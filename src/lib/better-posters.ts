// Affiches « Better Posters » (btttr.cc) : affiches enrichies avec note, genre, tags tendance.
// Format repris du plugin Jellyfin Better Posters : https://btttr.cc/{style}/imdb/poster-default/{imdb}.jpg
import { useEffect, useState } from 'react';

import type { BetterPostersConfig, Settings } from './settings';
import { useSettings } from './settings';
import { tmdb, type MediaType } from './tmdb';

export type PosterIds = { imdb?: string | null; tmdb?: number; type: MediaType };

export const RATING_SOURCES = [
  { value: '', label: 'Moyenne' },
  { value: 'IM', label: 'IMDb' },
  { value: 'TM', label: 'TMDB' },
  { value: 'RT', label: 'Rotten' },
  { value: 'MC', label: 'Metacritic' },
  { value: 'LB', label: 'Letterboxd' },
];

const LANGS = ['es', 'fr', 'de', 'pt-BR', 'pt-PT', 'it', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'ko', 'zh', 'hi', 'sv', 'cs'];

export function betterPosterUrl(imdb: string, cfg: BetterPostersConfig, language: string) {
  const suffix = cfg.genre ? (cfg.rating ? '' : 'g') : cfg.rating ? 'r' : 'n';
  const path = suffix ? `poster-${suffix}` : 'poster';
  const q = new URLSearchParams();
  const lang = LANGS.includes(language) ? language : LANGS.find((l) => l === language.slice(0, 2));
  if (lang) q.set('lang', lang);
  if (cfg.rating && cfg.ratingSource) q.set('rs', cfg.ratingSource);
  const qs = q.toString();
  return `https://btttr.cc/${path}/imdb/poster-default/${encodeURIComponent(imdb)}.jpg${qs ? `?${qs}` : ''}`;
}

const imdbCache = new Map<string, string | null>();

async function resolveImdb(s: Settings, ids: PosterIds): Promise<string | null> {
  if (ids.imdb) return ids.imdb;
  if (!ids.tmdb || !s.tmdbKey) return null;
  const key = `${ids.type}:${ids.tmdb}`;
  if (imdbCache.has(key)) return imdbCache.get(key)!;
  try {
    const ext = await tmdb.externalIds(s, ids.type, ids.tmdb);
    const imdb = ext.imdb_id ?? null;
    imdbCache.set(key, imdb);
    return imdb;
  } catch {
    return null;
  }
}

/** URL Better Posters pour ces identifiants, ou null (désactivé / pas d'IMDb). */
export function useBetterPoster(ids?: PosterIds, opts?: { hideRating?: boolean }) {
  const { settings } = useSettings();
  const base = settings.betterPosters;
  const cfg = opts?.hideRating && base.rating ? { ...base, rating: false } : base;
  const [url, setUrl] = useState<string | null>(() =>
    cfg.enabled && ids?.imdb ? betterPosterUrl(ids.imdb, cfg, settings.language) : null
  );

  useEffect(() => {
    if (!cfg.enabled || !ids) {
      setUrl(null);
      return;
    }
    let alive = true;
    resolveImdb(settings, ids).then((imdb) => {
      if (alive) setUrl(imdb ? betterPosterUrl(imdb, cfg, settings.language) : null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.enabled, cfg.rating, cfg.genre, cfg.ratingSource, settings.language, ids?.imdb, ids?.tmdb, ids?.type]);

  return url;
}
