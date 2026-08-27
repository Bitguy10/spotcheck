/**
 * The dashboard's data hook.
 *
 * Liveness model: one global Postgres change subscription. When any check-in
 * lands anywhere, we ask the server for that one venue's authoritative score
 * and patch the row. No polling, no client-side scoring.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBackend } from '@/data/backend';
import { applyFilters } from '@/lib/filters';
import type { LatLng } from '@/lib/geo';
import type { Checkin, VenueFilters, VenueWithVibe } from '@/lib/types';
import { computeVibeScore, type VibeScore } from '@/lib/vibe';

export type VenuesState = {
  venues: VenueWithVibe[];
  visible: VenueWithVibe[];
  loading: boolean;
  error: string | null;
  /** true while the OSM seed pull is running */
  syncing: boolean;
  syncNote: string | null;
  refresh: () => void;
  syncFromOSM: () => void;
  /** optimistic: my dot joins the strip before the server round-trip returns */
  applyOptimistic: (venueId: string, mine: Checkin) => void;
  /** authoritative: server's score replaces the optimistic one */
  applyScore: (venueId: string, score: VibeScore) => void;
  lastUpdated: number;
};

export function useVenues(center: LatLng, radiusM: number, filters: VenueFilters): VenuesState {
  const [venues, setVenues] = useState<VenueWithVibe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [nonce, setNonce] = useState(0);
  const centerRef = useRef(center);
  centerRef.current = center;

  /* -- initial load -------------------------------------------------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    getBackend()
      .then((backend) => backend.fetchVenues(center, radiusM))
      .then((rows) => {
        if (!alive) return;
        setVenues(rows);
        setLastUpdated(Date.now());
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
    // Re-run when the viewer moves materially, not on every GPS jitter.
  }, [roundCoord(center.lat), roundCoord(center.lng), radiusM, nonce]);

  /* -- realtime ------------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    const inFlight = new Set<string>();

    getBackend().then((backend) => {
      if (!alive) return;
      unsub = backend.subscribeGlobal(async (event) => {
        const { venueId } = event;
        if (inFlight.has(venueId)) return;

        let known = false;
        setVenues((prev) => {
          known = prev.some((v) => v.id === venueId);
          if (!known) return prev;
          return prev.map((v) =>
            v.id === venueId
              ? { ...v, score: { ...v.score, isLive: true, lastCheckinAt: event.checkin.createdAt } }
              : v,
          );
        });
        if (!known) return;

        // Ask the server for the real number. One venue, one call.
        inFlight.add(venueId);
        try {
          const score = await backend.getVibe(venueId);
          setVenues((prev) => prev.map((v) => (v.id === venueId ? { ...v, score } : v)));
          setLastUpdated(Date.now());
        } catch {
          /* keep the previous score rather than flicker to empty */
        } finally {
          inFlight.delete(venueId);
        }
      });
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  /* -- actions ------------------------------------------------------- */
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const syncFromOSM = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const backend = await getBackend();
      const result = await backend.syncFromOSM(centerRef.current, radiusM);
      const rows = await backend.fetchVenues(centerRef.current, radiusM);
      setVenues(rows);
      setLastUpdated(Date.now());
      setSyncNote(
        result.source === 'overpass'
          ? `${result.inserted} venues pulled from OpenStreetMap`
          : `Serving ${result.inserted} cached venues`,
      );
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : 'OpenStreetMap sync failed');
    } finally {
      setSyncing(false);
    }
  }, [radiusM]);

  const applyOptimistic = useCallback((venueId: string, mine: Checkin) => {
    setVenues((prev) =>
      prev.map((v) => {
        if (v.id !== venueId) return v;
        const predicted = computeVibeScore(
          [{ vibeValue: mine.vibeValue, createdAt: mine.createdAt }],
          Date.now(),
        );
        return {
          ...v,
          score: {
            ...predicted,
            activeCheckins: v.score.activeCheckins + 1,
            totalCheckins: v.score.totalCheckins + 1,
            lastCheckinAt: mine.createdAt,
            isLive: true,
            // Don't publish a score we haven't confirmed with the server.
            value: v.score.value ?? null,
            confidence: v.score.confidence,
          },
        };
      }),
    );
  }, []);

  const applyScore = useCallback((venueId: string, score: VibeScore) => {
    setVenues((prev) => prev.map((v) => (v.id === venueId ? { ...v, score } : v)));
    setLastUpdated(Date.now());
  }, []);

  return {
    venues,
    visible: applyFilters(venues, filters),
    loading,
    error,
    syncing,
    syncNote,
    refresh,
    syncFromOSM: () => void syncFromOSM(),
    applyOptimistic,
    applyScore,
    lastUpdated,
  };
}

/** ~10m buckets so a drifting GPS fix doesn't refetch the whole list. */
function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}
