import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { loadLibrary, type LibraryEntry } from './arr';
import { badgeFor, requestsApi, serverHasRequests } from './requests';
import { isManager, useSettings } from './settings';
import type { MediaType } from './tmdb';

type Lib = { movies: Map<number, LibraryEntry>; series: Map<number, LibraryEntry> };

function toMap(rec: Record<string, number>) {
  const m = new Map<number, LibraryEntry>();
  for (const [k, v] of Object.entries(rec)) {
    const b = badgeFor(v);
    if (b) m.set(Number(k), b);
  }
  return m;
}

/** Renvoie une fonction (type, tmdbId) → badge, rafraîchie à chaque retour sur l'écran. */
export function useLibrary() {
  const { settings } = useSettings();
  const [lib, setLib] = useState<Lib | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        // Serveur Lumio : statuts de Radarr / Sonarr + demandes en cours (comme les badges de Seerr)
        if (await serverHasRequests(settings)) {
          const r = await requestsApi.library(settings).catch(() => null);
          if (r) return { movies: toMap(r.movies), series: toMap(r.series) };
        }
        if (isManager(settings)) return loadLibrary(settings);
        return null;
      })()
        .then((l) => alive && l && setLib(l))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [settings])
  );

  return useCallback(
    (type: MediaType, tmdbId: number): LibraryEntry | null =>
      (type === 'movie' ? lib?.movies.get(tmdbId) : lib?.series.get(tmdbId)) ?? null,
    [lib]
  );
}
