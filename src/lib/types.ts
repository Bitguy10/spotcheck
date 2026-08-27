import type { VibeScore } from './vibe';
import type { Tag } from './tags';

export type VenueCategory = 'bar' | 'restaurant' | 'cafe' | 'club' | 'pub' | 'event' | 'other';

export type Venue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: VenueCategory;
  /** OpenStreetMap source reference, e.g. "node/123456789" or "way/98765" */
  osmId: string | null;
  /** Street / neighbourhood, from OSM `addr:*` when present. */
  address: string | null;
  /** Where the row came from: seeded demo data, an OSM pull, or user-submitted. */
  source: 'osm' | 'seed' | 'user';
  /** ephemeral events vanish after this; permanent venues are null */
  expiresAt: number | null;
};

export type VibeHistory = {
  /** index 0=Mon … 6=Sun, average vibe or null when no data */
  byDay: (number | null)[];
  /** 24 buckets, average vibe or null */
  byHour: (number | null)[];
  sampleSize: number;
};

export type Checkin = {
  id: string;
  venueId: string;
  userId: string;
  /** 0 (chill/teal) … 100 (hot/red) */
  vibeValue: number;
  tags: Tag[];
  createdAt: number;
  /** set when the submitting user is the signed-in user */
  mine?: boolean;
};

/** A venue + its live, server-computed score + its distance from the viewer. */
export type VenueWithVibe = Venue & {
  score: VibeScore;
  distanceMeters: number | null;
};

export type VibeFilter = 'all' | 'chill' | 'moderate' | 'hot';
export type CategoryFilter = 'all' | VenueCategory;
export type SortMode = 'distance' | 'vibe' | 'live';

export type VenueFilters = {
  vibe: VibeFilter;
  category: CategoryFilter;
  sort: SortMode;
  query: string;
};

export const DEFAULT_FILTERS: VenueFilters = {
  vibe: 'all',
  category: 'all',
  sort: 'distance',
  query: '',
};

export type AuthUser = { id: string; email: string };

export type Session = { user: AuthUser } | null;

export type CheckinResult =
  | { ok: true; checkin: Checkin; score: VibeScore }
  | { ok: false; code: 'too_far'; distanceMeters: number }
  | { ok: false; code: 'no_venue' }
  | { ok: false; code: 'auth_required' }
  | { ok: false; code: 'invalid_vibe' }
  | { ok: false; code: 'rate_limited' }
  | { ok: false; code: 'network' };

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string; code?: string };

export type OsmSyncResult = { inserted: number; skipped: number; source: 'overpass' | 'cache' };

export type CheckinSubmittedEvent = { venueId: string; checkin: Checkin };
