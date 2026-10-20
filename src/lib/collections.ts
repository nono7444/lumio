// Collections propres de Lumio : sagas TMDB des films présents dans Jellyfin (calculées par le serveur Lumio).
import { useEffect, useState } from 'react';

import { serverCall } from './chat';
import type { Settings } from './settings';

export type LumioCollection = {
  id: number;
  name: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  total: number;
  items: { jfId: string; tmdbId: number; title: string; year: number | null }[];
};

let cache: { at: number; list: LumioCollection[] } | null = null;

export async function fetchCollections(s: Settings, refresh = false) {
  if (!refresh && cache && Date.now() - cache.at < 5 * 60_000) return { building: false, collections: cache.list };
  const r = await serverCall<{ building: boolean; collections: LumioCollection[] }>(s, `/api/collections${refresh ? '?refresh=1' : ''}`);
  if (r.collections.length) cache = { at: Date.now(), list: r.collections };
  return r;
}


export function useLumioCollections(s: Settings) {
  const [data, setData] = useState<{ building: boolean; collections: LumioCollection[] } | null>(null);
  useEffect(() => {
    if (!s.chatUrl || !s.jellyfin) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      fetchCollections(s)
        .then((r) => {
          if (!alive) return;
          setData(r);
          // Première construction en cours sur le serveur : on repasse dans 8 s
          if (r.building && !r.collections.length) timer = setTimeout(load, 8000);
        })
        .catch(() => alive && setData(null));
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.chatUrl, s.jellyfin?.token]);
  return data;
}
