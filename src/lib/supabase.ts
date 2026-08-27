/**
 * The single Supabase client.
 *
 * Auth is email + password only — no magic link, no SMS OTP. Session
 * persistence uses AsyncStorage so a native app stays signed in across
 * launches; on web the same adapter falls back to localStorage.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or run without them to use demo mode.',
    );
  }
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Expo has no browser URL to parse the token from.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'spotcheck/0.1' },
    },
  });
  return client;
}

export type Database = {
  public: {
    Tables: {
      venues: {
        Row: {
          id: string;
          name: string;
          lat: number;
          lng: number;
          category: string;
          osm_id: string | null;
          address: string | null;
          source: string;
          created_at: string;
        };
      };
      checkins: {
        Row: {
          id: string;
          venue_id: string;
          user_id: string;
          vibe_value: number;
          tags: string[];
          created_at: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          handle: string | null;
          trust_score: number;
          created_at: string;
        };
      };
    };
  };
};
