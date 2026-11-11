// « Regarder maintenant » : un titre absent du serveur se regarde tout de suite. Le serveur Lumio trouve un lien
// (Movix, Wawacity), TorBox ou AllDebrid en fait un lien de lecture, et le titre se télécharge en arrière-plan.
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
  download?: { state: 'started' | 'already' | 'skipped' | 'off'; reason?: string };
};

export const watchNowApi = {
  status: (s: Settings) => serverCall<WatchNowStatus>(s, '/api/watch/now'),
  start: (s: Settings, body: { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number; title?: string; year?: string; poster?: string; backdrop?: string }) =>
    serverCall<WatchNowResult>(s, '/api/watch/now', { method: 'POST', body: JSON.stringify(body) }),
  /** Admin : clé TorBox (envoyée au serveur, jamais relue) et interrupteurs */
  save: (s: Settings, body: { torboxKey?: string; enabled?: boolean; download?: boolean }) =>
    serverCall<WatchNowStatus>(s, '/api/watch/now', { method: 'PUT', body: JSON.stringify(body) }),
};
