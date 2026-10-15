// Transforme un élément de catalogue Stremio en identifiant TMDB exploitable par Seerr.
import { seerr, type MediaType } from './seerr';
import type { Settings } from './settings';
import { metaYear, type StremioMeta } from './stremio';

export type Resolved = { mediaType: MediaType; tmdbId: number };

const cache = new Map<string, Resolved | null>();

function toMediaType(stremioType: string): MediaType | null {
  if (stremioType === 'movie') return 'movie';
  if (stremioType === 'series' || stremioType === 'tv') return 'tv';
  return null;
}

async function tmdbFind(key: string, imdbId: string, mediaType: MediaType): Promise<number | null> {
  const isV4 = key.startsWith('eyJ');
  const url =
    `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id` +
    (isV4 ? '' : `&api_key=${encodeURIComponent(key)}`);
  const res = await fetch(url, {
    headers: isV4 ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : undefined,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = mediaType === 'movie' ? data.movie_results : data.tv_results;
  return list?.[0]?.id ?? null;
}

async function seerrFallback(s: Settings, meta: StremioMeta, mediaType: MediaType): Promise<number | null> {
  const year = metaYear(meta);
  const { results } = await seerr.search(s, meta.name);
  const candidates = results.filter((r) => r.mediaType === mediaType);
  const withYear = year
    ? candidates.find((r) => {
        const d = r.releaseDate || r.firstAirDate;
        return d && Math.abs(Number(d.slice(0, 4)) - year) <= 1;
      })
    : undefined;
  return (withYear ?? candidates[0])?.id ?? null;
}

export async function resolveMeta(s: Settings, meta: StremioMeta): Promise<Resolved | null> {
  const mediaType = toMediaType(meta.type);
  if (!mediaType) return null;

  const key = `${mediaType}:${meta.id}`;
  if (cache.has(key)) return cache.get(key)!;

  let tmdbId: number | null = null;

  // 1. L'addon fournit directement l'id TMDB
  const tmdbPrefixed = meta.id.match(/^tmdb:(\d+)/);
  if (tmdbPrefixed) tmdbId = Number(tmdbPrefixed[1]);
  else if (meta.moviedb_id) tmdbId = Number(meta.moviedb_id);

  // 2. IMDb → TMDB via l'API TMDB si une clé est fournie
  const imdb = meta.id.match(/^tt\d+/)?.[0] ?? meta.imdb_id;
  if (!tmdbId && imdb && s.tmdbKey) {
    try {
      tmdbId = await tmdbFind(s.tmdbKey.trim(), imdb, mediaType);
    } catch {}
  }

  // 3. Repli : recherche par titre + année dans Seerr
  if (!tmdbId) {
    try {
      tmdbId = await seerrFallback(s, meta, mediaType);
    } catch {}
  }

  if (!tmdbId) return null;
  const result = { mediaType, tmdbId };
  cache.set(key, result);
  return result;
}
