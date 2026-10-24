// Demandes façon Seerr, servies par le serveur Lumio (mêmes statuts et mêmes règles que Seerr).
import { useEffect, useState } from 'react';

import type { LibraryEntry } from './arr';
import { serverCall } from './chat';
import { serverHealth, type ServerFolder } from './lumio-server';
import { useSettings, type Settings } from './settings';

// Valeurs identiques à Seerr (server/constants/media.ts)
export const RequestStatus = { PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 } as const;
export const MediaStatus = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIALLY_AVAILABLE: 4, AVAILABLE: 5 } as const;

export type Req = {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  tvdbId?: number;
  title: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  seasons?: number[];
  status: number;
  requestedBy: { id: string; name: string };
  createdAt: string;
  modifiedBy?: { id: string; name: string };
  modifiedAt?: string;
  completedAt?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  reason?: string;
  error?: string;
  mediaStatus: number;
  seasonStatuses: { seasonNumber: number; status: number }[];
  /** Suivi dans Radarr / Sonarr pour une demande approuvée */
  download?: {
    state: 'searching' | 'downloading' | 'importing' | 'warning' | 'partial';
    progress?: number | null;
    /** Groupe de secours : Radarr / Sonarr hors service, Lumio Secour télécharge à leur place */
    via?: 'secour';
    title?: string;
    message?: string;
    release?: string;
    count?: number;
    /** Partiel : saisons complètes, saisons entamées, saisons demandées */
    available?: number;
    partial?: number;
    total?: number;
  };
};

export type MediaInfo = { status: number; seasons: { seasonNumber: number; status: number; have?: number; total?: number }[]; requests: Req[] };

export type Me = {
  id: string;
  name: string;
  admin: boolean;
  permissions: { admin: boolean; autoApprove: boolean; movieQuotaLimit: number; movieQuotaDays: number; tvQuotaLimit: number; tvQuotaDays: number };
  quota: {
    movie: { limit: number; days: number; used: number; remaining: number | null };
    tv: { limit: number; days: number; used: number; remaining: number | null };
  };
};

export type ArrOptions = {
  folders: ServerFolder[];
  default: string | null;
  profiles: { id: number; name: string }[];
  defaultProfile: number | null;
  /** Profil imposé par le serveur à toutes les demandes (ex. « HD-1080p nono ») */
  lockedProfile?: { id: number; name: string } | null;
};

export type AdminSettings = {
  ntfyTopic?: string;
  ntfyServer?: string;
  ntfyEnabled?: boolean;
  publicUrl?: string | null;
  defaultAutoApprove: boolean;
  defaultMovieQuotaLimit: number;
  defaultMovieQuotaDays: number;
  defaultTvQuotaLimit: number;
  defaultTvQuotaDays: number;
  usersSeeAllRequests: boolean;
};

export type AdminUser = {
  id: string;
  name: string;
  admin: boolean;
  permissions: Me['permissions'];
  custom: Partial<{ autoApprove: boolean; movieQuotaLimit: number; movieQuotaDays: number; tvQuotaLimit: number; tvQuotaDays: number }>;
  quota: Me['quota'];
  requestCount: number;
};

export type RequestFilter = 'all' | 'pending' | 'approved' | 'processing' | 'available' | 'declined' | 'failed';

export const requestsApi = {
  me: (s: Settings) => serverCall<Me>(s, '/api/me'),
  media: (s: Settings, type: 'movie' | 'tv', tmdbId: number, tvdbId?: number | null, seasons?: number[]) => {
    const p = new URLSearchParams({ type, tmdbId: String(tmdbId) });
    if (tvdbId) p.set('tvdbId', String(tvdbId));
    if (seasons?.length) p.set('seasons', seasons.join(','));
    return serverCall<MediaInfo>(s, `/api/media?${p}`);
  },
  library: (s: Settings) => serverCall<{ movies: Record<string, number>; series: Record<string, number> }>(s, '/api/library'),
  list: (s: Settings, filter: RequestFilter, opts: { take?: number; skip?: number; sort?: 'added' | 'modified'; mine?: boolean } = {}) => {
    const p = new URLSearchParams({ filter, take: String(opts.take ?? 30), skip: String(opts.skip ?? 0), sort: opts.sort ?? 'added' });
    if (opts.mine) p.set('mine', '1');
    return serverCall<{ total: number; counts: { pending: number }; results: Req[] }>(s, `/api/requests?${p}`);
  },
  create: (
    s: Settings,
    body: {
      type: 'movie' | 'tv';
      tmdbId: number;
      tvdbId?: number;
      seasons?: number[];
      title: string;
      year?: string;
      poster?: string;
      backdrop?: string;
      rootFolderPath?: string;
      qualityProfileId?: number;
    }
  ) => serverCall<Req>(s, '/api/requests', { method: 'POST', body: JSON.stringify(body) }),
  approve: (s: Settings, id: string, opts: { rootFolderPath?: string; qualityProfileId?: number } = {}) =>
    serverCall<Req>(s, `/api/requests/${id}/approve`, { method: 'POST', body: JSON.stringify(opts) }),
  retry: (s: Settings, id: string) => serverCall<Req>(s, `/api/requests/${id}/retry`, { method: 'POST', body: '{}' }),
  /** Relance la recherche Radarr / Sonarr d'une demande en cours et dit si une version a été trouvée */
  search: (s: Settings, id: string) =>
    serverCall<{ found: boolean; available?: boolean; pending?: boolean; message: string }>(s, `/api/requests/${id}/search`, { method: 'POST', body: '{}' }),
  decline: (s: Settings, id: string, reason?: string) =>
    serverCall<Req>(s, `/api/requests/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason }) }),
  /** arr (admin) : 'keep' = arrêter + retirer de Radarr / Sonarr en gardant les fichiers, 'files' = tout supprimer */
  remove: (s: Settings, id: string, arr?: 'keep' | 'files') =>
    serverCall<{ message?: string } | undefined>(s, `/api/requests/${id}${arr ? `?arr=${arr}` : ''}`, { method: 'DELETE' }),
  options: (s: Settings, type: 'movie' | 'tv') => serverCall<ArrOptions>(s, `/api/arr/options?type=${type}`),
  users: (s: Settings) => serverCall<{ settings: AdminSettings; users: AdminUser[] }>(s, '/api/admin/users'),
  updateUser: (s: Settings, id: string, patch: Record<string, number | boolean | null>) =>
    serverCall(s, `/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  notifyTest: (s: Settings) => serverCall<{ ok: boolean; topic: string }>(s, '/api/admin/notify-test', { method: 'POST', body: '{}' }),
  updateSettings: (s: Settings, patch: Partial<AdminSettings> & { newNtfyTopic?: boolean }) =>
    serverCall<AdminSettings>(s, '/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

/** Le serveur Lumio gère-t-il les demandes ? */
export async function serverHasRequests(s: Settings) {
  if (!s.chatUrl || !s.jellyfin) return false;
  const h = await serverHealth(s);
  return Boolean(h?.features?.includes('requests'));
}

export function useServerRequests(nonce = 0) {
  const { settings } = useSettings();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    serverHasRequests(settings).then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, [settings.chatUrl, settings.jellyfin?.token, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return ok;
}

// ——— Libellés (ceux de Seerr en français) ———

export function mediaStatusLabel(st: number): { label: string; color: string; icon: string } | null {
  switch (st) {
    case MediaStatus.AVAILABLE:
      return { label: 'Disponible', color: '#30D158', icon: 'checkmark-circle' };
    case MediaStatus.PARTIALLY_AVAILABLE:
      return { label: 'Partiel', color: '#FF9F0A', icon: 'contrast' };
    case MediaStatus.PROCESSING:
      return { label: 'En cours de traitement', color: '#3D8BFF', icon: 'cloud-download' };
    case MediaStatus.PENDING:
      return { label: 'En attente de validation', color: '#FF9F0A', icon: 'hourglass' };
    default:
      return null;
  }
}

export function requestStatusLabel(st: number): { label: string; color: string } {
  switch (st) {
    case RequestStatus.PENDING:
      return { label: 'En attente', color: '#FF9F0A' };
    case RequestStatus.APPROVED:
      return { label: 'Approuvée', color: '#3D8BFF' };
    case RequestStatus.DECLINED:
      return { label: 'Refusée', color: '#FF453A' };
    case RequestStatus.FAILED:
      return { label: 'Échec', color: '#FF453A' };
    case RequestStatus.COMPLETED:
      return { label: 'Disponible', color: '#30D158' };
    default:
      return { label: '—', color: '#8E8E93' };
  }
}

/** Badge d'affiche à partir d'un statut de média. */
export function badgeFor(st: number | undefined): LibraryEntry | null {
  switch (st) {
    case MediaStatus.AVAILABLE:
      return { state: 'available', label: 'Disponible', color: '#2FBF71' };
    case MediaStatus.PARTIALLY_AVAILABLE:
      return { state: 'partial', label: 'Partiellement disponible', color: '#2FBF71' };
    case MediaStatus.PROCESSING:
      return { state: 'monitored', label: 'En cours', color: '#F2A93B' };
    case MediaStatus.PENDING:
      return { state: 'pending', label: 'En attente', color: '#FF9F0A' };
    default:
      return null;
  }
}

/** « il y a 2 h », « il y a 3 j »… */
export function timeAgo(iso: string) {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return 'à l’instant';
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `il y a ${Math.floor(d / 86400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Admin : nombre de demandes en attente (pastille rouge sur l'onglet Demandes), vérifié toutes les 60 s. */
export function usePendingRequests() {
  const { settings } = useSettings();
  const [n, setN] = useState(0);
  const admin = settings.jellyfin?.isAdmin === true;
  useEffect(() => {
    if (!admin || !settings.chatUrl) return;
    let alive = true;
    const tick = async () => {
      if (!(await serverHasRequests(settings))) return;
      const r = await requestsApi.list(settings, 'pending', { take: 1 }).catch(() => null);
      if (alive && r) setN(r.counts.pending);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [admin, settings.chatUrl, settings.jellyfin?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

/** Ligne de suivi d'une demande approuvée (recherche, téléchargement, blocage). */
/** « 1 saison sur 10 » (+ « 1 entamée ») */
export function partialText(d: NonNullable<Req['download']>) {
  const have = d.available ?? 0;
  const total = d.total ?? 0;
  const part = d.partial ? ` · ${d.partial} entamée${d.partial > 1 ? 's' : ''}` : '';
  return `${have} saison${have > 1 ? 's' : ''} sur ${total}${part}`;
}

export function downloadLabel(r: Req): { text: string; color: string } | null {
  const d = r.download;
  if (!d) return null;
  const app = r.type === 'movie' ? 'Radarr' : 'Sonarr';
  if (d.via === 'secour')
    return { text: `🛟 ${d.title ?? 'Lumio Secour'}${d.progress != null ? ` · ${d.progress} %` : ''}${d.count && d.count > 1 ? ` · ${d.count} épisodes restants` : ''}`, color: '#30D158' };
  switch (d.state) {
    case 'warning':
      return { text: `⚠️ À vérifier dans ${app} : ${d.message ?? 'intervention manuelle nécessaire'}`, color: '#FF9F0A' };
    case 'importing':
      return { text: `Import dans ${app}…`, color: '#64D2FF' };
    case 'downloading':
      return { text: `Téléchargement${d.progress != null ? ` ${d.progress} %` : '…'}${d.count && d.count > 1 ? ` · ${d.count} épisodes` : ''}`, color: '#3D8BFF' };
    case 'partial':
      return { text: `◐ Partiel · ${partialText(d)}`, color: '#FF9F0A' };
    default:
      return { text: `${app} cherche une release…`, color: '#8E8E93' };
  }
}
