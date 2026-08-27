/**
 * Native-only real map via react-native-maps (Apple Maps / Google Maps).
 * Resolved only on native builds; the .web.tsx twin keeps react-native-maps
 * out of the web bundle entirely.
 */

import React from 'react';
import { View } from 'react-native';
import MapView, { Circle as MapCircle, Marker } from 'react-native-maps';

import type { LatLng } from '@/lib/geo';
import { useTheme } from '@/theme/ThemeProvider';
import { vibeColor } from '@/lib/vibe';
import type { VenueWithVibe } from '@/lib/types';

type Props = {
  venues: VenueWithVibe[];
  center: LatLng;
  radiusM: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

export function NativeTileMap({ venues, center, radiusM, selectedId, onSelect }: Props) {
  const { theme, vibeColor: themeVibe } = useTheme();

  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: center.lat,
        longitude: center.lng,
        latitudeDelta: radiusM / 55000,
        longitudeDelta: radiusM / 55000,
      }}
    >
      <MapCircle
        center={{ latitude: center.lat, longitude: center.lng }}
        radius={radiusM}
        strokeColor="rgba(78,205,196,0.5)"
        fillColor="rgba(78,205,196,0.08)"
      />
      <Marker coordinate={{ latitude: center.lat, longitude: center.lng }} />
      {venues.map((v) => (
        <Marker
          key={v.id}
          coordinate={{ latitude: v.lat, longitude: v.lng }}
          onPress={() => onSelect?.(v.id)}
        >
          <MarkerDot color={v.score.value !== null ? themeVibe(v.score.value) : theme.faint} selected={v.id === selectedId} />
        </Marker>
      ))}
    </MapView>
  );
}

function MarkerDot({ color, selected }: { color: string; selected?: boolean }) {
  return (
    <View
      style={{
        width: selected ? 18 : 13,
        height: selected ? 18 : 13,
        borderRadius: 20,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: 'white',
      }}
    />
  );
}

export default NativeTileMap;
