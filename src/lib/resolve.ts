// Transforme un élément de catalogue Stremio en identifiant TMDB.
import type { Settings } from './settings';
import { metaYear, type StremioMeta } from './stremio';
import { tmdb, type MediaType } from './tmdb';

export type Resolved = { mediaType: MediaType; tmdbId: number };

const cache = new Map<string, Resolved>();

function toMediaType(stremioType: string): MediaType | null {
  if (stremioType === 'movie') return 'movie';
  if (stremioType === 'series' || stremioType === 'tv') return 'tv';
  return null;
}

export async function resolveMeta(s: Settings, meta: StremioMeta): Promise<Resolved | null> {
  const mediaType = toMediaType(meta.type);
  if (!mediaType) return null;

  const key = `${mediaType}:${meta.id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let tmdbId: number | null = null;

  // 1. L'addon fournit directement l'id TMDB
  const prefixed = meta.id.match(/^tmdb:(\d+)/);
  if (prefixed) tmdbId = Number(prefixed[1]);
  else if (meta.moviedb_id) tmdbId = Number(meta.moviedb_id);

  // 2. IMDb → TMDB
  const imdb = meta.id.match(/^tt\d+/)?.[0] ?? meta.imdb_id;
  if (!tmdbId && imdb) {
    try {
      const r = await tmdb.findImdb(s, imdb);
      tmdbId = (mediaType === 'movie' ? r.movie_results : r.tv_results)[0]?.id ?? null;
    } catch {}
  }

  // 3. Repli : recherche par titre + année
  if (!tmdbId) {
    try {
      const { results } = await tmdb.searchType(s, mediaType, meta.name, metaYear(meta));
      tmdbId = results[0]?.id ?? null;
    } catch {}
  }

  if (!tmdbId) return null;
  const result = { mediaType, tmdbId };
  cache.set(key, result);
  return result;
}
