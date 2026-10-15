// Clients Radarr et Sonarr (API v3, compatible Sonarr v3 et v4).
import type { ArrConfig, RadarrConfig, Settings, SonarrConfig } from './settings';

export class ArrError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export type QualityProfile = { id: number; name: string };
export type RootFolder = { id: number; path: string; freeSpace?: number; accessible?: boolean };

export type RadarrMovie = {
  id?: number;
  title: string;
  tmdbId: number;
  year?: number;
  monitored?: boolean;
  hasFile?: boolean;
  isAvailable?: boolean;
  sizeOnDisk?: number;
  qualityProfileId?: number;
  rootFolderPath?: string;
  path?: string;
  movieFile?: { quality?: { quality?: { name?: string } }; languages?: { name: string }[] };
  [k: string]: unknown;
};

export type SonarrSeason = {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    percentOfEpisodes: number;
  };
};

export type SonarrSeries = {
  id?: number;
  title: string;
  tvdbId: number;
  tmdbId?: number;
  imdbId?: string;
  year?: number;
  monitored?: boolean;
  seasons: SonarrSeason[];
  statistics?: { episodeFileCount: number; episodeCount: number; percentOfEpisodes: number };
  [k: string]: unknown;
};

export type QueueItem = {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  downloadClient?: string;
  errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
  movie?: { title: string; tmdbId: number; year?: number };
  series?: { title: string; tvdbId: number; tmdbId?: number };
  episode?: { seasonNumber: number; episodeNumber: number; title?: string };
  movieId?: number;
  seriesId?: number;
};

const base = (c: ArrConfig) => c.url.trim().replace(/\/+$/, '');

async function call<T>(c: ArrConfig, path: string, init?: RequestInit): Promise<T> {
  if (!c.url || !c.apiKey) throw new ArrError('Service non configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${base(c)}/api/v3${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'X-Api-Key': c.apiKey.trim(),
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        // Les *arr renvoient soit {message}, soit un tableau d'erreurs de validation
        if (Array.isArray(body)) msg = body.map((e) => e.errorMessage).filter(Boolean).join(' · ') || msg;
        else if (body?.message) msg = body.message;
      } catch {}
      if (res.status === 401) msg = 'Clé API refusée';
      throw new ArrError(msg, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ArrError('Délai dépassé');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ——— Commun ———

export const arr = {
  status: (c: ArrConfig) => call<{ version: string; appName?: string; instanceName?: string }>(c, '/system/status'),
  qualityProfiles: (c: ArrConfig) => call<QualityProfile[]>(c, '/qualityprofile'),
  rootFolders: (c: ArrConfig) => call<RootFolder[]>(c, '/rootfolder'),
  languageProfiles: (c: ArrConfig) =>
    call<QualityProfile[]>(c, '/languageprofile').catch(() => [] as QualityProfile[]),
};

/** Choix faits au moment de l'ajout (dossier racine, type de série). */
export type AddOverrides = { rootFolderPath?: string; seriesType?: 'anime' | 'standard' };

// ——— Radarr ———

export const radarr = {
  all: (c: RadarrConfig) => call<RadarrMovie[]>(c, '/movie'),

  byTmdb: async (c: RadarrConfig, tmdbId: number) => {
    const list = await call<RadarrMovie[]>(c, `/movie?tmdbId=${tmdbId}`);
    return list?.[0] ?? null;
  },

  lookup: (c: RadarrConfig, tmdbId: number) => call<RadarrMovie>(c, `/movie/lookup/tmdb?tmdbId=${tmdbId}`),

  add: async (c: RadarrConfig, tmdbId: number, o: AddOverrides = {}) => {
    const found = await radarr.lookup(c, tmdbId);
    return call<RadarrMovie>(c, '/movie', {
      method: 'POST',
      body: JSON.stringify({
        ...found,
        id: undefined,
        qualityProfileId: c.qualityProfileId,
        rootFolderPath: o.rootFolderPath ?? c.rootFolderPath,
        monitored: true,
        minimumAvailability: c.minimumAvailability,
        addOptions: { searchForMovie: c.searchOnAdd, monitor: 'movieOnly' },
      }),
    });
  },

  search: (c: RadarrConfig, movieId: number) =>
    call(c, '/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }) }),

  queue: (c: RadarrConfig) =>
    call<{ records: QueueItem[] }>(c, '/queue?page=1&pageSize=100&includeMovie=true'),
};

// ——— Sonarr ———

export const sonarr = {
  all: (c: SonarrConfig) => call<SonarrSeries[]>(c, '/series'),

  byTvdb: async (c: SonarrConfig, tvdbId: number) => {
    const list = await call<SonarrSeries[]>(c, `/series?tvdbId=${tvdbId}`);
    return list?.[0] ?? null;
  },

  lookup: async (c: SonarrConfig, tvdbId: number) => {
    const list = await call<SonarrSeries[]>(c, `/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`);
    if (!list?.length) throw new ArrError('Série introuvable dans Sonarr');
    return list[0];
  },

  /** Ajoute la série en ne surveillant que les saisons demandées. */
  add: async (c: SonarrConfig, tvdbId: number, seasons: number[], o: AddOverrides = {}) => {
    const found = await sonarr.lookup(c, tvdbId);
    const wanted = new Set(seasons);
    return call<SonarrSeries>(c, '/series', {
      method: 'POST',
      body: JSON.stringify({
        ...found,
        id: undefined,
        qualityProfileId: c.qualityProfileId,
        ...(c.languageProfileId ? { languageProfileId: c.languageProfileId } : {}),
        rootFolderPath: o.rootFolderPath ?? c.rootFolderPath,
        seasonFolder: c.seasonFolder,
        ...(o.seriesType ? { seriesType: o.seriesType } : {}),
        monitored: true,
        seasons: found.seasons.map((s) => ({ seasonNumber: s.seasonNumber, monitored: wanted.has(s.seasonNumber) })),
        addOptions: {
          searchForMissingEpisodes: c.searchOnAdd,
          searchForCutoffUnmetEpisodes: false,
          ignoreEpisodesWithFiles: true,
          ignoreEpisodesWithoutFiles: false,
        },
      }),
    });
  },

  /** Série déjà présente : active la surveillance des saisons et lance leur recherche. */
  monitorSeasons: async (c: SonarrConfig, series: SonarrSeries, seasons: number[]) => {
    const wanted = new Set(seasons);
    const updated = await call<SonarrSeries>(c, `/series/${series.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...series,
        monitored: true,
        seasons: series.seasons.map((s) => (wanted.has(s.seasonNumber) ? { ...s, monitored: true } : s)),
      }),
    });
    if (c.searchOnAdd) {
      for (const n of seasons) {
        await call(c, '/command', {
          method: 'POST',
          body: JSON.stringify({ name: 'SeasonSearch', seriesId: series.id, seasonNumber: n }),
        });
      }
    }
    return updated;
  },

  queue: (c: SonarrConfig) =>
    call<{ records: QueueItem[] }>(c, '/queue?page=1&pageSize=100&includeSeries=true&includeEpisode=true'),
};

// ——— Index de la bibliothèque (pour les badges) ———

export type LibraryEntry = { state: 'available' | 'partial' | 'monitored' | 'missing'; label: string; color: string };

export function movieState(m: RadarrMovie): LibraryEntry {
  if (m.hasFile) return { state: 'available', label: 'Disponible', color: '#2FBF71' };
  if (m.monitored) return { state: 'monitored', label: 'Surveillé', color: '#F2A93B' };
  return { state: 'missing', label: 'Non surveillé', color: '#9AA3B2' };
}

export function seriesState(s: SonarrSeries): LibraryEntry {
  const st = s.statistics;
  if (st && st.episodeCount > 0 && st.episodeFileCount >= st.episodeCount)
    return { state: 'available', label: 'Disponible', color: '#2FBF71' };
  if (st && st.episodeFileCount > 0) return { state: 'partial', label: 'Partiel', color: '#2FBF71' };
  if (s.monitored) return { state: 'monitored', label: 'Surveillé', color: '#F2A93B' };
  return { state: 'missing', label: 'Non surveillé', color: '#9AA3B2' };
}

type Library = { movies: Map<number, LibraryEntry>; series: Map<number, LibraryEntry>; at: number };
let library: Library | null = null;
let pending: Promise<Library> | null = null;

/** Index tmdbId → état, rafraîchi au plus toutes les 60 s (ou forcé). */
export function loadLibrary(s: Settings, force = false): Promise<Library> {
  if (!force && library && Date.now() - library.at < 60_000) return Promise.resolve(library);
  if (pending) return pending;
  pending = (async () => {
    const [movies, series] = await Promise.all([
      s.radarr.url && s.radarr.apiKey ? radarr.all(s.radarr).catch(() => []) : Promise.resolve([] as RadarrMovie[]),
      s.sonarr.url && s.sonarr.apiKey ? sonarr.all(s.sonarr).catch(() => []) : Promise.resolve([] as SonarrSeries[]),
    ]);
    library = {
      movies: new Map(movies.map((m) => [m.tmdbId, movieState(m)])),
      // Sonarr v4 expose tmdbId ; en v3 la correspondance se fait sur la fiche (tvdbId)
      series: new Map(series.filter((x) => x.tmdbId).map((x) => [x.tmdbId!, seriesState(x)])),
      at: Date.now(),
    };
    return library;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export function invalidateLibrary() {
  library = null;
}

export function formatBytes(n?: number) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}
