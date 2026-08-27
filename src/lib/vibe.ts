/**
 * SpotCheck — vibe engine
 *
 * THE core model of the product: a venue's public score is a *weighted recency
 * average* over the check-ins that are still "active" (not yet decayed).
 * Older check-ins slide toward weight zero as they approach the decay cutoff,
 * so a venue's gauge always describes *right now*, never a lifetime average.
 *
 * ⚠️  This module is the single source of truth for the math, but it is NOT the
 *     authority in production. The authoritative implementation is the Postgres
 *     function `vibe_score_for_venue()` (supabase/migrations/0001_schema.sql),
 *     exposed through the `vibe-score` Edge Function. The client must never be
 *     trusted to compute a public score.
 *
 *     This TS mirror exists for exactly three legitimate uses:
 *       1. Demo/offline mode (no Supabase project configured).
 *       2. Optimistic UI — predicting the local dot's effect for ~300ms before
 *          the server's authoritative value arrives over Realtime.
 *       3. Unit tests, which assert TS ≡ SQL by feeding both the same fixtures.
 */

/** Minutes a check-in keeps influencing a venue's score. Spec: 30–60. */
export const DECAY_WINDOW_MIN = 45;

/** A venue shows a public gauge only with at least this many active check-ins. */
export const MIN_CHECKINS_FOR_SCORE = 2;

/** Under this age a venue is "live" and its row breathes. */
export const LIVE_WINDOW_MIN = 10;

/** GPS grace radius for accepting a check-in. Spec: 100–150m. */
export const CHECKIN_GRACE_RADIUS_M = 150;

export type CheckinLike = {
  vibeValue: number;
  /** epoch ms, ISO string, or Date */
  createdAt: number | string | Date;
};

export type Confidence = 'none' | 'thin' | 'ok' | 'strong';

export type VibeScore = {
  /** 0 = dead chill (teal) … 100 = heaving (red). null when data is insufficient. */
  value: number | null;
  /** check-ins still inside the decay window */
  activeCheckins: number;
  /** every check-in handed in, decayed or not — used for the row's "n checks" label */
  totalCheckins: number;
  lastCheckinAt: number | null;
  /** true when the newest check-in is inside LIVE_WINDOW_MIN */
  isLive: boolean;
  confidence: Confidence;
};

export const EMPTY_SCORE: VibeScore = {
  value: null,
  activeCheckins: 0,
  totalCheckins: 0,
  lastCheckinAt: null,
  isLive: false,
  confidence: 'none',
};

export function toEpochMs(t: number | string | Date): number {
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function ageMinutes(createdAt: number | string | Date, now: number): number {
  return Math.max(0, (now - toEpochMs(createdAt)) / 60000);
}

/**
 * Recency weight.
 *
 * (1 - r)² where r = age / window:
 *   r = 0.00 → 1.00   (just tapped — full voice)
 *   r = 0.25 → 0.56
 *   r = 0.50 → 0.25
 *   r = 0.75 → 0.06
 *   r = 1.00 → 0.00   (fully decayed — drops out of the calculation)
 *
 * A quadratic rather than a linear ramp so a fresh check-in dominates the
 * gauge while a 40-minute-old one is nearly silent but not yet invisible.
 * Matches the SQL: POWER(GREATEST(0, 1 - age/window), 2).
 */
export function checkinWeight(ageMin: number, windowMin: number = DECAY_WINDOW_MIN): number {
  if (!(ageMin >= 0)) return 1;
  if (windowMin <= 0) return 1;
  const r = ageMin / windowMin;
  if (r >= 1) return 0;
  const w = (1 - r) * (1 - r);
  return w;
}

export function computeVibeScore(
  checkins: readonly CheckinLike[],
  now: number = Date.now(),
  opts: { windowMin?: number; minForScore?: number } = {},
): VibeScore {
  const windowMin = opts.windowMin ?? DECAY_WINDOW_MIN;
  const minForScore = opts.minForScore ?? MIN_CHECKINS_FOR_SCORE;

  let weightedSum = 0;
  let weightTotal = 0;
  let active = 0;
  let last: number | null = null;

  for (const c of checkins) {
    const at = toEpochMs(c.createdAt);
    if (last === null || at > last) last = at;

    const w = checkinWeight(ageMinutes(at, now), windowMin);
    if (w <= 0) continue;

    active += 1;
    weightedSum += w * clampVibe(c.vibeValue);
    weightTotal += w;
  }

  const isLive = last !== null && (now - last) / 60000 <= LIVE_WINDOW_MIN;

  if (active < minForScore || weightTotal <= 0) {
    return {
      value: null,
      activeCheckins: active,
      totalCheckins: checkins.length,
      lastCheckinAt: last,
      isLive,
      confidence: active === 0 ? 'none' : 'thin',
    };
  }

  return {
    value: round1(weightedSum / weightTotal),
    activeCheckins: active,
    totalCheckins: checkins.length,
    lastCheckinAt: last,
    isLive,
    confidence: active >= 5 ? 'strong' : 'ok',
  };
}

export function clampVibe(v: number): number {
  if (!Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(0, v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

export type VibeBucket = 'chill' | 'moderate' | 'hot';

export function vibeBucket(value: number | null): VibeBucket | null {
  if (value === null) return null;
  if (value < 35) return 'chill';
  if (value <= 65) return 'moderate';
  return 'hot';
}

export function vibeLabel(value: number | null): string {
  if (value === null) return 'No recent vibe check';
  if (value < 15) return 'Dead';
  if (value < 30) return 'Very chill';
  if (value < 45) return 'Chill';
  if (value < 60) return 'Mellow';
  if (value < 75) return 'Buzzing';
  if (value < 88) return 'Packed';
  return 'Heaving';
}

/** Human copy for the "not enough data" state. */
export function insufficientDataCopy(active: number): string {
  return active === 1
    ? 'One check-in so far — needs 2 to publish a vibe'
    : 'Not enough data yet';
}

/* ------------------------------------------------------------------ *
 * Colour: the vibe spectrum, identical in both themes
 * ------------------------------------------------------------------ */

export const VIBE = {
  teal: '#4ECDC4',
  amber: '#FFD166',
  red: '#FF5A5F',
} as const;

/** Deepened stops so the scale still reads on the #F5F3EF light base. */
const VIBE_LIGHT = {
  teal: '#0E9E97',
  amber: '#B8860B',
  red: '#E03A40',
} as const;

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * Map a vibe value to its spectrum colour.
 * Stops: 0 → teal, 50 → amber, 100 → red.
 */
export function vibeColor(value: number | null, mode: 'dark' | 'light' = 'dark', fallback = '#6B6F76'): string {
  if (value === null) return fallback;
  const stops = mode === 'light' ? VIBE_LIGHT : VIBE;
  const v = clampVibe(value);
  const teal = hexToRgb(stops.teal);
  const amber = hexToRgb(stops.amber);
  const red = hexToRgb(stops.red);
  if (v <= 50) return rgbToHex(mix(teal, amber, v / 50));
  return rgbToHex(mix(amber, red, (v - 50) / 50));
}

export function vibeColorDark(value: number | null): string {
  return vibeColor(value, 'dark');
}
export function vibeColorLight(value: number | null): string {
  return vibeColor(value, 'light');
}

/** Tailwind-safe class for a bucket chip. */
export function bucketClass(bucket: VibeBucket | null): string {
  switch (bucket) {
    case 'chill':
      return 'text-vibe-teal border-vibe-teal/40';
    case 'hot':
      return 'text-vibe-red border-vibe-red/40';
    case 'moderate':
      return 'text-vibe-amber border-vibe-amber/40';
    default:
      return 'text-mute border-line';
  }
}
