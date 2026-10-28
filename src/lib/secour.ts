// Admin : liens d'hébergeurs trouvés par Lumio Secour, téléchargés via AllDebrid sur les disques du serveur.
import Constants from 'expo-constants';

import { serverCall } from './chat';
import type { Settings } from './settings';

export type SecourStatus = {
  configured: boolean;
  url: string | null;
  fromEnv: boolean;
  alldebrid: boolean;
  disks: number;
  online?: boolean;
  version?: string;
  sources?: string[];
  tmdb?: boolean;
  error?: string;
  /** Moteur intégré au serveur Lumio (même conteneur) */
  embedded?: boolean;
  auto?: SecourAuto;
};

/** Groupe de secours : Lumio Secour prend le relais quand Radarr / Sonarr ne marchent plus. */
export type SecourTarget = { root: string; folder: string };
export type SecourAuto = {
  enabled: boolean;
  /** Simulation : Radarr / Sonarr considérés en panne */
  force?: boolean;
  /** Relais quand Radarr / Sonarr répondent mais restent bloqués (avertissement depuis stuckHours, rien trouvé en notFoundHours) */
  stuck?: boolean;
  stuckHours?: number;
  notFoundHours?: number;
  ready: boolean;
  alldebrid: boolean;
  engine: boolean;
  disks: string[];
  movie: SecourTarget | null;
  tv: SecourTarget | null;
  queue: number;
};

export type SecourLink = {
  link: string;
  name: string;
  quality: string;
  language: string;
  size: string;
  sizeBytes: number | null;
  hoster: string;
  source: string;
  cached: boolean;
  season: number | null;
  episode: number | null;
};

/** Build « Lumio Bêta » (identifiant .beta) : fonctions encore en test, aussi sur iPhone. */
export const IS_BETA = Boolean(Constants.expoConfig?.ios?.bundleIdentifier?.endsWith('.beta'));

export type SecourQuery = { type: 'movie' | 'tv'; tmdbId?: number; imdb?: string; season?: number; episode?: number };

export const secourApi = {
  status: (s: Settings) => serverCall<SecourStatus>(s, '/api/secour'),
  configure: (s: Settings, url: string, key?: string) =>
    serverCall<{ configured: boolean }>(s, '/api/secour', { method: 'PUT', body: JSON.stringify({ url, ...(key ? { key } : {}) }) }),
  links: (s: Settings, q: SecourQuery) => {
    const qs = new URLSearchParams({ type: q.type });
    if (q.imdb) qs.set('imdb', q.imdb);
    if (q.tmdbId) qs.set('tmdbId', String(q.tmdbId));
    if (q.type === 'tv') {
      qs.set('season', String(q.season ?? 1));
      qs.set('episode', String(q.episode ?? 1));
    }
    return serverCall<{ title: string; year?: string; debrid: boolean; links: SecourLink[] }>(s, `/api/secour/links?${qs}`);
  },
  download: (s: Settings, l: SecourLink, opts: { type: 'movie' | 'tv'; root: string; folder: string; name: string }) =>
    serverCall<{ download: { id: string } }>(s, '/api/secour/download', {
      method: 'POST',
      body: JSON.stringify({
        link: l.link,
        hoster: l.hoster,
        source: l.source,
        season: l.season,
        episode: l.episode,
        type: opts.type === 'tv' ? 'series' : 'movie',
        sizeBytes: l.sizeBytes,
        root: opts.root,
        folder: opts.folder,
        name: opts.name,
      }),
    }),
};

/** Catégorie de qualité pour les filtres (4K, 1080p, 720p, autre). */
export function qualityBucket(q: string): '4K' | '1080p' | '720p' | 'Autre' {
  const u = q.toUpperCase();
  if (/2160|4K|UHD/.test(u)) return '4K';
  if (/1080/.test(u)) return '1080p';
  if (/720/.test(u)) return '720p';
  return 'Autre';
}

// ——— Onglet Lumio Secour (admin) : réglages du fork, AllDebrid, état des sources ———

export type SecourField = {
  key: string;
  kind: 'bool' | 'int' | 'list' | 'str';
  value: unknown;
  is_set: boolean | null;
  sensitive: boolean;
  advanced: boolean;
  editor: string | null;
  description: string | null;
  /** env : fixé dans le docker-compose (non modifiable) · override : modifié · default : valeur d'origine */
  source: 'env' | 'override' | 'default';
  editable: boolean;
  choices: string[] | null;
  default: unknown;
};
export type SecourCategory = { category: string; fields: SecourField[] };
export type SecourHealth = {
  sources: { name: string; status: 'online' | 'offline' | 'unconfigured' | 'unknown' | string; response_time: number | null; error: string | null }[];
  summary: { online: number; offline: number; unconfigured: number; total: number };
};
export type AlldebridStatus = {
  configured: boolean;
  fromEnv?: boolean;
  disks: number;
  account?: { username: string | null; premium: boolean; premiumUntil: string | null };
  error?: string;
};

export type SecourGrab = { type: 'movie' | 'tv'; tmdbId: number; tvdbId?: number; title: string; year?: string; poster?: string; backdrop?: string; seasons?: number[]; source?: string };

export const secourAdminApi = {
  /** Bouton « LS » d'une demande bloquée : Lumio Secour la télécharge à la place de Radarr / Sonarr */
  viaRequest: (s: Settings, id: string) => serverCall<{ request: { id: string } }>(s, `/api/secour/requests/${id}`, { method: 'POST', body: '{}' }),
  /** Bouton « LS » : téléchargement direct par Lumio Secour (meilleur lien, AllDebrid, disques) */
  grab: (s: Settings, g: SecourGrab) => serverCall<{ request: { id: string }; already?: boolean }>(s, '/api/secour/grab', { method: 'POST', body: JSON.stringify(g) }),
  auto: (s: Settings) => serverCall<SecourAuto>(s, '/api/secour/auto'),
  saveAuto: (s: Settings, body: Partial<{ enabled: boolean; force: boolean; stuck: boolean; movie: SecourTarget; tv: SecourTarget }>) =>
    serverCall<SecourAuto>(s, '/api/secour/auto', { method: 'PUT', body: JSON.stringify(body) }),
  settings: (s: Settings) => serverCall<{ categories: SecourCategory[] }>(s, '/api/secour/settings').then((r) => r.categories),
  saveSettings: (s: Settings, updates: Record<string, unknown>) =>
    serverCall<{ success: boolean; results: Record<string, string> }>(s, '/api/secour/settings', { method: 'PUT', body: JSON.stringify({ updates }) }),
  resetSetting: (s: Settings, key: string) => serverCall(s, `/api/secour/settings/${key}`, { method: 'DELETE' }),
  health: (s: Settings, refresh = false) => serverCall<SecourHealth>(s, `/api/secour/health${refresh ? '?refresh=1' : ''}`),
  alldebrid: (s: Settings) => serverCall<AlldebridStatus>(s, '/api/alldebrid?check=1'),
  setAlldebridKey: (s: Settings, key: string) => serverCall<{ configured: boolean }>(s, '/api/alldebrid', { method: 'PUT', body: JSON.stringify({ key }) }),
};

/** Noms en français des rubriques et des réglages les plus utiles (sinon le nom technique). */
export const CATEGORY_FR: Record<string, string> = {
  Addon: 'Addon',
  Sources: 'Sources',
  TMDB: 'TMDB',
  'Database resilience': 'Base de données',
  'Kitsu / Anime': 'Kitsu / Anime',
  Pagination: 'Pages de recherche',
  'Scraper concurrency': 'Recherches en parallèle',
  Pastebin: 'Import Pastebin',
  Idrix: 'Import Idrix',
  'Domain synchronization': 'Mise à jour des domaines',
  Cache: 'Cache',
  Debrid: 'AllDebrid (délais)',
  Locks: 'Verrous',
  'HTTP timeouts': 'Délais réseau',
  'HTTP cache': 'Cache HTTP',
  Proxy: 'Proxy',
  'Health check': 'Surveillance',
  Logging: 'Journaux',
};

export const FIELD_FR: Record<string, { label: string; hint?: string }> = {
  ADDON_NAME: { label: 'Nom' },
  LUMIO_SOURCES: { label: 'Sources utilisées', hint: 'Une par ligne : movix, wawacity, zone-telechargement, free-telecharger, darki-api, webshare. Vide = toutes. Par défaut : movix seulement.' },
  WAWACITY_URL: { label: 'Wawacity', hint: 'Adresse du site (https://…)' },
  FREE_TELECHARGER_URL: { label: 'Free-Telecharger', hint: 'Adresse du site (https://…)' },
  DARKI_API_URL: { label: 'Darki-API', hint: 'Adresse de l’API (https://…)' },
  DARKI_API_KEY: { label: 'Clé Darki-API', hint: 'Facultative' },
  MOVIX_URL: { label: 'Movix', hint: 'Adresse du site ; l’API est déduite (api.domaine)' },
  WEBSHARE_URL: { label: 'Webshare', hint: 'Adresse du site (https://…)' },
  ZONE_TELECHARGEMENT_URL: { label: 'Zone-Telechargement', hint: 'Adresse du site (https://…)' },
  TMDB_API_KEY: { label: 'Jeton TMDB (v4)', hint: 'themoviedb.org → Paramètres → API → jeton d’accès en lecture. Obligatoire pour chercher des liens.' },
  CONTENT_CACHE_TTL: { label: 'Durée du cache des résultats (s)', hint: '-1 = permanent' },
  CONTENT_CACHE_MODE: { label: 'Mode du cache', hint: 'background : attend si expiré · live : instantané puis rafraîchit' },
  DEAD_LINK_TTL: { label: 'Mémoire des liens morts (s)', hint: '-1 = permanent' },
  STREAM_REQUEST_TIMEOUT: { label: 'Délai max d’une recherche (s)' },
  DOMAIN_FOLLOW_REDIRECTS: { label: 'Suivre les changements d’adresse', hint: 'Si un site redirige vers sa nouvelle adresse, elle est mise à jour toute seule (et tu reçois une notification)' },
  DOMAIN_SYNC_ENABLED: { label: 'Mettre à jour les domaines tout seul', hint: 'Via les chaînes Telegram renseignées ci-dessous' },
  PASTEBIN_SCRAPER_URLS: { label: 'Liens Pastebin à importer', hint: 'Un par ligne' },
  IDRIX_SCRAPER_URLS: { label: 'Liens Idrix à importer', hint: 'Un par ligne' },
  LOG_LEVEL: { label: 'Niveau des journaux' },
  PROXY_URL: { label: 'Proxy', hint: 'http://hote:port (vide = aucun)' },
  PUBLIC_HEALTH_PAGE_ENABLED: { label: 'Page /status publique' },
  HTTP_CACHE_ENABLED: { label: 'Cache HTTP' },
};
