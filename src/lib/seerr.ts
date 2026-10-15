// Client de l'API Seerr / Jellyseerr / Overseerr (v1).
import type { Settings } from './settings';

export type MediaType = 'movie' | 'tv';

/** MediaStatus côté Seerr */
export const MEDIA_STATUS = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
  BLOCKLISTED: 6,
  DELETED: 7,
} as const;

/** RequestStatus côté Seerr */
export const REQUEST_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  DECLINED: 3,
  FAILED: 4,
  COMPLETED: 5,
} as const;

export type MediaInfo = {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  status: number;
  seasons?: { seasonNumber: number; status: number }[];
  mediaUrl?: string;
  jellyfinMediaId?: string | null;
};

export type SearchResult = {
  id: number;
  mediaType: MediaType | 'person';
  title?: string;
  name?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  mediaInfo?: MediaInfo;
};

export type MovieDetails = {
  id: number;
  title: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  runtime?: number;
  voteAverage?: number;
  genres?: { id: number; name: string }[];
  mediaInfo?: MediaInfo;
};

export type TvDetails = {
  id: number;
  name: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  firstAirDate?: string;
  voteAverage?: number;
  genres?: { id: number; name: string }[];
  seasons: { id: number; seasonNumber: number; name: string; episodeCount: number }[];
  mediaInfo?: MediaInfo;
};

export type RequestItem = {
  id: number;
  status: number;
  createdAt: string;
  type: MediaType;
  is4k?: boolean;
  media: MediaInfo;
  seasons?: { seasonNumber: number }[];
  requestedBy?: { displayName?: string; email?: string };
};

export class SeerrError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function baseUrl(s: Settings) {
  return s.seerrUrl.trim().replace(/\/+$/, '');
}

async function call<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  if (!s.seerrUrl || !s.seerrApiKey) throw new SeerrError('Seerr non configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${baseUrl(s)}/api/v1${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'X-Api-Key': s.seerrApiKey.trim(),
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {}
      throw new SeerrError(msg, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new SeerrError('Délai dépassé');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Seerr rejette certains caractères non encodés (', !, (, ) …) dans query.
const encodeQuery = (q: string) =>
  encodeURIComponent(q).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export const seerr = {
  status: (s: Settings) => call<{ version: string }>(s, '/status'),

  search: (s: Settings, query: string, page = 1) =>
    call<{ results: SearchResult[]; totalPages: number }>(
      s,
      `/search?query=${encodeQuery(query)}&page=${page}&language=fr`
    ),

  trending: (s: Settings) =>
    call<{ results: SearchResult[] }>(s, `/discover/trending?page=1&language=fr`),

  movie: (s: Settings, id: number) => call<MovieDetails>(s, `/movie/${id}?language=fr`),

  tv: (s: Settings, id: number) => call<TvDetails>(s, `/tv/${id}?language=fr`),

  requestMovie: (s: Settings, tmdbId: number) =>
    call<RequestItem>(s, '/request', {
      method: 'POST',
      body: JSON.stringify({ mediaType: 'movie', mediaId: tmdbId }),
    }),

  requestTv: (s: Settings, tmdbId: number, seasons: number[] | 'all') =>
    call<RequestItem>(s, '/request', {
      method: 'POST',
      body: JSON.stringify({ mediaType: 'tv', mediaId: tmdbId, seasons }),
    }),

  requests: (s: Settings, take = 30) =>
    call<{ results: RequestItem[] }>(s, `/request?take=${take}&skip=0&sort=added&filter=all`),
};

export const tmdbImg = (path?: string | null, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

export function mediaStatusLabel(status?: number): { label: string; color: string } | null {
  switch (status) {
    case MEDIA_STATUS.AVAILABLE:
      return { label: 'Disponible', color: '#2FBF71' };
    case MEDIA_STATUS.PARTIALLY_AVAILABLE:
      return { label: 'Partiel', color: '#2FBF71' };
    case MEDIA_STATUS.PROCESSING:
      return { label: 'En cours', color: '#3BA4F2' };
    case MEDIA_STATUS.PENDING:
      return { label: 'Demandé', color: '#F2A93B' };
    default:
      return null;
  }
}

export function requestStatusLabel(status: number): { label: string; color: string } {
  switch (status) {
    case REQUEST_STATUS.PENDING:
      return { label: 'En attente', color: '#F2A93B' };
    case REQUEST_STATUS.APPROVED:
      return { label: 'Approuvée', color: '#3BA4F2' };
    case REQUEST_STATUS.DECLINED:
      return { label: 'Refusée', color: '#EF5B5B' };
    case REQUEST_STATUS.FAILED:
      return { label: 'Échec', color: '#EF5B5B' };
    case REQUEST_STATUS.COMPLETED:
      return { label: 'Terminée', color: '#2FBF71' };
    default:
      return { label: 'Inconnue', color: '#9AA3B2' };
  }
}
