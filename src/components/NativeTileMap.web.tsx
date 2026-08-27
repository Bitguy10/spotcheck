/**
 * Web map surface: Leaflet with a Google-Maps-grade basemap (Esri World Street
 * Map — keyless, clean labels; dimmed via a tile-pane filter in dark mode so
 * pins keep their true colours). Venues render as teardrop pins on the vibe
 * scale, the viewer as a teal dot with the discovery radius as a dashed ring,
 * plus a recenter control.
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

const TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; Tiles &copy; Esri',
} as const;

export function NativeTileMap({ venues, center, radiusM, selectedId, onSelect }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const overlayRef = useRef<{ circle: L.Circle; me: L.CircleMarker } | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { mode } = useTheme();

  /* -- init once ------------------------------------------------------ */
  useEffect(() => {
    const el = holder.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    map.setView([center.lat, center.lng], 14);
    mapRef.current = map;

    // Recenter control — the "where am I" button people expect from map apps.
    const Recenter = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: () => {
        const btn = L.DomUtil.create('button', 'sc-recenter');
        btn.setAttribute('aria-label', 'Center on my location');
        btn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="2"/></svg>';
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', () => {
          map.setView([centerRef.current.lat, centerRef.current.lng], 15);
        });
        return btn as unknown as HTMLElement;
      },
    });
    map.addControl(new Recenter());

    // RNW settles layout a beat after mount; keep the map sized correctly.
    const t = setTimeout(() => map.invalidateSize(), 60);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);

    return () => {
      clearTimeout(t);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      markersRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -- basemap ---------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tilesRef.current) return;
    tilesRef.current = L.tileLayer(TILES.url, { maxZoom: 19, attribution: TILES.attribution }).addTo(map);
  }, []);

  /* -- dim tiles in dark mode; pins stay true-coloured ------------------ */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pane = map.getContainer().querySelector<HTMLElement>('.leaflet-tile-pane');
    if (pane) {
      pane.style.filter =
        mode === 'dark' ? 'invert(1) hue-rotate(180deg) brightness(0.88) contrast(0.92) saturate(0.45)' : '';
    }
  }, [mode]);

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
        html: `<div style="width:24px;height:24px;transform:rotate(-45deg);border-radius:50% 50% 50% 4px;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><div style="width:7px;height:7px;border-radius:50%;background:#fff"></div></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const m = L.marker([v.lat, v.lng], { icon, keyboard: false });
      m.bindTooltip(v.name, { direction: 'top', offset: [0, -10] });
      if (onSelectRef.current) m.on('click', () => onSelectRef.current?.(v.id));
      m.addTo(group);
      if (v.id === selectedId) m.openTooltip();
    }
  }, [venues, selectedId, mode]);

  return (
    <div
      ref={holder}
      style={{ width: '100%', height: '100%', minHeight: 240, zIndex: 0, borderRadius: 18 }}
    />
  );
}

export default NativeTileMap;
