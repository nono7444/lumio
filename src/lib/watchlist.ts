// Liste « À voir » de chaque membre de la famille, gardée sur le serveur Lumio (la même sur tous ses appareils).
import { useCallback, useEffect, useState } from 'react';

import { serverCall } from './chat';
import type { Settings } from './settings';
import { useSettings } from './settings';

export type WatchItem = {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  addedAt: string;
  /** Statut sur le serveur (MediaStatus) */
  status?: number;
};

let cache: WatchItem[] | null = null;
const listeners = new Set<(l: WatchItem[]) => void>();
const emit = () => listeners.forEach((f) => f(cache ?? []));
const keyOf = (type: string, id: number) => `${type}:${id}`;

export const watchlist = {
  load: async (s: Settings) => {
    const r = await serverCall<{ items: WatchItem[] }>(s, '/api/watchlist');
    cache = r.items;
    emit();
    return r.items;
  },
  add: async (s: Settings, item: Omit<WatchItem, 'addedAt' | 'status'>) => {
    // Affichage immédiat, puis confirmation du serveur
    cache = [{ ...item, addedAt: new Date().toISOString() }, ...(cache ?? []).filter((x) => keyOf(x.type, x.tmdbId) !== keyOf(item.type, item.tmdbId))];
    emit();
    await serverCall(s, '/api/watchlist', { method: 'POST', body: JSON.stringify(item) });
  },
  remove: async (s: Settings, type: 'movie' | 'tv', tmdbId: number) => {
    cache = (cache ?? []).filter((x) => keyOf(x.type, x.tmdbId) !== keyOf(type, tmdbId));
    emit();
    await serverCall(s, `/api/watchlist?type=${type}&tmdbId=${tmdbId}`, { method: 'DELETE' });
  },
};

/** Liste complète, rechargée à la demande. */
export function useWatchlist() {
  const { settings } = useSettings();
  const [items, setItems] = useState<WatchItem[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      setError(null);
      await watchlist.load(settings);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
  return { items, error, reload };
}

/** Bouton des fiches : le titre est-il dans « À voir » ? + bascule. */
export function useInWatchlist(item: Omit<WatchItem, 'addedAt' | 'status'> | null) {
  const { settings } = useSettings();
  const [list, setList] = useState<WatchItem[] | null>(cache);
  useEffect(() => {
    listeners.add(setList);
    if (!cache && settings.chatUrl && settings.jellyfin) watchlist.load(settings).catch(() => {});
    return () => {
      listeners.delete(setList);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const on = Boolean(item && list?.some((x) => x.type === item.type && x.tmdbId === item.tmdbId));
  const toggle = useCallback(async () => {
    if (!item) return;
    if (on) await watchlist.remove(settings, item.type, item.tmdbId);
    else await watchlist.add(settings, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, item?.type, item?.tmdbId, settings.chatUrl, settings.jellyfin?.token]);
  return { on, toggle, available: Boolean(settings.chatUrl && settings.jellyfin && item) };
}
