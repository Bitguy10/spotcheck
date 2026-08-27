/**
 * Device location.
 *
 * Location is a *viewport*, never a gate on discovery: if permission is denied
 * the app still works, centred on a fallback point, and the user can still
 * browse and search venues anywhere in the world. Only the check-in action
 * genuinely requires GPS, and that is enforced server-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { DISCOVERY_RADIUS_M, FALLBACK_CENTER } from '@/lib/config';
import type { LatLng } from '@/lib/geo';

export type LocationStatus =
  | 'idle'
  | 'prompting'
  | 'located'
  | 'denied'
  | 'unavailable'
  | 'fallback';

export type LocationState = {
  coords: LatLng;
  accuracy: number | null;
  status: LocationStatus;
  /** true when we are using the fallback point rather than a real fix */
  isFallback: boolean;
  areaLabel: string;
  radiusM: number;
  refresh: () => void;
};

async function reverseGeocode(c: LatLng): Promise<string | null> {
  try {
    const res = await Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng });
    const first = res[0];
    if (!first) return null;
    const parts = [first.subregion ?? first.district, first.city, first.region].filter(
      (p): p is string => Boolean(p),
    );
    if (parts.length) return parts.slice(0, 2).join(', ');
    return first.country ?? null;
  } catch {
    return null;
  }
}

export function useLocation(radiusM: number = DISCOVERY_RADIUS_M): LocationState {
  const [coords, setCoords] = useState<LatLng>(FALLBACK_CENTER);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [areaLabel, setAreaLabel] = useState<string>(FALLBACK_CENTER.label);
  const [nonce, setNonce] = useState(0);
  const watch = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatus('prompting');
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm !== 'granted') {
          setStatus('denied');
          setCoords(FALLBACK_CENTER);
          setAreaLabel(`${FALLBACK_CENTER.label} · location off`);
          return;
        }

        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;

        const next = { lat: fix.coords.latitude, lng: fix.coords.longitude };
        setCoords(next);
        setAccuracy(fix.coords.accuracy ?? null);
        setStatus('located');
        setAreaLabel('Your area');

        // Reverse-geocode is best-effort: never leave "Finding your area…" on
        // screen when it is slow or unsupported (mobile web often is).
        const label = await Promise.race([
          reverseGeocode(next),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (!cancelled && label) setAreaLabel(label);

        // A live watch feed keeps the check-in gate's distance honest as you
        // walk toward the door.
        watch.current?.remove();
        watch.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 8 },
          (pos) => {
            if (cancelled) return;
            setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setAccuracy(pos.coords.accuracy ?? null);
          },
        );
      } catch {
        if (cancelled) return;
        setStatus(Platform.OS === 'web' ? 'unavailable' : 'fallback');
        setCoords(FALLBACK_CENTER);
        setAreaLabel(`${FALLBACK_CENTER.label} · location unavailable`);
      }
    }

    run();
    return () => {
      cancelled = true;
      watch.current?.remove();
      watch.current = null;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return {
    coords,
    accuracy,
    status,
    isFallback: status === 'denied' || status === 'unavailable' || status === 'fallback',
    areaLabel,
    radiusM,
    refresh,
  };
}
