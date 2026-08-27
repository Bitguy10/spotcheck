/**
 * An offline, dependency-free schematic map.
 *
 * Why this exists: real tiles (OSM/Mapbox/Leaflet) and react-native-maps both
 * need either network or native code, so the web preview and any offline run
 * would show a blank box. This projects the *same* lat/lngs into a clean SVG
 * scatter so spatial relationships and the vibe colour scale still read — and
 * it renders identically on native and web, no network required.
 *
 * In production web you would swap this for Leaflet/Mapbox GL JS; on native
 * set EXPO_PUBLIC_USE_NATIVE_MAPS=1 to use react-native-maps instead.
 */

import React, { useMemo } from 'react';
import { G, Circle, Line, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { boundingBox, type LatLng } from '@/lib/geo';
import { useTheme } from '@/theme/ThemeProvider';
import type { VenueWithVibe } from '@/lib/types';

const W = 100;
const H = 100;

type SchematicMapProps = {
  venues: VenueWithVibe[];
  center: LatLng;
  radiusM: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

export function SchematicMap({ venues, center, radiusM, selectedId, onSelect }: SchematicMapProps) {
  const { theme, vibeColor } = useTheme();

  const box = useMemo(() => boundingBox(center, radiusM), [center, radiusM]);
  const spanLat = Math.max(1e-9, box.north - box.south);
  const spanLng = Math.max(1e-9, box.east - box.west);

  const project = (lat: number, lng: number) => {
    const x = ((lng - box.west) / spanLng) * W;
    const y = ((box.north - lat) / spanLat) * H;
    return { x: Math.min(W, Math.max(0, x)), y: Math.min(H, Math.max(0, y)) };
  };

  const grid = [];
  for (let i = 1; i < 10; i++) {
    const p = i * 10;
    grid.push(<Line key={`v${i}`} x1={p} y1={0} x2={p} y2={H} stroke={theme.line} strokeWidth={0.3} />);
    grid.push(<Line key={`h${i}`} x1={0} y1={p} x2={W} y2={p} stroke={theme.line} strokeWidth={0.3} />);
  }

  const you = project(center.lat, center.lng);

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice">
      <Rect x={0} y={0} width={W} height={H} fill={theme.mapBg} />
      {grid}

      {/* the discovery radius, schematically */}
      <Circle cx={you.x} cy={you.y} r={46} fill="none" stroke={theme.line} strokeWidth={0.4} strokeDasharray="2 2" />

      {/* venues as vibe-coloured pins */}
      {venues.map((v) => {
        const p = project(v.lat, v.lng);
        const color = v.score.value !== null ? vibeColor(v.score.value) : theme.faint;
        const selected = v.id === selectedId;
        const r = selected ? 3.4 : v.score.isLive ? 2.8 : 2.2;
        return (
          <G key={v.id} onPress={() => onSelect?.(v.id)} opacity={v.score.value === null ? 0.55 : 1}>
            {selected ? (
              <Circle cx={p.x} cy={p.y} r={r + 2} fill="none" stroke={theme.text} strokeWidth={0.5} />
            ) : null}
            <Circle cx={p.x} cy={p.y} r={r} fill={color} stroke={theme.isDark ? '#0c0d12' : '#fff'} strokeWidth={0.5} />
            {v.score.isLive ? (
              <Circle cx={p.x} cy={p.y} r={r + 1.4} fill="none" stroke={color} strokeWidth={0.4} opacity={0.5} />
            ) : null}
          </G>
        );
      })}

      {/* you */}
      <Circle cx={you.x} cy={you.y} r={2.6} fill="#4ECDC4" stroke={theme.isDark ? '#0c0d12' : '#fff'} strokeWidth={0.5} />
      <SvgText x={you.x + 3.6} y={you.y + 1.4} fontSize={3} fill={theme.mapLabel} fontFamily="Inter, system-ui">
        you
      </SvgText>
    </Svg>
  );
}

export default SchematicMap;
