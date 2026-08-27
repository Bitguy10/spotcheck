/** Geo helpers. Keep dependency-free so Edge Functions can import them. */

export type LatLng = { lat: number; lng: number };

const R_EARTH_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Bounding box for a radius search. Deliberately generous (a box, not a circle)
 * so the Overpass query and the Postgres index scan stay cheap; the exact
 * distance filter is applied afterwards with distanceMeters().
 */
export function boundingBox(center: LatLng, radiusM: number) {
  const latDelta = (radiusM / R_EARTH_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(0.0001, Math.cos(toRad(center.lat)));
  return {
    south: center.lat - latDelta,
    west: center.lng - lngDelta,
    north: center.lat + latDelta,
    east: center.lng + lngDelta,
  };
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

/** "180 m · 590 ft" — the check-in gate quotes both so it reads anywhere. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m · ${Math.round(metersToFeet(m))} ft`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatDistanceShort(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/** Very rough reverse-geocode label. Real area names come from Overpass. */
export function coordsLabel(c: LatLng): string {
  return `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
}

export function isValidLatLng(c: Partial<LatLng> | null | undefined): c is LatLng {
  return (
    !!c &&
    Number.isFinite(c.lat as number) &&
    Number.isFinite(c.lng as number) &&
    (c.lat as number) >= -90 &&
    (c.lat as number) <= 90 &&
    (c.lng as number) >= -180 &&
    (c.lng as number) <= 180
  );
}
