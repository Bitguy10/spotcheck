/**
 * Tiny persisted preferences store (units + discovery radius).
 *
 * Lives outside React so any formatter can read it synchronously, while
 * components that must re-render on change subscribe via usePrefs().
 */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Units = 'km' | 'mi';
export type Prefs = { units: Units; radiusM: number };

const KEY = 'spotcheck.prefs.v1';
export const RADIUS_OPTIONS = [2000, 5000, 10000] as const;

let state: Prefs = { units: 'km', radiusM: 2000 };
const listeners = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<Prefs>;
    state = {
      units: p.units === 'mi' ? 'mi' : 'km',
      radiusM: (RADIUS_OPTIONS as readonly number[]).includes(Number(p.radiusM))
        ? Number(p.radiusM)
        : 2000,
    };
    listeners.forEach((l) => l());
  })
  .catch(() => undefined);

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(patch: Partial<Prefs>): void {
  state = { ...state, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
