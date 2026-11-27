// Lumio : les univers de l'appli (films et séries Jellyfin, Lumio Auto pour l'admin, livres, livres audio, TV en direct).
// Twitch n'est plus un univers : la sauvegarde des rediffusions est un onglet de Lumio Auto.
// Le choix est gardé sur le téléphone ; Films & séries est l'univers par défaut.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { IS_AUDIO, IS_BOOKS } from './variant';

export type Universe = 'media' | 'auto' | 'books' | 'audio' | 'tv';
export const UNIVERSES: { id: Universe; label: string; icon: 'film' | 'headset' | 'library' | 'tv' | 'flash'; home: string; admin?: boolean }[] = [
  { id: 'media', label: 'Films & séries', icon: 'film', home: 'index' },
  // Lumio Auto (ancienne appli à part) : gestion du serveur, torrents, demandes, rediffusions Twitch — réservé à l'admin
  { id: 'auto', label: 'Lumio Auto', icon: 'flash', home: 'perf', admin: true },
  { id: 'books', label: 'Livres', icon: 'library', home: 'shelf' },
  { id: 'audio', label: 'Livres audio', icon: 'headset', home: 'listen' },
  { id: 'tv', label: 'TV', icon: 'tv', home: 'live' },
];
/** Onglets de chaque univers (le Profil est commun). */
export const UNIVERSE_TABS: Record<Universe, string[]> = {
  media: ['index', 'search', 'library', 'calendar', 'watchlist', 'settings'],
  auto: ['perf', 'seed', 'demandes', 'twitch', 'qbit', 'disks', 'server', 'playing', 'settings'],
  books: ['shelf', 'findbook', 'booktop', 'settings'],
  audio: ['listen', 'find', 'settings'],
  tv: ['live', 'settings'],
};

const KEY = 'lumio:univers';
let current: Universe = IS_AUDIO ? 'audio' : IS_BOOKS ? 'books' : 'media';
const subs = new Set<() => void>();
AsyncStorage.getItem(KEY)
  .then((raw) => {
    // L'ancien univers Twitch est maintenant dans Lumio Auto
    const v = raw === 'twitch' ? 'auto' : raw;
    if ((v === 'audio' || v === 'books' || v === 'media' || v === 'tv' || v === 'auto') && !IS_AUDIO && !IS_BOOKS && v !== current) {
      current = v;
      subs.forEach((f) => f());
    }
  })
  .catch(() => {});

export function setUniverse(u: Universe) {
  if (u === current) return;
  current = u;
  AsyncStorage.setItem(KEY, u).catch(() => {});
  subs.forEach((f) => f());
}
export const getUniverse = () => current;
export const useUniverse = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current
  );
