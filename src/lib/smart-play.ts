// « Lire » unifié : Jellyfin si le titre (ou l'épisode) y est, sinon la meilleure source en streaming,
// pendant que le téléchargement part dans Radarr / Sonarr (ou en demande Seerr).
import { jf, type JfItem } from './jellyfin';
import type { Settings } from './settings';
import { tmdb } from './tmdb';

export type WatchTarget = {
  type: 'movie' | 'tv';
  tmdbId: number;
  imdb?: string | null;
  title: string;
  season?: number;
  episode?: number;
};

export type Resolution =
  | { kind: 'jellyfin'; item: JfItem; resume: boolean }
  | { kind: 'stream'; season?: number; episode?: number; seriesInJellyfin: boolean };

/** Épisode qui suit (s, e) d'après TMDB, ou null en fin de série. */
export async function tmdbNextEpisode(s: Settings, tmdbId: number, season: number, episode: number) {
  const tv = await tmdb.tv(s, tmdbId);
  const seasons = tv.seasons.filter((x) => x.season_number > 0).sort((a, b) => a.season_number - b.season_number);
  const cur = seasons.find((x) => x.season_number === season);
  if (cur && episode < cur.episode_count) return { season, episode: episode + 1 };
  const next = seasons.find((x) => x.season_number > season && x.episode_count > 0);
  return next ? { season: next.season_number, episode: 1 } : null;
}

const epKey = (s?: number, e?: number) => `${s ?? 0}:${e ?? 0}`;

export async function resolveWatch(s: Settings, t: WatchTarget): Promise<Resolution> {
  // ——— Film ———
  if (t.type === 'movie') {
    const item = s.jellyfin ? await jf.findByTmdb(s, 'movie', t.tmdbId, t.title, t.imdb).catch(() => null) : null;
    if (item) return { kind: 'jellyfin', item, resume: true };
    return { kind: 'stream', seriesInJellyfin: false };
  }

  // ——— Série ———
  const series = s.jellyfin ? await jf.findByTmdb(s, 'tv', t.tmdbId, t.title, t.imdb).catch(() => null) : null;
  const episodes = series ? await jf.allEpisodes(s, series.Id).catch(() => [] as JfItem[]) : [];
  const byKey = new Map(episodes.map((e) => [epKey(e.ParentIndexNumber, e.IndexNumber), e]));

  // Épisode précis demandé (choix manuel ou épisode suivant)
  if (t.season != null && t.episode != null) {
    const hit = byKey.get(epKey(t.season, t.episode));
    if (hit) return { kind: 'jellyfin', item: hit, resume: true };
    return { kind: 'stream', season: t.season, episode: t.episode, seriesInJellyfin: Boolean(series) };
  }

  // Premier épisode non vu
  if (series) {
    const next = await jf.nextUpForSeries(s, series.Id).catch(() => null);
    if (next) return { kind: 'jellyfin', item: next, resume: true };
    const watched = episodes.filter((e) => e.UserData?.Played && (e.ParentIndexNumber ?? 0) > 0);
    if (!watched.length) {
      const first = episodes.find((e) => (e.ParentIndexNumber ?? 0) > 0);
      if (first && first.ParentIndexNumber === 1 && first.IndexNumber === 1) return { kind: 'jellyfin', item: first, resume: true };
      return { kind: 'stream', season: 1, episode: 1, seriesInJellyfin: true };
    }
    const last = watched[watched.length - 1];
    const after = await tmdbNextEpisode(s, t.tmdbId, last.ParentIndexNumber ?? 1, last.IndexNumber ?? 1).catch(() => null);
    if (!after) return { kind: 'jellyfin', item: episodes[0], resume: false };
    const hit = byKey.get(epKey(after.season, after.episode));
    if (hit) return { kind: 'jellyfin', item: hit, resume: true };
    return { kind: 'stream', ...after, seriesInJellyfin: true };
  }

  return { kind: 'stream', season: 1, episode: 1, seriesInJellyfin: false };
}
