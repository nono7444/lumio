// Plateformes (Netflix, Disney+…) en mode « production » : servies par le serveur Lumio.
import { serverCall } from './chat';
import type { Settings } from './settings';

/** icon : icône officielle en couleur (carrée) ; color : couleur de la marque */
export type Platform = { id: string; name: string; logo: string | null; icon?: string | null; color?: string };
export type PlatformTitle = {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: string;
  date: string | null;
  poster: string | null;
  /** Déjà sur ton serveur */
  available: boolean;
};
export type PlatformPage = Platform & {
  /** Tout mélangé (dispo ou pas), trié par date de sortie */
  items?: PlatformTitle[];
  library: PlatformTitle[];
  latest: PlatformTitle[];
};

let listCache: Platform[] | null = null;

export const platformsApi = {
  list: async (s: Settings) => {
    if (listCache) return listCache;
    const r = await serverCall<{ platforms: Platform[] }>(s, '/api/platforms');
    listCache = r.platforms;
    return listCache;
  },
  page: (s: Settings, id: string, sort: 'desc' | 'asc') => serverCall<PlatformPage>(s, `/api/platforms/${id}?sort=${sort}`),
};
