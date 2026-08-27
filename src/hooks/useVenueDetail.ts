/**
 * Venue detail page data.
 *
 * The gauge at the top is the server's number. When a check-in arrives over
 * Realtime we append it to the mini-feed immediately (it's a fact, not a
 * computation) and re-fetch the score so the gauge moves to the server's
 * authoritative value rather than one we derived on the client.
 */

import { useCallback, useEffect, useState } from 'react';

import { getBackend } from '@/data/backend';
import type { Checkin, Venue } from '@/lib/types';
import { EMPTY_SCORE, type VibeScore } from '@/lib/vibe';

export type VenueDetailState = {
  venue: Venue | null;
  score: VibeScore;
  checkins: Checkin[];
  loading: boolean;
  error: string | null;
  refreshScore: () => Promise<void>;
  appendLocal: (checkin: Checkin) => void;
};

export function useVenueDetail(venueId: string | undefined): VenueDetailState {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [score, setScore] = useState<VibeScore>(EMPTY_SCORE);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!venueId) return;
    let alive = true;
    setLoading(true);
    setError(null);

    getBackend()
      .then(async (backend) => {
        const [v, s, c] = await Promise.all([
          backend.getVenue(venueId),
          backend.getVibe(venueId),
          backend.getCheckins(venueId, 40),
        ]);
        if (!alive) return;
        setVenue(v);
        setScore(s);
        setCheckins(c);
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
  }, [venueId]);

  /* Realtime: this venue only. */
  useEffect(() => {
    if (!venueId) return;
    let alive = true;
    let unsub: (() => void) | null = null;

    getBackend().then(async (backend) => {
      if (!alive) return;
      unsub = backend.subscribeVenue(venueId, async (event) => {
        if (!alive) return;
        setCheckins((prev) =>
          prev.some((c) => c.id === event.checkin.id) ? prev : [event.checkin, ...prev].slice(0, 60),
        );
        try {
          const next = await backend.getVibe(venueId);
          if (alive) setScore(next);
        } catch {
          /* keep last known */
        }
      });
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, [venueId]);

  const refreshScore = useCallback(async () => {
    if (!venueId) return;
    const backend = await getBackend();
    const next = await backend.getVibe(venueId);
    setScore(next);
  }, [venueId]);

  const appendLocal = useCallback((checkin: Checkin) => {
    setCheckins((prev) =>
      prev.some((c) => c.id === checkin.id) ? prev : [checkin, ...prev].slice(0, 60),
    );
  }, []);

  return { venue, score, checkins, loading, error, refreshScore, appendLocal };
}
