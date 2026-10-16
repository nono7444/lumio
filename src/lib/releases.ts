// Calendrier des sorties numériques, avec les dates exactes de TMDB :
// - films : type de sortie 4 (« numérique » : VOD, achat / location) en France, sinon aux États-Unis ;
// - séries : nouvelles saisons (date de diffusion de la saison) sur les plateformes de streaming en France.
// Les sorties cinéma (type 3) ne sont pas prises.
import type { Settings } from './settings';
import { tmdbCall, tmdbImg } from './tmdb';

export type Release = {
  id: string;
  tmdbId: number;
  kind: 'movie' | 'series';
  name: string;
  poster?: string;
  date: Date;
  dayKey: string;
  /** « Sortie numérique · Prime Video », « Saison 2 · Netflix »… */
  info: string;
  description?: string;
};

export const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isoDay = (d: Date) => dayKeyOf(d);
const parseDay = (s?: string | null) => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

type Providers = { results?: Record<string, { flatrate?: { provider_name: string }[]; rent?: { provider_name: string }[]; buy?: { provider_name: string }[] }> };

function providerNames(p: Providers | undefined, country = 'FR') {
  const r = p?.results?.[country];
  const names = [...(r?.flatrate ?? []), ...(r?.rent ?? []), ...(r?.buy ?? [])].map((x) => x.provider_name);
  return [...new Set(names)].slice(0, 2);
}

/** Exécute les tâches avec au plus `n` en parallèle. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

type ReleaseDates = { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };

async function digitalMovies(s: Settings, from: Date, to: Date): Promise<Release[]> {
  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) =>
      tmdbCall<{ results: { id: number }[] }>(s, '/discover/movie', {
        region: 'FR',
        with_release_type: '4',
        'release_date.gte': isoDay(from),
        'release_date.lte': isoDay(to),
        sort_by: 'popularity.desc',
        include_adult: 'false',
        page,
      }).catch(() => ({ results: [] }))
    )
  );
  const ids = [...new Set(pages.flatMap((p) => p.results.map((r) => r.id)))].slice(0, 80);
  const rows = await pool(ids, 6, async (id) => {
    try {
      const m = await tmdbCall<{
        id: number;
        title: string;
        poster_path?: string | null;
        overview?: string;
        release_dates?: ReleaseDates;
        'watch/providers'?: Providers;
      }>(s, `/movie/${id}`, { append_to_response: 'release_dates,watch/providers' });
      // Date numérique exacte : France d'abord, sinon États-Unis
      const pick = (country: string) =>
        m.release_dates?.results
          .find((r) => r.iso_3166_1 === country)
          ?.release_dates.filter((d) => d.type === 4)
          .map((d) => parseDay(d.release_date))
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => a.getTime() - b.getTime())[0];
      const fr = pick('FR');
      const date = fr ?? pick('US');
      if (!date || date < from || date > to) return null;
      const where = providerNames(m['watch/providers']);
      return {
        id: `movie:${m.id}`,
        tmdbId: m.id,
        kind: 'movie' as const,
        name: m.title,
        poster: tmdbImg(m.poster_path, 'w342'),
        date,
        dayKey: dayKeyOf(date),
        info: ['Sortie numérique', fr ? null : 'date US', ...where].filter(Boolean).join(' · '),
        description: m.overview,
      };
    } catch {
      return null;
    }
  });
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}

// Talk-shows, actualités, feuilletons quotidiens : pas des « sorties »
const EXCLUDED_TV_GENRES = '10767|10763|10766';

async function newSeasons(s: Settings, from: Date, to: Date): Promise<Release[]> {
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      tmdbCall<{ results: { id: number }[] }>(s, '/discover/tv', {
        watch_region: 'FR',
        with_watch_monetization_types: 'flatrate',
        'air_date.gte': isoDay(from),
        'air_date.lte': isoDay(to),
        without_genres: EXCLUDED_TV_GENRES,
        sort_by: 'popularity.desc',
        page,
      }).catch(() => ({ results: [] }))
    )
  );
  const ids = [...new Set(pages.flatMap((p) => p.results.map((r) => r.id)))].slice(0, 60);
  const rows = await pool(ids, 6, async (id) => {
    try {
      const t = await tmdbCall<{
        id: number;
        name: string;
        poster_path?: string | null;
        overview?: string;
        seasons?: { season_number: number; air_date?: string | null; poster_path?: string | null; episode_count: number }[];
        'watch/providers'?: Providers;
      }>(s, `/tv/${id}`, { append_to_response: 'watch/providers' });
      const where = providerNames(t['watch/providers']);
      // Une ligne par saison qui démarre dans la période (date de la saison = premier épisode)
      return (t.seasons ?? [])
        .filter((x) => x.season_number > 0)
        .map((x) => ({ x, date: parseDay(x.air_date) }))
        .filter(({ date }) => date && date >= from && date <= to)
        .map(({ x, date }) => ({
          id: `series:${t.id}:${x.season_number}`,
          tmdbId: t.id,
          kind: 'series' as const,
          name: t.name,
          poster: tmdbImg(x.poster_path ?? t.poster_path, 'w342'),
          date: date!,
          dayKey: dayKeyOf(date!),
          info: [x.season_number === 1 ? 'Nouvelle série' : `Saison ${x.season_number}`, `${x.episode_count} ép.`, ...where]
            .filter(Boolean)
            .join(' · '),
          description: t.overview,
        }));
    } catch {
      return [];
    }
  });
  return rows.flat();
}

let cache: { at: number; items: Release[] } | null = null;

/** Sorties numériques de J-7 à J+45, triées par date. Mises en cache 1 h. */
export async function fetchReleases(s: Settings, force = false): Promise<Release[]> {
  if (!force && cache && Date.now() - cache.at < 3600_000) return cache.items;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 7);
  const to = new Date(from);
  to.setDate(to.getDate() + 52);
  const [movies, series] = await Promise.all([digitalMovies(s, from, to), newSeasons(s, from, to)]);
  const items = [...movies, ...series].sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name));
  cache = { at: Date.now(), items };
  return items;
}

export function dayLabel(d: Date) {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
