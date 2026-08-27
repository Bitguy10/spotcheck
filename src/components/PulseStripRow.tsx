/**
 * One row of the pulse strip. A row IS a gauge: the dot's position along the
 * teal→amber→red bar communicates the vibe at a glance — far more scannable
 * than a card with a badge.
 *
 * Three visual states:
 *   · live     → breathing dot + full-colour meter (check-in in last 10 min)
 *   · scored   → still meter, colour retained (active but not fresh)
 *   · stale    → grayed out, no breathing, "no recent vibe check"
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { PulseDot } from './PulseDot';
import { VibeMeter } from './VibeMeter';
import { useTheme } from '@/theme/ThemeProvider';
import { relativeTime, formatTtl } from '@/lib/time';
import { formatDistanceShort } from '@/lib/geo';
import { usePrefs } from '@/lib/prefs';
import { MIN_CHECKINS_FOR_SCORE, vibeLabel } from '@/lib/vibe';
import type { VenueWithVibe } from '@/lib/types';

const CATEGORY_EMOJI: Record<string, string> = {
  bar: '🍸',
  pub: '🍺',
  cafe: '☕️',
  restaurant: '🍽️',
  club: '🎧',
  event: '🎟️',
  other: '📍',
};

type RowProps = {
  venue: VenueWithVibe;
  onPress: () => void;
  now?: number;
};

export function PulseStripRow({ venue, onPress, now = Date.now() }: RowProps) {
  const { theme, vibeColor } = useTheme();
  const prefs = usePrefs();
  const { score } = venue;

  const hasScore = score.value !== null;
  const live = score.isLive;
  const stale = !hasScore;
  const label = hasScore ? vibeLabel(score.value) : venue.score.totalCheckins > 0 ? 'Gone quiet' : 'No recent vibe check';
  const accent = hasScore ? vibeColor(score.value) : theme.faint;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.subtle : theme.card,
        borderRadius: 18,
        // Catchy but honest: scored rows get a vibe-coloured border, quiet
        // rows a clearly visible neutral one. Never dim the whole card —
        // a discovered place must stay readable in light *and* dark mode.
        borderWidth: hasScore ? 1.5 : 1,
        borderColor: hasScore ? `${accent}88` : theme.line,
        padding: 14,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOpacity: pressed ? 0.05 : 0.09,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      })}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}, ${label}`}
    >
      {/* line 1 — identity */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PulseDot color={hasScore ? vibeColor(score.value) : theme.muted} size={8} breathing={live} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: theme.text,
            fontFamily: 'SpaceGrotesk',
            fontWeight: '600',
            fontSize: 16,
            letterSpacing: -0.3,
          }}
        >
          {venue.name}
        </Text>
        {venue.expiresAt ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: `${theme.spectrum[1]}22`, borderWidth: 1, borderColor: theme.spectrum[1] }}>
            <Text style={{ color: theme.spectrum[1], fontSize: 10, fontWeight: '700' }}>EVENT · {formatTtl(venue.expiresAt, now)}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.subtle, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
          <Text style={{ fontSize: 12 }}>{CATEGORY_EMOJI[venue.category] ?? '📍'}</Text>
          <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>
            {venue.distanceMeters != null ? formatDistanceShort(venue.distanceMeters, prefs.units) : ''}
          </Text>
        </View>
      </View>

      {/* line 2 — the gauge (the row itself) */}
      <View style={{ marginTop: 12 }}>
        <VibeMeter value={hasScore ? score.value : null} height={9} dimmed={stale} />
      </View>

      {/* line 3 — meta */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }}>
        <Text style={{ color: hasScore ? accent : theme.muted, fontSize: 12, fontWeight: hasScore ? '700' : '600' }}>
          {label}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {score.activeCheckins > 0
            ? `${score.activeCheckins} active`
            : `${score.totalCheckins} all-time`}
          {score.lastCheckinAt ? ` · ${relativeTime(score.lastCheckinAt, now)}` : ''}
        </Text>
      </View>

      {score.activeCheckins > 0 && score.activeCheckins < MIN_CHECKINS_FOR_SCORE ? (
        <Text style={{ color: theme.faint, fontSize: 11, marginTop: 6 }}>
          needs {MIN_CHECKINS_FOR_SCORE - score.activeCheckins} more to publish a vibe
        </Text>
      ) : null}
    </Pressable>
  );
}

export default PulseStripRow;
