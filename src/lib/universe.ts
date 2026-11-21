// Lumio : les trois univers de l'appli (films et séries Jellyfin, livres audio, livres). Le choix est gardé
// sur le téléphone ; Films & séries est l'univers par défaut.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { IS_AUDIO, IS_BOOKS } from './variant';

export type Universe = 'media' | 'audio' | 'books' | 'twitch';
export const UNIVERSES: { id: Universe; label: string; icon: 'film' | 'headset' | 'library' | 'logo-twitch'; home: string; admin?: boolean }[] = [
  { id: 'media', label: 'Films & séries', icon: 'film', home: 'index' },
  { id: 'audio', label: 'Livres audio', icon: 'headset', home: 'listen' },
  { id: 'books', label: 'Livres', icon: 'library', home: 'shelf' },
  // Rediffusions Twitch : réservé à l'admin
  { id: 'twitch', label: 'Twitch', icon: 'logo-twitch', home: 'twitch', admin: true },
];
/** Onglets de chaque univers (le Profil est commun). */
export const UNIVERSE_TABS: Record<Universe, string[]> = {
  media: ['index', 'search', 'library', 'live', 'calendar', 'chat', 'activity', 'watchlist', 'settings'],
  audio: ['listen', 'find', 'settings'],
  books: ['shelf', 'findbook', 'settings'],
  twitch: ['twitch', 'settings'],
};

const KEY = 'lumio:univers';
let current: Universe = IS_AUDIO ? 'audio' : IS_BOOKS ? 'books' : 'media';
const subs = new Set<() => void>();
AsyncStorage.getItem(KEY)
  .then((v) => {
    if ((v === 'audio' || v === 'books' || v === 'media' || v === 'twitch') && !IS_AUDIO && !IS_BOOKS && v !== current) {
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
