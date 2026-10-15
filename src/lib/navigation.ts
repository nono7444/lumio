import { router } from 'expo-router';
import { Alert } from 'react-native';

import { resolveMeta } from './resolve';
import type { MediaType } from './seerr';
import type { Settings } from './settings';
import type { StremioMeta } from './stremio';

export function openMedia(mediaType: MediaType, tmdbId: number) {
  router.push({ pathname: '/media/[type]/[id]', params: { type: mediaType, id: String(tmdbId) } });
}

export async function openStremioMeta(s: Settings, meta: StremioMeta) {
  if (!s.seerrUrl || !s.seerrApiKey) {
    Alert.alert('Seerr non configuré', 'Ajoute ton serveur Seerr dans les réglages pour voir la fiche et faire une demande.');
    return;
  }
  const r = await resolveMeta(s, meta);
  if (!r) {
    Alert.alert('Introuvable', `Impossible de retrouver « ${meta.name} » sur TMDB.`);
    return;
  }
  openMedia(r.mediaType, r.tmdbId);
}
