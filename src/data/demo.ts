/**
 * Demo backend — SpotCheck with no Supabase project attached.
 *
 * This is not a mock of the UI; it is a complete implementation of the data
 * contract that happens to live in memory:
 *   · venues are seeded relative to wherever the viewer is, so the app is
 *     explorable anywhere on Earth (proving discovery is coordinates + radius,
 *     not a region list)
 *   · check-ins decay in real time with the same engine the SQL uses, so a
 *     venue you leave open will visibly cool down and grey out
 *   · a background simulator plays the part of other people, so the pulse
 *     strip, the live counter and Realtime all behave before anyone else exists
 *
 * When EXPO_PUBLIC_SUPABASE_* are set, none of this loads — getBackend() picks
 * supabase-backend instead.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { distanceMeters, type LatLng } from '@/lib/geo';
import {
  CHECKIN_GRACE_RADIUS_M,
  computeVibeScore,
  EMPTY_SCORE,
  type VibeScore,
} from '@/lib/vibe';
import { isKnownTag, type Tag } from '@/lib/tags';
import type {
  AuthResult,
  AuthUser,
  Checkin,
  CheckinResult,
  CheckinSubmittedEvent,
  OsmSyncResult,
  Session,
  Venue,
  VenueCategory,
  VenueWithVibe,
  VibeHistory,
} from '@/lib/types';
import type { SpotCheckBackend, Unsubscribe } from './backend';
import { fetchOsmVenues } from './overpass';

const USER_KEY = 'spotcheck.demo.user';
const MIN = 60_000;

/* ------------------------------------------------------------------ *
 * Seed venues
 * ------------------------------------------------------------------ */

type Seed = {
  name: string;
  category: VenueCategory;
  /** metres east / north of the viewer */
  east: number;
  north: number;
  /** what this place usually feels like, 0 (dead) – 100 (heaving) */
  personality: number;
  /** starting state so every UI state is on screen at first paint */
  state: 'live' | 'cooling' | 'stale' | 'empty';
};

const SEEDS: Seed[] = [
  { name: 'The Rooftop', category: 'bar', east: -90, north: 120, personality: 82, state: 'live' },
  { name: 'Coffee Lab', category: 'cafe', east: 60, north: 40, personality: 28, state: 'live' },
  { name: 'Social Club', category: 'club', east: 210, north: -180, personality: 91, state: 'live' },
  { name: 'Buka & Bass', category: 'restaurant', east: -240, north: -90, personality: 68, state: 'live' },
  { name: 'The Wine Room', category: 'bar', east: 330, north: 260, personality: 46, state: 'cooling' },
  { name: 'Iroko Grill', category: 'restaurant', east: -410, north: 320, personality: 58, state: 'cooling' },
  { name: 'The Quiet Room', category: 'cafe', east: 150, north: 420, personality: 16, state: 'cooling' },
  { name: 'Admiralty Social', category: 'bar', east: 520, north: -340, personality: 74, state: 'cooling' },
  { name: 'Palm Court Kitchen', category: 'restaurant', east: -620, north: -520, personality: 52, state: 'stale' },
  { name: 'Vinyl & Vine', category: 'bar', east: 700, north: 610, personality: 79, state: 'stale' },
  { name: 'Late Lounge', category: 'club', east: -820, north: 540, personality: 88, state: 'stale' },
  { name: 'Sunset Suya Spot', category: 'restaurant', east: 380, north: -680, personality: 63, state: 'stale' },
  { name: 'Sky Terrace', category: 'bar', east: 980, north: -220, personality: 71, state: 'empty' },
  { name: 'The Bistro', category: 'restaurant', east: -1040, north: -780, personality: 49, state: 'empty' },
  { name: 'The Grind House', category: 'cafe', east: 260, north: 860, personality: 24, state: 'empty' },
  { name: 'Cocoa & Crumb', category: 'cafe', east: -300, north: 980, personality: 19, state: 'empty' },
  { name: 'Skyline Bar', category: 'bar', east: 1180, north: 420, personality: 77, state: 'empty' },
  { name: 'Table Nine', category: 'restaurant', east: -1240, north: 160, personality: 55, state: 'empty' },
];

function project(center: LatLng, east: number, north: number): LatLng {
  const lat = center.lat + north / 111_320;
  const lng = center.lng + east / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return { lat, lng };
}

function venueFromSeed(seed: Seed, index: number, center: LatLng): Venue {
  const { lat, lng } = project(center, seed.east, seed.north);
  return {
    id: `demo-${index + 1}`,
    name: seed.name,
    lat,
    lng,
    category: seed.category,
    osmId: null,
    address: null,
    source: 'seed',
    expiresAt: null,
  };
}

/* ------------------------------------------------------------------ *
 * Simulation helpers
 * ------------------------------------------------------------------ */

let rngState = 0x2f6e2b1;
function rng(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 0xffffffff;
}

function sample(personality: number, spread = 16): number {
  const noise = (rng() + rng() - 1) * spread;
  return Math.min(100, Math.max(0, Math.round(personality + noise)));
}

function pickAge(state: Seed['state']): number {
  switch (state) {
    case 'live':
      return rng() * 8; // 0–8 min → breathing dot
    case 'cooling':
      return 14 + rng() * 22; // 14–36 min → scored, quiet
    case 'stale':
      return 70 + rng() * 180; // past the decay window → greyed out
    default:
      return 0;
  }
}

const HOT_TAGS: Tag[] = ['Packed', 'Line outside', 'Great energy', 'Loud'];
const CHILL_TAGS: Tag[] = ['Empty', 'Quiet', 'Dead crowd', 'Just opened'];

function sampleTags(vibe: number): Tag[] {
  if (rng() > 0.62) return [];
  const pool = vibe >= 62 ? HOT_TAGS : vibe <= 38 ? CHILL_TAGS : ['Half full', 'Good playlist', 'Cozy'] as Tag[];
  const first = pool[Math.floor(rng() * pool.length)];
  if (rng() > 0.72) {
    const second = pool[Math.floor(rng() * pool.length)];
    if (second !== first) return [first, second];
  }
  return [first];
}

let idCounter = 1000;
const nextId = () => `demo-checkin-${idCounter++}`;

/* ------------------------------------------------------------------ *
 * The backend
 * ------------------------------------------------------------------ */

type Listener = (event: CheckinSubmittedEvent) => void;

class DemoBackend implements SpotCheckBackend {
  readonly kind = 'demo' as const;

  private venues: Venue[] = [];
  private osmVenues: Venue[] = [];
  private center: LatLng = { lat: 6.4281, lng: 3.4219 };
  private checkins = new Map<string, Checkin[]>();
  private venueListeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private user: AuthUser | null = null;
  private events: Venue[] = [];
  private eventCounter = 0;
  private favorites = new Set<string>();
  private favsLoaded = false;
  private authListeners = new Set<(s: Session) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seeded = false;
  private todayBase = 1180;

  /* -- bootstrap ---------------------------------------------------- */

  private ensureVenues(center: LatLng) {
    // Re-project the seed grid only when the viewer actually moved; venue ids
    // must stay stable or every subscription would leak.
    const moved =
      distanceMeters(this.center, center) > 250 || this.venues.length !== SEEDS.length;
    if (!moved && this.seeded) return;

    this.center = center;
    this.venues = SEEDS.map((s, i) => venueFromSeed(s, i, center));
    if (!this.seeded) {
      this.seedCheckins();
      this.seeded = true;
      this.startSimulator();
    } else {
      // viewer moved: re-project coordinates but keep the check-in history
      this.venues = SEEDS.map((s, i) => venueFromSeed(s, i, center));
    }
  }

  private seedCheckins() {
    const now = Date.now();
    SEEDS.forEach((seed, i) => {
      const venueId = `demo-${i + 1}`;
      const list: Checkin[] = [];
      const count =
        seed.state === 'live'
          ? 3 + Math.floor(rng() * 3)
          : seed.state === 'cooling'
            ? 2 + Math.floor(rng() * 2)
            : seed.state === 'stale'
              ? 4 + Math.floor(rng() * 5)
              : 0;

      for (let n = 0; n < count; n++) {
        const vibe = sample(seed.personality);
        list.push({
          id: nextId(),
          venueId,
          userId: `demo-user-${1 + Math.floor(rng() * 40)}`,
          vibeValue: vibe,
          tags: sampleTags(vibe),
          createdAt: now - pickAge(seed.state) * MIN,
        });
      }
      if (list.length) this.checkins.set(venueId, list.sort((a, b) => b.createdAt - a.createdAt));
    });
  }

  /** Other people, checking in while you browse. */
  private startSimulator() {
    if (this.timer) return;
    const tick = () => {
      if (this.venues.length === 0) return;
      const seedIndex = Math.floor(rng() * SEEDS.length);
      const seed = SEEDS[seedIndex];
      const venueId = `demo-${seedIndex + 1}`;
      const vibe = sample(seed.personality);
      const checkin: Checkin = {
        id: nextId(),
        venueId,
        userId: `demo-user-${1 + Math.floor(rng() * 40)}`,
        vibeValue: vibe,
        tags: sampleTags(vibe),
        createdAt: Date.now(),
      };
      this.pushCheckin(checkin);
      const delay = 5000 + rng() * 9000;
      this.timer = setTimeout(tick, delay) as unknown as ReturnType<typeof setInterval>;
    };
    this.timer = setTimeout(tick, 4000) as unknown as ReturnType<typeof setInterval>;
  }

  private pushCheckin(checkin: Checkin) {
    const list = this.checkins.get(checkin.venueId) ?? [];
    list.unshift(checkin);
    this.checkins.set(checkin.venueId, list.slice(0, 200));

    const event: CheckinSubmittedEvent = { venueId: checkin.venueId, checkin };
    this.venueListeners.get(checkin.venueId)?.forEach((l) => l(event));
    this.globalListeners.forEach((l) => l(event));
  }

  /* -- auth --------------------------------------------------------- */

  async getSession(): Promise<Session> {
    if (!this.user) {
      try {
        const raw = await AsyncStorage.getItem(USER_KEY);
        if (raw) this.user = JSON.parse(raw) as AuthUser;
      } catch {
        this.user = null;
      }
    }
    return this.user ? { user: this.user } : null;
  }

  onAuthChange(cb: (session: Session) => void): Unsubscribe {
    this.authListeners.add(cb);
    this.getSession().then(cb);
    return () => this.authListeners.delete(cb);
  }

  private emitAuth() {
    const session = this.user ? { user: this.user } : null;
    this.authListeners.forEach((l) => l(session));
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    await new Promise((r) => setTimeout(r, 220));
    if (!email.includes('@') || password.length < 6) {
      return { ok: false, error: 'Check your email and password.' };
    }
    this.user = { id: `demo-user-${email.split('@')[0]}`, email };
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(this.user)).catch(() => undefined);
    this.emitAuth();
    return { ok: true, user: this.user };
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    return this.signIn(email, password);
  }

  async signOut(): Promise<void> {
    this.user = null;
    await AsyncStorage.removeItem(USER_KEY).catch(() => undefined);
    this.emitAuth();
  }

  /* -- venues ------------------------------------------------------- */

  async fetchVenues(center: LatLng, radiusM: number): Promise<VenueWithVibe[]> {
    this.ensureVenues(center);
    const now = Date.now();
    const all = [...this.osmVenues, ...this.venues, ...this.events];
    return all
      .filter((v) => (v.expiresAt ?? Infinity) > now) // expired events vanish
      .map((v) => ({
        ...v,
        distanceMeters: distanceMeters(center, v),
        score: computeVibeScore(this.checkins.get(v.id) ?? [], now),
      }))
      .filter((x) => x.distanceMeters <= radiusM)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  async getVenue(id: string): Promise<Venue | null> {
    if (this.venues.length === 0) this.ensureVenues(this.center);
    return [...this.osmVenues, ...this.venues, ...this.events].find((v) => v.id === id) ?? null;
  }

  /** Pull the real OSM layer for this area. Falls back to the seed grid. */
  async syncFromOSM(center: LatLng, radiusM: number): Promise<OsmSyncResult> {
    try {
      const raw = await fetchOsmVenues(center, radiusM, 250);
      this.osmVenues = raw.map((v, i) => ({
        id: `osm-${v.osmId}`,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        category: v.category,
        osmId: v.osmId,
        address: v.address,
        source: 'osm' as const,
        expiresAt: null,
      }));
      return { inserted: this.osmVenues.length, skipped: 0, source: 'overpass' };
    } catch {
      this.ensureVenues(center);
      return { inserted: this.venues.length, skipped: 0, source: 'cache' };
    }
  }

  /* -- vibe --------------------------------------------------------- */

  async getVibe(venueId: string): Promise<VibeScore> {
    const list = this.checkins.get(venueId);
    if (!list?.length) return EMPTY_SCORE;
    return computeVibeScore(list, Date.now());
  }

  /* -- check-ins ---------------------------------------------------- */

  async getCheckins(venueId: string, limit = 30): Promise<Checkin[]> {
    const list = this.checkins.get(venueId) ?? [];
    return list.slice(0, limit).map((c) => ({ ...c, mine: c.userId === this.user?.id }));
  }

  async submitCheckin(input: {
    venueId: string;
    vibeValue: number;
    tags: string[];
    at: LatLng;
    bypassGate?: boolean;
  }): Promise<CheckinResult> {
    const venue = await this.getVenue(input.venueId);
    if (!venue) return { ok: false, code: 'no_venue' };
    if (!Number.isFinite(input.vibeValue) || input.vibeValue < 0 || input.vibeValue > 100) {
      return { ok: false, code: 'invalid_vibe' };
    }

    // Parity with the server: max 3 check-ins per user per venue per hour.
    const uid = this.user?.id ?? 'demo-guest';
    const hourAgo = Date.now() - 60 * MIN;
    const recent = (this.checkins.get(input.venueId) ?? []).filter(
      (c) => c.userId === uid && c.createdAt > hourAgo,
    ).length;
    if (recent >= 3) return { ok: false, code: 'rate_limited' };

    const distance = distanceMeters(input.at, venue);
    // Same rule the Edge Function enforces. In demo mode it can be waived from
    // the UI (labelled as such); against Supabase it never can be.
    if (!input.bypassGate && distance > CHECKIN_GRACE_RADIUS_M) {
      return { ok: false, code: 'too_far', distanceMeters: distance };
    }

    const user = this.user ?? { id: 'demo-guest', email: 'guest@spotcheck.app' };
    const checkin: Checkin = {
      id: nextId(),
      venueId: input.venueId,
      userId: user.id,
      vibeValue: Math.round(input.vibeValue * 10) / 10,
      tags: input.tags.filter(isKnownTag),
      createdAt: Date.now(),
      mine: true,
    };
    this.pushCheckin(checkin);
    return { ok: true, checkin, score: await this.getVibe(input.venueId) };
  }

  /* -- realtime ----------------------------------------------------- */

  subscribeVenue(venueId: string, cb: Listener): Unsubscribe {
    let set = this.venueListeners.get(venueId);
    if (!set) {
      set = new Set();
      this.venueListeners.set(venueId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  subscribeGlobal(cb: Listener): Unsubscribe {
    this.globalListeners.add(cb);
    return () => this.globalListeners.delete(cb);
  }

  async countToday(): Promise<number> {
    let live = 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const cutoff = startOfDay.getTime();
    this.checkins.forEach((list) => {
      live += list.filter((c) => c.createdAt >= cutoff).length;
    });
    return this.todayBase + live;
  }

  /* -- favorites ---------------------------------------------------- */

  private async loadFavs() {
    if (this.favsLoaded) return;
    this.favsLoaded = true;
    try {
      const raw = await AsyncStorage.getItem('spotcheck.demo.favs');
      if (raw) (JSON.parse(raw) as string[]).forEach((id) => this.favorites.add(id));
    } catch {
      /* ignore */
    }
  }

  async getFavoriteIds(): Promise<string[]> {
    await this.loadFavs();
    return [...this.favorites];
  }

  async toggleFavorite(venueId: string): Promise<boolean> {
    await this.loadFavs();
    const saved = this.favorites.has(venueId);
    if (saved) this.favorites.delete(venueId);
    else this.favorites.add(venueId);
    AsyncStorage.setItem('spotcheck.demo.favs', JSON.stringify([...this.favorites])).catch(() => undefined);
    return !saved;
  }

  /* -- growth ------------------------------------------------------- */

  async createEvent(input: { name: string; at: LatLng; ttlMinutes: number }): Promise<
    { ok: true; id: string } | { ok: false; code: string }
  > {
    if (!input.name || input.name.trim().length < 2) return { ok: false, code: 'invalid_name' };
    this.eventCounter += 1;
    const id = `event-${this.eventCounter}`;
    this.events.push({
      id,
      name: input.name.trim(),
      lat: input.at.lat,
      lng: input.at.lng,
      category: 'event',
      osmId: null,
      address: null,
      source: 'user',
      expiresAt: Date.now() + input.ttlMinutes * MIN,
    });
    return { ok: true, id };
  }

  async getHistory(venueId: string): Promise<VibeHistory> {
    const byDay: (number | null)[] = Array(7).fill(null);
    const byHour: (number | null)[] = Array(24).fill(null);
    const dayAgg = new Map<number, { s: number; n: number }>();
    const hourAgg = new Map<number, { s: number; n: number }>();
    let sample = 0;
    for (const c of this.checkins.get(venueId) ?? []) {
      sample++;
      const d = new Date(c.createdAt);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const h = d.getHours();
      const da = dayAgg.get(dow) ?? { s: 0, n: 0 };
      da.s += c.vibeValue; da.n++; dayAgg.set(dow, da);
      const ha = hourAgg.get(h) ?? { s: 0, n: 0 };
      ha.s += c.vibeValue; ha.n++; hourAgg.set(h, ha);
    }
    dayAgg.forEach((v, k) => (byDay[k - 1] = Math.round((v.s / v.n) * 10) / 10));
    hourAgg.forEach((v, k) => (byHour[k] = Math.round((v.s / v.n) * 10) / 10));
    return { byDay, byHour, sampleSize: sample };
  }

  async purgeCache(_center: LatLng, _radiusM: number): Promise<number> {
    return 0;
  }

  async changePassword(_newPassword: string): Promise<{ ok: boolean; message?: string }> {
    return { ok: true };
  }

  async deleteAccount(): Promise<{ ok: boolean; message?: string }> {
    await this.signOut();
    return { ok: true };
  }
}

export const demoBackend = new DemoBackend();
