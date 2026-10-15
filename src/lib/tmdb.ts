// Client TMDB v3 : recherche, tendances, fiches, correspondance IMDb.
import type { Settings } from './settings';

export type MediaType = 'movie' | 'tv';

export type TmdbItem = {
  id: number;
  media_type?: MediaType | 'person';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
};

export type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  runtime?: number;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  imdb_id?: string | null;
};

export type TmdbTv = {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  status?: string;
  seasons: { id: number; season_number: number; name: string; episode_count: number; air_date?: string | null }[];
  external_ids?: { tvdb_id?: number | null; imdb_id?: string | null };
};

export class TmdbError extends Error {}

async function call<T>(s: Settings, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = s.tmdbKey.trim();
  if (!key) throw new TmdbError('Clé TMDB manquante');
  const isV4 = key.startsWith('eyJ');
  const qs = new URLSearchParams({ language: s.language || 'fr-FR', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  if (!isV4) qs.set('api_key', key);
  const res = await fetch(`https://api.themoviedb.org/3${path}?${qs}`, {
    headers: { Accept: 'application/json', ...(isV4 ? { Authorization: `Bearer ${key}` } : {}) },
  });
  if (!res.ok) {
    let msg = `TMDB HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.status_message) msg = body.status_message;
    } catch {}
    throw new TmdbError(msg);
  }
  return (await res.json()) as T;
}

const detailCache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = detailCache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    p.catch(() => detailCache.delete(key));
    detailCache.set(key, p);
  }
  return p;
}

export const tmdb = {
  search: (s: Settings, query: string, page = 1) =>
    call<{ results: TmdbItem[]; total_pages: number }>(s, '/search/multi', { query, page, include_adult: 'false' }).then(
      (r) => ({ ...r, results: r.results.filter((i) => i.media_type === 'movie' || i.media_type === 'tv') })
    ),

  searchType: (s: Settings, type: MediaType, query: string, year?: number) =>
    call<{ results: TmdbItem[] }>(s, `/search/${type}`, {
      query,
      ...(year ? (type === 'movie' ? { year } : { first_air_date_year: year }) : {}),
    }),

  trending: (s: Settings) => call<{ results: TmdbItem[] }>(s, '/trending/all/week'),

  movie: (s: Settings, id: number) => cached(`movie:${id}`, () => call<TmdbMovie>(s, `/movie/${id}`)),

  tv: (s: Settings, id: number) =>
    cached(`tv:${id}`, () => call<TmdbTv>(s, `/tv/${id}`, { append_to_response: 'external_ids' })),

  findImdb: (s: Settings, imdbId: string) =>
    call<{ movie_results: TmdbItem[]; tv_results: TmdbItem[] }>(s, `/find/${imdbId}`, { external_source: 'imdb_id' }),
};

export const tmdbImg = (path?: string | null, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

export const itemTitle = (i: TmdbItem) => i.title ?? i.name ?? '';
export const itemYear = (i: TmdbItem) => (i.release_date || i.first_air_date || '').slice(0, 4);
