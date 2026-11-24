// Sortie d'un titre, calculée par le serveur Lumio (calendrier amtVOD, puis dates TMDB) :
// « released » → bouton « Télécharger » ; « upcoming » → bouton « Demander » avec la date (cinéma ou numérique).
import { serverCall } from './chat';
import type { Settings } from './settings';

export type Release = { state: 'released' | 'upcoming'; label: string | null; date: string | null; source?: string };

const memo = new Map<string, { v: Release; at: number }>();

export const releaseApi = {
  get: async (s: Settings, type: 'movie' | 'tv', tmdbId: number): Promise<Release> => {
    const k = `${type}:${tmdbId}`;
    const hit = memo.get(k);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.v;
    const v = await serverCall<Release>(s, `/api/release?type=${type}&tmdbId=${tmdbId}`);
    memo.set(k, { v, at: Date.now() });
    return v;
  },
};
