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
import { cachedVenues, cachedVenuesSync, rememberVenues } from '@/lib/venueCache';
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

export function useVenues(
  center: LatLng,
  radiusM: number,
  filters: VenueFilters,
  userId?: string | null,
): VenuesState {
  const [venues, setVenues] = useState<VenueWithVibe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [nonce, setNonce] = useState(0);
  const centerRef = useRef(center);
  centerRef.current = center;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // Sandbox: every cached world belongs to one account — keys are scoped so a
  // second login on this device can never hydrate the previous user's rows.
  const scope = userId ?? 'anon';
  const areaKey = (lat: number, lng: number) =>
    `${scope}@${roundCoord(lat)},${roundCoord(lng)},${radiusM}`;

  /* -- initial load (stale-while-revalidate) -------------------------- */
  useEffect(() => {
    let alive = true;
    const key = areaKey(center.lat, center.lng);
    setLoading(true);
    setError(null);

    // Instant paint: rows from a previous visit to this area, if we have them.
    const inMem = cachedVenuesSync(key);
    if (inMem) {
      setVenues(inMem);
    } else {
      cachedVenues(key).then((rows) => {
        if (alive && rows?.length) setVenues((prev) => (prev.length ? prev : rows));
      });
    }

    getBackend()
      .then((backend) => backend.fetchVenues(center, radiusM))
      .then((rows) => {
        if (!alive) return;
        rememberVenues(key, rows);
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
  }, [roundCoord(center.lat), roundCoord(center.lng), radiusM, nonce, scope]);

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

  const doSync = useCallback(async () => {
    if (!userId) {
      // Sandbox mode: a pull with no account would write rows nobody can
      // ever see. Say so instead of pretending it worked.
      setSyncNote('Sign in first — pulled places land in your own world.');
      return;
    }
    setSyncing(true);
    setSyncNote(null);
    try {
      const backend = await getBackend();
      // A pull is section-aware: with Bars/Food/Cafés/Clubs active we ask OSM
      // for exactly those amenities, so the venues land in the section that
      // pulled them.
      const category = filtersRef.current.category;
      const result = await backend.syncFromOSM(centerRef.current, radiusM, category);
      let rows: VenueWithVibe[];
      try {
        rows = await backend.fetchVenues(centerRef.current, radiusM);
      } catch {
        // The pull itself saved — only the refetch died. Say so honestly
        // instead of claiming total failure.
        setSyncNote(
          `${result.inserted} venue${result.inserted === 1 ? '' : 's'} saved to SpotCheck — the list couldn't refresh on this connection. Pull again or refresh.`,
        );
        return;
      }
      rememberVenues(areaKey(centerRef.current.lat, centerRef.current.lng), rows);
      setVenues(rows);
      setLastUpdated(Date.now());
      setSyncNote(
        result.inserted === 0
          ? 'OpenStreetMap has nothing for this section nearby — try Everything or widen the radius.'
          : `${result.inserted} venue${result.inserted === 1 ? '' : 's'} pulled from OpenStreetMap`,
      );
    } catch (e) {
      // Never surface raw "TypeError: Failed to fetch" — say what happened
      // and what to do, keep the detail in the console.
      console.warn('OSM sync failed', e);
      setSyncNote('Couldn’t reach OpenStreetMap just now — check your connection and pull again.');
    } finally {
      setSyncing(false);
    }
  }, [radiusM, userId]);

  const syncFromOSM = useCallback(() => {
    void doSync();
  }, [doSync]);

  /* -- auto-discovery: an empty radius pulls real places once, silently -- */
  const autoTried = useRef<string>('');
  useEffect(() => {
    const key = areaKey(center.lat, center.lng);
    if (!loading && venues.length === 0 && !syncing && autoTried.current !== key) {
      autoTried.current = key;
      void doSync();
    }
  }, [loading, venues.length, syncing, center.lat, center.lng, radiusM, doSync]);

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
