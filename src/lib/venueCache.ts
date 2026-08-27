/**
 * Per-area venue cache so the pulse strip is never a blank screen.
 *
 * Memory map for synchronous hydration when the viewer moves between visited
 * areas; AsyncStorage persistence so a returning visitor sees last time's
 * rows instantly while the authoritative server fetch refreshes them
 * (stale-while-revalidate — scores are always replaced by the server).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { VenueWithVibe } from './types';

const STORAGE_KEY = 'spotcheck.vcache.v1';
const MAX_AREAS = 4;

const mem = new Map<string, VenueWithVibe[]>();

export function cachedVenuesSync(key: string): VenueWithVibe[] | null {
  return mem.get(key) ?? null;
}

export function rememberVenues(key: string, rows: VenueWithVibe[]): void {
  mem.set(key, rows);
  void persist(key, rows);
}

export async function cachedVenues(key: string): Promise<VenueWithVibe[] | null> {
  const inMem = mem.get(key);
  if (inMem) return inMem;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Array<{ key: string; rows: VenueWithVibe[] }>;
    const hit = all.find((e) => e.key === key);
    if (hit?.rows?.length) {
      mem.set(key, hit.rows);
      return hit.rows;
    }
  } catch {
    /* a broken cache is just a slow first paint */
  }
  return null;
}

async function persist(key: string, rows: VenueWithVibe[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Array<{ key: string; rows: VenueWithVibe[] }>) : [];
    const next = [{ key, rows }, ...all.filter((e) => e.key !== key)].slice(0, MAX_AREAS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — memory cache still helps this session */
  }
}
