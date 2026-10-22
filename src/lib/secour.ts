// Admin : liens d'hébergeurs trouvés par Lumio Secour, téléchargés via AllDebrid sur les disques du serveur.
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
