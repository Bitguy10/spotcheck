/**
 * Supabase backend.
 *
 * Rules this file exists to enforce:
 *   1. Scores are never computed here. Every vibe value the UI shows comes from
 *      Postgres (`venues_with_vibe` / `vibe_score_for_venue`) or from the
 *      `vibe-score` Edge Function.
 *   2. Check-ins are never inserted directly. They go through the `checkin`
 *      Edge Function, which re-measures the GPS distance against the venue's
 *      own lat/lng and rejects anything outside the grace radius — a client
 *      that lies about its coordinates gets a `too_far` back.
 *   3. Live updates arrive over Postgres change subscriptions. No polling
 *      loop exists anywhere in the app.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';
import { distanceMeters, type LatLng } from '@/lib/geo';
import { CHECKIN_GRACE_RADIUS_M, EMPTY_SCORE, type VibeScore } from '@/lib/vibe';
import { isKnownTag } from '@/lib/tags';
import type {
  AuthResult,
  AuthUser,
  Checkin,
  CheckinResult,
  CheckinSubmittedEvent,
  OsmSyncResult,
  Session,
  Venue,
  VenueWithVibe,
  VibeHistory,
} from '@/lib/types';
import type { SpotCheckBackend, Unsubscribe } from './backend';

type VibeRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  osm_id: string | null;
  address: string | null;
  source: string;
  distance_m: number;
  vibe_value: number | null;
  active_checkins: number;
  total_checkins: number;
  last_checkin_at: string | null;
  is_live: boolean;
  confidence: string;
  expires_at: string | null;
};

type CheckinRow = {
  id: string;
  venue_id: string;
  user_id: string;
  vibe_value: number;
  tags: string[] | null;
  created_at: string;
};

function rowToVenue(r: VibeRow): Venue {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    category: (r.category as Venue['category']) ?? 'other',
    osmId: r.osm_id,
    address: r.address,
    source: (r.source as Venue['source']) ?? 'osm',
    expiresAt: r.expires_at ? Date.parse(r.expires_at) : null,
  };
}

function rowToCheckin(r: CheckinRow, myId?: string): Checkin {
  return {
    id: r.id,
    venueId: r.venue_id,
    userId: r.user_id,
    vibeValue: r.vibe_value,
    tags: (r.tags ?? []).filter(isKnownTag),
    createdAt: Date.parse(r.created_at),
    mine: myId ? r.user_id === myId : undefined,
  };
}

function mapAuthError(err: unknown): AuthResult {
  const e = err as { message?: string; code?: string } | null;
  return { ok: false, error: e?.message ?? 'Something went wrong.', code: e?.code };
}

class SupabaseBackend implements SpotCheckBackend {
  readonly kind = 'supabase' as const;

  private get sb() {
    return getSupabase();
  }

  /* -- auth --------------------------------------------------------- */

  async getSession(): Promise<Session> {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return { user: { id: user.id, email: user.email ?? '' } satisfies AuthUser };
  }

  onAuthChange(cb: (session: Session) => void): Unsubscribe {
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ? { user: { id: session.user.id, email: session.user.email ?? '' } } : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.user) return mapAuthError(error ?? new Error('Sign-in failed'));
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? email } };
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { source: 'spotcheck-mvp' } },
    });
    if (error) return mapAuthError(error);
    if (!data.user) return { ok: false, error: 'Check your inbox to confirm your email.' };
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? email } };
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  /* -- venues ------------------------------------------------------- */

  async fetchVenues(center: LatLng, radiusM: number): Promise<VenueWithVibe[]> {
    const { data, error } = await this.sb.rpc('venues_with_vibe', {
      p_lat: center.lat,
      p_lng: center.lng,
      p_radius_m: radiusM,
      p_limit: 200,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as VibeRow[]).map((r) => ({
      ...rowToVenue(r),
      distanceMeters: r.distance_m,
      score: {
        value: r.vibe_value,
        activeCheckins: r.active_checkins,
        totalCheckins: r.total_checkins,
        lastCheckinAt: r.last_checkin_at ? Date.parse(r.last_checkin_at) : null,
        isLive: r.is_live,
        confidence: (r.confidence as VibeScore['confidence']) ?? 'none',
      },
    }));
  }

  async getVenue(id: string): Promise<Venue | null> {
    const { data, error } = await this.sb.from('venues').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const d = data as typeof data & { expires_at?: string | null };
    return {
      id: d.id,
      name: d.name,
      lat: d.lat,
      lng: d.lng,
      category: (d.category as Venue['category']) ?? 'other',
      osmId: d.osm_id,
      address: d.address,
      source: (d.source as Venue['source']) ?? 'osm',
      expiresAt: d.expires_at ? Date.parse(d.expires_at) : null,
    };
  }

  /**
   * Server-side Overpass pull + cache. The client fetches the public OSM feed
   * (CORS-friendly), then the `upsert_osm_venues` RPC normalises + writes it so
   * the service key never leaves the server and the shape stays validated.
   */
  async syncFromOSM(center: LatLng, radiusM: number): Promise<OsmSyncResult> {
    // Errors propagate: the UI prefers an honest "discovery failed" note over a
    // silent "serving 0 cached venues".
    const { fetchOsmVenues } = await import('./overpass');
    const raw = await fetchOsmVenues(center, radiusM, 250);
    const rows = raw.map((v) => ({
      name: v.name,
      lat: v.lat,
      lng: v.lng,
      category: v.category,
      osm_id: v.osmId,
      address: v.address,
    }));
    const { data, error } = await this.sb.rpc('upsert_osm_venues', { p_rows: rows });
    if (error) throw new Error(error.message);
    const d = data as { inserted?: number; skipped?: number };
    return { inserted: d?.inserted ?? rows.length, skipped: d?.skipped ?? 0, source: 'overpass' };
  }

  /* -- vibe --------------------------------------------------------- */

  /** Authoritative, server-computed (Postgres). */
  async getVibe(venueId: string): Promise<VibeScore> {
    const { data, error } = await this.sb.rpc('vibe_score_for_venue', { p_venue: venueId }).single();
    if (error || !data) return EMPTY_SCORE;
    const d = data as {
      value: number | null;
      active: number;
      total: number;
      last_checkin_at: string | null;
      is_live: boolean;
      confidence: string;
    };
    return {
      value: d.value,
      activeCheckins: d.active,
      totalCheckins: d.total,
      lastCheckinAt: d.last_checkin_at ? Date.parse(d.last_checkin_at) : null,
      isLive: d.is_live,
      confidence: (d.confidence as VibeScore['confidence']) ?? 'none',
    };
  }

  /* -- check-ins ---------------------------------------------------- */

  async getCheckins(venueId: string, limit = 30): Promise<Checkin[]> {
    const session = await this.getSession();
    const { data, error } = await this.sb
      .from('checkins')
      .select('id, venue_id, user_id, vibe_value, tags, created_at')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CheckinRow[]).map((r) => rowToCheckin(r, session?.user.id));
  }

  async submitCheckin(input: {
    venueId: string;
    vibeValue: number;
    tags: string[];
    at: LatLng;
    bypassGate?: boolean;
  }): Promise<CheckinResult> {
    // `bypassGate` is deliberately ignored: `submit_checkin` re-measures the
    // distance against the venue's own lat/lng. A demo convenience must never
    // become a production hole.
    const { data, error } = await this.sb.rpc('submit_checkin', {
      p_venue: input.venueId,
      p_vibe: input.vibeValue,
      p_tags: input.tags.filter(isKnownTag),
      p_lat: input.at.lat,
      p_lng: input.at.lng,
      p_grace: CHECKIN_GRACE_RADIUS_M,
    });

    if (error) {
      const venue = await this.getVenue(input.venueId).catch(() => null);
      const fallback = venue ? distanceMeters(input.at, venue) : CHECKIN_GRACE_RADIUS_M + 1;
      if (/permission|denied|auth/i.test(String(error.message))) return { ok: false, code: 'auth_required' };
      return { ok: false, code: 'too_far', distanceMeters: fallback };
    }

    const d = data as {
      code?: string;
      distance_m?: number | null;
      checkin?: CheckinRow;
      score?: {
        value: number | null;
        active_checkins: number;
        total_checkins: number;
        last_checkin_at: string | null;
        is_live: boolean;
        confidence: string;
      };
    };

    if (d?.code === 'too_far') return { ok: false, code: 'too_far', distanceMeters: d.distance_m ?? Infinity };
    if (d?.code === 'no_venue') return { ok: false, code: 'no_venue' };
    if (d?.code === 'auth_required') return { ok: false, code: 'auth_required' };
    if (d?.code === 'invalid_vibe') return { ok: false, code: 'invalid_vibe' };
    if (d?.code === 'rate_limited') return { ok: false, code: 'rate_limited' };
    if (!d?.checkin || !d?.score) return { ok: false, code: 'network' };

    const session = await this.getSession();
    return {
      ok: true,
      checkin: rowToCheckin(d.checkin, session?.user.id),
      score: {
        value: d.score.value,
        activeCheckins: d.score.active_checkins,
        totalCheckins: d.score.total_checkins,
        lastCheckinAt: d.score.last_checkin_at ? Date.parse(d.score.last_checkin_at) : null,
        isLive: d.score.is_live,
        confidence: (d.score.confidence as VibeScore['confidence']) ?? 'none',
      },
    };
  }

  /* -- realtime ----------------------------------------------------- */

  private chanSeq = 0;
  private subscribe(filter: string | undefined, cb: (e: CheckinSubmittedEvent) => void): Unsubscribe {
    // The client dedupes channels by name, so every subscription needs a unique
    // key or a second `postgres_changes` handler on a reused channel throws.
    const key = `${filter ? `checkins:${filter}` : 'checkins:global'}#${++this.chanSeq}`;
    const channel: RealtimeChannel = this.sb.channel(key, { config: { broadcast: { self: false } } });
    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'checkins',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          const r = payload.new as CheckinRow;
          if (!r?.id) return;
          cb({ venueId: r.venue_id, checkin: rowToCheckin(r) });
        },
      )
      .subscribe();

    return () => {
      this.sb.removeChannel(channel);
    };
  }

  subscribeVenue(venueId: string, cb: (e: CheckinSubmittedEvent) => void): Unsubscribe {
    return this.subscribe(`venue_id=eq.${venueId}`, cb);
  }

  subscribeGlobal(cb: (e: CheckinSubmittedEvent) => void): Unsubscribe {
    return this.subscribe(undefined, cb);
  }

  async countToday(): Promise<number> {
    const { data, error } = await this.sb.rpc('checkin_count_today');
    if (error) return 0;
    return Number(data ?? 0);
  }

  /* -- favorites (wave 2) ------------------------------------------ */

  async getFavoriteIds(): Promise<string[]> {
    const session = await this.getSession();
    if (!session) return [];
    const { data, error } = await this.sb.from('favorites').select('venue_id').eq('user_id', session.user.id);
    if (error) return [];
    return (data ?? []).map((r) => r.venue_id as string);
  }

  async toggleFavorite(venueId: string): Promise<boolean> {
    const session = await this.getSession();
    if (!session) return false;
    const uid = session.user.id;
    const { data } = await this.sb.from('favorites').select('venue_id').eq('user_id', uid).eq('venue_id', venueId);
    if (data && data.length) {
      await this.sb.from('favorites').delete().eq('user_id', uid).eq('venue_id', venueId);
      return false;
    }
    await this.sb.from('favorites').insert({ user_id: uid, venue_id: venueId });
    return true;
  }

  /* -- growth (wave 3) --------------------------------------------- */

  async getHistory(venueId: string): Promise<VibeHistory> {
    const byDay: (number | null)[] = Array(7).fill(null);
    const byHour: (number | null)[] = Array(24).fill(null);
    const dayW: number[] = Array(7).fill(0);
    const hourW: number[] = Array(24).fill(0);
    let sample = 0;

    const { data, error } = await this.sb.rpc('venue_vibe_history', { p_venue: venueId });
    if (error || !data) return { byDay, byHour, sampleSize: 0 };

    for (const r of data as { dow: number; hour: number; avg_value: number; n: number }[]) {
      const n = Number(r.n);
      sample += n;
      if (r.dow >= 1 && r.dow <= 7) {
        const i = r.dow - 1;
        byDay[i] = ((byDay[i] ?? 0) * dayW[i] + r.avg_value * n) / (dayW[i] + n);
        dayW[i] += n;
      }
      if (r.hour >= 0 && r.hour <= 23) {
        const i = r.hour;
        byHour[i] = ((byHour[i] ?? 0) * hourW[i] + r.avg_value * n) / (hourW[i] + n);
        hourW[i] += n;
      }
    }
    return {
      byDay: byDay.map((v, i) => (dayW[i] ? Math.round((v as number) * 10) / 10 : null)),
      byHour: byHour.map((v, i) => (hourW[i] ? Math.round((v as number) * 10) / 10 : null)),
      sampleSize: sample,
    };
  }

  async createEvent(input: { name: string; at: LatLng; ttlMinutes: number }): Promise<
    { ok: true; id: string } | { ok: false; code: string }
  > {
    const { data, error } = await this.sb.rpc('create_event', {
      p_name: input.name,
      p_lat: input.at.lat,
      p_lng: input.at.lng,
      p_ttl_minutes: input.ttlMinutes,
    });
    if (error) return { ok: false, code: 'network' };
    const d = data as { id?: string; code?: string };
    if (d?.id) return { ok: true, id: d.id };
    return { ok: false, code: d?.code ?? 'network' };
  }
}

export const supabaseBackend = new SupabaseBackend();
