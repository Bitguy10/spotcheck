/** Saved venues (wave 2). Works against both backends. */

import { useCallback, useEffect, useState } from 'react';
import { getBackend } from '@/data/backend';

export function useFavorites() {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
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
  }, []);

  const isSaved = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback(async (id: string) => {
    const backend = await getBackend();
    const saved = await backend.toggleFavorite(id);
    setIds((prev) => (saved ? [...prev, id] : prev.filter((x) => x !== id)));
    return saved;
  }, []);

  return { ids, ready, isSaved, toggle };
}
