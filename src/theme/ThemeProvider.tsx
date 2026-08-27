import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme as nativewindColorScheme } from 'nativewind';

import {
  DEFAULT_PREFERENCE,
  THEME_STORAGE_KEY,
  resolveMode,
  themes,
  type Theme,
  type ThemeMode,
  type ThemePreference,
} from './tokens';
import { vibeColor as vibeColorFor } from '@/lib/vibe';

type ThemeContextValue = {
  theme: Theme;
  mode: ThemeMode;
  preference: ThemePreference;
  /** the vibe spectrum colour for a value, already adjusted for this theme */
  vibeColor: (value: number | null) => string;
  setPreference: (p: ThemePreference) => void;
  cycle: () => void;
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useSystemColorScheme() as ThemeMode | null;
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!alive) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => alive && setHydrated(true));
    return () => {
      alive = false;
    };
  }, []);

  const mode = resolveMode(preference, system);
  const theme = themes[mode];

  // Keep NativeWind's `dark:` variants in step with an explicit user override,
  // not just the OS. This is what makes the Light/Dark/System toggle real
  // for every className-driven surface.
  useEffect(() => {
    nativewindColorScheme.set(mode);
  }, [mode]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(THEME_STORAGE_KEY, p).catch(() => undefined);
  }, []);

  const cycle = useCallback(() => {
    setPreferenceState((prev) => {
      const next = CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length];
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

  const vibeColor = useCallback(
    (value: number | null) => vibeColorFor(value, mode, theme.faint),
    [mode, theme.faint],
  );

  const value = useMemo(
    () => ({ theme, mode, preference, vibeColor, setPreference, cycle, hydrated }),
    [theme, mode, preference, vibeColor, setPreference, cycle, hydrated],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
