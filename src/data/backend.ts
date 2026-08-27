/**
 * The data contract the UI is built against.
 *
 * Two implementations, one interface:
 *   - `supabaseBackend`  → real auth, Postgres, Realtime, Edge Functions
 *   - `demoBackend`      → in-memory, seeded, self-simulating
 *
 * Nothing in `app/` or `src/components/` may import an implementation directly.
 * Screens call `getBackend()` and get whichever is configured. That is what
 * lets the exact same UI run on a laptop with no Supabase project and on a
 * phone pointed at production.
 */

import type { LatLng } from '@/lib/geo';
import type { VibeScore } from '@/lib/vibe';
import type {
  AuthResult,
  Checkin,
  CheckinResult,
  CheckinSubmittedEvent,
  OsmSyncResult,
  Session,
  Venue,
  VenueWithVibe,
  VibeHistory,
} from '@/lib/types';

export type Unsubscribe = () => void;

export interface SpotCheckBackend {
  readonly kind: 'demo' | 'supabase';

  /* auth — email + password only. No magic link, no SMS OTP. */
  getSession(): Promise<Session>;
  onAuthChange(cb: (session: Session) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;

  /* venues — served from our own cache, seeded from OSM when thin.
     Scores arrive already computed by the server; the client only sorts them. */
  fetchVenues(center: LatLng, radiusM: number): Promise<VenueWithVibe[]>;
  getVenue(id: string): Promise<Venue | null>;
  syncFromOSM(center: LatLng, radiusM: number): Promise<OsmSyncResult>;

  /* vibe — always server-computed. The client never authors a public score. */
  getVibe(venueId: string): Promise<VibeScore>;

  /* check-ins */
  getCheckins(venueId: string, limit?: number): Promise<Checkin[]>;
  submitCheckin(input: {
    venueId: string;
    vibeValue: number;
    tags: string[];
    at: LatLng;
    /**
     * Demo-mode only. The Supabase backend ignores this: the `checkin` Edge
     * Function re-measures the distance itself and rejects out-of-radius posts
     * no matter what the client claims.
     */
    bypassGate?: boolean;
  }): Promise<CheckinResult>;

  /* realtime — Postgres change subscriptions, never polling */
  subscribeVenue(venueId: string, cb: (event: CheckinSubmittedEvent) => void): Unsubscribe;
  subscribeGlobal(cb: (event: CheckinSubmittedEvent) => void): Unsubscribe;

  /* saved venues (wave 2) */
  getFavoriteIds(): Promise<string[]>;
  /** returns the new saved state */
  toggleFavorite(venueId: string): Promise<boolean>;

  /* growth (wave 3) */
  getHistory(venueId: string): Promise<VibeHistory>;
  createEvent(input: { name: string; at: LatLng; ttlMinutes: number }): Promise<
    { ok: true; id: string } | { ok: false; code: string }
  >;

  /** "1,247 vibe checks today" — the landing page's liveness proof. */
  countToday(): Promise<number>;
}

let instance: SpotCheckBackend | null = null;

export async function getBackend(): Promise<SpotCheckBackend> {
  if (instance) return instance;
  const { DATA_MODE } = await import('@/lib/config');
  if (DATA_MODE === 'supabase') {
    const { supabaseBackend } = await import('./supabase-backend');
    instance = supabaseBackend;
  } else {
    const { demoBackend } = await import('./demo');
    instance = demoBackend;
  }
  return instance;
}

/** Test hook. */
export function __setBackendForTests(backend: SpotCheckBackend | null) {
  instance = backend;
}
