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

import { boundingBox, distanceMeters, type LatLng } from '@/lib/geo';
import type { CategoryFilter, Venue, VenueCategory } from '@/lib/types';

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

/** Which OSM amenity keys belong to each app section, so a pull made while a
 *  section is active actually returns venues *for that section*. */
const CATEGORY_AMENITIES: Record<Exclude<CategoryFilter, 'all'>, string[]> = {
  bar: ['bar', 'pub', 'biergarten'],
  pub: ['pub', 'bar', 'biergarten'],
  cafe: ['cafe', 'ice_cream'],
  restaurant: ['restaurant', 'fast_food', 'food_court'],
  club: ['nightclub'],
  event: ['events_venue', 'music_venue', 'nightclub'],
  // "other" has no OSM discovery signature — pull everything instead.
  other: [],
};

function amenitiesFor(category: CategoryFilter): string[] | null {
  if (category === 'all') return null;
  const list = CATEGORY_AMENITIES[category];
  return list && list.length ? list : null;
}

export type OverpassVenue = Omit<Venue, 'id' | 'source' | 'expiresAt'> & { osmType: 'node' | 'way' | 'relation' };

function buildQuery(center: LatLng, radiusM: number, limit: number, amenities: string[] | null): string {
  const box = boundingBox(center, radiusM);
  const all = ['bar', 'pub', 'nightclub', 'cafe', 'restaurant', 'biergarten', 'food_court', 'ice_cream', 'fast_food'];
  const amenityValues = (amenities ?? all).filter((v) => v !== 'nightclub');
  const wantClubs = !amenities || amenities.includes('nightclub');
  const around = `(around:${Math.round(radiusM)},${center.lat},${center.lng})`;
  // `around:` keeps the result set to a real circle; the bbox variant is what
  // the Postgres side uses for its index scan.
  const selectors = [
    amenityValues.length ? `node["amenity"~"^(${amenityValues.join('|')})$"]${around};` : null,
    amenityValues.length ? `way["amenity"~"^(${amenityValues.join('|')})$"]${around};` : null,
    wantClubs ? `node["leisure"="dance"]${around};` : null,
  ]
    .filter(Boolean)
    .join('\n  ');
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
  ['ice_cream', 'cafe'],
  ['food_court', 'restaurant'],
  ['biergarten', 'bar'],
];

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_id?: number; street?: string; city?: string };
};

async function fetchPhotonVenues(
  center: LatLng,
  radiusM: number,
  amenities: string[] | null,
): Promise<OverpassVenue[]> {
  const km = Math.min(10, Math.max(1, Math.round(radiusM / 1000)));
  const values = PHOTON_VALUES.filter(([v]) => !amenities || amenities.includes(v));
  const out: OverpassVenue[] = [];
  const seen = new Set<string>();
  let failures = 0;

  // Photon's public service asks for ~1 req/s. A parallel burst gets 429s
  // (no CORS headers → "TypeError: Failed to fetch" in browsers), so go
  // sequential with a small pause; a section-scoped pull only needs a few
  // amenity types anyway.
  for (const [value, category] of values) {
    try {
      const url = `https://photon.komoot.io/reverse?lat=${center.lat}&lon=${center.lng}&radius=${km}&osm_tag=${encodeURIComponent(`amenity:${value}`)}&limit=50`;
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`Photon ${res.status}`);
      const json = (await res.json()) as { features?: PhotonFeature[] };
      for (const f of json.features ?? []) {
        const p = f.properties ?? {};
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const name = (p.name ?? '').trim();
        if (!name || lat == null || lng == null) continue;
        // Photon's radius is a hint, not a circle — enforce the real one so
        // everything we insert is something fetchVenues(radius) will return.
        if (distanceMeters(center, { lat, lng }) > radiusM * 1.1) continue;
        const osmId = `node/${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`;
        if (seen.has(osmId)) continue;
        seen.add(osmId);
        const street = [p.street, p.city].filter(Boolean).join(', ');
        out.push({ name, lat, lng, category, osmId, address: street || null, osmType: 'node' });
      }
    } catch {
      failures++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (out.length === 0 && failures === values.length && values.length > 0) {
    throw new Error('all Photon requests failed');
  }
  return out;
}

/** Geocode a free-text place ("Ikeja") so discovery can move there. */
export async function geocodePlace(q: string): Promise<(LatLng & { label: string }) | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/api?q=${encodeURIComponent(q)}&limit=1`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { name?: string; city?: string; country?: string };
      }>;
    };
    const f = j.features?.[0];
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    if (lat == null || lng == null) return null;
    const p = f?.properties ?? {};
    const label = [p.name ?? q, p.city ?? p.country].filter(Boolean).slice(0, 2).join(', ');
    return { lat, lng, label };
  } catch {
    return null;
  }
}

/**
 * Discover venues: Photon first (fast, CORS-open, reliable), Overpass second
 * (richer — ways + more categories — but its public mirrors are often slow or
 * blocked). Throws only when *both* fail; callers decide whether to fall back
 * to cached rows or seed data.
 */
async function fetchOverpassVenues(
  center: LatLng,
  radiusM: number,
  limit: number,
  timeoutMs: number,
  amenities: string[] | null,
): Promise<OverpassVenue[]> {
  const query = buildQuery(center, radiusM, limit, amenities);
  // Race the mirrors in parallel under one budget: whichever answers first
  // with elements wins; a slow or blocked mirror no longer stalls the pull.
  const results = await Promise.allSettled(
    OVERPASS_ENDPOINTS.map(async (endpoint) => {
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
        if (out.length === 0) throw new Error('Overpass empty');
        return out;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }
  throw new Error('all Overpass mirrors failed');
}

function dedupeKey(v: OverpassVenue): string {
  return `${v.name.toLowerCase()}|${v.lat.toFixed(4)},${v.lng.toFixed(4)}`;
}

/**
 * Discover venues from BOTH sources in parallel and merge: Photon (fast,
 * CORS-open, reliable) plus Overpass (richer — ways + more categories) when a
 * mirror answers within budget. Throws only when *both* fail; callers decide
 * whether to fall back to cached rows or seed data.
 */
export async function fetchOsmVenues(
  center: LatLng,
  radiusM: number,
  limit = 300,
  timeoutMs = 9000,
  category: CategoryFilter = 'all',
): Promise<OverpassVenue[]> {
  const amenities = amenitiesFor(category);
  const [photon, overpass] = await Promise.allSettled([
    fetchPhotonVenues(center, radiusM, amenities),
    fetchOverpassVenues(center, radiusM, limit, timeoutMs, amenities),
  ]);

  const merged: OverpassVenue[] = [];
  const seen = new Set<string>();
  const add = (list: OverpassVenue[]) => {
    for (const v of list) {
      const byKey = dedupeKey(v);
      const byId = v.osmId ?? byKey;
      if (seen.has(byId) || seen.has(byKey)) continue;
      seen.add(byId);
      seen.add(byKey);
      merged.push(v);
    }
  };
  if (photon.status === 'fulfilled') add(photon.value);
  if (overpass.status === 'fulfilled') add(overpass.value);

  if (merged.length === 0) {
    throw new Error(
      `OSM discovery unreachable (Photon: ${
        photon.status === 'rejected' ? String(photon.reason) : 'empty'
      }; Overpass: ${
        overpass.status === 'rejected' ? String(overpass.reason) : 'empty'
      })`,
    );
  }
  return merged.slice(0, limit);
}
