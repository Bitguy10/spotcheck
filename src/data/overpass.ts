/**
 * OpenStreetMap discovery via the Overpass API.
 *
 * OSM is the *seed* source only. Nothing in the hot path depends on Overpass:
 * we pull venues for a bounding area, normalise them, and cache them into our
 * own `venues` table. Every subsequent dashboard load is served from Postgres.
 *
 * Coverage is global by construction — the query is "these categories, within
 * this radius of these coordinates". There is no country list, no region
 * allowlist, and no locale gating anywhere in this file.
 */

import { boundingBox, type LatLng } from '@/lib/geo';
import type { Venue, VenueCategory } from '@/lib/types';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** amenity/leisure values we treat as "somewhere you'd vibe-check". */
const OSM_TAGS: Record<string, VenueCategory> = {
  bar: 'bar',
  pub: 'pub',
  nightclub: 'club',
  cafe: 'cafe',
  restaurant: 'restaurant',
  biergarten: 'bar',
  food_court: 'restaurant',
  ice_cream: 'cafe',
  fast_food: 'restaurant',
  events_venue: 'event',
  music_venue: 'event',
};

const AMENITY_REGEX = `^(bar|pub|nightclub|cafe|restaurant|biergarten|food_court|ice_cream|fast_food)$`;

export type OverpassVenue = Omit<Venue, 'id' | 'source' | 'expiresAt'> & { osmType: 'node' | 'way' | 'relation' };

function buildQuery(center: LatLng, radiusM: number, limit: number): string {
  const box = boundingBox(center, radiusM);
  // `around:` keeps the result set to a real circle; the bbox variant is what
  // the Postgres side uses for its index scan.
  const selectors = [
    `node["amenity"~"${AMENITY_REGEX}"](around:${Math.round(radiusM)},${center.lat},${center.lng});`,
    `way["amenity"~"${AMENITY_REGEX}"](around:${Math.round(radiusM)},${center.lat},${center.lng});`,
    `node["leisure"="dance"](around:${Math.round(radiusM)},${center.lat},${center.lng});`,
  ].join('\n  ');
  return `[out:json][timeout:25];\n(\n  ${selectors}\n);\nout center tags ${limit};\n/* bbox ${box.south.toFixed(4)},${box.west.toFixed(4)},${box.north.toFixed(4)},${box.east.toFixed(4)} */`;
}

type RawElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function normalize(el: RawElement): OverpassVenue | null {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat === undefined || lng === undefined) return null;

  const tags = el.tags ?? {};
  const key = tags.amenity ?? (tags.leisure === 'dance' ? 'nightclub' : undefined);
  if (!key) return null;
  const category = OSM_TAGS[key] ?? 'other';

  const name = tags.name?.trim();
  if (!name) return null; // unnamed POIs are noise in a pulse strip

  const street = [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ');

  return {
    name,
    lat,
    lng,
    category,
    osmId: `${el.type}/${el.id}`,
    address: street.length ? street : null,
    osmType: el.type,
  };
}

/**
 * Photon (komoot) reverse-POI lookup — the resilient fallback when Overpass
 * mirrors are blocked/overloaded, and an enricher when Overpass returns an
 * empty (sparsely tagged) area. CORS-open and fast.
 */
const PHOTON_VALUES: Array<[string, VenueCategory]> = [
  ['cafe', 'cafe'],
  ['restaurant', 'restaurant'],
  ['fast_food', 'restaurant'],
  ['bar', 'bar'],
  ['pub', 'pub'],
  ['nightclub', 'club'],
];

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_id?: number; street?: string; city?: string };
};

async function fetchPhotonVenues(center: LatLng, radiusM: number): Promise<OverpassVenue[]> {
  const km = Math.min(10, Math.max(1, Math.round(radiusM / 1000)));
  const out: OverpassVenue[] = [];
  const seen = new Set<string>();

  const results = await Promise.allSettled(
    PHOTON_VALUES.map(async ([value, category]) => {
      const url = `https://photon.komoot.io/reverse?lat=${center.lat}&lon=${center.lng}&radius=${km}&osm_tag=${encodeURIComponent(`amenity:${value}`)}&limit=50`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      const json = (await res.json()) as { features?: PhotonFeature[] };
      const found: OverpassVenue[] = [];
      for (const f of json.features ?? []) {
        const p = f.properties ?? {};
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const name = (p.name ?? '').trim();
        if (!name || lat == null || lng == null) continue;
        const osmId = `node/${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`;
        const street = [p.street, p.city].filter(Boolean).join(', ');
        found.push({ name, lat, lng, category, osmId, address: street || null, osmType: 'node' });
      }
      return found;
    }),
  );

  let failures = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      failures++;
      continue;
    }
    for (const v of r.value) {
      const id = v.osmId ?? v.name;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(v);
    }
  }
  if (out.length === 0 && failures === results.length) {
    throw new Error('all Photon requests failed');
  }
  return out;
}

/**
 * Discover venues: Photon first (fast, CORS-open, reliable), Overpass second
 * (richer — ways + more categories — but its public mirrors are often slow or
 * blocked). Throws only when *both* fail; callers decide whether to fall back
 * to cached rows or seed data.
 */
export async function fetchOsmVenues(
  center: LatLng,
  radiusM: number,
  limit = 300,
  timeoutMs = 10000,
): Promise<OverpassVenue[]> {
  let photonError: unknown = null;
  try {
    const viaPhoton = await fetchPhotonVenues(center, radiusM);
    if (viaPhoton.length > 0) return viaPhoton;
  } catch (err) {
    photonError = err;
  }

  const query = buildQuery(center, radiusM, limit);
  let overpassError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements?: RawElement[] };
      const seen = new Set<string>();
      const out: OverpassVenue[] = [];
      for (const el of json.elements ?? []) {
        const v = normalize(el);
        if (!v || !v.osmId || seen.has(v.osmId)) continue;
        seen.add(v.osmId);
        out.push(v);
      }
      if (out.length > 0) return out;
    } catch (err) {
      overpassError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `OSM discovery unreachable (Photon: ${
      photonError instanceof Error ? photonError.message : 'empty'
    }; Overpass: ${overpassError instanceof Error ? overpassError.message : 'empty'})`,
  );
}
