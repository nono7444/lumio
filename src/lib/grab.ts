// Lance le téléchargement d'un titre, en demandant le dossier (Films, Kids, Anime…) si le titre est nouveau :
// - admin : directement dans Radarr / Sonarr ;
// - autres comptes : via le serveur Lumio (les clés restent sur le serveur) ;
// - sinon, demande Seerr.
import { arr, invalidateLibrary, radarr, sonarr } from './arr';
import { lumio, serverCanGrab, type ServerFolder } from './lumio-server';
import { seerr } from './seerr';
import { arrReady, isManager, type Settings } from './settings';
import { tmdb, tmdbImg, type TmdbMovie, type TmdbTv } from './tmdb';

export type GrabTarget = { type: 'movie' | 'tv'; tmdbId: number; season?: number; seasons?: number[]; allSeasons?: boolean };

export type FolderChoice = {
  type: 'movie' | 'tv';
  title?: string;
  folders: ServerFolder[];
  suggested: string | null;
  /** Lecture en streaming en même temps : le bouton « annuler » devient « regarder sans télécharger » */
  streaming?: boolean;
};

export type GrabOptions = {
  /** Demande le dossier à l'utilisateur ; null = ne pas télécharger */
  chooseFolder?: (c: FolderChoice) => Promise<string | null>;
  streaming?: boolean;
};

const ANIME_RE = /anim[eé]/i;
const KIDS_RE = /kid|enfant|jeunesse|famil|dessin/i;
const lastPart = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

/** Anime japonais, contenu jeunesse, ou rien de particulier. */
export function mediaFlavor(d: TmdbMovie | TmdbTv): 'anime' | 'kids' | null {
  const g = new Set((d.genres ?? []).map((x) => x.id));
  const jp = d.original_language === 'ja' || ('origin_country' in d && Boolean(d.origin_country?.includes('JP')));
  if (g.has(16) && jp) return 'anime';
  if (g.has(10762) || g.has(10751) || g.has(16)) return 'kids';
  return null;
}

/** Dossier proposé par défaut selon le genre du titre. */
export function suggestFolder(folders: ServerFolder[], flavor: 'anime' | 'kids' | null, fallback?: string | null) {
  if (flavor === 'anime') {
    const hit = folders.find((f) => ANIME_RE.test(lastPart(f.path)));
    if (hit) return hit.path;
  }
  if (flavor === 'kids') {
    const hit = folders.find((f) => KIDS_RE.test(lastPart(f.path)));
    if (hit) return hit.path;
  }
  if (fallback && folders.some((f) => f.path === fallback)) return fallback;
  return folders.find((f) => !ANIME_RE.test(lastPart(f.path)) && !KIDS_RE.test(lastPart(f.path)))?.path ?? folders[0]?.path ?? null;
}

/** undefined = pas de choix possible (dossier par défaut), null = l'utilisateur ne veut pas télécharger. */
async function pick(
  opts: GrabOptions,
  type: 'movie' | 'tv',
  details: TmdbMovie | TmdbTv,
  folders: ServerFolder[],
  fallback?: string | null
): Promise<string | null | undefined> {
  if (!folders.length) return undefined;
  const suggested = suggestFolder(folders, mediaFlavor(details), fallback);
  if (folders.length === 1 || !opts.chooseFolder) return suggested ?? undefined;
  const title = 'title' in details ? details.title : details.name;
  return opts.chooseFolder({ type, title, folders, suggested, streaming: opts.streaming });
}

const isAnimeFolder = (p?: string | null) => Boolean(p && ANIME_RE.test(lastPart(p)));
const SKIPPED = 'Pas de téléchargement : lecture en streaming seulement.';

export async function grab(s: Settings, t: GrabTarget, opts: GrabOptions = {}): Promise<string | null> {
  if (!isManager(s)) {
    if (await serverCanGrab(s, t.type)) return grabViaServer(s, t, opts);
    return request(s, t);
  }

  if (t.type === 'movie') {
    if (!s.radarr.url || !s.radarr.apiKey) return null;
    const existing = await radarr.byTmdb(s.radarr, t.tmdbId);
    if (existing) return existing.hasFile ? null : 'Déjà dans Radarr : le téléchargement suit son cours.';
    if (!arrReady(s.radarr)) return null;
    const [details, folders] = await Promise.all([tmdb.movie(s, t.tmdbId), arr.rootFolders(s.radarr).catch(() => [])]);
    const folder = await pick(opts, 'movie', details, folders, s.radarr.rootFolderPath);
    if (folder === null) return opts.streaming ? SKIPPED : null;
    await radarr.add(s.radarr, t.tmdbId, { rootFolderPath: folder });
    invalidateLibrary();
    return `Ajouté à Radarr${folder ? ` (${folder})` : ''} : le film se télécharge en arrière-plan.`;
  }

  if (!s.sonarr.url || !s.sonarr.apiKey) return null;
  const tv = await tmdb.tv(s, t.tmdbId);
  const tvdb = tv.external_ids?.tvdb_id;
  if (!tvdb) return null;
  const wanted = wantedSeasons(tv, t);

  const existing = await sonarr.byTvdb(s.sonarr, tvdb);
  if (existing) {
    const missing = wanted.filter((n) => !existing.seasons.find((x) => x.seasonNumber === n)?.monitored);
    if (!missing.length) return null;
    await sonarr.monitorSeasons(s.sonarr, existing, missing);
    invalidateLibrary();
    return missing.length === 1 ? `Saison ${missing[0]} envoyée à Sonarr.` : `${missing.length} saisons envoyées à Sonarr.`;
  }
  if (!arrReady(s.sonarr)) return null;
  const folders = await arr.rootFolders(s.sonarr).catch(() => []);
  const folder = await pick(opts, 'tv', tv, folders, s.sonarr.rootFolderPath);
  if (folder === null) return opts.streaming ? SKIPPED : null;
  await sonarr.add(s.sonarr, tvdb, wanted, { rootFolderPath: folder, seriesType: isAnimeFolder(folder) ? 'anime' : undefined });
  invalidateLibrary();
  return wanted.length > 1
    ? `Série ajoutée à Sonarr${folder ? ` (${folder})` : ''} : elle se télécharge en arrière-plan.`
    : `Série ajoutée à Sonarr (saison ${wanted[0]}).`;
}

function wantedSeasons(tv: TmdbTv, t: GrabTarget) {
  const all = tv.seasons.filter((x) => x.season_number > 0).map((x) => x.season_number);
  if (t.seasons?.length) return t.seasons;
  if (t.allSeasons || !t.season) return all;
  return [t.season];
}

/** Compte non-admin : le serveur Lumio ajoute le titre dans Radarr / Sonarr. */
async function grabViaServer(s: Settings, t: GrabTarget, opts: GrabOptions): Promise<string | null> {
  const details = t.type === 'movie' ? await tmdb.movie(s, t.tmdbId) : await tmdb.tv(s, t.tmdbId);
  const title = 'title' in details ? details.title : details.name;
  const date = 'title' in details ? details.release_date : details.first_air_date;
  const tvdbId = t.type === 'tv' ? ((details as TmdbTv).external_ids?.tvdb_id ?? undefined) : undefined;
  if (t.type === 'tv' && !tvdbId) throw new Error('Pas d’identifiant TVDB sur TMDB : Sonarr ne peut pas l’ajouter.');
  const body = {
    type: t.type,
    tmdbId: t.tmdbId,
    title,
    year: date?.slice(0, 4),
    poster: tmdbImg(details.poster_path, 'w342'),
    tvdbId,
    seasons: t.type === 'tv' ? wantedSeasons(details as TmdbTv, t) : undefined,
  };

  let res = await lumio.grab(s, { ...body, askFolder: true });
  if (res.needFolder) {
    const folder = await pick(opts, t.type, details, res.folders, res.default);
    if (folder === null) return opts.streaming ? SKIPPED : null;
    res = await lumio.grab(s, { ...body, rootFolderPath: folder, seriesType: isAnimeFolder(folder) ? 'anime' : undefined });
  }
  if (res.needFolder) return null;
  return res.message || null;
}

/** Demande Seerr (quand le serveur Lumio ne gère pas les téléchargements). */
export async function request(s: Settings, t: GrabTarget): Promise<string | null> {
  if (!s.seerr?.url) return null;
  if (t.type === 'movie') {
    await seerr.requestMovie(s, t.tmdbId);
    return 'Demande envoyée : le film sera ajouté après validation.';
  }
  await seerr.requestTv(s, t.tmdbId, t.allSeasons || !t.season ? 'all' : [t.season]);
  return 'Demande envoyée : la série sera ajoutée après validation.';
}
