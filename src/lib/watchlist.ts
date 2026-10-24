// Liste « À voir » de chaque membre de la famille, gardée sur le serveur Lumio (la même sur tous ses appareils).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { serverCall } from './chat';
import { serverHealth } from './lumio-server';
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
  /** Sortie en numérique (film) ou prochain épisode (série), AAAA-MM-JJ */
  digital?: string | null;
};

let cache: WatchItem[] | null = null;
const listeners = new Set<(l: WatchItem[]) => void>();
const emit = () => listeners.forEach((f) => f(cache ?? []));
const keyOf = (type: string, id: number) => `${type}:${id}`;

// Serveur Lumio pas encore à jour (pas de « watchlist » dans /health) : liste gardée sur le téléphone,
// puis envoyée au serveur dès qu'il la gère (elle devient alors la même sur tous les appareils, TV comprise).
const LOCAL_KEY = 'lumio.watchlist.local';
async function serverHasWatchlist(s: Settings) {
  if (!s.chatUrl || !s.jellyfin) return false;
  const h = await serverHealth(s).catch(() => null);
  return Boolean(h?.features?.includes('watchlist'));
}
async function readLocal(): Promise<WatchItem[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(LOCAL_KEY)) || '[]');
  } catch {
    return [];
  }
}
const writeLocal = (l: WatchItem[]) => AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(l)).catch(() => {});

export const watchlist = {
  load: async (s: Settings) => {
    const local = await readLocal();
    if (!(await serverHasWatchlist(s))) {
      cache = local;
      emit();
      return local;
    }
    // Titres ajoutés hors ligne / avant la mise à jour du serveur : envoyés une fois
    if (local.length) {
      for (const x of [...local].reverse()) {
        await serverCall(s, '/api/watchlist', { method: 'POST', body: JSON.stringify(x) }).catch(() => {});
      }
      await AsyncStorage.removeItem(LOCAL_KEY).catch(() => {});
    }
    const r = await serverCall<{ items: WatchItem[] }>(s, '/api/watchlist');
    cache = r.items;
    emit();
    return r.items;
  },
  add: async (s: Settings, item: Omit<WatchItem, 'addedAt' | 'status'>) => {
    // Affichage immédiat, puis enregistrement (serveur, ou téléphone si le serveur n'est pas à jour)
    cache = [{ ...item, addedAt: new Date().toISOString() }, ...(cache ?? []).filter((x) => keyOf(x.type, x.tmdbId) !== keyOf(item.type, item.tmdbId))];
    emit();
    if (await serverHasWatchlist(s)) await serverCall(s, '/api/watchlist', { method: 'POST', body: JSON.stringify(item) });
    else await writeLocal(cache);
  },
  remove: async (s: Settings, type: 'movie' | 'tv', tmdbId: number) => {
    cache = (cache ?? []).filter((x) => keyOf(x.type, x.tmdbId) !== keyOf(type, tmdbId));
    emit();
    if (await serverHasWatchlist(s)) await serverCall(s, `/api/watchlist?type=${type}&tmdbId=${tmdbId}`, { method: 'DELETE' });
    else await writeLocal(cache);
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
    if (!cache) watchlist.load(settings).catch(() => {});
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
  return { on, toggle, available: Boolean(item) };
}
