/**
 * The tap. The entire required input of a check-in is one point on this
 * red↔teal gauge. Tap or drag; no text entry.
 *
 * Drag handling uses the responder system so it behaves identically with a
 * finger (native) and a pointer (web); Reanimated drives the knob's press
 * micro-spring so the interaction feels physical.
 */

import React, { useCallback, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { VibeMeter } from './VibeMeter';
import { useTheme } from '@/theme/ThemeProvider';
import { vibeLabel } from '@/lib/vibe';

type VibeGaugeProps = {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  height?: number;
  disabled?: boolean;
  /** hide the knob until the user has actually tapped (the check-in starts unfilled) */
  showKnob?: boolean;
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function VibeGauge({ value, onChange, onCommit, height = 16, disabled = false, showKnob = true }: VibeGaugeProps) {
  const { theme, vibeColor } = useTheme();
  const width = useRef<number>(0);
  const dragging = useRef(false);
  const nodeRef = useRef<{ getBoundingClientRect?: () => { left: number } } | null>(null);
  const pressed = useSharedValue(0);

  const fromLocation = useCallback(
    (locationX: number) => {
      const w = Math.max(1, width.current);
      return clamp((locationX / w) * 100);
    },
    [],
  );

  /** Native gives locationX; web we derive from clientX − the track's left. */
  const xFrom = useCallback((e: { nativeEvent: unknown }) => {
    const ne = e.nativeEvent as { locationX?: number; clientX?: number };
    if (typeof ne.locationX === 'number' && Number.isFinite(ne.locationX)) return ne.locationX;
    if (typeof ne.clientX === 'number' && nodeRef.current?.getBoundingClientRect) {
      return ne.clientX - nodeRef.current.getBoundingClientRect().left;
    }
    return 0;
  }, []);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: 0 }, { scale: 1 + pressed.value * 0.25 }],
  }));

  return (
    <View>
      <View
        ref={nodeRef as never}
        testID="sc-gauge"
        style={{ paddingVertical: 10 }}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          pressed.value = withSpring(1, { damping: 15, stiffness: 250 });
          onChange(Math.round(fromLocation(xFrom(e))));
        }}
        onPointerMove={(e) => {
          if (dragging.current) onChange(Math.round(fromLocation(xFrom(e))));
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          pressed.value = withSpring(0, { damping: 15, stiffness: 250 });
          const v = Math.round(fromLocation(xFrom(e)));
          onChange(v);
          onCommit?.(v);
        }}
        onLayout={(e) => {
          width.current = e.nativeEvent.layout.width;
        }}
        accessibilityRole="adjustable"
        accessibilityValue={{ now: value, min: 0, max: 100, text: vibeLabel(value) }}
      >
        <VibeMeter value={value} height={height} showDot={false} />

        {showKnob ? (
          /* the grabbable knob */
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: '50%',
                left: `${value}%`,
                width: 28,
                height: 28,
                borderRadius: 14,
                transform: [{ translateY: -14 }, { translateX: -14 }],
              },
              knobStyle,
            ]}
          >
            <View
              style={{
                flex: 1,
                borderRadius: 14,
                backgroundColor: vibeColor(value),
                borderWidth: 3,
                borderColor: theme.isDark ? theme.bg : '#FFFFFF',
                shadowColor: vibeColor(value),
                shadowOpacity: 0.6,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 0 },
              }}
            />
          </Animated.View>
        ) : (
          /* unfilled: a neutral centered tick, not a pre-selected value */
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 2,
              height: height + 10,
              transform: [{ translateX: -1 }, { translateY: -(height + 10) / 2 }],
              backgroundColor: theme.faint,
              opacity: 0.5,
              borderRadius: 1,
            }}
          />
        )}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ color: theme.spectrum[0], fontWeight: '600', fontSize: 12 }}>Chill</Text>
        <Text style={{ color: vibeColor(value), fontWeight: '700', fontSize: 13, fontFamily: 'SpaceGrotesk' }}>
          {vibeLabel(value)}
        </Text>
        <Text style={{ color: theme.spectrum[2], fontWeight: '600', fontSize: 12 }}>Hot</Text>
      </View>
    </View>
  );
}

export default VibeGauge;
