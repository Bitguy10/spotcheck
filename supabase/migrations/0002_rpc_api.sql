-- RPC trust layer.
--
-- These SECURITY DEFINER functions are the server-side authority for the two
-- things the client must never be trusted with:
--   1. submitting a check-in (auth + GPS grace-radius + value bounds), and
--   2. ingesting normalised OSM venue rows.
--
-- They are the Postgres equivalent of the Deno Edge Functions in
-- supabase/functions/* (kept for reference / a CLI-deployed setup). Using RPCs
-- means the whole trust layer deploys with nothing but the DB connection
-- string, while preserving "never trust the client": the distance is measured
-- here against the venue's own lat/lng, and the score is recomputed here.

-- ================================================================ check-in
create or replace function public.submit_checkin(
  p_venue uuid,
  p_vibe  numeric,
  p_tags  text[] default '{}',
  p_lat   double precision default null,
  p_lng   double precision default null,
  p_grace double precision default 150
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_venue   public.venues%rowtype;
  v_user    uuid := auth.uid();
  v_dist    double precision;
  v_checkin public.checkins%rowtype;
  v_score   record;
begin
  if v_user is null then
    return jsonb_build_object('code', 'auth_required');
  end if;

  if p_vibe is null or p_vibe < 0 or p_vibe > 100 then
    return jsonb_build_object('code', 'invalid_vibe');
  end if;

  select * into v_venue from public.venues where id = p_venue;
  if not found then
    return jsonb_build_object('code', 'no_venue');
  end if;

  if p_lat is null or p_lng is null then
    return jsonb_build_object('code', 'too_far', 'distance_m', null);
  end if;

  v_dist := public.haversine_m(p_lat, p_lng, v_venue.lat, v_venue.lng);
  if v_dist > p_grace then
    return jsonb_build_object('code', 'too_far', 'distance_m', round(v_dist));
  end if;

  insert into public.checkins (venue_id, user_id, vibe_value, tags)
  values (p_venue, v_user, p_vibe, coalesce(p_tags, '{}'))
  returning * into v_checkin;

  select * into v_score from public.vibe_score_for_venue(p_venue);

  return jsonb_build_object(
    'checkin', jsonb_build_object(
      'id', v_checkin.id,
      'venue_id', v_checkin.venue_id,
      'user_id', v_checkin.user_id,
      'vibe_value', v_checkin.vibe_value,
      'tags', v_checkin.tags,
      'created_at', v_checkin.created_at
    ),
    'score', jsonb_build_object(
      'value', v_score.value,
      'active_checkins', v_score.active,
      'total_checkins', v_score.total,
      'last_checkin_at', v_score.last_checkin_at,
      'is_live', v_score.is_live,
      'confidence', v_score.confidence
    )
  );
end;
$$;

-- ================================================================ OSM ingest
create or replace function public.upsert_osm_venues(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('inserted', 0, 'skipped', 0);
  end if;
  for r in select * from jsonb_array_elements(p_rows)
  loop
    if (r ? 'osm_id') and (r ? 'lat') and (r ? 'lng') and (r ? 'name') then
      insert into public.venues (name, lat, lng, category, osm_id, address, source)
      values (
        nullif(r->>'name', ''),
        (r->>'lat')::double precision,
        (r->>'lng')::double precision,
        coalesce(nullif(r->>'category', ''), 'other'),
        r->>'osm_id',
        r->>'address',
        'osm'
      )
      on conflict (osm_id) do update set
        name = excluded.name,
        lat = excluded.lat,
        lng = excluded.lng,
        category = excluded.category,
        address = excluded.address;
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', n, 'skipped', 0);
end;
$$;

-- Grant execute to authenticated + anon (submit_checkin self-guards on auth.uid()).
grant execute on function public.submit_checkin(uuid, numeric, text[], double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.upsert_osm_venues(jsonb) to anon, authenticated;
