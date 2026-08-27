-- Wave 3 (growth): historical vibe patterns + ephemeral event check-ins.
--
-- Events reuse `venues` with category 'event' and an `expires_at`. Discovery
-- ignores expired rows, so an event is on the map for its window, then gone.
-- History aggregates the raw verified signal by day-of-week x hour so the app
-- can say "usually packed on Friday nights" — complementary to "right now".

alter table public.venues add column if not exists expires_at timestamptz;

-- ================================================================ discovery
-- Return type changed (added expires_at), so drop then recreate.
drop function if exists public.venues_with_vibe(double precision, double precision, double precision, integer);
create or replace function public.venues_with_vibe(
  p_lat double precision, p_lng double precision,
  p_radius_m double precision, p_limit integer default 200
)
returns table (
  id uuid, name text, lat double precision, lng double precision,
  category text, osm_id text, address text, source text,
  distance_m double precision, vibe_value double precision,
  active_checkins integer, total_checkins integer,
  last_checkin_at timestamptz, is_live boolean, confidence text,
  expires_at timestamptz
) language sql stable as $$
  select v.id, v.name, v.lat, v.lng, v.category, v.osm_id, v.address, v.source,
         d.distance_m, s.value, s.active, s.total, s.last_checkin_at, s.is_live, s.confidence,
         v.expires_at
  from public.venues v
  cross join lateral public.haversine_m(p_lat, p_lng, v.lat, v.lng) as d(distance_m)
  cross join lateral public.vibe_score_for_venue(v.id) as s
  where d.distance_m <= p_radius_m
    and (v.expires_at is null or v.expires_at > now())
  order by d.distance_m
  limit p_limit;
$$;

-- ================================================================ history
create or replace function public.venue_vibe_history(p_venue uuid)
returns table (dow integer, hour integer, avg_value double precision, n bigint)
language sql stable as $$
  select extract(isodow from created_at)::integer as dow,
         extract(hour from created_at)::integer as hour,
         avg(vibe_value::double precision) as avg_value,
         count(*) as n
  from public.checkins
  where venue_id = p_venue
  group by 1, 2;
$$;

-- ================================================================ events
create or replace function public.create_event(
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_ttl_minutes integer default 180,
  p_category text default 'event'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then
    return jsonb_build_object('code', 'auth_required');
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    return jsonb_build_object('code', 'invalid_name');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('code', 'no_location');
  end if;

  insert into public.venues (name, lat, lng, category, source, expires_at)
  values (
    trim(p_name), p_lat, p_lng,
    coalesce(nullif(p_category, ''), 'event'),
    'user',
    now() + (coalesce(p_ttl_minutes, 180) || ' minutes')::interval
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.create_event(text, double precision, double precision, integer, text) to authenticated;
grant execute on function public.venue_vibe_history(uuid) to anon, authenticated;
