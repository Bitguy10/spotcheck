// sync-venues — server-side OpenStreetMap pull + cache.
//
// OSM is the *seed* source. This runs with the service key so the heavy pull
// and normalisation happen once, off-client, and land in `venues`. Every read
// afterwards is served from Postgres. Global by construction: the query is
// "categories within a radius of these coordinates" — no region allowlist.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const AMENITY = '^(bar|pub|nightclub|cafe|restaurant|biergarten|food_court|ice_cream|fast_food)$';

const CATEGORY: Record<string, string> = {
  bar: 'bar', pub: 'pub', nightclub: 'club', cafe: 'cafe', restaurant: 'restaurant',
  biergarten: 'bar', food_court: 'restaurant', ice_cream: 'cafe', fast_food: 'restaurant',
};

type El = { type: 'node' | 'way'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const radius = Number(body.radius_m ?? 2000);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'lat/lng required' }, 400);

    const query = `[out:json][timeout:25];
(
  node["amenity"~"${AMENITY}"](around:${Math.round(radius)},${lat},${lng});
  way["amenity"~"${AMENITY}"](around:${Math.round(radius)},${lat},${lng});
  node["leisure"="dance"](around:${Math.round(radius)},${lat},${lng});
);
out center tags 300;`;

    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return json({ inserted: 0, skipped: 0, error: `overpass ${res.status}` }, 502);
    const data = (await res.json()) as { elements?: El[] };

    const seen = new Set<string>();
    const rows: { name: string; lat: number; lng: number; category: string; osm_id: string; address: string | null; source: string }[] = [];
    for (const el of data.elements ?? []) {
      const elat = el.lat ?? el.center?.lat;
      const elng = el.lon ?? el.center?.lon;
      if (elat == null || elng == null || !el.tags?.name) continue;
      const key = el.tags.amenity ?? (el.tags.leisure === 'dance' ? 'nightclub' : '');
      if (!CATEGORY[key]) continue;
      const osmId = `${el.type}/${el.id}`;
      if (seen.has(osmId)) continue;
      seen.add(osmId);
      rows.push({
        name: el.tags.name.trim(),
        lat: elat,
        lng: elng,
        category: CATEGORY[key],
        osm_id: osmId,
        address: [el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(', ') || null,
        source: 'osm',
      });
    }

    let inserted = 0;
    let skipped = 0;
    // upsert on the unique osm_id
    const { error } = await admin.from('venues').upsert(
      rows.map((r) => ({ ...r })),
      { onConflict: 'osm_id', ignoreDuplicates: false },
    );
    if (error) return json({ inserted: 0, skipped: rows.length, error: error.message }, 500);
    inserted = rows.length;

    return json({ inserted, skipped });
  } catch (e) {
    return json({ inserted: 0, skipped: 0, error: String(e) }, 500);
  }
});
