// Version de l'appli et détection des mises à jour : on lit la source FlareStore/AltStore publiée à chaque build.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
export const SOURCE_URL = 'https://github.com/nono7444/lumio/releases/latest/download/altstore.json';
export const RELEASES_URL = 'https://github.com/nono7444/lumio/releases/latest';

export type UpdateInfo = { version: string; date?: string; notes?: string };

/** 1.0.12 < 1.0.9 ? Non : comparaison nombre par nombre. */
export function isNewer(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

let latest: UpdateInfo | null = null;
let checkedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function check(force = false) {
  if (!force && Date.now() - checkedAt < 30 * 60_000) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${SOURCE_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const src = await res.json();
      const app = src?.apps?.[0];
      const v = app?.versions?.[0];
      const version = v?.version ?? app?.version;
      if (typeof version !== 'string') return;
      latest = { version, date: v?.date ?? app?.versionDate, notes: v?.localizedDescription };
      checkedAt = Date.now();
      listeners.forEach((l) => l());
    } catch {
      // hors ligne : on réessaiera au prochain retour dans l'appli
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export const checkForUpdate = () => check(true);

/** Mise à jour disponible (null sinon). Vérifie au lancement et à chaque retour dans l'appli. */
export function useAppUpdate() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => {
      listeners.delete(l);
      sub.remove();
    };
  }, []);
  return latest && isNewer(latest.version, APP_VERSION) ? latest : null;
}

const DISMISSED_KEY = 'lumio.update.dismissed';
export const dismissedVersion = () => AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
export const dismissVersion = (v: string) => AsyncStorage.setItem(DISMISSED_KEY, v).catch(() => {});

/** « Build build-24 » → texte lisible pour les notes. */
export const cleanNotes = (n?: string) => (n && !/^Build build-\d+$/.test(n.trim()) ? n.trim() : undefined);
