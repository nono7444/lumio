// Client de l'API Jellyfin : connexion, bibliothèque, lecture, suivi de progression.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { JellyfinSession, Settings } from './settings';

export const TICKS_PER_SECOND = 10_000_000;

export type JfItem = {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | 'BoxSet' | 'CollectionFolder' | 'Folder' | string;
  CollectionType?: string;
  ProductionYear?: number;
  PremiereDate?: string;
  Overview?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ChildCount?: number;
  ImageTags?: { Primary?: string; Logo?: string; Thumb?: string; Backdrop?: string };
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string;
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ProviderIds?: { Tmdb?: string; Imdb?: string; Tvdb?: string };
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    Played?: boolean;
    UnplayedItemCount?: number;
    IsFavorite?: boolean;
  };
  People?: { Id: string; Name: string; Role?: string; Type: string; PrimaryImageTag?: string }[];
};

export type JfMediaSource = {
  Id: string;
  Container?: string;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  RunTimeTicks?: number;
};

export class JellyfinError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const VERSION = Constants.expoConfig?.version ?? '1.0.0';
const DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'web' ? 'Mac' : 'Android';

const trimUrl = (u: string) => {
  let url = u.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  // L'URL de l'interface web (…/web/index.html) n'est pas celle de l'API
  return url.replace(/\/web(\/.*)?$/i, '');
};

function authHeader(deviceId: string, token?: string) {
  const parts = [
    `Client="Lumio"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId || 'lumio'}"`,
    `Version="${VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

async function call<T>(
  base: string,
  deviceId: string,
  token: string | undefined,
  path: string,
  init?: RequestInit
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${trimUrl(base)}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(deviceId, token),
        'X-Emby-Authorization': authHeader(deviceId, token),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      if (res.status === 401) throw new JellyfinError('Identifiants refusés ou session expirée', 401);
      throw new JellyfinError(`HTTP ${res.status}`, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new JellyfinError('Serveur injoignable (délai dépassé)');
    if (e instanceof JellyfinError) throw e;
    throw new JellyfinError(`Serveur injoignable : ${e?.message ?? e}`);
  } finally {
    clearTimeout(t);
  }
}

// ——— Connexion ———

export async function serverInfo(url: string, deviceId: string) {
  return call<{ ServerName: string; Version: string; Id: string }>(url, deviceId, undefined, '/System/Info/Public');
}

export async function login(url: string, username: string, password: string, deviceId: string): Promise<JellyfinSession> {
  const base = trimUrl(url);
  const info = await serverInfo(base, deviceId);
  const res = await call<{ AccessToken: string; User: { Id: string; Name: string } }>(
    base,
    deviceId,
    undefined,
    '/Users/AuthenticateByName',
    { method: 'POST', body: JSON.stringify({ Username: username, Pw: password }) }
  );
  const user = res.User as { Id: string; Name: string; Policy?: { IsAdministrator?: boolean } };
  return {
    url: base,
    token: res.AccessToken,
    userId: user.Id,
    userName: user.Name,
    serverName: info.ServerName,
    isAdmin: Boolean(user.Policy?.IsAdministrator),
  };
}

/** Rafraîchit le rôle (admin ou non) de l'utilisateur connecté. */
export async function fetchIsAdmin(s: Settings) {
  const { get } = api(s);
  const me = await get<{ Policy?: { IsAdministrator?: boolean } }>('/Users/Me');
  return Boolean(me.Policy?.IsAdministrator);
}

export async function logout(s: Settings) {
  if (!s.jellyfin) return;
  await call(s.jellyfin.url, s.deviceId, s.jellyfin.token, '/Sessions/Logout', { method: 'POST' }).catch(() => {});
}

// ——— Bibliothèque ———

const FIELDS = 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,ProviderIds,CommunityRating,OfficialRating,ChildCount';

function api(s: Settings) {
  const j = s.jellyfin;
  if (!j) throw new JellyfinError('Non connecté à Jellyfin');
  const get = <T,>(path: string) => call<T>(j.url, s.deviceId, j.token, path);
  const post = <T,>(path: string, body?: unknown) =>
    call<T>(j.url, s.deviceId, j.token, path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  return { j, get, post };
}

// Index « type:tmdb:id » / « type:imdb:id » → Id Jellyfin, pour savoir si un titre est déjà sur le serveur
let providerCache: { key: string; at: number; map: Promise<Map<string, string>> } | null = null;
function providerIndex(s: Settings) {
  const key = `${s.jellyfin?.url}|${s.jellyfin?.userId}`;
  if (providerCache && providerCache.key === key && Date.now() - providerCache.at < 5 * 60_000) return providerCache.map;
  const { j, get } = api(s);
  const map = get<{ Items: JfItem[] }>(
    `/Users/${j.userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds&EnableImages=false&EnableUserData=false`
  ).then(({ Items }) => {
    const m = new Map<string, string>();
    for (const i of Items) {
      const t = i.Type === 'Movie' ? 'movie' : 'tv';
      if (i.ProviderIds?.Tmdb) m.set(`${t}:tmdb:${i.ProviderIds.Tmdb}`, i.Id);
      if (i.ProviderIds?.Imdb) m.set(`${t}:imdb:${i.ProviderIds.Imdb}`, i.Id);
    }
    return m;
  });
  map.catch(() => {
    providerCache = null;
  });
  providerCache = { key, at: Date.now(), map };
  return map;
}

export type JfSession = {
  Id: string;
  UserId?: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  RemoteEndPoint?: string;
  LastActivityDate?: string;
  NowPlayingItem?: JfItem & {
    SeriesName?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    RunTimeTicks?: number;
    SeriesPrimaryImageTag?: string;
    ProductionYear?: number;
  };
  PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode' };
  TranscodingInfo?: {
    VideoCodec?: string;
    AudioCodec?: string;
    Bitrate?: number;
    Height?: number;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    CompletionPercentage?: number;
    TranscodeReasons?: string[];
    HardwareAccelerationType?: string;
  };
};

export const jf = {
  /** Admin : sessions actives du serveur (qui regarde quoi). */
  sessions: (s: Settings) => api(s).get<JfSession[]>('/Sessions?ActiveWithinSeconds=900'),

  /** Oublie l'index des titres (après un téléchargement terminé, pour voir le nouveau film). */
  invalidateIndex: () => {
    providerCache = null;
  },

  views: (s: Settings) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Users/${j.userId}/Views`).then((r) =>
      r.Items.filter((v) => !v.CollectionType || ['movies', 'tvshows', 'mixed', 'homevideos', 'boxsets'].includes(v.CollectionType))
    );
  },

  resume: (s: Settings) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(
      `/Users/${j.userId}/Items/Resume?Limit=20&MediaTypes=Video&Fields=${FIELDS}&EnableImageTypes=Primary,Backdrop,Thumb`
    ).then((r) => r.Items);
  },

  nextUp: (s: Settings) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Shows/NextUp?UserId=${j.userId}&Limit=20&Fields=${FIELDS}`).then((r) => r.Items);
  },

  latest: (s: Settings, parentId: string) => {
    const { j, get } = api(s);
    return get<JfItem[]>(`/Users/${j.userId}/Items/Latest?ParentId=${parentId}&Limit=30&Fields=${FIELDS}&GroupItems=true`);
  },

  items: (
    s: Settings,
    opts: {
      parentId?: string;
      types?: string;
      sort?: string;
      order?: 'Ascending' | 'Descending';
      start?: number;
      limit?: number;
      search?: string;
      filters?: string;
      genres?: string;
    }
  ) => {
    const { j, get } = api(s);
    const q = new URLSearchParams({
      Recursive: 'true',
      Fields: FIELDS,
      SortBy: opts.sort ?? 'SortName',
      SortOrder: opts.order ?? 'Ascending',
      StartIndex: String(opts.start ?? 0),
      Limit: String(opts.limit ?? 60),
      EnableTotalRecordCount: 'true',
    });
    if (opts.parentId) q.set('ParentId', opts.parentId);
    if (opts.types) q.set('IncludeItemTypes', opts.types);
    if (opts.search) q.set('SearchTerm', opts.search);
    if (opts.filters) q.set('Filters', opts.filters);
    if (opts.genres) q.set('Genres', opts.genres);
    return get<{ Items: JfItem[]; TotalRecordCount: number }>(`/Users/${j.userId}/Items?${q}`);
  },

  /**
   * Derniers ajouts, mais seulement les sorties récentes (année en cours et suivantes) :
   * films sortis cette année, séries avec des épisodes diffusés cette année (nouvelle saison d'une ancienne série incluse).
   * Ordre : du plus récemment ajouté sur le serveur au plus ancien. S'il y en a trop peu (début d'année), on inclut l'an dernier.
   */
  recentReleases: async (
    s: Settings,
    opts: { parentId?: string; kind: 'movies' | 'series' | 'both'; limit?: number }
  ): Promise<JfItem[]> => {
    const { j, get } = api(s);
    const limit = opts.limit ?? 30;
    const run = async (year: number) => {
      const since = `${year}-01-01T00:00:00Z`;
      const base = (types: string, n: number) => {
        const q = new URLSearchParams({
          Recursive: 'true',
          IncludeItemTypes: types,
          MinPremiereDate: since,
          SortBy: 'DateCreated',
          SortOrder: 'Descending',
          Limit: String(n),
          Fields: `${FIELDS},DateCreated,PremiereDate`,
        });
        if (opts.parentId) q.set('ParentId', opts.parentId);
        return get<{ Items: (JfItem & { DateCreated?: string })[] }>(`/Users/${j.userId}/Items?${q}`).then((r) => r.Items);
      };
      const [movies, series] = await Promise.all([
        opts.kind !== 'series' ? base('Movie', limit) : Promise.resolve([]),
        opts.kind !== 'movies'
          ? (async () => {
              // Épisodes sortis cette année, regroupés par série dans l'ordre d'ajout
              const eps = await base('Episode', 300);
              const order: string[] = [];
              const added = new Map<string, string>();
              for (const e of eps)
                if (e.SeriesId && !added.has(e.SeriesId)) {
                  added.set(e.SeriesId, e.DateCreated ?? '');
                  order.push(e.SeriesId);
                }
              const ids = order.slice(0, limit);
              if (!ids.length) return [];
              const r = await get<{ Items: JfItem[] }>(`/Users/${j.userId}/Items?Ids=${ids.join(',')}&Fields=${FIELDS}`);
              return ids
                .map((id) => r.Items.find((x) => x.Id === id))
                .filter((x): x is JfItem => Boolean(x))
                .map((x) => ({ ...x, DateCreated: added.get(x.Id) }));
            })()
          : Promise.resolve([]),
      ]);
      return [...movies, ...series]
        .sort((a, b) => (b.DateCreated ?? '').localeCompare(a.DateCreated ?? ''))
        .slice(0, limit) as JfItem[];
    };
    const year = new Date().getFullYear();
    const items = await run(year);
    return items.length >= 6 ? items : run(year - 1);
  },

  item: (s: Settings, id: string) => {
    const { j, get } = api(s);
    return get<JfItem>(`/Users/${j.userId}/Items/${id}`);
  },

  seasons: (s: Settings, seriesId: string) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Shows/${seriesId}/Seasons?UserId=${j.userId}&Fields=${FIELDS}`).then((r) => r.Items);
  },

  episodes: (s: Settings, seriesId: string, seasonId: string) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(
      `/Shows/${seriesId}/Episodes?UserId=${j.userId}&SeasonId=${seasonId}&Fields=${FIELDS}`
    ).then((r) => r.Items);
  },

  /**
   * Retrouve un titre TMDB dans Jellyfin. AnyProviderIdEquals est peu fiable selon les versions :
   * on cherche par titre puis on compare l'id TMDB (ou IMDb) dans les ProviderIds.
   */
  findByTmdb: async (s: Settings, type: 'movie' | 'tv', tmdbId: number, title: string, imdbId?: string | null) => {
    if (!s.jellyfin) return null;
    // 1) Index de toute la bibliothèque par identifiants (fiable même si le titre diffère : VO, VF…)
    const idx = await providerIndex(s).catch(() => null);
    const hit = idx?.get(`${type}:tmdb:${tmdbId}`) ?? (imdbId ? idx?.get(`${type}:imdb:${imdbId}`) : undefined);
    if (hit) return jf.item(s, hit).catch(() => null);
    if (idx) return null;
    // 2) Repli : recherche par titre
    const { Items } = await jf.items(s, {
      types: type === 'movie' ? 'Movie' : 'Series',
      search: title,
      limit: 25,
    });
    return (
      Items.find((i) => i.ProviderIds?.Tmdb === String(tmdbId)) ??
      (imdbId ? Items.find((i) => i.ProviderIds?.Imdb === imdbId) : undefined) ??
      null
    );
  },

  genres: (s: Settings, parentId?: string) => {
    const { j, get } = api(s);
    return get<{ Items: { Id: string; Name: string }[] }>(
      `/Genres?UserId=${j.userId}&SortBy=SortName${parentId ? `&ParentId=${parentId}` : ''}`
    ).then((r) => r.Items);
  },

  similar: (s: Settings, id: string) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Items/${id}/Similar?UserId=${j.userId}&Limit=15&Fields=${FIELDS}`).then((r) => r.Items);
  },

  favorites: (s: Settings) =>
    jf.items(s, { types: 'Movie,Series', filters: 'IsFavorite', sort: 'DateCreated', order: 'Descending', limit: 30 }).then((r) => r.Items),

  setFavorite: (s: Settings, id: string, fav: boolean) => {
    const { j } = api(s);
    return call(j.url, s.deviceId, j.token, `/Users/${j.userId}/FavoriteItems/${id}`, { method: fav ? 'POST' : 'DELETE' });
  },

  /** Prochain épisode à regarder pour une série (Jellyfin « À suivre »). */
  nextUpForSeries: (s: Settings, seriesId: string) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Shows/NextUp?UserId=${j.userId}&SeriesId=${seriesId}&Limit=1&Fields=${FIELDS}`).then(
      (r) => r.Items[0] ?? null
    );
  },

  allEpisodes: (s: Settings, seriesId: string) => {
    const { j, get } = api(s);
    return get<{ Items: JfItem[] }>(`/Shows/${seriesId}/Episodes?UserId=${j.userId}&Fields=${FIELDS}`).then((r) => r.Items);
  },

  /** Épisode qui suit celui-ci dans la série. */
  nextEpisode: async (s: Settings, episode: JfItem) => {
    if (!episode.SeriesId) return null;
    const { j, get } = api(s);
    const r = await get<{ Items: JfItem[] }>(
      `/Shows/${episode.SeriesId}/Episodes?UserId=${j.userId}&StartItemId=${episode.Id}&Limit=2&Fields=${FIELDS}`
    );
    return r.Items.find((e) => e.Id !== episode.Id) ?? null;
  },

  setPlayed: (s: Settings, id: string, played: boolean) => {
    const { j } = api(s);
    return call(j.url, s.deviceId, j.token, `/Users/${j.userId}/PlayedItems/${id}`, { method: played ? 'POST' : 'DELETE' });
  },
};

// ——— Images ———

export function jfImage(
  s: Settings,
  itemId: string | undefined,
  type: 'Primary' | 'Backdrop' | 'Logo' | 'Thumb' = 'Primary',
  opts: { tag?: string; maxHeight?: number; maxWidth?: number } = {}
) {
  if (!s.jellyfin || !itemId) return undefined;
  const q = new URLSearchParams({ quality: '90' });
  if (opts.tag) q.set('tag', opts.tag);
  if (opts.maxHeight) q.set('maxHeight', String(opts.maxHeight));
  if (opts.maxWidth) q.set('maxWidth', String(opts.maxWidth));
  return `${s.jellyfin.url}/Items/${itemId}/Images/${type}?${q}`;
}

/** Affiche d'un élément (pour un épisode : l'affiche de la série). */
export function jfPoster(s: Settings, i: JfItem, maxHeight = 450) {
  if (i.ImageTags?.Primary && i.Type !== 'Episode') return jfImage(s, i.Id, 'Primary', { tag: i.ImageTags.Primary, maxHeight });
  if (i.SeriesId && i.SeriesPrimaryImageTag) return jfImage(s, i.SeriesId, 'Primary', { tag: i.SeriesPrimaryImageTag, maxHeight });
  if (i.ImageTags?.Primary) return jfImage(s, i.Id, 'Primary', { tag: i.ImageTags.Primary, maxHeight });
  return undefined;
}

export function jfBackdrop(s: Settings, i: JfItem, maxWidth = 1280) {
  if (i.BackdropImageTags?.length) return jfImage(s, i.Id, 'Backdrop', { tag: i.BackdropImageTags[0], maxWidth });
  if (i.ParentBackdropItemId && i.ParentBackdropImageTags?.length)
    return jfImage(s, i.ParentBackdropItemId, 'Backdrop', { tag: i.ParentBackdropImageTags[0], maxWidth });
  if (i.ImageTags?.Thumb) return jfImage(s, i.Id, 'Thumb', { tag: i.ImageTags.Thumb, maxWidth });
  return jfPoster(s, i, 900);
}

export function jfLogo(s: Settings, i: JfItem) {
  if (i.ImageTags?.Logo) return jfImage(s, i.Id, 'Logo', { tag: i.ImageTags.Logo, maxWidth: 600 });
  if (i.ParentLogoItemId && i.ParentLogoImageTag)
    return jfImage(s, i.ParentLogoItemId, 'Logo', { tag: i.ParentLogoImageTag, maxWidth: 600 });
  return undefined;
}

// ——— Lecture ———

/**
 * Profil de l'appareil envoyé à Jellyfin : ce que le lecteur natif sait lire directement.
 * Le reste est transcodé en HLS par le serveur.
 */
/** Appli Mac (Electron / Chromium) : MP4 et WebM lus directement, le reste converti en HLS H.264 / AAC (lu par hls.js). */
const WEB_PROFILE = {
  Name: 'Lumio Mac',
  MaxStreamingBitrate: 120_000_000,
  MaxStaticBitrate: 120_000_000,
  MusicStreamingTranscodingBitrate: 384_000,
  DirectPlayProfiles: [
    { Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: 'h264,hevc,av1', AudioCodec: 'aac,mp3,opus,flac,alac' },
    { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      Protocol: 'hls',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      Context: 'Streaming',
      MaxAudioChannels: '2',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
  ],
  ContainerProfiles: [],
  CodecProfiles: [],
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'Hls' },
    { Format: 'subrip', Method: 'Hls' },
    { Format: 'ass', Method: 'Encode' },
    { Format: 'ssa', Method: 'Encode' },
    { Format: 'pgssub', Method: 'Encode' },
    { Format: 'dvdsub', Method: 'Encode' },
  ],
};

function deviceProfile(engine: PlaybackEngine) {
  if (engine === 'cast') return CAST_PROFILE;
  if (Platform.OS === 'web') return WEB_PROFILE;
  if (engine === 'mpv') return MPV_PROFILE;
  const android = Platform.OS === 'android';
  return {
    Name: 'Lumio',
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      {
        Container: android ? 'mp4,m4v,mkv,webm,mov' : 'mp4,m4v,mov',
        Type: 'Video',
        VideoCodec: android ? 'h264,hevc,vp9,av1' : 'h264,hevc',
        AudioCodec: android ? 'aac,ac3,eac3,mp3,opus,flac,vorbis' : 'aac,ac3,eac3,mp3,alac,flac',
      },
    ],
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        Protocol: 'hls',
        VideoCodec: 'h264,hevc',
        AudioCodec: 'aac,ac3,eac3',
        Context: 'Streaming',
        MaxAudioChannels: '6',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'Hls' },
      { Format: 'subrip', Method: 'Hls' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
    ],
  };
}

/** Chromecast (récepteur par défaut) : MP4/WebM H.264 en direct, le reste transcodé en HLS H.264/AAC stéréo. */
const CAST_PROFILE = {
  Name: 'Lumio Chromecast',
  MaxStreamingBitrate: 20_000_000,
  MaxStaticBitrate: 20_000_000,
  MusicStreamingTranscodingBitrate: 384_000,
  DirectPlayProfiles: [
    { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' },
    { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9', AudioCodec: 'vorbis,opus' },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      Protocol: 'hls',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      Context: 'Streaming',
      MaxAudioChannels: '2',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
  ],
  ContainerProfiles: [],
  CodecProfiles: [],
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'Hls' },
    { Format: 'subrip', Method: 'Encode' },
    { Format: 'ass', Method: 'Encode' },
    { Format: 'ssa', Method: 'Encode' },
    { Format: 'pgssub', Method: 'Encode' },
    { Format: 'dvdsub', Method: 'Encode' },
  ],
};

/** mpv (FFmpeg) lit pratiquement tout : lecture directe de quasiment tous les fichiers. */
const MPV_PROFILE = {
  Name: 'Lumio mpv',
  MaxStreamingBitrate: 200_000_000,
  MaxStaticBitrate: 200_000_000,
  MusicStreamingTranscodingBitrate: 384_000,
  DirectPlayProfiles: [
    {
      Container: 'mkv,mp4,m4v,mov,avi,webm,ts,m2ts,mpegts,wmv,flv,ogm,ogv,3gp',
      Type: 'Video',
      VideoCodec: 'h264,hevc,h265,av1,vp8,vp9,mpeg2video,mpeg4,msmpeg4v3,vc1,wmv3',
      AudioCodec: 'aac,ac3,eac3,dts,truehd,mlp,flac,alac,mp3,mp2,opus,vorbis,pcm_s16le,pcm_s24le,wmav2',
    },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      Protocol: 'hls',
      VideoCodec: 'h264,hevc',
      AudioCodec: 'aac,ac3,eac3',
      Context: 'Streaming',
      MaxAudioChannels: '8',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
  ],
  ContainerProfiles: [],
  CodecProfiles: [],
  // Sous-titres intégrés lus par mpv (libass) : aucun incrustage côté serveur
  SubtitleProfiles: ['ass', 'ssa', 'subrip', 'srt', 'vtt', 'webvtt', 'pgssub', 'dvdsub', 'dvbsub', 'mov_text'].flatMap((f) => [
    { Format: f, Method: 'Embed' },
    { Format: f, Method: 'External' },
  ]),
};

export type PlaybackTarget = {
  uri: string;
  isHls: boolean;
  itemId: string;
  mediaSourceId: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
};

export type PlaybackEngine = 'mpv' | 'native' | 'cast';

/** Qualités proposées dans le lecteur (débit et hauteur max). « original » = lecture directe. */
export type Quality = { id: string; label: string; bitrate?: number; maxHeight?: number };
export const QUALITIES: Quality[] = [
  { id: 'original', label: 'Original' },
  { id: '2160', label: '4K · 40 Mb/s', bitrate: 40_000_000, maxHeight: 2160 },
  { id: '1080h', label: '1080p · 20 Mb/s', bitrate: 20_000_000, maxHeight: 1080 },
  { id: '1080', label: '1080p · 10 Mb/s', bitrate: 10_000_000, maxHeight: 1080 },
  { id: '720', label: '720p · 4 Mb/s', bitrate: 4_000_000, maxHeight: 720 },
  { id: '480', label: '480p · 1,5 Mb/s', bitrate: 1_500_000, maxHeight: 480 },
];

export async function getPlayback(
  s: Settings,
  itemId: string,
  startSeconds = 0,
  engine: PlaybackEngine = 'mpv',
  quality?: Quality
): Promise<PlaybackTarget> {
  const { j, post } = api(s);
  // Qualité choisie : on force le transcodage par le serveur au débit / à la hauteur demandés
  const forced = quality?.bitrate ? quality : undefined;
  const q = new URLSearchParams({
    UserId: j.userId,
    StartTimeTicks: String(Math.round(startSeconds * TICKS_PER_SECOND)),
    AutoOpenLiveStream: 'true',
    ...(forced ? { EnableDirectPlay: 'false', EnableDirectStream: 'false', AllowVideoStreamCopy: 'false', MaxStreamingBitrate: String(forced.bitrate) } : {}),
  });
  const info = await post<{ MediaSources: JfMediaSource[]; PlaySessionId?: string }>(`/Items/${itemId}/PlaybackInfo?${q}`, {
    DeviceProfile: deviceProfile(engine),
    UserId: j.userId,
    MaxStreamingBitrate: forced?.bitrate ?? (engine === 'cast' ? 20_000_000 : 120_000_000),
    ...(forced ? { EnableDirectPlay: false, EnableDirectStream: false, AllowVideoStreamCopy: false } : {}),
  });
  const src = info.MediaSources?.[0];
  if (!src) throw new JellyfinError('Aucune source vidéo pour cet élément');

  const common = { itemId, mediaSourceId: src.Id, playSessionId: info.PlaySessionId };
  if (!forced && (src.SupportsDirectPlay || src.SupportsDirectStream)) {
    const p = new URLSearchParams({
      static: 'true',
      MediaSourceId: src.Id,
      DeviceId: s.deviceId,
      api_key: j.token,
      ...(info.PlaySessionId ? { PlaySessionId: info.PlaySessionId } : {}),
    });
    const ext = (src.Container ?? 'mp4').split(',')[0];
    return {
      ...common,
      uri: `${j.url}/Videos/${itemId}/stream.${ext}?${p}`,
      isHls: false,
      playMethod: src.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
    };
  }
  if (src.TranscodingUrl) {
    let uri = `${j.url}${src.TranscodingUrl}`;
    const add = (k: string, v: string) => {
      uri = /[?&]/.test(uri) && new RegExp(`[?&]${k}=`, 'i').test(uri)
        ? uri.replace(new RegExp(`([?&]${k}=)[^&]*`, 'i'), `$1${v}`)
        : `${uri}${uri.includes('?') ? '&' : '?'}${k}=${v}`;
    };
    if (!/[?&]api_key=/i.test(uri)) add('api_key', j.token);
    if (forced?.maxHeight) add('MaxHeight', String(forced.maxHeight));
    if (forced?.bitrate) {
      add('MaxStreamingBitrate', String(forced.bitrate));
      add('VideoBitrate', String(Math.round(forced.bitrate * 0.9)));
    }
    return { ...common, uri, isHls: true, playMethod: 'Transcode' };
  }
  throw new JellyfinError('Le serveur ne propose ni lecture directe ni transcodage');
}

type Report = { target: PlaybackTarget; positionSeconds: number; isPaused?: boolean };

const reportBody = ({ target, positionSeconds, isPaused }: Report) => ({
  ItemId: target.itemId,
  MediaSourceId: target.mediaSourceId,
  PlaySessionId: target.playSessionId,
  PlayMethod: target.playMethod,
  PositionTicks: Math.round(positionSeconds * TICKS_PER_SECOND),
  IsPaused: Boolean(isPaused),
  CanSeek: true,
});

export const playback = {
  start: (s: Settings, r: Report) => api(s).post('/Sessions/Playing', reportBody(r)).catch(() => {}),
  progress: (s: Settings, r: Report) => api(s).post('/Sessions/Playing/Progress', reportBody(r)).catch(() => {}),
  stop: (s: Settings, r: Report) => api(s).post('/Sessions/Playing/Stopped', reportBody(r)).catch(() => {}),
};

export const ticksToSeconds = (t?: number) => (t ? t / TICKS_PER_SECOND : 0);

export function formatRuntime(ticks?: number) {
  const min = Math.round(ticksToSeconds(ticks) / 60);
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}
