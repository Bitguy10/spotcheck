/**
 * Chooses the map surface:
 *   · web                                   → Leaflet with real OSM tiles
 *   · native + EXPO_PUBLIC_USE_NATIVE_MAPS=1 → react-native-maps (real tiles)
 *   · native otherwise                       → offline schematic SVG map
 *
 * The schematic map keeps offline/native runs fully usable while encoding the
 * same coordinates + vibe colour scale.
 */

import React from 'react';
import { Platform, View } from 'react-native';

import { SchematicMap } from './SchematicMap';
import NativeTileMap from './NativeTileMap';
import type { LatLng } from '@/lib/geo';
import type { VenueWithVibe } from '@/lib/types';

const useNativeMaps = process.env.EXPO_PUBLIC_USE_NATIVE_MAPS === '1';

type VibeMapProps = {
  venues: VenueWithVibe[];
  center: LatLng;
  radiusM: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  style?: object;
};

export function VibeMap(props: VibeMapProps) {
  const real = Platform.OS === 'web' || useNativeMaps;
  return (
    <View style={[{ overflow: 'hidden', borderRadius: 18 }, props.style]}>
      {real ? <NativeTileMap {...props} /> : <SchematicMap {...props} />}
    </View>
  );
}

export default VibeMap;
