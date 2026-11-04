// Lumio Auto (bêta) : remplace Radarr / Sonarr pour l'essentiel. Tout se passe sur le serveur Lumio ;
// les clés (indexeurs, rdt-client) y restent et ne reviennent jamais dans l'appli.
import { serverCall } from './chat';
import type { Settings } from './settings';

export type AutoProfile = {
  resolution: number;
  allowLower: boolean;
  h265: 'required' | 'preferred' | 'any';
  h265Wait?: number;
  upgradeDays?: number;
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
  type: 'c411' | 'torznab' | 'prowlarr';
  url: string;
  hasKey: boolean;
  enabled: boolean;
  rss: boolean;
  search: boolean;
  maxPerHour: number;
  catMovie?: string;
  catTv?: string;
  catAnime?: string;
  status: { ok: boolean; at: string; message?: string; count?: number; url?: string } | null;
  callsLastHour: number;
  caps?: { tv: string[] | null; movie: string[] | null } | null;
  client?: '' | 'rdt' | 'qbit' | 'alldebrid';
  maxGbPerDay?: number;
  todayGb?: number;
};
export type QbitTorrent = {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  dl: number;
  up: number;
  ratio: number;
  uploaded: number;
  eta: number | null;
  seeds: number;
  peers: number;
  category: string;
  addedOn: string | null;
  seedTime: number;
  hrLeftH?: number;
  swarmLeechers?: number | null;
  swarmSeeders?: number | null;
  tracker: string;
  lumio: string | null;
};
export type AutoSeed = { ratio: number; days: number; smart?: boolean; summary?: boolean };
export type QbitPrefs = {
  scheduler_enabled: boolean;
  queueing_enabled: boolean;
  max_active_torrents: number;
  max_active_uploads: number;
  max_active_downloads: number;
  dont_count_slow_torrents: boolean;
  up_limit: number;
  dl_limit: number;
  max_uploads: number;
  max_uploads_per_torrent: number;
  max_connec: number;
  max_connec_per_torrent: number;
  alt_up_limit: number;
  alt_dl_limit: number;
};
export type QbitState = {
  ok: boolean;
  error?: string;
  vpnPort?: number | null;
  transfer?: { dl: number; up: number; dlLimit: number; upLimit: number; alt: boolean; status: string | null };
  torrents: QbitTorrent[];
};
export type AutoTry = { query: string; count: number; error: string | null; skipped: boolean; url: string | null };
export type AutoEvent = { at: string; type: 'added' | 'found' | 'none' | 'sent' | 'imported' | 'failed'; msg: string; indexer?: string; size?: number; by?: string };
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
  searching: string | null;
  lastReport: {
    at: string;
    want: string;
    total: number;
    kept: number;
    best: string | null;
    sites: { name: string; count: number; error: string | null; skipped: boolean; tries: AutoTry[] }[];
    reasons: string[];
  } | null;
  needsChoice: boolean;
  imdbId: string | null;
  events: AutoEvent[];
  requestedBy: string[];
  addedAt?: string;
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
  size?: number;
  downloaded?: number;
  eta?: number | null;
  statusText?: string;
  clientState?: string | null;
  paused?: boolean;
  importSrc?: string;
  client?: 'rdt' | 'alldebrid' | 'qbit';
  seeding?: boolean;
  ratio?: number;
  uploaded?: number;
  seedTime?: number;
  upSpeed?: number;
  seedEnd?: string;
  seedNote?: string | null;
  leechers?: number;
  seeders?: number;
  error?: string;
  startedAt: string;
  doneAt?: string;
  by: string;
};
export type AutoFolder = { path: string; root: string; folder: string; name: string };
export type AutoState = {
  enabled: boolean;
  debridOnly?: boolean;
  client: 'rdt' | 'alldebrid' | 'qbit';
  adoptable?: number;
  rdt: { url: string; user: string; hasPass: boolean; category: string; remotePath: string; localRoot: string; localFolder: string };
  qbit?: { url: string; user: string; hasPass: boolean; category: string; remotePath: string; localRoot: string; localFolder: string };
  seed?: AutoSeed;
  vpnPort?: { port: number | null; at: string | null; error: string | null; fixed: string | null };
  alldebrid: boolean;
  profile: AutoProfile;
  indexers: AutoIndexer[];
  folders: { movie: AutoFolder[]; tv: AutoFolder[]; defaults: { movie?: string | null; tv?: string | null } };
  disks: string[];
  items: AutoItem[];
  grabs: AutoGrab[];
  log: { at: string; level: string; msg: string }[];
};
export type AutoRelease = {
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  grabs: number | null;
  indexer: string;
  guid: string;
  score: number;
  rejected: string | null;
  reasons: string[];
  ageDays: number | null;
  quality: string;
  languages: string[];
  matchedBy: 'identifiant' | 'nom' | null;
  freeleech: boolean;
  details: string | null;
};
export type AutoWant = { kind: 'movie' | 'season' | 'episode'; season?: number; episode?: number; count?: number };

const json = (b: unknown) => ({ body: JSON.stringify(b) });

export const autoApi = {
  state: (s: Settings) => serverCall<AutoState>(s, '/api/auto/state'),
  save: (s: Settings, b: Partial<{ enabled: boolean; debridOnly: boolean; client: string; rdt: Record<string, string>; qbit: Record<string, string | undefined>; seed: Partial<AutoSeed>; profile: Partial<AutoProfile>; folders: { movie?: string | null; tv?: string | null } }>) =>
    serverCall(s, '/api/auto/settings', { method: 'PUT', ...json(b) }),
  saveIndexer: (s: Settings, b: Partial<AutoIndexer> & { key?: string }) => serverCall<{ indexer: AutoIndexer }>(s, '/api/auto/indexers', { method: 'POST', ...json(b) }),
  removeIndexer: (s: Settings, id: string) => serverCall(s, `/api/auto/indexers/${id}`, { method: 'DELETE' }),
  testIndexer: (s: Settings, id: string) => serverCall<{ ok: boolean; message: string; sample?: string[]; url?: string; caps?: string }>(s, `/api/auto/indexers/${id}/test`, { method: 'POST' }),
  testClient: (s: Settings, client?: 'rdt' | 'qbit' | 'alldebrid') =>
    serverCall<{ ok: boolean; message: string }>(s, '/api/auto/test-client', { method: 'POST', body: JSON.stringify({ client }) }),
  addItem: (s: Settings, b: { type: 'movie' | 'tv'; tmdbId: number; title?: string; seasons?: number[]; folderPath?: string }) =>
    serverCall<{ item: AutoItem }>(s, '/api/auto/items', { method: 'POST', ...json(b) }),
  updateItem: (s: Settings, id: string, b: Partial<{ seasons: number[]; future: boolean; folderPath: string; anime: boolean }>) =>
    serverCall<{ item: AutoItem }>(s, `/api/auto/items/${id}`, { method: 'PATCH', ...json(b) }),
  removeItem: (s: Settings, id: string) => serverCall(s, `/api/auto/items/${id}`, { method: 'DELETE' }),
  pauseItem: (s: Settings, id: string) => serverCall(s, `/api/auto/items/${id}/pause`, { method: 'POST' }),
  searchItem: (s: Settings, id: string) => serverCall<{ message: string }>(s, `/api/auto/items/${id}/search`, { method: 'POST' }),
  searchAll: (s: Settings) => serverCall<{ message: string }>(s, '/api/auto/search-all', { method: 'POST' }),
  releases: (s: Settings, id: string, season?: number, episode?: number) =>
    serverCall<{ want: AutoWant; wanted: AutoWant[]; status: { name: string; count: number; error?: string; skipped?: boolean; tries?: AutoTry[] }[]; results: AutoRelease[] }>(
      s,
      `/api/auto/items/${id}/releases?${new URLSearchParams({ ...(season != null ? { season: String(season) } : {}), ...(episode != null ? { episode: String(episode) } : {}) })}`
    ),
  grab: (s: Settings, id: string, guid: string) => serverCall(s, `/api/auto/items/${id}/grab`, { method: 'POST', ...json({ guid }) }),
  cancelGrab: (s: Settings, id: string) => serverCall(s, `/api/auto/grabs/${id}`, { method: 'DELETE' }),
  qbit: (s: Settings) => serverCall<QbitState>(s, '/api/auto/qbit'),
  qbitAction: (s: Settings, action: 'pause' | 'resume' | 'recheck' | 'reannounce' | 'delete' | 'deleteFiles' | 'alt', hashes: string[] = [], force = false) =>
    serverCall(s, '/api/auto/qbit/action', { method: 'POST', body: JSON.stringify({ action, hashes, force }) }),
  qbitPrefs: (s: Settings, b?: Partial<QbitPrefs> & { night?: boolean }) =>
    serverCall<{ prefs: QbitPrefs; seed: AutoSeed }>(s, '/api/auto/qbit/prefs', b ? { method: 'POST', body: JSON.stringify(b) } : undefined),
  adopt: (s: Settings) => serverCall<{ ok: number; errors: string[]; message: string }>(s, '/api/auto/adopt', { method: 'POST' }),
  removeGrab: (s: Settings, id: string, o: { client: boolean; blocklist: boolean; search: boolean; force?: boolean }) =>
    serverCall(s, `/api/auto/grabs/${id}?client=${o.client ? 1 : 0}&blocklist=${o.blocklist ? 1 : 0}&search=${o.search ? 1 : 0}${o.force ? '&force=1' : ''}`, { method: 'DELETE' }),
  pauseGrab: (s: Settings, id: string) => serverCall(s, `/api/auto/grabs/${id}/pause`, { method: 'POST' }),
  resumeGrab: (s: Settings, id: string) => serverCall(s, `/api/auto/grabs/${id}/resume`, { method: 'POST' }),
  retryImport: (s: Settings, id: string) => serverCall<{ ok: boolean; message: string }>(s, `/api/auto/grabs/${id}/retry-import`, { method: 'POST' }),
  unblock: (s: Settings) => serverCall(s, '/api/auto/unblock', { method: 'POST' }),
  blocklist: (s: Settings) => serverCall<{ blocked: { key: string; title: string | null; indexer?: string | null; reason?: string | null; at?: string }[] }>(s, '/api/auto/blocklist'),
  unblockOne: (s: Settings, key: string) => serverCall(s, '/api/auto/blocklist/remove', { method: 'POST', body: JSON.stringify({ key }) }),
};

export const gb = (n?: number) => (n ? `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : '—');
