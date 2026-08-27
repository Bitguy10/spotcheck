-- 0005_settings.sql — account + cache-hygiene RPCs for the settings screen.
--
-- Both are SECURITY DEFINER so they can touch auth.users / skip RLS, and both
-- self-guard on auth.uid() so a missing token can never act.

-- Purge OSM-sourced venues around a point that never received a check-in and
-- nobody saved. Real signal (check-ins, favorites, events) always survives.
create or replace function public.purge_osm_cache(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision default 5000
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  delete from public.venues v
  where v.source = 'osm'
    and not exists (select 1 from public.checkins c where c.venue_id = v.id)
    and not exists (select 1 from public.favorites f where f.venue_id = v.id)
    and (select distance_m from public.haversine_m(p_lat, p_lng, v.lat, v.lng)) <= p_radius_m;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.purge_osm_cache(double precision, double precision, double precision) to authenticated;

-- Self-service account deletion. Favorites/checkins cascade via their FKs;
-- the profiles row is removed explicitly.
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

grant execute on function public.delete_own_account() to authenticated;
