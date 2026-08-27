-- 0006_sandbox.sql — sandbox mode: full per-account data separation.
--
-- Every venue now belongs to the account that pulled or created it. An account
-- only ever sees venues (and therefore check-ins, events, gauges, feeds and
-- history) that it owns; new accounts start in an empty world and build it by
-- pulling from OpenStreetMap. Enforcement is server-side: owner column + RLS +
-- SECURITY DEFINER RPCs that filter/stamp auth.uid() — the client is never
-- trusted with visibility.
--
-- Legacy rows (pulled before this migration) are assigned the "nobody" owner
-- (all-zero uuid) so no existing account keeps data pulled by someone else.

-- 1. ownership column ---------------------------------------------------
alter table public.venues add column if not exists owner_id uuid;
update public.venues
   set owner_id = '00000000-0000-0000-0000-000000000000'
 where owner_id is null;
alter table public.venues alter column owner_id set default '00000000-0000-0000-0000-000000000000';
alter table public.venues alter column owner_id set not null;
create index if not exists venues_owner_idx on public.venues (owner_id);

-- 2. same OSM place may now exist once per account ------------------------
-- (osm_id is null for user/event venues; nulls are distinct in unique
-- indexes, so those rows are unaffected.)
alter table public.venues drop constraint if exists venues_osm_id_key;
create unique index if not exists venues_osm_owner_uq on public.venues (osm_id, owner_id);

-- 3. RLS: direct table reads (venue detail via URL, ad-hoc queries) return
-- only own rows. Writes stay inside SECURITY DEFINER RPCs (no write policy).
alter table public.venues enable row level security;
-- The old public-discovery policy (using true) would OR with the owner
-- policy and re-open every row — it must go for sandbox mode.
drop policy if exists venues_read on public.venues;
drop policy if exists venues_owner_select on public.venues;
create policy venues_owner_select on public.venues
  for select to anon, authenticated
  using (owner_id = auth.uid());

-- 4. discovery returns only the caller's own world ------------------------
-- (signed out → auth.uid() is null → empty, which is correct for sandbox.)
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
    and v.owner_id = auth.uid()
    and (v.expires_at is null or v.expires_at > now())
  order by d.distance_m
  limit p_limit;
$$;

-- 5. OSM ingest: stamp the caller; dedupe per (osm_id, owner) -------------
create or replace function public.upsert_osm_venues(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  r jsonb;
  n integer := 0;
begin
  if v_user is null then
    -- sandbox: anonymous pulls would be invisible to everyone — refuse
    -- instead of writing orphan rows.
    return jsonb_build_object('inserted', 0, 'skipped', 0);
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('inserted', 0, 'skipped', 0);
  end if;
  for r in select * from jsonb_array_elements(p_rows)
  loop
    if (r ? 'osm_id') and (r ? 'lat') and (r ? 'lng') and (r ? 'name') then
      insert into public.venues (name, lat, lng, category, osm_id, address, source, owner_id)
      values (
        nullif(r->>'name', ''),
        (r->>'lat')::double precision,
        (r->>'lng')::double precision,
        coalesce(nullif(r->>'category', ''), 'other'),
        r->>'osm_id',
        r->>'address',
        'osm',
        v_user
      )
      on conflict (osm_id, owner_id) do update set
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

-- 6. check-ins only on venues the caller owns -----------------------------
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

  if v_venue.owner_id is distinct from v_user then
    return jsonb_build_object('code', 'not_your_venue');
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
    'ok', true,
    'checkin_id', v_checkin.id,
    'created_at', v_checkin.created_at,
    'score', jsonb_build_object(
      'value', v_score.value,
      'active', v_score.active,
      'total', v_score.total,
      'last_checkin_at', v_score.last_checkin_at,
      'confidence', v_score.confidence
    )
  );
end;
$$;

-- 7. events belong to their creator ---------------------------------------
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

  insert into public.venues (name, lat, lng, category, source, expires_at, owner_id)
  values (
    trim(p_name), p_lat, p_lng,
    coalesce(nullif(p_category, ''), 'event'),
    'user',
    now() + (coalesce(p_ttl_minutes, 180) || ' minutes')::interval,
    v_user
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- 8. cache purge only touches the caller's own rows -----------------------
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
    and v.owner_id = auth.uid()
    and not exists (select 1 from public.checkins c where c.venue_id = v.id)
    and not exists (select 1 from public.favorites f where f.venue_id = v.id)
    -- haversine_m is a scalar function (0005 wrapped it in a bogus column
    -- select — that purge never ran; fixed here).
    and public.haversine_m(p_lat, p_lng, v.lat, v.lng) <= p_radius_m;
  get diagnostics n = row_count;
  return n;
end $$;

-- 9. account deletion takes the account's world with it -------------------
-- (checkins + favorites cascade off venues via their FKs.)
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;
  delete from public.venues where owner_id = auth.uid();
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
