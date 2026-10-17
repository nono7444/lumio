// Notes de la famille : étoiles (1 à 5) et petit avis, stockés sur le serveur Lumio.
import { useEffect, useState } from 'react';

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

// ——— Pastilles sur les affiches : toutes les moyennes, chargées une fois et partagées ———

export type RatingSummary = { avg: number; count: number };
let summary: Record<string, RatingSummary> = {};
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function loadSummary(s: Settings) {
  try {
    const r = await serverCall<{ items: Record<string, RatingSummary> }>(s, '/api/ratings/summary');
    summary = r.items ?? {};
  } catch {
    // Serveur plus ancien (< 3.7.0) : on se contente des coups de cœur
    const top = await ratingsApi.top(s).catch(() => [] as TopRated[]);
    summary = Object.fromEntries(top.map((t) => [`${t.type}:${t.tmdbId}`, { avg: Math.round(t.avg * 10) / 10, count: t.count }]));
  }
  loadedAt = Date.now();
  listeners.forEach((l) => l());
}

/** Recharge les pastilles (après avoir noté un titre). */
export function refreshRatingSummary(s: Settings) {
  inflight = loadSummary(s).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Moyenne de la famille pour un titre, ou null. Se met à jour toute seule. */
export function useFamilyRatingBadge(s: Settings, type: 'movie' | 'tv' | undefined, tmdbId: number | undefined): RatingSummary | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (s.chatUrl && s.jellyfin && !inflight && Date.now() - loadedAt > 5 * 60_000) refreshRatingSummary(s);
    return () => {
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.chatUrl, s.jellyfin?.token]);
  if (!type || !tmdbId) return null;
  return summary[`${type}:${tmdbId}`] ?? null;
}
