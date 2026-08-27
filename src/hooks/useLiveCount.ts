/**
 * "X vibe checks today" — the landing page's liveness proof.
 *
 * Starts from a server count, then ticks forward on Realtime events.
 * Nothing here polls.
 */

import { useEffect, useRef, useState } from 'react';

import { getBackend } from '@/data/backend';

export function useLiveCount(): { count: number; loading: boolean } {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const seeded = useRef(false);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;

    getBackend()
      .then(async (backend) => {
        const n = await backend.countToday();
        if (!alive) return;
        seeded.current = true;
        setCount(n);
        setLoading(false);

        unsub = backend.subscribeGlobal(() => {
          if (!alive) return;
          setCount((c) => (seeded.current ? c + 1 : c));
        });
      })
      .catch(() => alive && setLoading(false));

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  return { count, loading };
}
