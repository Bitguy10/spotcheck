/**
 * The MVP filter row: vibe level · category · sort. Anything beyond these is
 * explicitly deferred. Horizontal, thumb-reachable, single tap.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { CategoryFilter, SortMode, VenueFilters, VibeFilter } from '@/lib/types';

type ChipProps = {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
};

function Chip({ label, active, color, onPress }: ChipProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        marginRight: 8,
        borderWidth: 1,
        borderColor: active ? (color ?? theme.text) : theme.line,
        backgroundColor: active ? theme.subtle : 'transparent',
      }}
    >
      <Text
        style={{
          color: active ? (color ?? theme.text) : theme.muted,
          fontSize: 12,
          fontWeight: active ? '700' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type FilterRowProps = {
  filters: VenueFilters;
  onChange: (next: VenueFilters) => void;
};

const VIBES: { id: VibeFilter; label: string; color?: string }[] = [
  { id: 'all', label: 'All vibes' },
  { id: 'chill', label: 'Chill', color: '#4ECDC4' },
  { id: 'moderate', label: 'Moderate', color: '#FFD166' },
  { id: 'hot', label: 'Hot', color: '#FF5A5F' },
];

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'bar', label: 'Bars' },
  { id: 'restaurant', label: 'Food' },
  { id: 'cafe', label: 'Cafés' },
  { id: 'club', label: 'Clubs' },
];

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'distance', label: 'Nearest' },
  { id: 'vibe', label: 'Hottest' },
  { id: 'live', label: 'Live now' },
];

export function FilterRow({ filters, onChange }: FilterRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ height: 54, flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' }}
    >
      {VIBES.map((v) => (
        <Chip
          key={`v-${v.id}`}
          label={v.label}
          color={v.color}
          active={filters.vibe === v.id}
          onPress={() => onChange({ ...filters, vibe: v.id })}
        />
      ))}
      <View style={{ width: 1, height: 16, marginHorizontal: 4, backgroundColor: 'rgba(128,128,140,0.25)' }} />
      {CATEGORIES.map((c) => (
        <Chip
          key={`c-${c.id}`}
          label={c.label}
          active={filters.category === c.id}
          onPress={() => onChange({ ...filters, category: c.id })}
        />
      ))}
      <View style={{ width: 1, height: 16, marginHorizontal: 4, backgroundColor: 'rgba(128,128,140,0.25)' }} />
      {SORTS.map((s) => (
        <Chip key={`s-${s.id}`} label={`↕ ${s.label}`} active={filters.sort === s.id} onPress={() => onChange({ ...filters, sort: s.id })} />
      ))}
    </ScrollView>
  );
}

export default FilterRow;
