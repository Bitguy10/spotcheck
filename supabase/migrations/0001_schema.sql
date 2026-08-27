-- SpotCheck schema.
--
-- The decay / weighted-recency-average lives HERE, in Postgres, so the public
-- vibe of a venue is always computed server-side. The client never authors a
-- score; it only renders what these functions return.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- venues
create table if not exists public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  category    text not null default 'other',
  osm_id      text unique,
  address     text,
  source      text not null default 'osm' check (source in ('osm','seed','user')),
  created_at  timestamptz not null default now()
);
create index if not exists venues_lat_lng on public.venues (lat, lng);

-- ---------------------------------------------------------------- checkins
create table if not exists public.checkins (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  vibe_value  numeric not null check (vibe_value >= 0 and vibe_value <= 100),
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists checkins_venue_time on public.checkins (venue_id, created_at desc);
create index if not exists checkins_time on public.checkins (created_at desc);

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  handle      text,
  trust_score integer not null default 0,   -- reserved for a later wave
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ================================================================ decay math
--
-- weight(age) = (1 - age/window)^2, sliding to zero at the decay cutoff.
-- Mirrors src/lib/vibe.ts exactly.

create or replace function public.checkin_weight(age_min double precision, window_min double precision default 45)
returns double precision language sql immutable as $$
  select case when age_min >= window_min then 0 else power(1 - age_min / window_min, 2) end;
$$;

create or replace function public.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371008.8 * asin(sqrt(
      power(sin(radians((lat2 - lat1) / 2)), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)
  ));
$$;

-- The authoritative score for one venue.
create or replace function public.vibe_score_for_venue(p_venue uuid)
returns table (
  value          double precision,
  active         integer,
  total          integer,
  last_checkin_at timestamptz,
  is_live        boolean,
  confidence     text
) language sql stable as $$
  with scored as (
    select (vibe_value)::double precision as v,
           created_at,
           public.checkin_weight(extract(epoch from (now() - created_at)) / 60.0) as w
    from public.checkins
    where venue_id = p_venue
  ),
  agg as (
    select sum(w * v) / nullif(sum(w), 0) as raw_value,
           count(*) filter (where w > 0)::integer as active,
           count(*)::integer as total,
           max(created_at) as last
    from scored
  )
  select
    case when active >= 2 then raw_value else null end,
    active,
    total,
    last,
    last is not null and now() - last <= interval '10 minutes',
    case when active >= 5 then 'strong' when active >= 2 then 'ok' when active = 1 then 'thin' else 'none' end
  from agg;
$$;

-- The dashboard's single round-trip: venues near a point + their scores.
create or replace function public.venues_with_vibe(
  p_lat double precision, p_lng double precision,
  p_radius_m double precision, p_limit integer default 200
)
returns table (
  id uuid, name text, lat double precision, lng double precision,
  category text, osm_id text, address text, source text,
  distance_m double precision, vibe_value double precision,
  active_checkins integer, total_checkins integer,
  last_checkin_at timestamptz, is_live boolean, confidence text
) language sql stable as $$
  select v.id, v.name, v.lat, v.lng, v.category, v.osm_id, v.address, v.source,
         d.distance_m, s.value, s.active, s.total, s.last_checkin_at, s.is_live, s.confidence
  from public.venues v
  cross join lateral public.haversine_m(p_lat, p_lng, v.lat, v.lng) as d(distance_m)
  cross join lateral public.vibe_score_for_venue(v.id) as s
  where d.distance_m <= p_radius_m
  order by d.distance_m
  limit p_limit;
$$;

-- Landing-page counter.
create or replace function public.checkin_count_today()
returns integer language sql stable as $$
  select count(*)::integer from public.checkins where created_at >= current_date;
$$;

-- ================================================================ RLS
alter table public.venues enable row level security;
alter table public.checkins enable row level security;
alter table public.profiles enable row level security;

-- Reading is open; writing check-ins and venues is service-role only so the
-- Edge Functions own mutation (GPS verification, normalisation, rate limits).
create policy venues_read on public.venues for select to anon, authenticated using (true);
create policy checkins_read on public.checkins for select to anon, authenticated using (true);
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_own on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Realtime for the pulse.
do $$
begin
  alter publication supabase_realtime add table public.checkins;
exception when duplicate_object then null;
end $$;
