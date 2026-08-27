/**
 * Web map surface: real tiles via Leaflet + OpenStreetMap.
 *
 * Venues render as brand-coloured pins (vibe scale), the viewer as a teal dot
 * with the discovery radius as a dashed ring. Tiles dim in dark mode via a CSS
 * filter on the tile pane only, so pins keep their true colours.
 */

import React, { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { vibeColor } from '@/lib/vibe';
import { useTheme } from '@/theme/ThemeProvider';
import type { LatLng } from '@/lib/geo';
import type { VenueWithVibe } from '@/lib/types';

type Props = {
  venues: VenueWithVibe[];
  center: LatLng;
  radiusM: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  style?: object;
};

export function NativeTileMap({ venues, center, radiusM, selectedId, onSelect }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const overlayRef = useRef<{ circle: L.Circle; me: L.CircleMarker } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { mode } = useTheme();

  /* -- init once ------------------------------------------------------ */
  useEffect(() => {
    const el = holder.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    map.setView([center.lat, center.lng], 14);
    mapRef.current = map;

    // RNW settles layout a beat after mount; keep the map sized correctly.
    const t = setTimeout(() => map.invalidateSize(), 60);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);

    return () => {
      clearTimeout(t);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -- follow the viewer when they move materially -------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - center.lat) + Math.abs(c.lng - center.lng) > 0.01) {
      map.panTo([center.lat, center.lng]);
    }
  }, [center.lat, center.lng]);

  /* -- radius ring + "you" dot ---------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    overlayRef.current?.circle.remove();
    overlayRef.current?.me.remove();
    const circle = L.circle([center.lat, center.lng], {
      radius: radiusM,
      color: '#4ECDC4',
      weight: 1.5,
      dashArray: '4 6',
      fillColor: '#4ECDC4',
      fillOpacity: 0.06,
    }).addTo(map);
    const me = L.circleMarker([center.lat, center.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 2.5,
      fillColor: '#4ECDC4',
      fillOpacity: 1,
    }).addTo(map);
    me.bindTooltip('you', { direction: 'right', offset: [8, 0] });
    overlayRef.current = { circle, me };
  }, [center.lat, center.lng, radiusM]);

  /* -- venue pins ------------------------------------------------------ */
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    for (const v of venues) {
      const color = vibeColor(v.score.value, mode);
      const icon = L.divIcon({
        className: 'sc-pin',
        html: `<div style="width:20px;height:20px;transform:rotate(-45deg);border-radius:50% 50% 50% 4px;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const m = L.marker([v.lat, v.lng], { icon, keyboard: false });
      m.bindTooltip(v.name, { direction: 'top', offset: [0, -8] });
      if (onSelectRef.current) m.on('click', () => onSelectRef.current?.(v.id));
      m.addTo(group);
      if (v.id === selectedId) m.openTooltip();
    }
  }, [venues, selectedId, mode]);

  /* -- dim tiles in dark mode, keep pins true-coloured ----------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pane = map.getContainer().querySelector<HTMLElement>('.leaflet-tile-pane');
    if (pane) {
      pane.style.filter =
        mode === 'dark' ? 'invert(1) hue-rotate(180deg) brightness(0.86) contrast(0.9) saturate(0.5)' : '';
    }
  }, [mode, venues.length]);

  return (
    <div
      ref={holder}
      style={{ width: '100%', height: '100%', minHeight: 240, zIndex: 0, borderRadius: 18 }}
    />
  );
}

export default NativeTileMap;
