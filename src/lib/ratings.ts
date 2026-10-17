// Notes de la famille : étoiles (1 à 5) et petit avis, stockés sur le serveur Lumio.
import { serverCall } from './chat';
import type { Settings } from './settings';

export type RatingInfo = {
  avg: number | null;
  count: number;
  mine: { stars: number; comment: string } | null;
  list: { name: string; stars: number; comment?: string; at: string; mine: boolean }[];
};
export type TopRated = { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string; count: number; avg: number };

export const ratingsApi = {
  get: (s: Settings, type: 'movie' | 'tv', tmdbId: number) => serverCall<RatingInfo>(s, `/api/ratings?type=${type}&tmdbId=${tmdbId}`),
  set: (s: Settings, b: { type: 'movie' | 'tv'; tmdbId: number; stars: number; comment?: string; title?: string; poster?: string }) =>
    serverCall<{ ok: boolean }>(s, '/api/ratings', { method: 'POST', body: JSON.stringify(b) }),
  top: (s: Settings) => serverCall<{ items: TopRated[] }>(s, '/api/ratings/top').then((r) => r.items),
};

export const starsText = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
