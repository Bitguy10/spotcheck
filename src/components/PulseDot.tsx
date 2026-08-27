/**
 * The signature interaction element.
 *
 * A single dot that gently breathes — subtle scale + opacity, nothing busy —
 * beside any venue with a check-in in the last 10 minutes. Everything else on
 * screen stays still; this is the only thing allowed to move (plus the logo
 * ping and the gauge drag), so it reads instantly as "this is live".
 *
 * Uses Reanimated so it runs on the UI thread on native and degrades cleanly
 * on web. When not breathing (stale), it renders a small static gray dot.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type PulseDotProps = {
  color: string;
  size?: number;
  breathing?: boolean;
  style?: object;
};

export function PulseDot({ color, size = 8, breathing = true, style }: PulseDotProps) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (!breathing) {
      t.value = 0;
      return;
    }
    const up = withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) });
    const down = withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.ease) });
    t.value = withRepeat(withSequence(up, down), -1, false);
  }, [breathing]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.value * 0.14 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.value * 0.7 }],
    opacity: 0.45 * (1 - t.value * 0.65),
  }));

  const radius = size / 2;

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      {breathing ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius * 1.8, borderWidth: 1.5, borderColor: color },
            haloStyle,
          ]}
        />
      ) : null}
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: color }, dotStyle]}
      />
    </View>
  );
}

export default PulseDot;
