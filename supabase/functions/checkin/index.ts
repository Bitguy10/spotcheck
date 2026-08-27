// checkin — the only writer of check-ins.
//
// Enforces, server-side, what the client must never be trusted with:
//   1. authentication (a real user row)
//   2. GPS grace-radius verification against the venue's own lat/lng
//   3. value bounds
// Returns the freshly computed authoritative score so the client can apply it
// immediately.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const mapScore = (s: {
  value: number | null;
  active: number;
  total: number;
  last_checkin_at: string | null;
  is_live: boolean;
  confidence: string;
}) => ({
  value: s.value,
  active_checkins: s.active,
  total_checkins: s.total,
  last_checkin_at: s.last_checkin_at,
  is_live: s.is_live,
  confidence: s.confidence,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return json({ code: 'auth_required' }, 401);

    const body = await req.json();
    const venueId: string = body.venue_id;
    const vibeValue: number = Number(body.vibe_value);
    const tags: string[] = Array.isArray(body.tags) ? body.tags.slice(0, 2) : [];
    const lat: number = Number(body.lat);
    const lng: number = Number(body.lng);
    const grace: number = Number(body.grace_radius_m ?? 150);

    if (!Number.isFinite(vibeValue) || vibeValue < 0 || vibeValue > 100) {
      return json({ code: 'invalid_vibe' }, 422);
    }

    const { data: venue } = await admin
      .from('venues')
      .select('*')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue) return json({ code: 'no_venue' }, 404);

    // The grace-radius gate, measured here. A lying client loses.
    const distance = haversineM(lat, lng, venue.lat, venue.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || distance > grace) {
      return json({ code: 'too_far', distance_m: Math.round(distance) }, 409);
    }

    const { data: checkin, error } = await admin
      .from('checkins')
      .insert({ venue_id: venueId, user_id: auth.user.id, vibe_value: vibeValue, tags })
      .select()
      .single();
    if (error || !checkin) return json({ code: 'network' }, 500);

    const { data: scoreRow } = await admin.rpc('vibe_score_for_venue', { p_venue: venueId }).single();

    return json({
      checkin: {
        id: checkin.id,
        venue_id: checkin.venue_id,
        user_id: checkin.user_id,
        vibe_value: checkin.vibe_value,
        tags: checkin.tags ?? [],
        created_at: checkin.created_at,
      },
      score: scoreRow ? mapScore(scoreRow) : null,
    });
  } catch (e) {
    return json({ code: 'network', detail: String(e) }, 500);
  }
});
