// Client Seerr / Jellyseerr : demandes des utilisateurs non-admins, validées par l'admin.
// Connexion avec les identifiants Jellyfin (cookie de session), clé API optionnelle pour l'admin.
import type { Settings } from './settings';

export const REQUEST_STATUS = { PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 } as const;
export const MEDIA_STATUS = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 } as const;

export type SeerrUser = { id: number; displayName?: string; username?: string; jellyfinUsername?: string; email?: string; avatar?: string; permissions?: number };

export type SeerrRequest = {
  id: number;
  status: number;
  type: 'movie' | 'tv';
  createdAt: string;
  media: { tmdbId: number; mediaType: 'movie' | 'tv'; status: number };
  seasons?: { seasonNumber: number }[];
  requestedBy?: SeerrUser;
};

export type SeerrMediaInfo = { status: number; seasons?: { seasonNumber: number; status: number }[]; requests?: SeerrRequest[] };

export class SeerrError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const base = (url: string) => {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
};

async function call<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  const cfg = s.seerr;
  if (!cfg?.url) throw new SeerrError('Seerr non configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${base(cfg.url)}/api/v1${path}`, {
      ...init,
      credentials: 'include',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cfg.apiKey ? { 'X-Api-Key': cfg.apiKey } : {}),
      },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {}
      if (res.status === 401 || res.status === 403) msg = res.status === 401 ? 'Session Seerr expirée' : 'Droit refusé par Seerr';
      throw new SeerrError(msg, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new SeerrError('Seerr injoignable (délai dépassé)');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const seerr = {
  /** Connexion avec le compte Jellyfin : Seerr pose un cookie de session. */
  login: async (url: string, username: string, password: string): Promise<SeerrUser> => {
    const res = await fetch(`${base(url)}/api/v1/auth/jellyfin`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {}
      throw new SeerrError(msg, res.status);
    }
    return (await res.json()) as SeerrUser;
  },

  me: (s: Settings) => call<SeerrUser>(s, '/auth/me'),

  requestMovie: (s: Settings, tmdbId: number) =>
    call<SeerrRequest>(s, '/request', { method: 'POST', body: JSON.stringify({ mediaType: 'movie', mediaId: tmdbId }) }),

  requestTv: (s: Settings, tmdbId: number, seasons: number[] | 'all') =>
    call<SeerrRequest>(s, '/request', { method: 'POST', body: JSON.stringify({ mediaType: 'tv', mediaId: tmdbId, seasons }) }),

  requests: (s: Settings, filter: 'all' | 'pending' | 'approved' | 'available' = 'all', take = 50) =>
    call<{ results: SeerrRequest[] }>(s, `/request?take=${take}&skip=0&sort=added&filter=${filter}`).then((r) => r.results),

  approve: (s: Settings, id: number) => call(s, `/request/${id}/approve`, { method: 'POST' }),
  decline: (s: Settings, id: number) => call(s, `/request/${id}/decline`, { method: 'POST' }),
  remove: (s: Settings, id: number) => call(s, `/request/${id}`, { method: 'DELETE' }),

  mediaInfo: (s: Settings, type: 'movie' | 'tv', tmdbId: number) =>
    call<{ mediaInfo?: SeerrMediaInfo }>(s, `/${type}/${tmdbId}`).then((r) => r.mediaInfo ?? null),
};

export function requestLabel(status: number): { label: string; color: string } {
  switch (status) {
    case REQUEST_STATUS.PENDING:
      return { label: 'En attente', color: '#FFB340' };
    case REQUEST_STATUS.APPROVED:
      return { label: 'Approuvée', color: '#64D2FF' };
    case REQUEST_STATUS.DECLINED:
      return { label: 'Refusée', color: '#FF453A' };
    case REQUEST_STATUS.FAILED:
      return { label: 'Échec', color: '#FF453A' };
    case REQUEST_STATUS.COMPLETED:
      return { label: 'Disponible', color: '#30D158' };
    default:
      return { label: 'Inconnue', color: '#A1A1A6' };
  }
}

export function mediaLabel(status?: number): { label: string; color: string } | null {
  switch (status) {
    case MEDIA_STATUS.AVAILABLE:
      return { label: 'Disponible', color: '#30D158' };
    case MEDIA_STATUS.PARTIAL:
      return { label: 'Partiel', color: '#30D158' };
    case MEDIA_STATUS.PROCESSING:
      return { label: 'En cours', color: '#64D2FF' };
    case MEDIA_STATUS.PENDING:
      return { label: 'Demandé', color: '#FFB340' };
    default:
      return null;
  }
}
