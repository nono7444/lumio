// Lumio Auto (bêta) : remplace Radarr / Sonarr pour l'essentiel. Tout se passe sur le serveur Lumio ;
// les clés (indexeurs, rdt-client) y restent et ne reviennent jamais dans l'appli.
import { serverCall } from './chat';
import type { Settings } from './settings';

export type AutoProfile = {
  resolution: number;
  allowLower: boolean;
  h265: 'required' | 'preferred' | 'any';
  languages: string[];
  maxMovieGb: number;
  maxEpisodeGb: number;
  minSeeders: number;
  maxActive: number;
  searchEveryMin: number;
  rssEveryMin: number;
};
export type AutoIndexer = {
  id: string;
  name: string;
  type: 'torznab' | 'prowlarr';
  url: string;
  hasKey: boolean;
  enabled: boolean;
  rss: boolean;
  search: boolean;
  maxPerHour: number;
  catMovie?: string;
  catTv?: string;
  catAnime?: string;
  status: { ok: boolean; at: string; message?: string; count?: number } | null;
  callsLastHour: number;
};
export type AutoItem = {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: number;
  anime: boolean;
  seasons: number[];
  future: boolean;
  folderPath: string | null;
  paused: boolean;
  note: string | null;
  available: boolean | null;
  availableFrom: string | null;
  have: number;
  nextSearch: string | null;
  lastSearch: string | null;
  active: number;
};
export type AutoGrab = {
  id: string;
  itemId: string;
  title: string;
  release: { title: string; size: number; indexer: string; seeders?: number | null };
  episodes: string[];
  state: 'sent' | 'downloading' | 'importing' | 'done' | 'failed';
  progress: number;
  speed?: number;
  client?: 'rdt' | 'alldebrid';
  error?: string;
  startedAt: string;
  doneAt?: string;
  by: string;
};
export type AutoFolder = { path: string; root: string; folder: string; name: string };
export type AutoState = {
  enabled: boolean;
  client: 'rdt' | 'alldebrid';
  rdt: { url: string; user: string; hasPass: boolean; category: string; remotePath: string; localRoot: string; localFolder: string };
  alldebrid: boolean;
  profile: AutoProfile;
  indexers: AutoIndexer[];
  folders: { movie: AutoFolder[]; tv: AutoFolder[]; defaults: { movie?: string | null; tv?: string | null } };
  disks: string[];
  items: AutoItem[];
  grabs: AutoGrab[];
  log: { at: string; level: string; msg: string }[];
};
export type AutoRelease = { title: string; size: number; seeders: number | null; indexer: string; guid: string; score: number; rejected: string | null };
export type AutoWant = { kind: 'movie' | 'season' | 'episode'; season?: number; episode?: number; count?: number };

const json = (b: unknown) => ({ body: JSON.stringify(b) });

export const autoApi = {
  state: (s: Settings) => serverCall<AutoState>(s, '/api/auto/state'),
  save: (s: Settings, b: Partial<{ enabled: boolean; client: string; rdt: Record<string, string>; profile: Partial<AutoProfile>; folders: { movie?: string | null; tv?: string | null } }>) =>
    serverCall(s, '/api/auto/settings', { method: 'PUT', ...json(b) }),
  saveIndexer: (s: Settings, b: Partial<AutoIndexer> & { key?: string }) => serverCall<{ indexer: AutoIndexer }>(s, '/api/auto/indexers', { method: 'POST', ...json(b) }),
  removeIndexer: (s: Settings, id: string) => serverCall(s, `/api/auto/indexers/${id}`, { method: 'DELETE' }),
  testIndexer: (s: Settings, id: string) => serverCall<{ ok: boolean; message: string; sample?: string[] }>(s, `/api/auto/indexers/${id}/test`, { method: 'POST' }),
  testClient: (s: Settings) => serverCall<{ ok: boolean; message: string }>(s, '/api/auto/test-client', { method: 'POST' }),
  addItem: (s: Settings, b: { type: 'movie' | 'tv'; tmdbId: number; title?: string; seasons?: number[]; folderPath?: string }) =>
    serverCall<{ item: AutoItem }>(s, '/api/auto/items', { method: 'POST', ...json(b) }),
  updateItem: (s: Settings, id: string, b: Partial<{ seasons: number[]; future: boolean; folderPath: string; anime: boolean }>) =>
    serverCall<{ item: AutoItem }>(s, `/api/auto/items/${id}`, { method: 'PATCH', ...json(b) }),
  removeItem: (s: Settings, id: string) => serverCall(s, `/api/auto/items/${id}`, { method: 'DELETE' }),
  pauseItem: (s: Settings, id: string) => serverCall(s, `/api/auto/items/${id}/pause`, { method: 'POST' }),
  searchItem: (s: Settings, id: string) => serverCall<{ message: string }>(s, `/api/auto/items/${id}/search`, { method: 'POST' }),
  searchAll: (s: Settings) => serverCall<{ message: string }>(s, '/api/auto/search-all', { method: 'POST' }),
  releases: (s: Settings, id: string, season?: number, episode?: number) =>
    serverCall<{ want: AutoWant; wanted: AutoWant[]; status: { name: string; count: number; error?: string; skipped?: boolean }[]; results: AutoRelease[] }>(
      s,
      `/api/auto/items/${id}/releases?${new URLSearchParams({ ...(season != null ? { season: String(season) } : {}), ...(episode != null ? { episode: String(episode) } : {}) })}`
    ),
  grab: (s: Settings, id: string, guid: string) => serverCall(s, `/api/auto/items/${id}/grab`, { method: 'POST', ...json({ guid }) }),
  cancelGrab: (s: Settings, id: string) => serverCall(s, `/api/auto/grabs/${id}`, { method: 'DELETE' }),
  unblock: (s: Settings) => serverCall(s, '/api/auto/unblock', { method: 'POST' }),
};

export const gb = (n?: number) => (n ? `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : '—');
