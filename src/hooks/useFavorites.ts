/** Saved venues (wave 2). Works against both backends.
 *
 * Favorites are per-account: the hook takes the signed-in user's id and
 * refetches whenever it changes, so signing out and in as someone else can
 * never leave the previous account's saved list on screen. Signed out
 * (userId null) means an empty list, not a stale one.
 */

import { useCallback, useEffect, useState } from 'react';
import { getBackend } from '@/data/backend';

export function useFavorites(userId: string | null) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setIds([]);
      setReady(true);
      return;
    }
    setReady(false);
    getBackend()
      .then((b) => b.getFavoriteIds())
      .then((f) => {
        if (!alive) return;
        setIds(f);
        setReady(true);
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [userId]);

  const isSaved = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback(async (id: string) => {
    const backend = await getBackend();
    const saved = await backend.toggleFavorite(id);
    setIds((prev) => (saved ? [...prev, id] : prev.filter((x) => x !== id)));
    return saved;
  }, []);

  return { ids, ready, isSaved, toggle };
}
