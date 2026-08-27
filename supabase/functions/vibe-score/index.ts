// vibe-score — authoritative, server-computed vibe for one venue.
// The client renders this; it never derives its own public score.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let venueId: string | undefined;
    if (req.method === 'GET') {
      venueId = new URL(req.url).searchParams.get('venue_id') ?? undefined;
    } else {
      const body = await req.json().catch(() => ({}));
      venueId = body.venue_id;
    }
    if (!venueId) return json({ error: 'venue_id required' }, 400);

    const { data, error } = await admin.rpc('vibe_score_for_venue', { p_venue: venueId }).single();
    if (error || !data) return json({ value: null, active_checkins: 0, total_checkins: 0, last_checkin_at: null, is_live: false, confidence: 'none' });

    return json({
      value: data.value,
      active_checkins: data.active,
      total_checkins: data.total,
      last_checkin_at: data.last_checkin_at,
      is_live: data.is_live,
      confidence: data.confidence,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
