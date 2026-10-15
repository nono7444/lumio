// Client du serveur Lumio : téléchargements pour tous, file d'attente, état des services.
import type { QueueItem } from './arr';
import { serverBase, serverCall } from './chat';
import type { Settings } from './settings';

export type ServerFolder = { path: string; freeSpace?: number; accessible?: boolean };
export type ServiceStatus = {
  ok: boolean;
  ms?: number;
  error?: string;
  version?: string;
  name?: string;
  configured?: boolean;
  queue?: number;
  disks?: ServerFolder[];
};
export type ServerStatus = { lumio: ServiceStatus; jellyfin?: ServiceStatus; radarr?: ServiceStatus; sonarr?: ServiceStatus };
export type ServerHealth = { ok: boolean; version?: string; features?: string[]; radarr?: boolean; sonarr?: boolean };

export type GrabResult =
  | { needFolder: true; folders: ServerFolder[]; default: string | null }
  | { needFolder?: false; added: boolean; message: string; title?: string; folder?: string };

export type GrabBody = {
  type: 'movie' | 'tv';
  tmdbId: number;
  tvdbId?: number;
  seasons?: number[];
  rootFolderPath?: string;
  seriesType?: 'anime' | 'standard';
  askFolder?: boolean;
  title?: string;
  year?: string;
  poster?: string;
};

// Le /health est public : on le garde en cache pour savoir si le serveur gère les téléchargements
let healthCache: { url: string; at: number; value: ServerHealth | null } | null = null;

export async function serverHealth(s: Settings, force = false): Promise<ServerHealth | null> {
  if (!s.chatUrl) return null;
  if (!force && healthCache && healthCache.url === s.chatUrl && Date.now() - healthCache.at < 60_000) return healthCache.value;
  let value: ServerHealth | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${serverBase(s.chatUrl)}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    value = res.ok ? await res.json() : null;
  } catch {
    value = null;
  }
  healthCache = { url: s.chatUrl, at: Date.now(), value };
  return value;
}

/** Le serveur Lumio sait-il lancer des téléchargements (Radarr ou Sonarr configuré) ? */
export async function serverCanGrab(s: Settings, type?: 'movie' | 'tv') {
  const h = await serverHealth(s);
  if (!h?.features?.includes('grab')) return false;
  if (type === 'movie') return Boolean(h.radarr);
  if (type === 'tv') return Boolean(h.sonarr);
  return Boolean(h.radarr || h.sonarr);
}

export const lumio = {
  status: (s: Settings) => serverCall<ServerStatus>(s, '/api/status'),
  folders: (s: Settings, type: 'movie' | 'tv') =>
    serverCall<{ folders: ServerFolder[]; default: string | null }>(s, `/api/arr/folders?type=${type}`),
  grab: (s: Settings, body: GrabBody) => serverCall<GrabResult>(s, '/api/grab', { method: 'POST', body: JSON.stringify(body) }),
  queue: (s: Settings) =>
    serverCall<{ records: (QueueItem & { source: 'radarr' | 'sonarr' })[]; errors: string[] }>(s, '/api/queue'),
  /** Admin : envoie la config Radarr / Sonarr au serveur (les clés restent sur le serveur). */
  pushArr: (s: Settings) =>
    serverCall<ServerStatus>(s, '/api/admin/arr', {
      method: 'POST',
      body: JSON.stringify({
        radarr: s.radarr.url && s.radarr.apiKey ? s.radarr : undefined,
        sonarr: s.sonarr.url && s.sonarr.apiKey ? s.sonarr : undefined,
      }),
    }).finally(() => {
      healthCache = null;
    }),
};
