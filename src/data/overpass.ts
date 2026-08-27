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
 * Query Overpass. Throws on failure — callers decide whether to fall back to
 * cached rows (normal) or seed data (demo / first run).
 */
export async function fetchOsmVenues(
  center: LatLng,
  radiusM: number,
  limit = 300,
  timeoutMs = 15000,
): Promise<OverpassVenue[]> {
  const query = buildQuery(center, radiusM, limit);
  let lastError: unknown = null;

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
      return out;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Overpass unreachable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
