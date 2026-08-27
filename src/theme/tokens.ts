/**
 * Design tokens.
 *
 * Two bases — #12131A (dark, deep charcoal-navy, never pure black) and #F5F3EF
 * (light, warm off-white) — plus one vibe spectrum that is deliberately
 * identical in both so a venue's colour means the same thing everywhere.
 */

import { VIBE } from '@/lib/vibe';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

export type Theme = {
  mode: ThemeMode;
  isDark: boolean;

  /** app background */
  bg: string;
  /** header / sticky bars */
  raised: string;
  /** cards, sheets, rows */
  card: string;
  /** hairlines and dividers */
  line: string;
  /** pressed / hovered surface */
  subtle: string;

  /** primary text — display face */
  text: string;
  /** secondary / metadata — #6B6F76 family */
  muted: string;
  /** tertiary, disabled, stale rows */
  faint: string;

  /** scrim behind modals and sheets */
  scrim: string;

  /** the vibe spectrum stops, teal → amber → red */
  spectrum: [string, string, string];
  /** muted track behind the gauge */
  track: string;

  /** map surface so the map never fights the shell */
  mapBg: string;
  mapLabel: string;
};

const dark: Theme = {
  mode: 'dark',
  isDark: true,
  bg: '#12131A',
  raised: '#171922',
  card: '#1C1F2B',
  line: '#2A2E3D',
  subtle: '#232735',
  text: '#F2F4F8',
  muted: '#8E939C',
  faint: '#5C616B',
  scrim: 'rgba(6, 7, 11, 0.72)',
  spectrum: [VIBE.teal, VIBE.amber, VIBE.red],
  track: '#242838',
  mapBg: '#0E1017',
  mapLabel: '#8E939C',
};

const light: Theme = {
  mode: 'light',
  isDark: false,
  bg: '#F5F3EF',
  raised: '#FBFAF7',
  card: '#FFFFFF',
  line: '#E4E0D8',
  subtle: '#EFEBE3',
  text: '#16181F',
  muted: '#6B6F76',
  faint: '#9A9DA4',
  scrim: 'rgba(24, 24, 28, 0.42)',
  // Same hues, deepened so the scale still separates on warm off-white.
  spectrum: ['#0E9E97', '#C08A0C', '#E03A40'],
  track: '#E8E4DB',
  mapBg: '#EDE9E1',
  mapLabel: '#6B6F76',
};

export const themes = { dark, light };

export const DEFAULT_PREFERENCE: ThemePreference = 'system';

export const THEME_STORAGE_KEY = 'spotcheck.theme';

export function resolveMode(pref: ThemePreference, system: ThemeMode | null | undefined): ThemeMode {
  if (pref === 'system') return system === 'light' ? 'light' : 'dark';
  return pref;
}

export const THEME_OPTIONS: { id: ThemePreference; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Follows your device' },
  { id: 'light', label: 'Light', hint: 'Warm off-white' },
  { id: 'dark', label: 'Dark', hint: 'Charcoal-navy' },
];
