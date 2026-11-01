// Données affichées tout de suite depuis la dernière ouverture (mémoire puis téléphone), puis mises à jour en arrière-plan.
// Au retour sur un écran, pas de nouveau chargement si les données ont moins d'une minute.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const mem = new Map<string, { at: number; data: unknown }>();
const FRESH_MS = 60_000;

export function useCached<T>(key: string | null, fetcher: () => Promise<T>, opts: { onFocus?: boolean; nonce?: number } = {}): T | undefined {
  const onFocus = opts.onFocus ?? true;
  const [data, setData] = useState<T | undefined>(() => (key ? (mem.get(key)?.data as T | undefined) : undefined));
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  // Première ouverture : la copie gardée sur le téléphone s'affiche tout de suite
  useEffect(() => {
    if (!key) return;
    const hit = mem.get(key);
    if (hit) {
      setData(hit.data as T);
      return;
    }
    setData(undefined);
    AsyncStorage.getItem(`cache.${key}`)
      .then((v) => {
        if (!v || mem.has(key)) return;
        const parsed = JSON.parse(v) as T;
        mem.set(key, { at: 0, data: parsed });
        setData(parsed);
      })
      .catch(() => {});
  }, [key]);

  const refresh = useCallback(() => {
    if (!key) return;
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return;
    fetchRef
      .current()
      .then((d) => {
        mem.set(key, { at: Date.now(), data: d });
        setData(d);
        AsyncStorage.setItem(`cache.${key}`, JSON.stringify(d)).catch(() => {});
      })
      .catch(() => {});
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      if (onFocus) refresh();
    }, [refresh, onFocus])
  );
  useEffect(() => {
    if (!onFocus) refresh();
  }, [refresh, onFocus]);

  // Tirer pour actualiser : rechargement forcé
  const firstNonce = useRef(opts.nonce);
  useEffect(() => {
    if (!key || opts.nonce === firstNonce.current) return;
    const hit = mem.get(key);
    if (hit) hit.at = 0;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.nonce]);

  return data;
}

/** Tirer pour actualiser : tout est rechargé au prochain affichage. */
export function invalidateCached() {
  for (const v of mem.values()) v.at = 0;
}
