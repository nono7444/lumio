import { Platform } from 'react-native';
// Client TMDB v3 : recherche, tendances, fiches, correspondance IMDb.
import type { Settings } from './settings';

export type MediaType = 'movie' | 'tv';

export type TmdbItem = {
  id: number;
  media_type?: MediaType | 'person';
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
  genre_ids?: number[];
};

/** Genres TMDB (films + séries), en français. */
export const GENRES: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime', 99: 'Documentaire',
  18: 'Drame', 10751: 'Famille', 14: 'Fantastique', 36: 'Histoire', 27: 'Horreur', 10402: 'Musique',
  9648: 'Mystère', 10749: 'Romance', 878: 'Science-fiction', 10770: 'Téléfilm', 53: 'Thriller',
  10752: 'Guerre', 37: 'Western', 10759: 'Action & Aventure', 10762: 'Enfants', 10763: 'Actualités',
  10764: 'Téléréalité', 10765: 'SF & Fantastique', 10766: 'Feuilleton', 10767: 'Talk-show', 10768: 'Guerre & Politique',
};

export type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  runtime?: number;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  original_language?: string;
  imdb_id?: string | null;
  images?: TmdbImages;
  credits?: TmdbCredits;
};

export type TmdbTv = {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  vote_average?: number;
  genres?: { id: number; name: string }[];
  original_language?: string;
  origin_country?: string[];
  status?: string;
  seasons: { id: number; season_number: number; name: string; episode_count: number; air_date?: string | null }[];
  external_ids?: { tvdb_id?: number | null; imdb_id?: string | null };
  images?: TmdbImages;
  credits?: TmdbCredits;
  number_of_episodes?: number;
  episode_run_time?: number[];
};

export type TmdbImages = { logos?: { file_path: string; iso_639_1: string | null; aspect_ratio: number }[] };
export type TmdbCredits = {
  cast?: { id: number; name: string; character?: string; profile_path?: string | null }[];
};

export class TmdbError extends Error {}

export async function tmdbCall<T>(s: Settings, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = s.tmdbKey.trim();
  if (!key) throw new TmdbError('Clé TMDB manquante');
  const isV4 = key.startsWith('eyJ');
  const qs = new URLSearchParams({ language: s.language || 'fr-FR', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  if (!isV4) qs.set('api_key', key);
  const res = await fetch(`https://api.themoviedb.org/3${path}?${qs}`, {
    headers: { Accept: 'application/json', ...(isV4 ? { Authorization: `Bearer ${key}` } : {}) },
  });
  if (!res.ok) {
    let msg = `TMDB HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.status_message) msg = body.status_message;
    } catch {}
    throw new TmdbError(msg);
  }
  return (await res.json()) as T;
}

const detailCache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = detailCache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    p.catch(() => detailCache.delete(key));
    detailCache.set(key, p);
  }
  return p;
}

export const tmdb = {
  search: (s: Settings, query: string, page = 1) =>
    tmdbCall<{ results: TmdbItem[]; total_pages: number }>(s, '/search/multi', { query, page, include_adult: 'false' }).then(
      (r) => ({ ...r, results: r.results.filter((i) => i.media_type === 'movie' || i.media_type === 'tv') })
    ),

  searchType: (s: Settings, type: MediaType, query: string, year?: number) =>
    tmdbCall<{ results: TmdbItem[] }>(s, `/search/${type}`, {
      query,
      ...(year ? (type === 'movie' ? { year } : { first_air_date_year: year }) : {}),
    }),

  trending: (s: Settings) => tmdbCall<{ results: TmdbItem[] }>(s, '/trending/all/week'),

  /** Les mieux notés d'un thème (genre ou mot-clé comme « christmas »), pour la recherche rapide. */
  best: async (s: Settings, type: MediaType, opts: { genre?: number; keyword?: string; page?: number }) => {
    let kw: number | undefined;
    if (opts.keyword) {
      const k = await tmdbCall<{ results: { id: number; name: string }[] }>(s, '/search/keyword', { query: opts.keyword });
      kw = (k.results.find((x) => x.name.toLowerCase() === opts.keyword!.toLowerCase()) ?? k.results[0])?.id;
    }
    const r = await tmdbCall<{ results: TmdbItem[] }>(s, `/discover/${type}`, {
      sort_by: 'vote_average.desc',
      'vote_count.gte': type === 'movie' ? (opts.keyword ? 150 : 1500) : opts.keyword ? 60 : 400,
      include_adult: 'false',
      page: opts.page ?? 1,
      ...(opts.genre ? { with_genres: String(opts.genre) } : {}),
      ...(kw ? { with_keywords: String(kw) } : {}),
    });
    return r.results.map((i) => ({ ...i, media_type: type }));
  },

  /**
   * Recherche par thème : tous les titres du thème (genre, mot-clé ou studios), du plus récent au plus ancien,
   * page par page (pas seulement les mieux notés). Titres sortis seulement, un minimum de votes pour écarter le bruit.
   */
  themed: async (s: Settings, type: MediaType, opts: { genre?: number; keyword?: string; companies?: number[]; page?: number }) => {
    let kw: number | undefined;
    if (opts.keyword) {
      const k = await tmdbCall<{ results: { id: number; name: string }[] }>(s, '/search/keyword', { query: opts.keyword });
      kw = (k.results.find((x) => x.name.toLowerCase() === opts.keyword!.toLowerCase()) ?? k.results[0])?.id;
    }
    const today = new Date().toISOString().slice(0, 10);
    const dateKey = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    const r = await tmdbCall<{ results: TmdbItem[]; total_pages: number }>(s, `/discover/${type}`, {
      sort_by: `${dateKey}.desc`,
      [`${dateKey}.lte`]: today,
      'vote_count.gte': opts.companies?.length ? 30 : 40,
      include_adult: 'false',
      page: opts.page ?? 1,
      ...(opts.genre ? { with_genres: String(opts.genre) } : {}),
      ...(kw ? { with_keywords: String(kw) } : {}),
      ...(opts.companies?.length ? { with_companies: opts.companies.join('|') } : {}),
    });
    return { results: r.results.map((i) => ({ ...i, media_type: type })), totalPages: r.total_pages ?? 1 };
  },

  /** Découverte filtrée (genres / mot-clé), du plus récent au plus ancien. */
  discover: (s: Settings, type: MediaType, opts: { genres?: number[]; keyword?: number; page?: number }) => {
    const today = new Date().toISOString().slice(0, 10);
    const dateKey = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    return tmdbCall<{ results: TmdbItem[] }>(s, `/discover/${type}`, {
      sort_by: `${dateKey}.desc`,
      [`${dateKey}.lte`]: today,
      'vote_count.gte': 80,
      include_adult: 'false',
      page: opts.page ?? 1,
      ...(opts.genres?.length ? { with_genres: opts.genres.join(',') } : {}),
      ...(opts.keyword ? { with_keywords: String(opts.keyword) } : {}),
    }).then((r) => ({ results: r.results.map((i) => ({ ...i, media_type: type })) }));
  },

  movie: (s: Settings, id: number) =>
    cached(`movie:${id}`, () =>
      tmdbCall<TmdbMovie>(s, `/movie/${id}`, { append_to_response: 'images,credits,release_dates', include_image_language: imgLangs(s) })
    ),

  tv: (s: Settings, id: number) =>
    cached(`tv:${id}`, () =>
      tmdbCall<TmdbTv>(s, `/tv/${id}`, {
        append_to_response: 'external_ids,images,credits',
        include_image_language: imgLangs(s),
      })
    ),

  /** Logo du titre (pour le hero), mis en cache. */
  logo: (s: Settings, type: MediaType, id: number) =>
    cached(`logo:${type}:${id}`, () =>
      tmdbCall<TmdbImages>(s, `/${type}/${id}/images`, { include_image_language: imgLangs(s) }).then((i) => pickLogo(s, i))
    ),

  season: (s: Settings, tvId: number, n: number) =>
    cached(`season:${tvId}:${n}`, () =>
      tmdbCall<{
        episodes: { id: number; episode_number: number; name: string; overview?: string; still_path?: string | null; air_date?: string | null; runtime?: number | null }[];
      }>(s, `/tv/${tvId}/season/${n}`)
    ),

  externalIds: (s: Settings, type: MediaType, id: number) =>
    cached(`ext:${type}:${id}`, () => tmdbCall<{ imdb_id?: string | null; tvdb_id?: number | null }>(s, `/${type}/${id}/external_ids`)),

  findImdb: (s: Settings, imdbId: string) =>
    tmdbCall<{ movie_results: TmdbItem[]; tv_results: TmdbItem[] }>(s, `/find/${imdbId}`, { external_source: 'imdb_id' }),
};

const imgLangs = (s: Settings) => `${(s.language || 'fr-FR').slice(0, 2)},en,null`;

/** Choisit le logo dans la langue de l'utilisateur, sinon anglais, sinon le premier. */
export function pickLogo(s: Settings, images?: TmdbImages): string | null {
  const logos = images?.logos ?? [];
  const lang = (s.language || 'fr-FR').slice(0, 2);
  const best =
    logos.find((l) => l.iso_639_1 === lang) ?? logos.find((l) => l.iso_639_1 === 'en') ?? logos[0];
  return best?.file_path ?? null;
}

type ImgSize = 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original';
// TV : une taille au-dessus (voire l'original) pour des images nettes sur grand écran
const TV_SIZE: Record<ImgSize, ImgSize> = { w185: 'w342', w342: 'w342', w500: 'w500', w780: 'w780', w1280: 'w1280', original: 'w1280' };
export const tmdbImg = (path?: string | null, size: ImgSize = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${Platform.isTV ? TV_SIZE[size] : size}${path}` : undefined;

export const itemTitle = (i: TmdbItem) => i.title ?? i.name ?? '';
export const itemYear = (i: TmdbItem) => (i.release_date || i.first_air_date || '').slice(0, 4);

// ——— « Disponible le … » : prochaine sortie d'un titre pas encore sorti ———

const longDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dayOf = (iso?: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

/** Texte de la prochaine sortie (numérique pour un film, nouvelle saison / épisode pour une série), ou null si déjà sorti. */
export function upcomingRelease(kind: 'movie' | 'tv', data: any): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (kind === 'movie') {
    const results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] = data?.release_dates?.results ?? [];
    const pick = (country: string, types: number[]) =>
      results
        .find((r) => r.iso_3166_1 === country)
        ?.release_dates.filter((d) => types.includes(d.type))
        .map((d) => dayOf(d.release_date))
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const digitalFr = pick('FR', [4]);
    const digital = digitalFr ?? pick('US', [4]);
    if (digital) return digital >= today ? `Disponible en numérique le ${longDate(digital)}${digitalFr ? '' : ' (date US)'}` : null;
    // Déjà sorti en numérique (ou en physique) dans un autre pays : rien à annoncer
    const anyPast = results.some((r) => r.release_dates.some((d) => (d.type === 4 || d.type === 5) && (dayOf(d.release_date) ?? today) < today));
    if (anyPast) return null;
    // Pas encore de date numérique : la sortie cinéma si elle est à venir
    const cinema = pick('FR', [2, 3]) ?? dayOf(data?.release_date);
    if (cinema && cinema >= today) return `Au cinéma le ${longDate(cinema)} · date numérique pas encore annoncée`;
    // Sorti au cinéma il y a moins de 4 mois : la sortie numérique arrive bientôt
    if (cinema && today.getTime() - cinema.getTime() < 120 * 86_400_000) return 'Au cinéma en ce moment · date numérique pas encore annoncée';
    return null;
  }
  const first = dayOf(data?.first_air_date);
  if (first && first >= today) return `Première diffusion le ${longDate(first)}`;
  const next = data?.next_episode_to_air;
  const nd = dayOf(next?.air_date);
  if (next && nd && nd >= today) {
    return next.episode_number === 1
      ? `Saison ${next.season_number} le ${longDate(nd)}`
      : `Prochain épisode (S${next.season_number}E${next.episode_number}) le ${longDate(nd)}`;
  }
  return null;
}

// ——— Bande-annonce (YouTube), en français si possible ———

type TmdbVideo = { key: string; site: string; type: string; official?: boolean; iso_639_1?: string; name?: string };

export async function trailerKey(s: Settings, type: 'movie' | 'tv', id: number): Promise<string | null> {
  const pick = (list: TmdbVideo[]) => {
    const yt = list.filter((v) => v.site === 'YouTube');
    return (
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser') ??
      yt[0] ??
      null
    );
  };
  for (const language of ['fr-FR', 'en-US']) {
    const r = await tmdbCall<{ results: TmdbVideo[] }>(s, `/${type}/${id}/videos`, { language }).catch(() => ({ results: [] }));
    const v = pick(r.results ?? []);
    if (v) return v.key;
  }
  return null;
}
