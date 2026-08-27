/**
 * The read-only gradient meter — the dot's position along the red↔teal bar is
 * the venue's vibe at a glance. This same track is the body of a pulse-strip
 * row, so a row *is* a gauge.
 */

import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '@/theme/ThemeProvider';
import { vibeLabel } from '@/lib/vibe';

type VibeMeterProps = {
  value: number | null;
  height?: number;
  showDot?: boolean;
  dotSize?: number;
  /** dim the whole meter (stale rows) */
  dimmed?: boolean;
  style?: object;
};

export function VibeMeter({
  value,
  height = 10,
  showDot = true,
  dotSize = 14,
  dimmed = false,
  style,
}: VibeMeterProps) {
  const { theme, vibeColor } = useTheme();
  const has = value !== null && value !== undefined;
  const track = dimmed ? [theme.track, theme.track, theme.track] : theme.spectrum;

  return (
    <View
      style={[{ height, borderRadius: height, overflow: 'visible', opacity: dimmed ? 0.5 : 1 }, style]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={track as [string, string, string]}
        start={[0, 0.5]}
        end={[1, 0.5]}
        style={{ height, borderRadius: height, position: 'absolute', inset: 0 }}
      />
      {/* subtle inner shadow line so the track separates from cards */}
      <View
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: height,
          borderWidth: 1,
          borderColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        }}
      />
      {has && showDot ? (
        <View
          style={{
            position: 'absolute',
            top: '50%',
            left: `${value}%`,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize,
            transform: [{ translateX: -dotSize / 2 }, { translateY: -dotSize / 2 }],
            backgroundColor: vibeColor(value),
            borderWidth: 2.5,
            borderColor: theme.isDark ? theme.bg : '#FFFFFF',
            shadowColor: vibeColor(value),
            shadowOpacity: 0.55,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
          }}
          accessibilityLabel={vibeLabel(value)}
        />
      ) : null}
    </View>
  );
}

export default VibeMeter;
