import Constants from 'expo-constants';

/**
 * Runtime configuration.
 *
 * SpotCheck runs in two modes:
 *  - **supabase**: EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY are
 *    set. Real auth, real Postgres, real Realtime, Edge Functions compute scores.
 *  - **demo**: those vars are absent. A local in-memory backend seeds venues and
 *    simulates other people checking in, so the whole loop is explorable
 *    without provisioning anything. No feature is stubbed out — the same
 *    interfaces, the same decay math, the same UI.
 */

type Extra = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_EDGE_ORIGIN?: string;
  EXPO_PUBLIC_DEMO_CENTER_LAT?: string;
  EXPO_PUBLIC_DEMO_CENTER_LNG?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

// Static `process.env.EXPO_PUBLIC_*` member expressions are inlined by Metro at
// build time; a dynamic `process.env[key]` is not. So every var we care about is
// referenced literally here. `extra` (app.json) is the runtime fallback.
const str = (a: string | undefined, b: string | undefined) => (a && a.trim() ? a.trim() : b?.trim() || undefined);

export const SUPABASE_URL = str(process.env.EXPO_PUBLIC_SUPABASE_URL, extra.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = str(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, extra.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const DATA_MODE: 'supabase' | 'demo' = isSupabaseConfigured ? 'supabase' : 'demo';

/** Edge Functions origin — override for self-hosted / staging. */
export const EDGE_ORIGIN = str(process.env.EXPO_PUBLIC_EDGE_ORIGIN, extra.EXPO_PUBLIC_EDGE_ORIGIN) || SUPABASE_URL;

/**
 * Where the app centres itself before the browser/OS grants location.
 * Defaults to Victoria Island, Lagos. Override with EXPO_PUBLIC_DEMO_CENTER_*.
 *
 * This is a *fallback viewport*, not a region lock: discovery is always
 * "GPS coordinates + radius" and works for any coordinates on Earth.
 */
export const FALLBACK_CENTER = {
  lat: Number(str(process.env.EXPO_PUBLIC_DEMO_CENTER_LAT, extra.EXPO_PUBLIC_DEMO_CENTER_LAT)) || 6.4281,
  lng: Number(str(process.env.EXPO_PUBLIC_DEMO_CENTER_LNG, extra.EXPO_PUBLIC_DEMO_CENTER_LNG)) || 3.4219,
  label: 'Victoria Island, Lagos',
};

/** Search radius for "near you", metres. */
export const DISCOVERY_RADIUS_M = 2000;

export const APP_NAME = 'SpotCheck';
export const APP_VERSION = '0.1.0';
