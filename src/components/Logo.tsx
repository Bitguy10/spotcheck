/**
 * The SpotCheck mark: a location pin whose dot has been replaced by a live
 * radar — one asset, two ideas ("a place" + "a live signal"). This same
 * component doubles as the animated map pin.
 *
 * Rendering strategy:
 *   · web    → inline <svg> with CSS keyframes (guaranteed smooth ping)
 *   · native → react-native-svg + Reanimated useAnimatedProps
 *
 * Below ~28px the ping is disabled so favicons / small map pins stay crisp.
 */

import React, { useEffect, useId, useMemo } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type LogoProps = {
  size?: number;
  animate?: boolean;
  style?: object;
};

export function Logo({ size = 40, animate = true, style }: LogoProps) {
  const animated = animate && size >= 28;
  if (Platform.OS === 'web') {
    return <LogoWeb size={size} animate={animated} style={style} />;
  }
  return <LogoNative size={size} animate={animated} style={style} />;
}

/* ------------------------------------------------------------------ *
 * Web — CSS keyframes
 * ------------------------------------------------------------------ */

function LogoWeb({ size, animate, style }: { size: number; animate: boolean; style?: object }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `vibe-${uid}`;

  const animationCss = animate
    ? `
      #${gradId} .ra { animation: scA${uid} 2.4s cubic-bezier(.22,.61,.36,1) infinite; }
      #${gradId} .rb { animation: scB${uid} 2.4s cubic-bezier(.22,.61,.36,1) 1.2s infinite; }
      #${gradId} .d  { animation: scD${uid} 2.4s ease-in-out infinite; }
      @keyframes scA${uid} { from { r:3.6; opacity:.75 } to { r:12.4; opacity:0 } }
      @keyframes scB${uid} { from { r:3.6; opacity:.55 } to { r:12.4; opacity:0 } }
      @keyframes scD${uid} { 0%,100% { r:3.1 } 50% { r:3.7 } }
    `
    : `
      #${gradId} .ra { r:8.4; opacity:.35 }
      #${gradId} .rb { r:11.4; opacity:.18 }
    `;

  const svg = useMemo(
    () => `
<svg id="${gradId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" style="display:block">
  <style>${animationCss}</style>
  <defs>
    <linearGradient id="${gradId}-g" x1="14" y1="7" x2="50" y2="57" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4ECDC4"/><stop offset="0.52" stop-color="#FFD166"/><stop offset="1" stop-color="#FF5A5F"/>
    </linearGradient>
  </defs>
  <path d="M32 5.33C21.68 5.33 13.33 13.68 13.33 24c0 14 18.67 34.67 18.67 34.67S50.67 38 50.67 24c0-10.32-8.35-18.67-18.67-18.67z" fill="url(#${gradId}-g)"/>
  <circle cx="32" cy="24" r="13.2" fill="#12131A"/>
  <circle class="ra" cx="32" cy="24" r="3.6" fill="none" stroke="#4ECDC4" stroke-width="1.5"/>
  <circle class="rb" cx="32" cy="24" r="3.6" fill="none" stroke="#FF5A5F" stroke-width="1.5"/>
  <circle class="d" cx="32" cy="24" r="3.1" fill="#FF5A5F"/>
</svg>`,
    [size, gradId, animationCss],
  );

  // Render a real DOM <div> on web so the inline <svg> (with its CSS ping)
  // actually mounts; react-native-web does not forward dangerouslySetInnerHTML.
  return React.createElement('div', {
    style: { width: size, height: size },
    dangerouslySetInnerHTML: { __html: svg },
  });
}

/* ------------------------------------------------------------------ *
 * Native — react-native-svg + Reanimated
 * ------------------------------------------------------------------ */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function LogoNative({ size, animate, style }: { size: number; animate: boolean; style?: object }) {
  const a = useSharedValue(0);
  const b = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;
    const loop = () => withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) });
    a.value = withRepeat(loop(), -1, false);
    b.value = withDelay(1200, withRepeat(loop(), -1, false));
  }, [animate]);

  const ringA = useAnimatedProps(() => ({
    r: 3.6 + a.value * 8.8,
    opacity: 0.75 * (1 - a.value),
  }));
  const ringB = useAnimatedProps(() => ({
    r: 3.6 + b.value * 8.8,
    opacity: 0.55 * (1 - b.value),
  }));

  return (
    <Svg viewBox="0 0 64 64" width={size} height={size} style={style}>
      <Defs>
        <LinearGradient id="sc-vibe-n" x1="14" y1="7" x2="50" y2="57" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#4ECDC4" />
          <Stop offset="0.52" stopColor="#FFD166" />
          <Stop offset="1" stopColor="#FF5A5F" />
        </LinearGradient>
      </Defs>
      <Path
        d="M32 5.33C21.68 5.33 13.33 13.68 13.33 24c0 14 18.67 34.67 18.67 34.67S50.67 38 50.67 24c0-10.32-8.35-18.67-18.67-18.67z"
        fill="url(#sc-vibe-n)"
      />
      <Circle cx="32" cy="24" r="13.2" fill="#12131A" />
      {animate ? (
        <>
          <AnimatedCircle cx="32" cy="24" r="3.6" fill="none" stroke="#4ECDC4" strokeWidth="1.5" animatedProps={ringA} />
          <AnimatedCircle cx="32" cy="24" r="3.6" fill="none" stroke="#FF5A5F" strokeWidth="1.5" animatedProps={ringB} />
        </>
      ) : (
        <>
          <Circle cx="32" cy="24" r="8.4" fill="none" stroke="#4ECDC4" strokeWidth="1.5" opacity="0.35" />
          <Circle cx="32" cy="24" r="11.4" fill="none" stroke="#FF5A5F" strokeWidth="1.5" opacity="0.18" />
        </>
      )}
      <Circle cx="32" cy="24" r="3.1" fill="#FF5A5F" />
    </Svg>
  );
}

export default Logo;
