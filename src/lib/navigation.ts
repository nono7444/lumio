import { router } from 'expo-router';
import { Alert } from 'react-native';

import { resolveMeta } from './resolve';
import { hasTmdb, type Settings } from './settings';
import type { StremioMeta } from './stremio';
import type { MediaType } from './tmdb';

export function openMedia(mediaType: MediaType, tmdbId: number) {
  router.push({ pathname: '/media/[type]/[id]', params: { type: mediaType, id: String(tmdbId) } });
}

export async function openStremioMeta(s: Settings, meta: StremioMeta) {
  if (!hasTmdb(s)) {
    Alert.alert('Clé TMDB manquante', 'Ajoute ta clé TMDB dans les réglages pour ouvrir les fiches.');
    return;
  }
  const r = await resolveMeta(s, meta);
  if (!r) {
    Alert.alert('Introuvable', `Impossible de retrouver « ${meta.name} » sur TMDB.`);
    return;
  }
  openMedia(r.mediaType, r.tmdbId);
}
