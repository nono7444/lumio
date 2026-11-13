// « Regarder » un titre absent du serveur : le serveur Lumio cherche le torrent du site dans le cache TorBox (par son empreinte
// seulement) et renvoie un lien de lecture ; le titre part en téléchargement en arrière-plan.
// Les clés restent sur le serveur : l'appli ne reçoit que le lien de lecture.
import { serverCall } from './chat';
import type { Settings } from './settings';

/** enabled : prêt à servir (interrupteur allumé + moteur + une clé) ; on : l'interrupteur seul */
export type WatchNowStatus = { enabled: boolean; on?: boolean; torbox: boolean; alldebrid: boolean; download: boolean };
export type WatchNowResult = {
  url: string;
  service: 'torbox' | 'alldebrid';
  source: string | null;
  hoster: string | null;
  name: string | null;
  quality: string | null;
  language: string | null;
  sizeBytes: number;
  /** Position gardée par le serveur (secondes) pour reprendre là où on s'était arrêté */
  position?: number;
  download?: { state: 'started' | 'pending' | 'declined' | 'already' | 'skipped' | 'off'; reason?: string };
};

export const watchNowApi = {
  status: (s: Settings) => serverCall<WatchNowStatus>(s, '/api/watch/now'),
  start: (s: Settings, body: { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number; title?: string; year?: string; poster?: string; backdrop?: string }) =>
    serverCall<WatchNowResult>(s, '/api/watch/now', { method: 'POST', body: JSON.stringify(body) }),
  /** Position de lecture d'un streaming (gardée sur le serveur, recopiée dans Jellyfin quand le fichier arrive) */
  progress: (s: Settings, body: { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number; position: number; duration?: number; title?: string }) =>
    serverCall<{ ok: boolean }>(s, '/api/watch/progress', { method: 'POST', body: JSON.stringify(body) }).catch(() => null),
  /** Admin : clé TorBox (envoyée au serveur, jamais relue) et interrupteurs */
  save: (s: Settings, body: { torboxKey?: string; enabled?: boolean; download?: boolean }) =>
    serverCall<WatchNowStatus>(s, '/api/watch/now', { method: 'PUT', body: JSON.stringify(body) }),
};
