import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { loadLibrary, type LibraryEntry } from './arr';
import { useSettings } from './settings';
import type { MediaType } from './tmdb';

/** Renvoie une fonction (type, tmdbId) → badge, rafraîchie à chaque retour sur l'écran. */
export function useLibrary() {
  const { settings } = useSettings();
  const [lib, setLib] = useState<Awaited<ReturnType<typeof loadLibrary>> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadLibrary(settings)
        .then((l) => alive && setLib(l))
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
