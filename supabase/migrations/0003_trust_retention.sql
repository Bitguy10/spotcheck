-- Wave 2: anti-abuse rate limiting + saved venues.
--
-- Rate limiting lives INSIDE submit_checkin so it is enforced server-side no
-- matter what the client does: a user may log at most RATE_MAX check-ins per
-- venue per RATE_WINDOW. This is the deferred "anti-abuse" item, delivered as a
-- trust guarantee rather than a client courtesy.

-- ================================================================ rate limit
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
  v_recent  integer;
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

  -- anti-abuse: at most 3 check-ins per user per venue per hour
  select count(*) into v_recent
  from public.checkins
  where user_id = v_user
    and venue_id = p_venue
    and created_at > now() - interval '60 minutes';
  if v_recent >= 3 then
    return jsonb_build_object('code', 'rate_limited');
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

-- ================================================================ favorites
create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  venue_id   uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);
create index if not exists favorites_user on public.favorites (user_id);

alter table public.favorites enable row level security;
create policy fav_select on public.favorites for select to authenticated using (auth.uid() = user_id);
create policy fav_insert on public.favorites for insert to authenticated with check (auth.uid() = user_id);
create policy fav_delete on public.favorites for delete to authenticated using (auth.uid() = user_id);
