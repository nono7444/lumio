// Serveur Lumio : chat familial + demandes façon Seerr (Radarr / Sonarr) + état des services.
// Sans dépendance. Authentification : le jeton Jellyfin de l'appli, vérifié auprès de ton serveur Jellyfin.
// Les clés Radarr / Sonarr restent ici, jamais sur les téléphones.
//
// Le fonctionnement des demandes reprend celui de Seerr (projet MIT) :
// statuts de demande EN ATTENTE / APPROUVÉE / REFUSÉE / ÉCHEC / TERMINÉE,
// statuts de média INCONNU / EN ATTENTE / EN COURS / PARTIELLEMENT DISPONIBLE / DISPONIBLE,
// validation automatique par utilisateur, quotas, demandes saison par saison.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3456);
const JELLYFIN_URL = (process.env.JELLYFIN_URL || 'http://jellyfin:8096').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || '/data';
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const IDEAS_FILE = path.join(DATA_DIR, 'ideas.json');
const RATINGS_FILE = path.join(DATA_DIR, 'ratings.json');
const LIVE_FILE = path.join(DATA_DIR, 'live-sources.json');
const MAX_MESSAGES = 3000;
const MAX_TEXT = 2000;
const VERSION = '3.19.0';

// Mêmes valeurs que Seerr
const RequestStatus = { PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 };
const MediaStatus = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIALLY_AVAILABLE: 4, AVAILABLE: 5 };

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let messages = readJson(MESSAGES_FILE, []);
let config = readJson(CONFIG_FILE, {});
let requests = readJson(REQUESTS_FILE, []);
let userPrefs = readJson(USERS_FILE, {});
let ideas = readJson(IDEAS_FILE, []);
let ratings = readJson(RATINGS_FILE, {});
// Sources Live TV de chaque utilisateur (envoyées par son téléphone, lues par Lumio TV) — restent sur ce serveur
let liveSources = readJson(LIVE_FILE, {});

const timers = {};
function persist(file, getData) {
  clearTimeout(timers[file]);
  timers[file] = setTimeout(() => writeJson(file, getData()), 250);
}
const saveMessages = () => persist(MESSAGES_FILE, () => messages);
const saveRequests = () => persist(REQUESTS_FILE, () => requests);
const saveUsers = () => persist(USERS_FILE, () => userPrefs);
const saveIdeas = () => persist(IDEAS_FILE, () => ideas);
const saveRatings = () => persist(RATINGS_FILE, () => ratings);
const saveLive = () => persist(LIVE_FILE, () => liveSources);
// Notes passées de 5 étoiles à 10 tomates : les anciennes notes sont doublées une seule fois
if (!config.ratingsOn10) {
  for (const e of Object.values(ratings)) for (const v of Object.values(e.votes || {})) v.stars = Math.min(10, (Number(v.stars) || 0) * 2);
  config.ratingsOn10 = true;
  writeJson(RATINGS_FILE, ratings);
  writeJson(CONFIG_FILE, config);
}
const saveConfig = () => writeJson(CONFIG_FILE, config);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ——— Config Radarr / Sonarr : envoyée depuis l'appli par un admin, ou variables d'environnement ———
function arrConfig(kind) {
  const c = { ...(config[kind] || {}) };
  const env = kind.toUpperCase();
  if (process.env[`${env}_URL`]) c.url = process.env[`${env}_URL`];
  if (process.env[`${env}_API_KEY`]) c.apiKey = process.env[`${env}_API_KEY`];
  if (c.url) c.url = String(c.url).trim().replace(/\/+$/, '');
  return c.url && c.apiKey ? c : null;
}
const label = (kind) => (kind === 'radarr' ? 'Radarr' : 'Sonarr');
const kindOf = (type) => (type === 'tv' ? 'sonarr' : 'radarr');

// Réglages généraux (comme « Paramètres → Utilisateurs » de Seerr)
function settings() {
  return {
    ntfyTopic: ntfyTopic(),
    ntfyServer: NTFY_SERVER,
    ntfyEnabled: config.ntfyEnabled !== false,
    publicUrl: publicUrl() || null,
    defaultAutoApprove: config.defaultAutoApprove !== false,
    defaultMovieQuotaLimit: Number(config.defaultMovieQuotaLimit) || 0,
    defaultMovieQuotaDays: Number(config.defaultMovieQuotaDays) || 7,
    defaultTvQuotaLimit: Number(config.defaultTvQuotaLimit) || 0,
    defaultTvQuotaDays: Number(config.defaultTvQuotaDays) || 7,
    usersSeeAllRequests: config.usersSeeAllRequests === true,
    lockedProfile: lockedProfileName(),
  };
}

// ——— Notifications push (ntfy) pour l'admin : nouvelle demande, échec, disponible ———
// L'admin s'abonne au sujet dans l'appli ntfy (iOS / Android). Les boutons « Valider » / « Refuser »
// de la notification appellent /hooks/… avec une signature HMAC (pas besoin d'ouvrir l'appli).
if (!config.hookSecret) {
  config.hookSecret = crypto.randomBytes(24).toString('hex');
  config.ntfyTopic = config.ntfyTopic || `lumio-${crypto.randomBytes(8).toString('hex')}`;
  writeJson(CONFIG_FILE, config);
}
// Sujet « famille » : messages du chat, nouvelles demandes, titres disponibles (chacun s'y abonne dans ntfy)
if (!config.familyTopic) {
  config.familyTopic = `lumio-famille-${crypto.randomBytes(8).toString('hex')}`;
  writeJson(CONFIG_FILE, config);
}
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const ntfyTopic = () => process.env.NTFY_TOPIC || config.ntfyTopic;
const publicUrl = () => (process.env.PUBLIC_URL || config.publicUrl || '').replace(/\/+$/, '');
const sign = (id, action) => crypto.createHmac('sha256', config.hookSecret).update(`${action}:${id}`).digest('hex').slice(0, 32);

async function notify({ title, message, tags, image, click, actions, topic }) {
  const to = topic || ntfyTopic();
  if (config.ntfyEnabled === false || !to) return;
  try {
    await fetch(NTFY_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}) },
      body: JSON.stringify({ topic: to, title, message, tags, attach: image, click: click || 'lumio://activity', actions }),
    });
  } catch {}
}
/** Notification pour toute la famille (sujet partagé). */
const notifyFamily = (o) => notify({ ...o, topic: config.familyTopic });

function notifyRequest(r, what) {
  const base = publicUrl();
  const pending = r.status === RequestStatus.PENDING;
  const actions = [];
  if (pending && base) {
    actions.push({ action: 'http', label: 'Valider', url: `${base}/hooks/approve?id=${r.id}&sig=${sign(r.id, 'approve')}`, method: 'POST', clear: true });
    actions.push({ action: 'http', label: 'Refuser', url: `${base}/hooks/decline?id=${r.id}&sig=${sign(r.id, 'decline')}`, method: 'POST', clear: true });
  }
  actions.push({ action: 'view', label: 'Voir', url: 'lumio://activity' });
  notify({
    title: pending ? `Demande à valider · ${r.requestedBy.name}` : r.status === RequestStatus.FAILED ? `Demande en échec · ${r.requestedBy.name}` : `Nouvelle demande · ${r.requestedBy.name}`,
    message: `${r.title}${r.year ? ` (${r.year})` : ''}${what}${r.status === RequestStatus.FAILED && r.error ? `\n${r.error}` : pending ? '' : '\nTéléchargement lancé.'}`,
    tags: [pending ? 'hourglass' : r.status === RequestStatus.FAILED ? 'warning' : 'inbox_tray'],
    image: r.poster,
    actions,
  });
}

// ——— Vérification du jeton Jellyfin (cache 10 min) ———
const sessions = new Map();

function jfHeaders(token) {
  return { Authorization: `MediaBrowser Client="LumioServer", Device="server", DeviceId="lumio-server", Version="${VERSION}", Token="${token}"` };
}

async function whoAmI(token) {
  if (!token) return null;
  const hit = sessions.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const res = await fetch(`${JELLYFIN_URL}/Users/Me`, { headers: jfHeaders(token) });
    if (!res.ok) return null;
    const me = await res.json();
    const user = { id: me.Id, name: me.Name, admin: Boolean(me.Policy && me.Policy.IsAdministrator), token };
    sessions.set(token, { user, until: Date.now() + 10 * 60 * 1000 });
    // Jeton gardé en mémoire pour lire le contenu de Jellyfin (celui d'un admin de préférence)
    if (user.admin || !jfIndexToken) jfIndexToken = token;
    return user;
  } catch {
    return null;
  }
}

/** Droits d'un utilisateur : l'admin Jellyfin a tous les droits. */
function permissionsOf(user) {
  const s = settings();
  const p = userPrefs[user.id] || {};
  return {
    admin: user.admin,
    autoApprove: user.admin || (p.autoApprove != null ? Boolean(p.autoApprove) : s.defaultAutoApprove),
    movieQuotaLimit: user.admin ? 0 : p.movieQuotaLimit != null ? Number(p.movieQuotaLimit) : s.defaultMovieQuotaLimit,
    movieQuotaDays: p.movieQuotaDays != null ? Number(p.movieQuotaDays) : s.defaultMovieQuotaDays,
    tvQuotaLimit: user.admin ? 0 : p.tvQuotaLimit != null ? Number(p.tvQuotaLimit) : s.defaultTvQuotaLimit,
    tvQuotaDays: p.tvQuotaDays != null ? Number(p.tvQuotaDays) : s.defaultTvQuotaDays,
  };
}

/** Quota restant, compté comme Seerr : films = nombre de demandes, séries = nombre de saisons. */
function quotaOf(user) {
  const perm = permissionsOf(user);
  const since = (days) => Date.now() - days * 86400000;
  const mine = requests.filter((r) => r.requestedBy.id === user.id && r.status !== RequestStatus.DECLINED);
  const movieUsed = mine.filter((r) => r.type === 'movie' && Date.parse(r.createdAt) > since(perm.movieQuotaDays)).length;
  const tvUsed = mine
    .filter((r) => r.type === 'tv' && Date.parse(r.createdAt) > since(perm.tvQuotaDays))
    .reduce((n, r) => n + (r.seasons || []).length, 0);
  return {
    movie: { limit: perm.movieQuotaLimit, days: perm.movieQuotaDays, used: movieUsed, remaining: perm.movieQuotaLimit ? Math.max(0, perm.movieQuotaLimit - movieUsed) : null },
    tv: { limit: perm.tvQuotaLimit, days: perm.tvQuotaDays, used: tvUsed, remaining: perm.tvQuotaLimit ? Math.max(0, perm.tvQuotaLimit - tvUsed) : null },
  };
}

// ——— Appels Radarr / Sonarr ———
async function arr(kind, p, init = {}) {
  const c = arrConfig(kind);
  if (!c) throw new HttpError(503, `${label(kind)} n'est pas configuré sur le serveur Lumio`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${c.url}/api/v3${p}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'X-Api-Key': c.apiKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      if (res.status === 401) msg = 'clé API refusée';
      else if (Array.isArray(body)) msg = body.map((e) => e.errorMessage).filter(Boolean).join(' · ') || msg;
      else if (body && body.message) msg = body.message;
      throw new HttpError(502, `${label(kind)} : ${msg}`);
    }
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new HttpError(504, `${label(kind)} ne répond pas`);
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `${label(kind)} injoignable`);
  } finally {
    clearTimeout(t);
  }
}

async function folders(kind) {
  const list = await arr(kind, '/rootfolder');
  const c = arrConfig(kind);
  // Ordre de préférence : Films d'abord (Kids en dernier) ; pour les séries, Séries puis Animés
  const last = (p2) => String(p2).replace(/\/+$/, '').split('/').pop().toLowerCase();
  const score = (p2) => {
    const n = last(p2);
    if (/kid|enfant|jeunesse|famil/.test(n)) return 9;
    if (kind === 'radarr') return /film|movie/.test(n) ? 0 : /anim/.test(n) ? 2 : 1;
    return /s[eé]rie|tv|show/.test(n) ? 0 : /anim/.test(n) ? 1 : 2;
  };
  const sorted = [...list].sort((a, b) => score(a.path) - score(b.path));
  return {
    folders: sorted.map((f) => ({ path: f.path, freeSpace: f.freeSpace, accessible: f.accessible !== false })),
    default: c.rootFolderPath || (sorted[0] && sorted[0].path) || null,
  };
}

// Profil de qualité imposé à toutes les demandes (films et séries), s'il existe dans Radarr / Sonarr
const lockedProfileName = () => (config.lockedProfile !== undefined ? config.lockedProfile : process.env.LOCKED_PROFILE || 'HD-1080p nono') || '';
const normName = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function profiles(kind) {
  const list = await arr(kind, '/qualityprofile');
  const c = arrConfig(kind);
  const lockName = normName(lockedProfileName());
  const locked = lockName ? list.find((p) => normName(p.name) === lockName) : null;
  return {
    profiles: list.map((p) => ({ id: p.id, name: p.name })),
    default: (locked && locked.id) || c.qualityProfileId || (list[0] && list[0].id) || null,
    locked: locked ? { id: locked.id, name: locked.name } : null,
  };
}

async function checkFolder(kind, wanted) {
  const { folders: list, default: def } = await folders(kind);
  if (!wanted) return def;
  const clean = String(wanted).replace(/\/+$/, '');
  const hit = list.find((f) => f.path.replace(/\/+$/, '') === clean);
  if (!hit) throw new HttpError(400, `Dossier inconnu : ${wanted}`);
  return hit.path;
}

async function checkProfile(kind, wanted) {
  const { profiles: list, default: def, locked } = await profiles(kind);
  if (locked) return locked.id; // profil imposé : on ignore tout autre choix
  if (!wanted) {
    if (!def) throw new HttpError(500, 'Aucun profil de qualité');
    return def;
  }
  if (!list.some((p) => p.id === Number(wanted))) throw new HttpError(400, 'Profil de qualité inconnu');
  return Number(wanted);
}

const isAnimeFolder = (p) => Boolean(p && /anim[eé]/i.test(String(p).replace(/\/+$/, '').split('/').pop() || ''));

/** Envoie une demande approuvée à Radarr / Sonarr. */
async function sendToArr(r) {
  if (r.type === 'movie') {
    const c = arrConfig('radarr');
    const existing = (await arr('radarr', `/movie?tmdbId=${r.tmdbId}`))[0];
    if (existing) {
      if (existing.hasFile) return;
      if (!existing.monitored) await arr('radarr', `/movie/${existing.id}`, { method: 'PUT', body: JSON.stringify({ ...existing, monitored: true }) });
      await arr('radarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [existing.id] }) });
      return;
    }
    const found = await arr('radarr', `/movie/lookup/tmdb?tmdbId=${r.tmdbId}`);
    r.rootFolderPath = await checkFolder('radarr', r.rootFolderPath);
    r.qualityProfileId = await checkProfile('radarr', r.qualityProfileId);
    await arr('radarr', '/movie', {
      method: 'POST',
      body: JSON.stringify({
        ...found,
        id: undefined,
        qualityProfileId: r.qualityProfileId,
        rootFolderPath: r.rootFolderPath,
        monitored: true,
        minimumAvailability: c.minimumAvailability || 'released',
        addOptions: { searchForMovie: c.searchOnAdd !== false, monitor: 'movieOnly' },
      }),
    });
    return;
  }

  const c = arrConfig('sonarr');
  if (!r.tvdbId) throw new HttpError(400, 'Identifiant TVDB manquant');
  const seasons = (r.seasons || []).map(Number).filter((n) => n > 0);
  const existing = (await arr('sonarr', `/series?tvdbId=${r.tvdbId}`))[0];
  if (existing) {
    const missing = seasons.filter((n) => !(existing.seasons.find((s) => s.seasonNumber === n) || {}).monitored);
    if (!missing.length) return;
    const set = new Set(missing);
    await arr('sonarr', `/series/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...existing, monitored: true, seasons: existing.seasons.map((s) => (set.has(s.seasonNumber) ? { ...s, monitored: true } : s)) }),
    });
    if (c.searchOnAdd !== false) {
      for (const n of missing)
        await arr('sonarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'SeasonSearch', seriesId: existing.id, seasonNumber: n }) });
    }
    return;
  }
  const list = await arr('sonarr', `/series/lookup?term=${encodeURIComponent(`tvdb:${r.tvdbId}`)}`);
  const found = list && list[0];
  if (!found) throw new HttpError(404, 'Série introuvable dans Sonarr');
  r.rootFolderPath = await checkFolder('sonarr', r.rootFolderPath);
  r.qualityProfileId = await checkProfile('sonarr', r.qualityProfileId);
  const wanted = new Set(seasons);
  await arr('sonarr', '/series', {
    method: 'POST',
    body: JSON.stringify({
      ...found,
      id: undefined,
      qualityProfileId: r.qualityProfileId,
      ...(c.languageProfileId ? { languageProfileId: c.languageProfileId } : {}),
      rootFolderPath: r.rootFolderPath,
      seasonFolder: c.seasonFolder !== false,
      monitored: true,
      seriesType: isAnimeFolder(r.rootFolderPath) ? 'anime' : found.seriesType || 'standard',
      seasons: found.seasons.map((s) => ({ seasonNumber: s.seasonNumber, monitored: wanted.has(s.seasonNumber) })),
      addOptions: {
        searchForMissingEpisodes: c.searchOnAdd !== false,
        searchForCutoffUnmetEpisodes: false,
        ignoreEpisodesWithFiles: true,
        ignoreEpisodesWithoutFiles: false,
      },
    }),
  });
}

// ——— Bibliothèque Radarr / Sonarr (cache 60 s) pour les statuts ———
let library = null;
let libraryAt = 0;
let libraryPending = null;

// ——— Contenu déjà présent dans Jellyfin (y compris ce qui n'est pas géré par Radarr / Sonarr) ———
let jfIndexToken = null;
async function loadJfIndex() {
  const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
  if (!token) return null;
  const get = async (types, fields) => {
    const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: types, Fields: fields, EnableImages: 'false', EnableUserData: 'false' });
    const r = await fetch(`${JELLYFIN_URL}/Items?${q}`, { headers: jfHeaders(token) });
    if (!r.ok) throw new Error(`Jellyfin HTTP ${r.status}`);
    return (await r.json()).Items || [];
  };
  const [items, seasons] = await Promise.all([get('Movie,Series', 'ProviderIds'), get('Season', 'ChildCount')]);
  const idx = { movies: new Set(), moviesImdb: new Set(), series: new Map(), seriesTvdb: new Map(), seriesById: new Map() };
  for (const i of items) {
    const p = i.ProviderIds || {};
    if (i.Type === 'Movie') {
      if (p.Tmdb) idx.movies.add(Number(p.Tmdb));
      if (p.Imdb) idx.moviesImdb.add(p.Imdb);
    } else if (i.Type === 'Series') {
      const set = new Set();
      idx.seriesById.set(i.Id, set);
      if (p.Tmdb) idx.series.set(Number(p.Tmdb), set);
      if (p.Tvdb) idx.seriesTvdb.set(Number(p.Tvdb), set);
    }
  }
  // Saisons qui ont au moins un épisode dans Jellyfin
  for (const s of seasons) {
    const set = idx.seriesById.get(s.SeriesId);
    if (set && s.IndexNumber > 0 && (s.ChildCount == null || s.ChildCount > 0)) set.add(s.IndexNumber);
  }
  return idx;
}
const jfSeasons = (lib, tmdbId, tvdbId) => (lib.jf && ((tvdbId && lib.jf.seriesTvdb.get(Number(tvdbId))) || lib.jf.series.get(tmdbId))) || null;

async function loadLibrary(force = false) {
  if (!force && library && Date.now() - libraryAt < 60_000) return library;
  if (libraryPending) return libraryPending;
  libraryPending = (async () => {
    const [movies, series] = await Promise.all([
      arrConfig('radarr') ? arr('radarr', '/movie').catch(() => null) : null,
      arrConfig('sonarr') ? arr('sonarr', '/series').catch(() => null) : null,
    ]);
    const lib = { movies: new Map(), seriesByTvdb: new Map(), seriesByTmdb: new Map() };
    for (const m of movies || []) lib.movies.set(m.tmdbId, { hasFile: Boolean(m.hasFile), monitored: Boolean(m.monitored) });
    for (const s of series || []) {
      const entry = {
        tvdbId: s.tvdbId,
        seasons: (s.seasons || []).map((x) => ({
          seasonNumber: x.seasonNumber,
          monitored: Boolean(x.monitored),
          files: (x.statistics && x.statistics.episodeFileCount) || 0,
          aired: (x.statistics && (x.statistics.totalEpisodeCount != null ? Math.min(x.statistics.totalEpisodeCount, x.statistics.episodeCount || x.statistics.totalEpisodeCount) : x.statistics.episodeCount)) || 0,
        })),
      };
      lib.seriesByTvdb.set(s.tvdbId, entry);
      if (s.tmdbId) lib.seriesByTmdb.set(s.tmdbId, entry);
    }
    lib.queueAt = Date.now();
    [lib.queue, lib.jf] = await Promise.all([
      queueIndex().catch(() => ({ movies: new Map(), series: new Map() })),
      loadJfIndex().catch(() => null),
    ]);
    library = lib;
    libraryAt = Date.now();
    return lib;
  })().finally(() => {
    libraryPending = null;
  });
  return libraryPending;
}

const activeReq = (r) => r.status === RequestStatus.PENDING || r.status === RequestStatus.APPROVED;

function seasonArrStatus(entry, n) {
  const s = entry && entry.seasons.find((x) => x.seasonNumber === n);
  if (!s) return MediaStatus.UNKNOWN;
  if (s.files > 0 && s.aired > 0 && s.files >= s.aired) return MediaStatus.AVAILABLE;
  if (s.files > 0) return MediaStatus.PARTIALLY_AVAILABLE;
  if (s.monitored) return MediaStatus.PROCESSING;
  return MediaStatus.UNKNOWN;
}

/** Statut d'un média (et de ses saisons), comme la fiche Seerr. */
function mediaStatus(lib, type, tmdbId, tvdbId, seasonNumbers) {
  const reqs = requests.filter((r) => r.type === type && r.tmdbId === tmdbId);
  if (type === 'movie') {
    const m = lib.movies.get(tmdbId);
    let status = MediaStatus.UNKNOWN;
    if ((m && m.hasFile) || (lib.jf && lib.jf.movies.has(tmdbId))) status = MediaStatus.AVAILABLE;
    else if (reqs.some((r) => r.status === RequestStatus.PENDING)) status = MediaStatus.PENDING;
    else if ((m && m.monitored) || reqs.some((r) => r.status === RequestStatus.APPROVED)) status = MediaStatus.PROCESSING;
    return { status, seasons: [] };
  }
  const entry = (tvdbId && lib.seriesByTvdb.get(Number(tvdbId))) || lib.seriesByTmdb.get(tmdbId);
  const inJf = jfSeasons(lib, tmdbId, tvdbId);
  const nums = seasonNumbers && seasonNumbers.length ? seasonNumbers : entry ? entry.seasons.map((s) => s.seasonNumber).filter((n) => n > 0) : inJf ? [...inJf] : [];
  const seasons = nums.map((n) => {
    let st = seasonArrStatus(entry, n);
    // Saison déjà dans Jellyfin mais inconnue de Sonarr (ajoutée à la main) : disponible, on ne la retélécharge pas
    if (st === MediaStatus.UNKNOWN && inJf && inJf.has(n)) st = MediaStatus.AVAILABLE;
    if (st === MediaStatus.UNKNOWN || st === MediaStatus.PROCESSING) {
      const r = reqs.find((x) => activeReq(x) && (x.seasons || []).includes(n));
      if (r && r.status === RequestStatus.PENDING && st === MediaStatus.UNKNOWN) st = MediaStatus.PENDING;
      else if (r) st = MediaStatus.PROCESSING;
    }
    return { seasonNumber: n, status: st };
  });
  let status = MediaStatus.UNKNOWN;
  if (seasons.length && seasons.every((s) => s.status === MediaStatus.AVAILABLE)) status = MediaStatus.AVAILABLE;
  else if (seasons.some((s) => s.status === MediaStatus.AVAILABLE || s.status === MediaStatus.PARTIALLY_AVAILABLE)) status = MediaStatus.PARTIALLY_AVAILABLE;
  else if (seasons.some((s) => s.status === MediaStatus.PROCESSING)) status = MediaStatus.PROCESSING;
  else if (seasons.some((s) => s.status === MediaStatus.PENDING)) status = MediaStatus.PENDING;
  return { status, seasons };
}

/** Une demande approuvée dont le média est arrivé passe à « Terminée ». */
function refreshCompleted(lib) {
  let changed = false;
  for (const r of requests) {
    if (r.status !== RequestStatus.APPROVED) continue;
    let done = false;
    if (r.type === 'movie') done = Boolean((lib.movies.get(r.tmdbId) || {}).hasFile);
    else {
      const entry = (r.tvdbId && lib.seriesByTvdb.get(Number(r.tvdbId))) || lib.seriesByTmdb.get(r.tmdbId);
      done = Boolean(entry) && (r.seasons || []).every((n) => seasonArrStatus(entry, n) === MediaStatus.AVAILABLE);
    }
    if (done) {
      r.status = RequestStatus.COMPLETED;
      r.completedAt = new Date().toISOString();
      changed = true;
      notify({ title: 'Disponible dans Jellyfin', message: `${r.title} · demandé par ${r.requestedBy.name}`, tags: ['tada'], image: r.poster });
      notifyFamily({ title: '🎉 Disponible', message: `${r.title} est prêt à regarder`, tags: ['tada'], image: r.poster, click: 'lumio://' });
    }
  }
  if (changed) saveRequests();
}

// Vérifie régulièrement l'arrivée des médias demandés
setInterval(() => {
  if (!requests.some((r) => r.status === RequestStatus.APPROVED)) return;
  loadLibrary(true).then(refreshCompleted).catch(() => {});
}, 2 * 60 * 1000);

// Nouvelle version de l'appli iOS publiée → notification push à l'admin (ntfy)
const APP_SOURCE = process.env.APP_SOURCE_URL || 'https://github.com/nono7444/lumio/releases/latest/download/altstore.json';
async function checkAppRelease() {
  try {
    const r = await fetch(APP_SOURCE);
    if (!r.ok) return;
    const app = ((await r.json()).apps || [])[0] || {};
    const v = (app.versions || [])[0] || {};
    const version = v.version || app.version;
    if (!version || version === config.lastAppVersion) return;
    const first = !config.lastAppVersion;
    config.lastAppVersion = version;
    saveConfig();
    if (first) return; // premier démarrage : on mémorise sans prévenir
    const notes = v.localizedDescription && !/^Build build-\d+$/.test(v.localizedDescription) ? `\n${v.localizedDescription}` : '';
    notify({ title: `Lumio ${version} est disponible`, message: `Mets à jour depuis FlareStore.${notes}`, tags: ['arrow_down'], click: 'lumio://settings' });
  } catch {}
}
setTimeout(checkAppRelease, 20_000);
setInterval(checkAppRelease, 30 * 60 * 1000);

/** État du téléchargement dans la file Radarr / Sonarr (pour voir ce qui bloque). */
function trackOf(rec) {
  const state = rec.trackedDownloadState || rec.status;
  const problem = rec.trackedDownloadStatus === 'warning' || rec.trackedDownloadStatus === 'error' || state === 'importBlocked' || state === 'failedPending' || state === 'failed' || Boolean(rec.errorMessage);
  const messages = [rec.errorMessage, ...((rec.statusMessages || []).flatMap((m) => m.messages || []))].filter(Boolean);
  const progress = rec.size > 0 ? Math.round((1 - rec.sizeleft / rec.size) * 100) : null;
  return {
    state: problem ? 'warning' : state === 'importPending' || state === 'importing' ? 'importing' : 'downloading',
    progress,
    message: problem ? messages[0] || 'Intervention manuelle nécessaire dans ' + (rec.movie ? 'Radarr' : 'Sonarr') : undefined,
    release: rec.title,
  };
}

async function queueIndex() {
  const out = { movies: new Map(), series: new Map() };
  const [rq, sq] = await Promise.all([
    arrConfig('radarr') ? arr('radarr', '/queue?page=1&pageSize=200&includeMovie=true').catch(() => null) : null,
    arrConfig('sonarr') ? arr('sonarr', '/queue?page=1&pageSize=500&includeSeries=true&includeEpisode=true').catch(() => null) : null,
  ]);
  for (const r of (rq && rq.records) || []) if (r.movie) out.movies.set(r.movie.tmdbId, trackOf(r));
  for (const r of (sq && sq.records) || []) {
    if (!r.series) continue;
    const list = out.series.get(r.series.tvdbId) || [];
    list.push({ season: r.episode ? r.episode.seasonNumber : null, ...trackOf(r) });
    out.series.set(r.series.tvdbId, list);
  }
  return out;
}

function downloadOf(r, lib) {
  if (!lib || !lib.queue || r.status !== RequestStatus.APPROVED) return undefined;
  if (r.type === 'movie') {
    const t = lib.queue.movies.get(r.tmdbId);
    if (t) return t;
  } else {
    const items = (lib.queue.series.get(Number(r.tvdbId)) || []).filter((x) => x.season == null || (r.seasons || []).includes(x.season));
    if (items.length) {
      const bad = items.find((x) => x.state === 'warning');
      if (bad) return bad;
      const avg = items.filter((x) => x.progress != null);
      return {
        state: items.some((x) => x.state === 'downloading') ? 'downloading' : 'importing',
        progress: avg.length ? Math.round(avg.reduce((n, x) => n + x.progress, 0) / avg.length) : null,
        count: items.length,
      };
    }
  }
  // Série : une partie des saisons est déjà là et le reste n'est trouvé nulle part → « Partiel » plutôt que « recherche »
  if (r.type === 'tv') {
    const asked = mediaStatus(lib, 'tv', r.tmdbId, r.tvdbId, r.seasons);
    const got = (x) => x.status === MediaStatus.AVAILABLE || x.status === MediaStatus.PARTIALLY_AVAILABLE;
    if (asked.seasons.some(got)) {
      // Compte sur toute la série (toutes ses saisons), pas seulement les saisons demandées
      const all = mediaStatus(lib, 'tv', r.tmdbId, r.tvdbId, null);
      const list = all.seasons.length >= asked.seasons.length ? all.seasons : asked.seasons;
      const have = list.filter((x) => x.status === MediaStatus.AVAILABLE).length;
      const some = list.filter((x) => x.status === MediaStatus.PARTIALLY_AVAILABLE).length;
      return { state: 'partial', available: have, partial: some, total: list.length };
    }
  }
  // Approuvée mais rien dans la file : Radarr / Sonarr cherche encore une release
  return { state: 'searching' };
}

function publicRequest(r, lib) {
  const media = lib ? mediaStatus(lib, r.type, r.tmdbId, r.tvdbId, r.type === 'tv' ? r.seasons : undefined) : null;
  return {
    ...r,
    mediaStatus: media ? media.status : MediaStatus.UNKNOWN,
    seasonStatuses: media ? media.seasons : [],
    download: downloadOf(r, lib),
  };
}

// ——— Accélérer les imports : Radarr / Sonarr ne regardent le client de téléchargement qu'une fois par minute ———
const lastRefresh = { radarr: 0, sonarr: 0 };
function refreshDownloads(kinds = ['radarr', 'sonarr'], minGap = 10_000) {
  for (const kind of kinds) {
    if (!arrConfig(kind) || Date.now() - lastRefresh[kind] < minGap) continue;
    lastRefresh[kind] = Date.now();
    arr(kind, '/command', { method: 'POST', body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }) }).catch(() => {});
  }
}

// Toutes les 20 s : un téléchargement fini attend d'être importé → on lance l'import tout de suite ;
// un élément vient de quitter la file (importé) → Jellyfin rescanne sans attendre son propre passage.
const queueSeen = { radarr: null, sonarr: null }; // Map id → titre (null avant le premier passage)
let jfRefreshAt = 0;
async function fastImportTick() {
  let imported = false;
  for (const kind of ['radarr', 'sonarr']) {
    if (!arrConfig(kind)) continue;
    let q;
    try {
      q = await arr(kind, '/queue?page=1&pageSize=200');
    } catch {
      continue;
    }
    const recs = q.records || [];
    const now = new Map(recs.map((r) => [r.downloadId || r.id, r.title || 'Téléchargement']));
    const before = queueSeen[kind];
    if (before) {
      for (const [id, t] of now)
        if (!before.has(id)) notify({ title: `⬇️ Téléchargement lancé · ${label(kind)}`, message: t, tags: ['arrow_down'], click: 'lumio://activity' });
      for (const [id, t] of before)
        if (!now.has(id)) {
          imported = true;
          notify({ title: `✅ Importé · ${label(kind)}`, message: t, tags: ['white_check_mark'], click: 'lumio://activity' });
        }
    }
    queueSeen[kind] = now;
    const waiting = recs.some(
      (r) => r.trackedDownloadState === 'importPending' || r.status === 'completed' || (r.size > 0 && r.sizeleft === 0 && r.trackedDownloadState !== 'importing')
    );
    if (waiting) refreshDownloads([kind], 20_000);
  }
  if (imported && Date.now() - jfRefreshAt > 30_000) {
    jfRefreshAt = Date.now();
    // Laisse le temps au déplacement / lien du fichier de se terminer
    setTimeout(() => {
      const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
      if (token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {});
      loadLibrary(true).then(refreshCompleted).catch(() => {});
    }, 8000);
  }
}
setInterval(() => fastImportTick().catch(() => {}), 20_000);

/** Relance la recherche d'une demande approuvée et dit si une version est partie en téléchargement. */
async function recheckRequest(r) {
  const kind = r.type === 'movie' ? 'radarr' : 'sonarr';
  let command;
  let match;
  if (r.type === 'movie') {
    const m = (await arr('radarr', `/movie?tmdbId=${r.tmdbId}`))[0];
    if (!m) {
      await sendToArr(r);
      return { found: false, message: 'Film renvoyé à Radarr, la recherche est lancée.' };
    }
    if (m.hasFile) return { found: true, available: true, message: 'Le film est déjà téléchargé, il arrive dans Jellyfin.' };
    command = { name: 'MoviesSearch', movieIds: [m.id] };
    match = (x) => x.movieId === m.id;
  } else {
    const ser = (await arr('sonarr', `/series?tvdbId=${r.tvdbId}`))[0];
    if (!ser) {
      await sendToArr(r);
      return { found: false, message: 'Série renvoyée à Sonarr, la recherche est lancée.' };
    }
    const seasons = (r.seasons || []).map(Number).filter((n) => n > 0);
    command = seasons.length === 1 ? { name: 'SeasonSearch', seriesId: ser.id, seasonNumber: seasons[0] } : { name: 'SeriesSearch', seriesId: ser.id };
    match = (x) => x.seriesId === ser.id && (!seasons.length || seasons.includes(x.seasonNumber ?? (x.episode && x.episode.seasonNumber)));
  }
  const cmd = await arr(kind, '/command', { method: 'POST', body: JSON.stringify(command) });
  let st = cmd;
  for (let i = 0; i < 40 && st && !['completed', 'failed', 'aborted', 'cancelled'].includes(st.status); i++) {
    await sleep(2000);
    st = await arr(kind, `/command/${cmd.id}`).catch(() => st);
  }
  if (st && st.status !== 'completed' && st.status !== 'started' && st.status !== 'queued')
    return { found: false, message: `${label(kind)} : recherche ${st.status === 'failed' ? 'en échec' : 'interrompue'}${st.message ? ` (${st.message})` : ''}` };
  const q = await arr(kind, `/queue?page=1&pageSize=200${kind === 'sonarr' ? '&includeEpisode=true' : ''}`).catch(() => ({ records: [] }));
  const hit = (q.records || []).find(match);
  if (hit) {
    loadLibrary(true).catch(() => {});
    return { found: true, message: `Trouvé : ${hit.title || 'une version'} part en téléchargement.` };
  }
  if (st && st.status !== 'completed') return { found: false, pending: true, message: `${label(kind)} cherche encore, regarde dans quelques minutes.` };
  return { found: false, message: `Toujours rien de disponible. ${label(kind)} continue de chercher tout seul régulièrement.` };
}

// ——— Collections : regroupe les films de Jellyfin par saga TMDB (« belongs_to_collection »), au moins 2 films ———
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const collCache = readJson(COLLECTIONS_FILE, { movies: {}, sets: {} }); // movies: tmdbId → { c: id|null, at }, sets: id → infos
let collectionsList = null;
let collectionsAt = 0;
let collectionsBuilding = false;
const tmdbKey = () => process.env.TMDB_KEY || config.tmdbKey || null;
async function tmdbGet(p2, params = {}) {
  const key = tmdbKey();
  if (!key) throw new Error('Clé TMDB manquante');
  const v4 = key.length > 40;
  const qs = new URLSearchParams({ language: 'fr-FR', ...params });
  if (!v4) qs.set('api_key', key);
  const r = await fetch(`https://api.themoviedb.org/3${p2}?${qs}`, { headers: v4 ? { Authorization: `Bearer ${key}` } : {} });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
  return r.json();
}
// Notes : complète l'identifiant IMDb des titres notés (pour les pastilles de Lumio TV), en arrière-plan
let ratingImdbFilling = false;
async function fillRatingImdb() {
  if (ratingImdbFilling || !tmdbKey()) return;
  const todo = Object.values(ratings).filter((e) => !e.imdb && !e.imdbChecked).slice(0, 25);
  if (!todo.length) return;
  ratingImdbFilling = true;
  try {
    for (const e of todo) {
      const ext = await tmdbGet(`/${e.type === 'tv' ? 'tv' : 'movie'}/${e.tmdbId}/external_ids`).catch(() => null);
      if (ext && ext.imdb_id) e.imdb = ext.imdb_id;
      else e.imdbChecked = true;
    }
    saveRatings();
  } finally {
    ratingImdbFilling = false;
  }
}

async function buildCollections() {
  if (collectionsBuilding || (collectionsList && Date.now() - collectionsAt < 6 * 3600_000)) return;
  const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
  if (!token || !tmdbKey()) return;
  collectionsBuilding = true;
  try {
    const qs = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie', Fields: 'ProviderIds,ProductionYear', EnableImages: 'false', EnableUserData: 'false' });
    const r = await fetch(`${JELLYFIN_URL}/Items?${qs}`, { headers: jfHeaders(token) });
    if (!r.ok) throw new Error(`Jellyfin HTTP ${r.status}`);
    const movies = ((await r.json()).Items || []).filter((m) => m.ProviderIds && m.ProviderIds.Tmdb);
    // Saga de chaque film (en cache ; on revérifie les films « sans saga » tous les 30 jours)
    const todo = movies.filter((m) => {
      const c = collCache.movies[m.ProviderIds.Tmdb];
      return !c || (c.c == null && Date.now() - c.at > 30 * 86400_000);
    });
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(
        todo.slice(i, i + 8).map(async (m) => {
          const d = await tmdbGet(`/movie/${m.ProviderIds.Tmdb}`).catch(() => undefined);
          if (d === undefined) return;
          const b = d && d.belongs_to_collection;
          collCache.movies[m.ProviderIds.Tmdb] = { c: b ? b.id : null, at: Date.now() };
        })
      );
      if (i % 80 === 0) writeJson(COLLECTIONS_FILE, collCache);
    }
    const groups = new Map();
    for (const m of movies) {
      const c = (collCache.movies[m.ProviderIds.Tmdb] || {}).c;
      if (!c) continue;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(m);
    }
    const out = [];
    for (const [id, list] of groups) {
      if (list.length < 2) continue;
      let set = collCache.sets[id];
      if (!set || Date.now() - set.at > 14 * 86400_000) {
        const d = await tmdbGet(`/collection/${id}`).catch(() => null);
        if (d) {
          set = {
            name: String(d.name || '').replace(/\s*[-–]\s*(Saga|Collection)$/i, '').replace(/^(Saga|Collection)\s+/i, '') || d.name,
            overview: d.overview || '',
            poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
            backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
            total: (d.parts || []).length,
            at: Date.now(),
          };
          collCache.sets[id] = set;
        }
      }
      if (!set) continue;
      out.push({
        id,
        name: set.name,
        overview: set.overview,
        poster: set.poster,
        backdrop: set.backdrop,
        total: set.total,
        items: list
          .map((m) => ({ jfId: m.Id, tmdbId: Number(m.ProviderIds.Tmdb), title: m.Name, year: m.ProductionYear || null }))
          .sort((a, b) => (a.year || 0) - (b.year || 0)),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    collectionsList = out;
    collectionsAt = Date.now();
    writeJson(COLLECTIONS_FILE, collCache);
  } finally {
    collectionsBuilding = false;
  }
}
setTimeout(() => buildCollections().catch(() => {}), 60_000);

// ——— File de téléchargement ———
async function queue() {
  const out = [];
  const errors = [];
  await Promise.all(
    ['radarr', 'sonarr'].map(async (kind) => {
      if (!arrConfig(kind)) return;
      try {
        const q = await arr(
          kind,
          kind === 'radarr' ? '/queue?page=1&pageSize=100&includeMovie=true' : '/queue?page=1&pageSize=100&includeSeries=true&includeEpisode=true'
        );
        for (const r of q.records || []) {
          out.push({
            id: r.id,
            source: kind,
            title: r.title,
            status: r.status,
            trackedDownloadState: r.trackedDownloadState,
            trackedDownloadStatus: r.trackedDownloadStatus,
            size: r.size,
            sizeleft: r.sizeleft,
            timeleft: r.timeleft,
            errorMessage: r.errorMessage,
            movie: r.movie ? { title: r.movie.title, tmdbId: r.movie.tmdbId, year: r.movie.year } : undefined,
            series: r.series ? { title: r.series.title, tvdbId: r.series.tvdbId, tmdbId: r.series.tmdbId } : undefined,
            episode: r.episode ? { seasonNumber: r.episode.seasonNumber, episodeNumber: r.episode.episodeNumber, title: r.episode.title } : undefined,
          });
        }
      } catch (e) {
        errors.push(String(e.message || e));
      }
    })
  );
  return { records: out, errors };
}

// ——— État des services ———
async function probe(url, headers) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const ms = Date.now() - start;
    if (!res.ok) return { ok: false, ms, error: res.status === 401 ? 'clé API refusée' : `HTTP ${res.status}` };
    return { ok: true, ms, body: await res.json().catch(() => null) };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e && e.name === 'AbortError' ? 'délai dépassé' : 'injoignable' };
  } finally {
    clearTimeout(t);
  }
}

async function status() {
  const out = { lumio: { ok: true, version: VERSION, pending: requests.filter((r) => r.status === RequestStatus.PENDING).length } };
  const jf = await probe(`${JELLYFIN_URL}/System/Info/Public`);
  out.jellyfin = { ok: jf.ok, ms: jf.ms, error: jf.error, version: jf.body && jf.body.Version, name: jf.body && jf.body.ServerName };
  await Promise.all(
    ['radarr', 'sonarr'].map(async (kind) => {
      const c = arrConfig(kind);
      if (!c) return (out[kind] = { ok: false, configured: false, error: 'non configuré' });
      const st = await probe(`${c.url}/api/v3/system/status`, { 'X-Api-Key': c.apiKey });
      const entry = { ok: st.ok, configured: true, ms: st.ms, error: st.error, version: st.body && st.body.version };
      if (st.ok) {
        try {
          entry.disks = (await folders(kind)).folders;
          const q = await arr(kind, '/queue?page=1&pageSize=1');
          entry.queue = q.totalRecords || 0;
        } catch {}
      }
      out[kind] = entry;
    })
  );
  return out;
}


// ——— Supervision façon UptimeRobot : historique des services (24 h) et état de la machine en direct ———
const UPTIME_FILE = path.join(DATA_DIR, 'uptime.json');
let uptime = readJson(UPTIME_FILE, {});
const UPTIME_KEEP = 7 * 24 * 12; // 7 jours, un point toutes les 5 min

async function recordUptime() {
  try {
    const st = await status();
    const t = Date.now();
    for (const key of ['lumio', 'jellyfin', 'radarr', 'sonarr']) {
      const e = st[key];
      if (!e || e.configured === false) continue;
      const list = (uptime[key] = uptime[key] || []);
      list.push({ t, ok: Boolean(e.ok), ms: e.ms || 0 });
      if (list.length > UPTIME_KEEP) list.splice(0, list.length - UPTIME_KEEP);
    }
    writeJson(UPTIME_FILE, uptime);
  } catch {}
}
setTimeout(recordUptime, 20_000);
setInterval(recordUptime, 5 * 60_000);

// Processeur, mémoire, température (lus dans /proc et /sys de la machine)
let cpuPrev = null;
const sysHistory = [];
function readCpu() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = line[3] + (line[4] || 0);
    const total = line.reduce((a, b) => a + b, 0);
    let pct = null;
    if (cpuPrev) pct = Math.max(0, Math.min(100, Math.round((1 - (idle - cpuPrev.idle) / (total - cpuPrev.total || 1)) * 100)));
    cpuPrev = { idle, total };
    return pct;
  } catch {
    return null;
  }
}
function readTemp() {
  let best = null;
  try {
    const base = '/sys/class/thermal';
    for (const z of fs.readdirSync(base).filter((d) => d.startsWith('thermal_zone'))) {
      try {
        const type = fs.readFileSync(`${base}/${z}/type`, 'utf8').trim();
        const v = Number(fs.readFileSync(`${base}/${z}/temp`, 'utf8').trim()) / 1000;
        if (!(v > 0 && v < 130)) continue;
        // Priorité au processeur (x86_pkg_temp, coretemp…)
        if (/x86_pkg|cpu|core|soc/i.test(type)) return Math.round(v);
        best = Math.max(best || 0, Math.round(v));
      } catch {}
    }
  } catch {}
  try {
    const hw = '/sys/class/hwmon';
    for (const h of fs.readdirSync(hw)) {
      const name = fs.readFileSync(`${hw}/${h}/name`, 'utf8').trim();
      if (!/coretemp|k10temp|cpu/i.test(name)) continue;
      const v = Number(fs.readFileSync(`${hw}/${h}/temp1_input`, 'utf8').trim()) / 1000;
      if (v > 0) return Math.round(v);
    }
  } catch {}
  return best;
}
function readMem() {
  try {
    const m = Object.fromEntries(
      fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => {
        const [k, v] = l.split(':');
        return [k, Number(String(v).trim().split(' ')[0]) * 1024];
      })
    );
    return { total: m.MemTotal, used: m.MemTotal - (m.MemAvailable ?? m.MemFree) };
  } catch {
    return null;
  }
}
// Débit internet : octets reçus / envoyés par seconde sur les cartes réseau de la machine
// (pour voir celles de l'hôte et pas seulement du conteneur, monter « /proc:/host/proc:ro »)
const NET_DEV = ['/host/proc/1/net/dev', '/proc/net/dev'].find((f) => {
  try {
    fs.accessSync(f);
    return true;
  } catch {
    return false;
  }
});
let netPrev = null;
function readNet() {
  try {
    let rx = 0;
    let tx = 0;
    for (const line of fs.readFileSync(NET_DEV, 'utf8').split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest) continue;
      const n = name.trim();
      if (/^(lo|docker|veth|br-|virbr|tun|wg)/.test(n)) continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }
    const t = Date.now();
    const out = netPrev ? { rx: Math.max(0, Math.round(((rx - netPrev.rx) * 1000) / (t - netPrev.t))), tx: Math.max(0, Math.round(((tx - netPrev.tx) * 1000) / (t - netPrev.t))) } : null;
    netPrev = { rx, tx, t };
    return out;
  } catch {
    return null;
  }
}
function sampleSystem() {
  const cpu = readCpu();
  if (cpu == null) return;
  const net = readNet();
  const s = { t: Date.now(), cpu, temp: readTemp(), rx: net ? net.rx : null, tx: net ? net.tx : null };
  sysHistory.push(s);
  if (sysHistory.length > 90) sysHistory.shift();
}
readCpu();
setInterval(sampleSystem, 2000);

let publicStatusCache = null;
let watchStatsCache = null;

const UPTIME_NAMES = { lumio: 'Serveur Lumio', jellyfin: 'Jellyfin', radarr: 'Radarr', sonarr: 'Sonarr' };
/** 24 barres d'une heure (1 = tout allait bien, 0,5 = coupure, 0 = hors ligne, -1 = pas de mesure) et % de disponibilité. */
function uptimeSummary(k) {
  const since = Date.now() - 24 * 3600_000;
  const hist = (uptime[k] || []).filter((x) => x.t >= since);
  const bars = [];
  for (let h = 23; h >= 0; h--) {
    const from = Date.now() - (h + 1) * 3600_000;
    const pts = hist.filter((x) => x.t >= from && x.t < from + 3600_000);
    bars.push(pts.length ? (pts.every((x) => x.ok) ? 1 : pts.some((x) => x.ok) ? 0.5 : 0) : -1);
  }
  const pct = hist.length ? Math.round((hist.filter((x) => x.ok).length / hist.length) * 1000) / 10 : null;
  return { uptime: pct, bars };
}

function publicIdea(i, user) {
  const { votes, ...rest } = i;
  return { ...rest, votes: votes.length, voted: votes.includes(user.id), mine: i.createdBy.id === user.id };
}

// ——— Chat ———
const LUMIO_BOT = { id: 'lumio', name: 'Lumio', admin: true };
// Anciennes annonces automatiques (demandes, validations…) : masquées, le chat sert juste à discuter
const AUTO_KINDS = new Set(['request', 'approved', 'declined', 'available', 'grab']);
const chatMessages = () => messages.filter((m) => !AUTO_KINDS.has(m.kind));

function cleanMedia(m) {
  if (!m || typeof m !== 'object') return undefined;
  const type = m.type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(m.tmdbId);
  if (!tmdbId) return undefined;
  return {
    type,
    tmdbId,
    title: String(m.title || '').slice(0, 200),
    year: m.year ? String(m.year).slice(0, 4) : undefined,
    poster: typeof m.poster === 'string' && /^https:\/\//.test(m.poster) ? m.poster.slice(0, 500) : undefined,
  };
}
const mediaOf = (r) => cleanMedia({ type: r.type, tmdbId: r.tmdbId, title: r.title, year: r.year, poster: r.poster });

function postMessage(user, text, media, kind) {
  const msg = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    userId: user.id,
    userName: user.name,
    admin: user.admin,
    text,
    media,
    kind,
    createdAt: new Date().toISOString(),
  };
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  saveMessages();
  if (!kind && user.id !== 'lumio')
    notifyFamily({
      title: `💬 ${user.name}`,
      message: text ? String(text).slice(0, 300) : media ? `Propose « ${media.title} »` : 'Nouveau message',
      tags: ['speech_balloon'],
      image: media && media.poster,
      click: 'lumio://chat',
    });
  return msg;
}

// ——— HTTP ———
function send(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Jellyfin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new HttpError(413, 'trop volumineux'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
  });
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined && o[k] !== '').map((k) => [k, o[k]]));

// ——— Disques et téléchargements AllDebrid (admin) ———
// Disques visibles par le serveur : LUMIO_DISKS="Films:/media/jellyfin1,Séries:/media/jellyfin2"
// (les dossiers doivent être montés dans le conteneur, voir README).
function disks() {
  const raw = process.env.LUMIO_DISKS || process.env.ROOT_DIRS || '';
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(':');
      const name = i > 0 ? x.slice(0, i) : path.basename(x);
      const dir = path.resolve(i > 0 ? x.slice(i + 1) : x);
      return { name, dir };
    })
    .filter((d) => fs.existsSync(d.dir));
}

/** Chemin absolu sûr à l'intérieur d'un disque (refuse « .. » et les liens qui sortent du disque). */
function safePath(rootName, rel) {
  const d = disks().find((x) => x.name === rootName);
  if (!d) throw new HttpError(404, 'disque inconnu');
  const full = path.resolve(d.dir, '.' + path.sep + String(rel || '').replace(/^\/+/, ''));
  if (full !== d.dir && !full.startsWith(d.dir + path.sep)) throw new HttpError(400, 'chemin interdit');
  return { root: d, full };
}

async function diskInfo(d) {
  try {
    const st = await fs.promises.statfs(d.dir);
    return { name: d.name, free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch {
    return { name: d.name, free: null, total: null };
  }
}

async function listDir(rootName, rel) {
  const { full } = safePath(rootName, rel);
  const entries = await fs.promises.readdir(full, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    let size = 0;
    let mtime = null;
    try {
      const st = await fs.promises.stat(path.join(full, e.name));
      size = st.size;
      mtime = st.mtime.toISOString();
    } catch {}
    out.push({ name: e.name, dir: e.isDirectory(), size, mtime });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'fr') : a.dir ? -1 : 1));
  return out;
}

// AllDebrid : la clé reste sur le serveur (jamais renvoyée à l'appli)
const AD_API = 'https://api.alldebrid.com';
async function ad(pathname, params = {}) {
  const key = process.env.ALLDEBRID_KEY || config.alldebridKey;
  if (!key) throw new HttpError(400, 'Clé AllDebrid non configurée');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => body.append(`${k}[]`, String(x)));
    else if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const r = await fetch(`${AD_API}${pathname}`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body });
  const j = await r.json().catch(() => null);
  if (!j || j.status !== 'success') throw new HttpError(502, `AllDebrid : ${(j && j.error && (j.error.message || j.error.code)) || `HTTP ${r.status}`}`);
  return j.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lien hébergeur / AllDebrid → lien direct (attend les liens « différés »). */
async function unlockLink(link, job) {
  const d = await ad('/v4/link/unlock', { link });
  if (d.link) return { url: d.link, name: d.filename, size: d.filesize };
  if (d.delayed) {
    for (let i = 0; i < 120 && !job.cancelled; i++) {
      await sleep(5000);
      const s = await ad('/v4/link/delayed', { id: d.delayed });
      if (s.status === 2 && s.link) return { url: s.link, name: d.filename, size: d.filesize };
      if (s.status === 3) throw new Error('AllDebrid : génération du lien impossible');
    }
  }
  throw new Error('AllDebrid : lien indisponible');
}

function flattenFiles(nodes, prefix = '') {
  const out = [];
  for (const n of nodes || []) {
    if (n.e) out.push(...flattenFiles(n.e, prefix ? `${prefix}/${n.n}` : n.n));
    else if (n.l) out.push({ rel: prefix ? `${prefix}/${n.n}` : n.n, link: n.l, size: n.s });
  }
  return out;
}

/** Magnet → attend que AllDebrid l'ait récupéré → liste des fichiers avec leurs liens. */
async function magnetFiles(magnet, job) {
  const up = await ad('/v4/magnet/upload', { magnets: [magnet] });
  const m = up.magnets && up.magnets[0];
  if (!m || m.error) throw new Error(`AllDebrid : ${(m && m.error && m.error.message) || 'magnet refusé'}`);
  job.name = m.name || job.name;
  for (let i = 0; i < 2880 && !job.cancelled; i++) {
    const st = await ad('/v4.1/magnet/status', { id: m.id });
    const info = Array.isArray(st.magnets) ? st.magnets[0] : st.magnets;
    if (info) {
      job.name = info.filename || job.name;
      if (info.statusCode === 4) break;
      if (info.statusCode >= 5) throw new Error(`AllDebrid : ${info.status || 'erreur'}`);
      job.status = 'debrid';
      job.size = info.size || job.size;
      job.done = info.downloaded || 0;
      job.speed = info.downloadSpeed || 0;
    }
    await sleep(job.done ? 5000 : 3000);
  }
  if (job.cancelled) return [];
  const f = await ad('/v4/magnet/files', { id: [m.id] });
  const mm = f.magnets && f.magnets[0];
  return flattenFiles(mm && mm.files);
}

const downloads = [];

async function downloadTo(url, dest, job) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const ctrl = new AbortController();
  job.abort = () => ctrl.abort();
  const r = await fetch(url, { signal: ctrl.signal });
  if (!r.ok || !r.body) throw new Error(`Téléchargement : HTTP ${r.status}`);
  const out = fs.createWriteStream(part);
  let last = Date.now();
  let lastBytes = job.done;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      job.done += value.length;
      const now = Date.now();
      if (now - last > 1000) {
        job.speed = Math.round(((job.done - lastBytes) * 1000) / (now - last));
        last = now;
        lastBytes = job.done;
      }
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  await fs.promises.rename(part, dest);
}

async function runDownload(job) {
  notify({ title: '⬇️ Téléchargement AllDebrid lancé', message: job.name || job.link.slice(0, 120), tags: ['arrow_down'], click: 'lumio://downloads' });
  try {
    const { full } = safePath(job.root, job.folder);
    let files;
    if (/^magnet:\?/i.test(job.link) || /^[a-f0-9]{40}$/i.test(job.link)) {
      job.status = 'debrid';
      files = await magnetFiles(job.link, job);
    } else {
      files = [{ rel: null, link: job.link }];
    }
    job.status = 'downloading';
    job.done = 0;
    const unlocked = [];
    for (const f of files) {
      if (job.cancelled) break;
      const u = await unlockLink(f.link, job);
      unlocked.push({ ...u, rel: f.rel || u.name });
    }
    job.size = unlocked.reduce((n, u) => n + (Number(u.size) || 0), 0) || job.size;
    if (unlocked.length === 1 && !job.name) job.name = unlocked[0].name;
    for (const u of unlocked) {
      if (job.cancelled) break;
      const rel = String(u.rel || 'fichier').replace(/\.\.+/g, '_');
      job.current = path.basename(rel);
      await downloadTo(u.url, path.join(full, rel), job);
    }
    if (job.cancelled) {
      job.status = 'cancelled';
      return;
    }
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    // Jellyfin voit les nouveaux fichiers tout de suite
    if (job.token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(job.token) }).catch(() => {});
    notify({ title: 'Téléchargement terminé', message: job.name || 'Fichier', tags: ['white_check_mark'] }).catch(() => {});
  } catch (e) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    job.error = String((e && e.message) || e);
  }
}


// Déplacements entre disques : copie avec progression (le pourcentage s'affiche dans l'appli), puis suppression
const moveJobs = [];
async function sizeOf(p) {
  const st = await fs.promises.stat(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of await fs.promises.readdir(p)) n += await sizeOf(path.join(p, e));
  return n;
}
async function copyWithProgress(from, to, job) {
  const st = await fs.promises.stat(from);
  if (st.isDirectory()) {
    await fs.promises.mkdir(to, { recursive: true });
    for (const e of await fs.promises.readdir(from)) await copyWithProgress(path.join(from, e), path.join(to, e), job);
    return;
  }
  await new Promise((resolve, reject) => {
    const r = fs.createReadStream(from);
    const w = fs.createWriteStream(to);
    r.on('data', (c) => (job.done += c.length));
    r.on('error', reject);
    w.on('error', reject);
    w.on('finish', resolve);
    r.pipe(w);
  });
}
async function runMove(job, from, to, token) {
  try {
    job.total = await sizeOf(from);
    await copyWithProgress(from, to, job);
    await fs.promises.rm(from, { recursive: true, force: true });
    job.status = 'done';
    if (token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {});
  } catch (e) {
    job.status = 'error';
    job.error = String((e && e.message) || e);
  }
  setTimeout(() => {
    const i = moveJobs.indexOf(job);
    if (i >= 0) moveJobs.splice(i, 1);
  }, 10 * 60 * 1000);
}

const publicJob = (j) => ({
  id: j.id, name: j.name, link: j.link.slice(0, 120), root: j.root, folder: j.folder, status: j.status,
  size: j.size || 0, done: j.done || 0, speed: j.speed || 0, current: j.current, error: j.error,
  createdAt: j.createdAt, finishedAt: j.finishedAt,
});

const requireAdmin = (user) => {
  if (!user.admin) throw new HttpError(403, 'réservé aux admins Jellyfin');
};

// ——— Identifiants : l'appli TV peut n'avoir que l'IMDb (catalogues Stremio) ———
const idCache = new Map();
async function resolveIds(type, b) {
  const tmdbId = Number(b.tmdbId) || 0;
  const tvdbId = Number(b.tvdbId) || 0;
  const imdbId = typeof b.imdbId === 'string' && /^tt\d+$/.test(b.imdbId) ? b.imdbId : '';
  if (type === 'movie') {
    if (tmdbId) return { tmdbId };
    if (!imdbId) throw new HttpError(400, 'Identifiant TMDB ou IMDb manquant');
    const key = `movie:${imdbId}`;
    if (!idCache.has(key)) {
      const m = await arr('radarr', `/movie/lookup/imdb?imdbId=${imdbId}`);
      const found = Array.isArray(m) ? m[0] : m;
      if (!found || !found.tmdbId) throw new HttpError(404, 'Film introuvable dans Radarr');
      idCache.set(key, { tmdbId: found.tmdbId, title: found.title, year: found.year, poster: posterOf(found) });
    }
    return idCache.get(key);
  }
  if (tmdbId && tvdbId) return { tmdbId, tvdbId };
  const key = `tv:${tmdbId || imdbId}`;
  if (!idCache.has(key)) {
    let found = null;
    for (const term of [tmdbId ? `tmdb:${tmdbId}` : null, imdbId ? `imdb:${imdbId}` : null].filter(Boolean)) {
      const list = await arr('sonarr', `/series/lookup?term=${encodeURIComponent(term)}`).catch(() => []);
      if (list && list[0] && list[0].tvdbId) {
        found = list[0];
        break;
      }
    }
    if (!found) throw new HttpError(404, 'Série introuvable dans Sonarr');
    idCache.set(key, {
      tmdbId: tmdbId || found.tmdbId,
      tvdbId: found.tvdbId,
      title: found.title,
      year: found.year,
      poster: posterOf(found),
      seasons: (found.seasons || []).map((x) => x.seasonNumber).filter((n) => n > 0),
    });
  }
  const r = idCache.get(key);
  if (!r.tmdbId) throw new HttpError(404, 'Pas d’identifiant TMDB pour cette série');
  return r;
}
function posterOf(item) {
  const img = (item.images || []).find((i) => i.coverType === 'poster');
  const url = img && (img.remoteUrl || img.url);
  return url && /^https:\/\//.test(url) ? url : undefined;
}

/** Crée une demande (POST /api/requests), avec les mêmes règles que Seerr. */
async function createRequest(user, b) {
  const type = b.type === 'tv' ? 'tv' : 'movie';
  if (!arrConfig(kindOf(type))) throw new HttpError(503, `${label(kindOf(type))} n'est pas configuré sur le serveur Lumio`);
  const ids = await resolveIds(type, b);
  const tmdbId = ids.tmdbId;
  b = {
    ...b,
    tmdbId,
    tvdbId: ids.tvdbId || b.tvdbId,
    title: b.title || ids.title,
    year: b.year || (ids.year ? String(ids.year) : undefined),
    poster: b.poster || ids.poster,
    seasons: Array.isArray(b.seasons) && b.seasons.length ? b.seasons : ids.seasons,
  };
  const perm = permissionsOf(user);
  const quota = quotaOf(user);
  const lib = await loadLibrary(true);
  const existing = requests.filter((r) => r.type === type && r.tmdbId === tmdbId && activeReq(r));

  let seasons = [];
  if (type === 'movie') {
    const m = lib.movies.get(tmdbId);
    if ((m && m.hasFile) || (lib.jf && lib.jf.movies.has(tmdbId))) throw new HttpError(409, 'Ce film est déjà disponible dans Jellyfin.');
    if (existing.length) throw new HttpError(409, 'Ce film a déjà été demandé.');
    if (quota.movie.remaining === 0) throw new HttpError(429, `Quota atteint : ${quota.movie.limit} film(s) tous les ${quota.movie.days} jours.`);
  } else {
    if (!Number(b.tvdbId)) throw new HttpError(400, 'Pas d’identifiant TVDB : Sonarr ne peut pas ajouter cette série.');
    const wanted = (Array.isArray(b.seasons) ? b.seasons : []).map(Number).filter((n) => n > 0);
    if (!wanted.length) throw new HttpError(400, 'Choisis au moins une saison.');
    const st = mediaStatus(lib, 'tv', tmdbId, b.tvdbId, wanted);
    // Saisons déjà disponibles ou déjà demandées : ignorées, comme dans Seerr
    seasons = st.seasons.filter((s) => s.status === MediaStatus.UNKNOWN).map((s) => s.seasonNumber);
    if (!seasons.length) throw new HttpError(409, 'Ces saisons sont déjà disponibles ou demandées.');
    if (quota.tv.remaining != null && seasons.length > quota.tv.remaining)
      throw new HttpError(429, `Quota atteint : il te reste ${quota.tv.remaining} saison(s) sur ${quota.tv.limit} tous les ${quota.tv.days} jours.`);
  }

  const r = {
    id: `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    type,
    tmdbId,
    tvdbId: type === 'tv' ? Number(b.tvdbId) : undefined,
    title: String(b.title || '').slice(0, 200),
    year: b.year ? String(b.year).slice(0, 4) : undefined,
    poster: typeof b.poster === 'string' && /^https:\/\//.test(b.poster) ? b.poster : undefined,
    backdrop: typeof b.backdrop === 'string' && /^https:\/\//.test(b.backdrop) ? b.backdrop : undefined,
    seasons: type === 'tv' ? seasons : undefined,
    status: RequestStatus.PENDING,
    requestedBy: { id: user.id, name: user.name },
    createdAt: new Date().toISOString(),
    rootFolderPath: b.rootFolderPath || undefined,
    qualityProfileId: user.admin && b.qualityProfileId ? Number(b.qualityProfileId) : undefined,
  };

  if (perm.autoApprove) {
    r.status = RequestStatus.APPROVED;
    r.modifiedBy = { id: user.id, name: user.name };
    r.modifiedAt = r.createdAt;
    try {
      await sendToArr(r);
    } catch (e) {
      r.status = RequestStatus.FAILED;
      r.error = String(e.message || e);
    }
  }
  requests.unshift(r);
  saveRequests();
  library = null;

  const what = type === 'tv' ? ` (${seasons.length > 1 ? `${seasons.length} saisons` : `saison ${seasons[0]}`})` : '';
  // Plus d'annonce dans le chat : notification push pour l'admin (sauf pour ses propres demandes)
  if (!user.admin || r.status === RequestStatus.FAILED) notifyRequest(r, what);
  notifyFamily({ title: `📥 ${user.name} a demandé`, message: `${r.title}${r.year ? ` (${r.year})` : ''}${what}`, tags: ['inbox_tray'], image: r.poster, click: 'lumio://activity' });
  return r;
}

async function approveRequest(admin, r, b) {
  if (r.status !== RequestStatus.PENDING && r.status !== RequestStatus.FAILED) throw new HttpError(409, 'Cette demande n’est pas en attente.');
  if (b.rootFolderPath) r.rootFolderPath = b.rootFolderPath;
  if (b.qualityProfileId) r.qualityProfileId = Number(b.qualityProfileId);
  r.modifiedBy = { id: admin.id, name: admin.name };
  r.modifiedAt = new Date().toISOString();
  try {
    await sendToArr(r);
    r.status = RequestStatus.APPROVED;
    delete r.error;
  } catch (e) {
    r.status = RequestStatus.FAILED;
    r.error = String(e.message || e);
  }
  saveRequests();
  library = null;
  return r;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health')
    return send(res, 200, {
      ok: true,
      version: VERSION,
      messages: messages.length,
      features: ['chat', 'requests', 'status', 'ideas', 'ratings', 'files'],
      radarr: Boolean(arrConfig('radarr')),
      sonarr: Boolean(arrConfig('sonarr')),
    });

  // État public pour le widget iOS : en ligne / hors ligne et compteurs seulement (aucun titre, aucune clé)
  if (url.pathname === '/status/public') {
    if (!publicStatusCache || Date.now() - publicStatusCache.at > 30_000) {
      const s = await status().catch(() => null);
      const pick = (k, x) =>
        x && x.configured !== false ? { ok: Boolean(x.ok), queue: typeof x.queue === 'number' ? x.queue : undefined, ms: x.ms || undefined, ...uptimeSummary(k) } : undefined;
      publicStatusCache = {
        at: Date.now(),
        body: s
          ? { lumio: { ok: true, version: VERSION, ...uptimeSummary('lumio') }, jellyfin: pick('jellyfin', s.jellyfin), radarr: pick('radarr', s.radarr), sonarr: pick('sonarr', s.sonarr), pending: s.lumio.pending }
          : { lumio: { ok: true, version: VERSION } },
      };
    }
    // Processeur et chaleur toujours frais (mesurés toutes les 2 s), sans détail sensible
    const last = sysHistory[sysHistory.length - 1] || {};
    return send(res, 200, { ...publicStatusCache.body, machine: { cpu: last.cpu ?? null, temp: last.temp ?? null }, at: new Date().toISOString() });
  }

  // Raccourci pour installer l'appli Android (téléphone)
  if (url.pathname === '/mac' || url.pathname === '/mac.dmg') {
    res.writeHead(302, { Location: 'https://github.com/nono7444/lumio/releases/latest/download/lumio-mac.dmg' });
    return res.end();
  }
  if (url.pathname === '/android' || url.pathname === '/android.apk') {
    res.writeHead(302, { Location: process.env.ANDROID_APK_URL || 'https://github.com/nono7444/lumio/releases/latest/download/lumio-android.apk' });
    return res.end();
  }

  // Page d'invitation : lien cliquable partout (WhatsApp, SMS…), qui ouvre Lumio et le configure
  if (url.pathname === '/invite') {
    const deep = `lumio://invite${url.search}`;
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const name = url.searchParams.get('name');
    const flare = process.env.FLARESTORE_URL || config.flarestoreUrl || '';
    const SOURCE = 'https://github.com/nono7444/lumio/releases/latest/download/altstore.json';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invitation Lumio</title><style>
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0B0D12;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:420px;padding:28px;text-align:center}h1{font-size:30px;margin:0 0 8px}p{color:#A1A1A6;line-height:1.5}
a.b{display:block;margin:12px 0;padding:15px;border-radius:14px;background:#fff;color:#000;text-decoration:none;font-weight:700}
a.s{background:#1C1C1E;color:#fff}ol{text-align:left;color:#A1A1A6;line-height:1.6;padding-left:20px}h2{font-size:18px;text-align:left;margin:26px 0 6px}b{color:#fff}.src{margin:8px 0;padding:10px;border-radius:10px;background:#1C1C1E;color:#fff;font-size:12px;word-break:break-all;text-align:left}ol a{color:#5AA2FF}</style></head><body><main>
<h1>Lumio</h1><p>${name ? `${esc(name)} t'invite sur son serveur.` : 'Tu es invité sur un serveur Lumio.'}</p>
<h2>📱 iPhone (avec FlareStore)</h2>
<ol><li>${flare ? `Installe <b>FlareStore</b> : <a href="${esc(flare)}">ouvrir le lien d'installation</a>.` : 'Installe <b>FlareStore</b> (demande le lien à la personne qui t\'invite).'}</li>
<li>Dans FlareStore, va dans <b>Sources</b>, touche <b>+</b> et colle cette adresse :<div class="src" id="src">${esc(SOURCE)}</div><a class="b s" href="#" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('src').textContent);this.textContent='Adresse copiée ✅';return false">Copier l'adresse de la source</a></li>
<li>Dans la source, installe <b>Lumio</b>. Les mises à jour arriveront ensuite toutes seules dans FlareStore.</li>
<li>Reviens sur cette page et touche « Ouvrir dans Lumio ».</li></ol>
<h2>🤖 Android</h2>
<ol><li>Touche « Installer sur Android », ouvre le fichier téléchargé et autorise l'installation si on te le demande.</li>
<li>Reviens sur cette page et touche « Ouvrir dans Lumio ».</li></ol>
<a class="b s" href="/android">Installer sur Android (APK)</a>
<h2>Ensuite</h2>
<p>« Ouvrir dans Lumio » règle les serveurs tout seul : il ne te reste qu'à entrer l'identifiant et le mot de passe qu'on t'a donnés.</p>
<a class="b" href="${esc(deep)}">Ouvrir dans Lumio</a>
</main></body></html>`);
  }

  // QR code de Lumio TV : ouvre l'appli Lumio du téléphone sur « Connecter la TV » avec le code
  if (url.pathname === '/tvlink') {
    const code = String(url.searchParams.get('code') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const deep = `lumio://connect-tv?code=${code}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecter la TV</title><style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0B0D12;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:420px;padding:28px;text-align:center}h1{font-size:28px;margin:0 0 8px}p{color:#A1A1A6;line-height:1.5}.code{font-size:40px;font-weight:900;letter-spacing:6px;margin:18px 0}
a.b{display:block;margin:14px 0;padding:16px;border-radius:14px;background:#fff;color:#000;text-decoration:none;font-weight:700}</style></head><body><main>
<h1>📺 Connecter la TV</h1><p>Lumio va s'ouvrir pour connecter la TV à ton compte.</p><div class="code">${code.replace(/(.{3})/g, '$1 ').trim()}</div>
<a class="b" href="${deep}">Ouvrir dans Lumio</a>
<p>Si rien ne s'ouvre : dans Lumio → Profil → « Connecter une TV », tape le code ci-dessus.</p>
<script>setTimeout(function(){location.href=${JSON.stringify(deep)}},300)</script>
</main></body></html>`);
  }

  // Raccourci pour installer l'appli TV : taper « lumio.tondomaine/tv » dans Downloader
  // Lumio TV : par défaut la version 32 bits (≈ 50 Mo), qui s'installe sur toutes les box et clés TV Android,
  // même les 64 bits ; l'APK universel (≈ 130 Mo) fait planter Downloader sur les petites box.
  // Lumio TV : même appli que l'iPhone, compilée pour Android TV (publiée avec chaque version de Lumio)
  if (url.pathname === '/tv' || url.pathname === '/tv.apk') {
    res.writeHead(302, { Location: process.env.TV_APK_URL || 'https://github.com/nono7444/lumio/releases/latest/download/lumio-tv.apk' });
    return res.end();
  }

  // Lumio TV (fork de NuvioTV, dépôt nono7444/lumio-tv) : /tvnuvio = 32 bits (toutes les box), /tvnuvio64 = 64 bits
  if (url.pathname === '/tvnuvio' || url.pathname === '/tvnuvio.apk' || url.pathname === '/tvnuvio64') {
    const file = url.pathname === '/tvnuvio64' ? 'lumio-tv-arm64-v8a.apk' : 'lumio-tv-armeabi-v7a.apk';
    res.writeHead(302, { Location: `https://github.com/nono7444/lumio-tv/releases/latest/download/${file}` });
    return res.end();
  }

  // Boutons « Valider » / « Refuser » des notifications push (signés, sans jeton Jellyfin)
  const hook = url.pathname.match(/^\/hooks\/(approve|decline)$/);
  if (hook && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    const sig = url.searchParams.get('sig') || '';
    const r = requests.find((x) => x.id === id);
    if (!r || sig !== sign(id, hook[1])) return send(res, 403, { error: 'lien invalide' });
    try {
      const admin = { id: 'push', name: 'Admin (notification)', admin: true };
      if (hook[1] === 'approve') await approveRequest(admin, r, {});
      else if (r.status === RequestStatus.PENDING) {
        r.status = RequestStatus.DECLINED;
        r.modifiedBy = { id: admin.id, name: admin.name };
        r.modifiedAt = new Date().toISOString();
        saveRequests();
      }
      return send(res, 200, { ok: true, status: r.status });
    } catch (e) {
      return send(res, 400, { error: String((e && e.message) || e) });
    }
  }

  // Lumio TV : au premier lancement, la TV demande l'adresse publique de Jellyfin
  if (url.pathname === '/tv/setup') {
    return send(res, 200, {
      name: 'Lumio',
      jellyfinUrl: process.env.PUBLIC_JELLYFIN_URL || config.publicJellyfinUrl || null,
      // Adresse locale (réseau de la maison) : la TV lit les vidéos en direct, sans passer par le tunnel
      localJellyfinUrl: process.env.LOCAL_JELLYFIN_URL || null,
    });
  }

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'introuvable' });

  const user = await whoAmI(req.headers['x-jellyfin-token']);
  if (!user) return send(res, 401, { error: 'jeton Jellyfin invalide' });

  // Adresse publique de Jellyfin vue depuis l'appli (pour configurer les TV) : on garde la dernière adresse https
  const seenJf = String(req.headers['x-jellyfin-url'] || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(seenJf) && !/^https:\/\/(localhost|127\.|192\.168\.|10\.)/i.test(seenJf) && config.publicJellyfinUrl !== seenJf) {
    config.publicJellyfinUrl = seenJf;
    saveConfig();
  }

  // Adresse publique du serveur (pour les boutons des notifications), vue depuis l'appli
  if (!process.env.PUBLIC_URL) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (String(host || '').includes('localhost') ? 'http' : 'https');
    if (host && !/^(localhost|127\.|192\.168\.|10\.)/.test(String(host))) {
      const found = `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
      if (config.publicUrl !== found) {
        config.publicUrl = found;
        saveConfig();
      }
    }
  }

  try {
    const p = url.pathname;
    const q = url.searchParams;

    // ——— Moi : droits et quotas ———
    if (req.method === 'GET' && p === '/api/me') {
      return send(res, 200, { id: user.id, name: user.name, admin: user.admin, permissions: permissionsOf(user), quota: quotaOf(user) });
    }

    // ——— Chat ———
    if (req.method === 'GET' && p === '/api/messages') {
      const after = q.get('after');
      const limit = Math.min(200, Number(q.get('limit')) || 100);
      const all = chatMessages();
      let list = all;
      if (after) {
        const idx = all.findIndex((m) => m.id === after);
        list = idx >= 0 ? all.slice(idx + 1) : all;
      }
      const { token, ...me } = user;
      return send(res, 200, { me, messages: list.slice(-limit) });
    }
    if (req.method === 'GET' && p === '/api/latest') {
      const all = chatMessages();
      const last = all[all.length - 1];
      return send(res, 200, { id: last ? last.id : null, at: last ? last.createdAt : null, from: last ? last.userId : null });
    }
    if (req.method === 'POST' && p === '/api/messages') {
      const body = await readBody(req);
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      const media = cleanMedia(body.media);
      if (!text && !media) return send(res, 400, { error: 'message vide' });
      return send(res, 201, postMessage(user, text, media));
    }
    const delMsg = p.match(/^\/api\/messages\/([\w-]+)$/);
    if (req.method === 'DELETE' && delMsg) {
      const idx = messages.findIndex((m) => m.id === delMsg[1]);
      if (idx < 0) return send(res, 404, { error: 'introuvable' });
      if (messages[idx].userId !== user.id && !user.admin) return send(res, 403, { error: 'interdit' });
      messages.splice(idx, 1);
      saveMessages();
      return send(res, 204);
    }

    // ——— Notes de la famille (étoiles + avis) ———
    if (req.method === 'GET' && p === '/api/ratings') {
      const key = `${q.get('type') === 'tv' ? 'tv' : 'movie'}:${Number(q.get('tmdbId'))}`;
      const entry = ratings[key];
      const votes = entry ? Object.entries(entry.votes) : [];
      const list = votes
        .map(([id, v]) => ({ name: v.name, stars: v.stars, comment: v.comment || undefined, at: v.at, mine: id === user.id }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const avg = list.length ? Math.round((list.reduce((n, v) => n + v.stars, 0) / list.length) * 10) / 10 : null;
      const mine = entry && entry.votes[user.id] ? { stars: entry.votes[user.id].stars, comment: entry.votes[user.id].comment || '' } : null;
      return send(res, 200, { avg, count: list.length, mine, list });
    }
    if (req.method === 'POST' && p === '/api/ratings') {
      const b = await readBody(req);
      const type = b.type === 'tv' ? 'tv' : 'movie';
      const tmdbId = Number(b.tmdbId);
      if (!tmdbId) throw new HttpError(400, 'tmdbId manquant');
      const key = `${type}:${tmdbId}`;
      const stars = Math.max(0, Math.min(10, Math.round(Number(b.stars) || 0)));
      const entry = ratings[key] || { type, tmdbId, title: '', poster: undefined, votes: {} };
      if (b.title) entry.title = String(b.title).slice(0, 200);
      if (typeof b.imdb === 'string' && /^tt\d+$/.test(b.imdb)) entry.imdb = b.imdb;
      if (typeof b.poster === 'string' && b.poster.startsWith('https://')) entry.poster = b.poster;
      if (!stars) delete entry.votes[user.id];
      else entry.votes[user.id] = { name: user.name, stars, comment: String(b.comment || '').trim().slice(0, 600) || undefined, at: new Date().toISOString() };
      if (Object.keys(entry.votes).length) ratings[key] = entry;
      else delete ratings[key];
      saveRatings();
      return send(res, 200, { ok: true });
    }
    // Résumé de toutes les notes (moyenne + nombre), pour les pastilles sur les affiches
    if (req.method === 'GET' && p === '/api/ratings/summary') {
      const items = {};
      for (const [key, e] of Object.entries(ratings)) {
        const v = Object.values(e.votes);
        if (!v.length) continue;
        items[key] = { avg: Math.round((v.reduce((n, x) => n + x.stars, 0) / v.length) * 10) / 10, count: v.length };
        // Lumio TV : mêmes notes, retrouvées par l'identifiant IMDb des affiches
        if (e.imdb) items[`imdb:${e.imdb}`] = items[key];
      }
      fillRatingImdb();
      return send(res, 200, { items });
    }
    // Coups de cœur : titres les mieux notés par la famille
    if (req.method === 'GET' && p === '/api/ratings/top') {
      const out = Object.values(ratings)
        .map((e) => {
          const v = Object.values(e.votes);
          return { type: e.type, tmdbId: e.tmdbId, title: e.title, poster: e.poster, count: v.length, avg: v.reduce((n, x) => n + x.stars, 0) / (v.length || 1) };
        })
        .filter((x) => x.count)
        .sort((a, b) => b.avg - a.avg || b.count - a.count)
        .slice(0, 30);
      return send(res, 200, { items: out });
    }

    // ——— Mode développeur : idées de fonctionnalités et bugs proposés par la famille ———
    if (req.method === 'GET' && p === '/api/ideas') {
      return send(res, 200, { ideas: ideas.map((i) => publicIdea(i, user)) });
    }
    if (req.method === 'POST' && p === '/api/ideas') {
      const b = await readBody(req);
      const title = String(b.title || '').trim().slice(0, 120);
      if (!title) return send(res, 400, { error: 'titre manquant' });
      const idea = {
        id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        kind: b.kind === 'bug' ? 'bug' : 'feature',
        title,
        details: String(b.details || '').trim().slice(0, 4000),
        status: 'new',
        createdBy: { id: user.id, name: user.name },
        createdAt: new Date().toISOString(),
        votes: [user.id],
      };
      // Signalement d'un problème sur un film / une série
      if (b.media && b.media.tmdbId) {
        idea.media = {
          type: b.media.type === 'tv' ? 'tv' : 'movie',
          tmdbId: Number(b.media.tmdbId),
          title: String(b.media.title || '').slice(0, 200),
          poster: typeof b.media.poster === 'string' && b.media.poster.startsWith('https://') ? b.media.poster : undefined,
        };
      }
      if (b.category) idea.category = String(b.category).slice(0, 40);
      ideas.unshift(idea);
      saveIdeas();
      if (!user.admin)
        notify({
          title: `${idea.media ? 'Problème signalé' : idea.kind === 'bug' ? 'Bug signalé' : 'Nouvelle idée'} · ${user.name}`,
          message: `${idea.title}${idea.details ? `\n${idea.details.slice(0, 200)}` : ''}`,
          tags: [idea.kind === 'bug' ? 'bug' : 'bulb'],
          click: 'lumio://ideas',
        });
      return send(res, 201, publicIdea(idea, user));
    }
    const ideaVote = p.match(/^\/api\/ideas\/([\w-]+)\/vote$/);
    if (req.method === 'POST' && ideaVote) {
      const idea = ideas.find((i) => i.id === ideaVote[1]);
      if (!idea) return send(res, 404, { error: 'introuvable' });
      idea.votes = idea.votes.includes(user.id) ? idea.votes.filter((v) => v !== user.id) : [...idea.votes, user.id];
      saveIdeas();
      return send(res, 200, publicIdea(idea, user));
    }
    const ideaOne = p.match(/^\/api\/ideas\/([\w-]+)$/);
    if (req.method === 'PUT' && ideaOne) {
      requireAdmin(user);
      const idea = ideas.find((i) => i.id === ideaOne[1]);
      if (!idea) return send(res, 404, { error: 'introuvable' });
      const b = await readBody(req);
      if (['new', 'planned', 'sent', 'done', 'rejected'].includes(b.status)) idea.status = b.status;
      if (typeof b.note === 'string') idea.note = b.note.trim().slice(0, 1000);
      idea.updatedAt = new Date().toISOString();
      saveIdeas();
      return send(res, 200, publicIdea(idea, user));
    }
    if (req.method === 'DELETE' && ideaOne) {
      const idx = ideas.findIndex((i) => i.id === ideaOne[1]);
      if (idx < 0) return send(res, 404, { error: 'introuvable' });
      if (ideas[idx].createdBy.id !== user.id && !user.admin) return send(res, 403, { error: 'interdit' });
      ideas.splice(idx, 1);
      saveIdeas();
      return send(res, 204);
    }

    // ——— Statut d'un média (fiche) ———
    if (req.method === 'GET' && p === '/api/media') {
      const type = q.get('type') === 'tv' ? 'tv' : 'movie';
      const ids = await resolveIds(type, { tmdbId: q.get('tmdbId'), tvdbId: q.get('tvdbId'), imdbId: q.get('imdbId') });
      const tmdbId = ids.tmdbId;
      let seasons = (q.get('seasons') || '').split(',').map(Number).filter((n) => n > 0);
      if (!seasons.length && ids.seasons) seasons = ids.seasons;
      let lib = await loadLibrary().catch(() => ({ movies: new Map(), seriesByTvdb: new Map(), seriesByTmdb: new Map() }));
      // Demande en cours de téléchargement : file d'attente rafraîchie toutes les 4 s pour un pourcentage en direct,
      // et bibliothèque relue (toutes les 15 s au plus) dès que le téléchargement a quitté la file, pour passer à « Disponible »
      const live = requests.find((r) => r.type === type && r.tmdbId === tmdbId && r.status === RequestStatus.APPROVED);
      if (live && lib.queue) {
        // Radarr / Sonarr ne relisent le client de téléchargement qu'une fois par minute : on les relance (toutes les 10 s au plus)
        refreshDownloads([type === 'movie' ? 'radarr' : 'sonarr']);
        if (Date.now() - (lib.queueAt || 0) > 2500) {
          lib.queue = await queueIndex().catch(() => lib.queue);
          lib.queueAt = Date.now();
        }
        if (['searching', 'partial'].includes(downloadOf(live, lib).state) && Date.now() - libraryAt > 15_000) lib = await loadLibrary(true).catch(() => lib);
      }
      refreshCompleted(lib);
      const st = mediaStatus(lib, type, tmdbId, ids.tvdbId || q.get('tvdbId'), seasons);
      const reqs = requests
        .filter((r) => r.type === type && r.tmdbId === tmdbId && r.status !== RequestStatus.COMPLETED)
        .map((r) => publicRequest(r, lib));
      return send(res, 200, { ...st, tmdbId, tvdbId: ids.tvdbId, requests: reqs });
    }

    // ——— Statuts pour les badges des affiches ———
    if (req.method === 'GET' && p === '/api/library') {
      const lib = await loadLibrary().catch(() => ({ movies: new Map(), seriesByTvdb: new Map(), seriesByTmdb: new Map() }));
      const movies = {};
      const series = {};
      for (const [id, m] of lib.movies) movies[id] = m.hasFile ? MediaStatus.AVAILABLE : m.monitored ? MediaStatus.PROCESSING : MediaStatus.UNKNOWN;
      for (const [id] of lib.seriesByTmdb) series[id] = mediaStatus(lib, 'tv', id, null, null).status;
      if (lib.jf) {
        for (const id of lib.jf.movies) movies[id] = MediaStatus.AVAILABLE;
        for (const [id] of lib.jf.series) if (!series[id] || series[id] === MediaStatus.UNKNOWN) series[id] = mediaStatus(lib, 'tv', id, null, null).status;
      }
      for (const r of requests.filter(activeReq)) {
        const target = r.type === 'movie' ? movies : series;
        if (!target[r.tmdbId] || target[r.tmdbId] === MediaStatus.UNKNOWN)
          target[r.tmdbId] = r.status === RequestStatus.PENDING ? MediaStatus.PENDING : MediaStatus.PROCESSING;
      }
      return send(res, 200, { movies, series });
    }

    // ——— Demandes ———
    if (req.method === 'GET' && p === '/api/requests') {
      const filter = q.get('filter') || 'all';
      const take = Math.min(100, Number(q.get('take')) || 30);
      const skip = Number(q.get('skip')) || 0;
      const lib = await loadLibrary().catch(() => null);
      if (lib) refreshCompleted(lib);
      const seeAll = user.admin || settings().usersSeeAllRequests;
      let list = requests.filter((r) => (seeAll && q.get('mine') !== '1') || r.requestedBy.id === user.id);
      const by = {
        all: () => true,
        pending: (r) => r.status === RequestStatus.PENDING,
        approved: (r) => r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED,
        processing: (r) => r.status === RequestStatus.APPROVED,
        available: (r) => r.status === RequestStatus.COMPLETED,
        declined: (r) => r.status === RequestStatus.DECLINED,
        failed: (r) => r.status === RequestStatus.FAILED,
      }[filter] || (() => true);
      list = list.filter(by);
      if (q.get('sort') === 'modified') list = [...list].sort((a, b) => Date.parse(b.modifiedAt || b.createdAt) - Date.parse(a.modifiedAt || a.createdAt));
      const counts = {
        pending: requests.filter((r) => r.status === RequestStatus.PENDING && (seeAll || r.requestedBy.id === user.id)).length,
      };
      return send(res, 200, { total: list.length, counts, results: list.slice(skip, skip + take).map((r) => publicRequest(r, lib)) });
    }

    if (req.method === 'POST' && p === '/api/requests') {
      const r = await createRequest(user, await readBody(req));
      return send(res, 201, publicRequest(r, await loadLibrary().catch(() => null)));
    }

    const one = p.match(/^\/api\/requests\/([\w-]+)(?:\/(approve|decline|retry|search))?$/);
    if (one) {
      const r = requests.find((x) => x.id === one[1]);
      if (!r) return send(res, 404, { error: 'demande introuvable' });
      const action = one[2];
      // « Relancer » : nouvelle recherche Radarr / Sonarr, puis on regarde si une version part en téléchargement
      if (req.method === 'POST' && action === 'search') {
        if (!user.admin && r.requestedBy.id !== user.id) return send(res, 403, { error: 'Ce n’est pas ta demande.' });
        if (r.status !== RequestStatus.APPROVED) return send(res, 409, { error: 'Cette demande n’est pas en cours.' });
        if (r.lastSearchAt && Date.now() - r.lastSearchAt < 45_000) return send(res, 429, { error: 'Recherche déjà lancée il y a moins d’une minute, patiente un peu.' });
        r.lastSearchAt = Date.now();
        return send(res, 200, await recheckRequest(r));
      }
      if (req.method === 'POST' && (action === 'approve' || action === 'retry')) {
        requireAdmin(user);
        return send(res, 200, publicRequest(await approveRequest(user, r, await readBody(req)), await loadLibrary().catch(() => null)));
      }
      if (req.method === 'POST' && action === 'decline') {
        requireAdmin(user);
        const b = await readBody(req);
        if (r.status !== RequestStatus.PENDING) return send(res, 409, { error: 'Cette demande n’est pas en attente.' });
        r.status = RequestStatus.DECLINED;
        r.reason = b.reason ? String(b.reason).slice(0, 300) : undefined;
        r.modifiedBy = { id: user.id, name: user.name };
        r.modifiedAt = new Date().toISOString();
        saveRequests();
        return send(res, 200, publicRequest(r, null));
      }
      if (req.method === 'DELETE' && !action) {
        // Comme Seerr : le demandeur peut annuler tant que c'est en attente ; l'admin peut tout supprimer
        if (!user.admin && !(r.requestedBy.id === user.id && r.status === RequestStatus.PENDING))
          return send(res, 403, { error: 'Seule une demande en attente peut être annulée.' });
        requests = requests.filter((x) => x.id !== r.id);
        saveRequests();
        return send(res, 204);
      }
    }

    // ——— Dossiers et profils (fenêtre de demande) ———
    if (req.method === 'GET' && p === '/api/arr/folders') return send(res, 200, await folders(kindOf(q.get('type'))));
    if (req.method === 'GET' && p === '/api/arr/options') {
      const kind = kindOf(q.get('type'));
      const [f, pr] = await Promise.all([folders(kind), user.admin ? profiles(kind) : null]);
      return send(res, 200, { ...f, profiles: pr ? pr.profiles : [], defaultProfile: pr ? pr.default : null, lockedProfile: pr ? pr.locked : null });
    }

    // ——— Message épinglé sur l'accueil (écrit par l'admin) ———
    if (p === '/api/announcement') {
      if (req.method === 'GET') return send(res, 200, { announcement: config.announcement || null });
      requireAdmin(user);
      if (req.method === 'DELETE') {
        config.announcement = null;
        saveConfig();
        return send(res, 200, { announcement: null });
      }
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const text = String(b.text || '').trim().slice(0, 2000);
        if (!text) return send(res, 400, { error: 'Message vide' });
        config.announcement = {
          id: crypto.randomBytes(6).toString('hex'),
          title: String(b.title || '').trim().slice(0, 120) || 'Message de la maison',
          text,
          kind: ['update', 'info', 'warning'].includes(b.kind) ? b.kind : 'info',
          by: user.name,
          at: new Date().toISOString(),
        };
        saveConfig();
        if (b.notify !== false) notifyFamily({ title: `📌 ${config.announcement.title}`, message: text.slice(0, 300), tags: ['pushpin'], click: 'lumio://' });
        return send(res, 200, { announcement: config.announcement });
      }
    }

    // ——— Pastille sur l'icône de l'appli : messages non lus, et pour l'admin demandes à valider + signalements ———
    if (req.method === 'GET' && p === '/api/badge') {
      const after = String(q.get('after') || '');
      const unread = chatMessages().filter((m) => m.userId !== user.id && (!after || m.createdAt > after));
      const pending = user.admin ? requests.filter((r) => r.status === RequestStatus.PENDING).length : 0;
      const problems = user.admin ? ideas.filter((i) => i.kind === 'bug' && i.status === 'new').length : 0;
      const last = unread[unread.length - 1];
      return send(res, 200, {
        unread: unread.length,
        pending,
        problems,
        total: unread.length + pending + problems,
        last: last ? { id: last.id, from: last.userName, text: String(last.text || '').slice(0, 200), at: last.createdAt } : null,
      });
    }

    // ——— Abonnement aux notifications de la famille (ntfy) ———
    if (req.method === 'GET' && p === '/api/notify/family') {
      return send(res, 200, { server: NTFY_SERVER, topic: config.familyTopic, enabled: config.ntfyEnabled !== false, adminTopic: user.admin ? ntfyTopic() : undefined });
    }

    // ——— Collections propres (sagas TMDB des films présents dans Jellyfin) ———
    // ——— Admin : actions sur le serveur (Paramètres → Serveur) ———
    // Jellyfin : redémarrage et scan via son API, avec le jeton de l'admin.
    // Machine : le conteneur ne peut pas redémarrer le PC lui-même ; il dépose une demande dans DATA_DIR/host-actions/,
    // qu'un petit service systemd de la machine surveille (voir README du serveur : lumio-host-actions).
    if (req.method === 'POST' && p === '/api/admin/jellyfin/scan') {
      requireAdmin(user);
      const r = await fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(user.token) });
      if (!r.ok) throw new HttpError(502, `Jellyfin a refusé le scan (HTTP ${r.status})`);
      return send(res, 200, { ok: true, message: 'Scan des bibliothèques lancé.' });
    }
    if (req.method === 'POST' && p === '/api/admin/jellyfin/restart') {
      requireAdmin(user);
      // Dans Docker, Jellyfin ne sait pas toujours se relancer lui-même : on passe alors par le service de la machine
      const r = await fetch(`${JELLYFIN_URL}/System/Restart`, { method: 'POST', headers: jfHeaders(user.token) }).catch(() => null);
      if (!r || !r.ok) {
        const dir = path.join(DATA_DIR, 'host-actions');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'restart-jellyfin'), new Date().toISOString());
      }
      return send(res, 200, { ok: true, message: 'Jellyfin redémarre (environ 1 minute).' });
    }
    if (req.method === 'POST' && p === '/api/admin/host/reboot') {
      requireAdmin(user);
      const dir = path.join(DATA_DIR, 'host-actions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'reboot'), JSON.stringify({ by: user.name, at: new Date().toISOString() }));
      console.log(`Redémarrage de la machine demandé par ${user.name}`);
      // Le service de la machine efface ce fichier en le prenant : s'il est encore là après 20 s, il n'est pas installé
      return send(res, 200, { ok: true, message: 'Redémarrage demandé : le serveur sera indisponible 2 à 3 minutes.' });
    }
    if (req.method === 'POST' && p === '/api/admin/server/update') {
      requireAdmin(user);
      const dir = path.join(DATA_DIR, 'host-actions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'update'), JSON.stringify({ by: user.name, at: new Date().toISOString(), from: VERSION }));
      console.log(`Mise à jour du serveur demandée par ${user.name}`);
      return send(res, 200, { ok: true, message: 'Mise à jour lancée : Lumio sera indisponible environ 1 minute.' });
    }
    if (req.method === 'GET' && p === '/api/admin/host/status') {
      requireAdmin(user);
      const pending = fs.existsSync(path.join(DATA_DIR, 'host-actions', 'reboot'));
      return send(res, 200, {
        rebootPending: pending,
        updatePending: fs.existsSync(path.join(DATA_DIR, 'host-actions', 'update')),
        helperInstalled: fs.existsSync(path.join(DATA_DIR, 'host-actions', '.helper')),
        version: VERSION,
      });
    }

    // ——— Live TV : sources IPTV / Stremio du compte (le téléphone les envoie, la TV les lit) ———
    if (p === '/api/live/sources') {
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const list = Array.isArray(b.sources) ? b.sources : [];
        liveSources[user.id] = list
          .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
          .slice(0, 20)
          .map((x) => ({ id: String(x.id || '').slice(0, 60), name: String(x.name || 'Source').slice(0, 80), kind: x.kind === 'stremio' ? 'stremio' : 'm3u', url: String(x.url).slice(0, 2000) }));
        saveLive();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET') return send(res, 200, { sources: liveSources[user.id] || [] });
    }

    if (req.method === 'GET' && p === '/api/collections') {
      if (q.get('refresh') === '1' && user.admin) collectionsAt = 0;
      buildCollections().catch((e) => console.log('Collections :', e.message));
      return send(res, 200, { building: collectionsBuilding, collections: collectionsList || [] });
    }

    if (req.method === 'GET' && p === '/api/queue') {
      refreshDownloads();
      return send(res, 200, await queue());
    }
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, await status());


    // ——— Clé TMDB partagée : l'admin la confie au serveur, la famille la reçoit automatiquement ———
    if (p === '/api/config/tmdb') {
      if (req.method === 'PUT') {
        requireAdmin(user);
        const b = await readBody(req);
        const key = String(b.key || '').trim();
        if (key && config.tmdbKey !== key) {
          config.tmdbKey = key;
          saveConfig();
        }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET') return send(res, 200, { key: process.env.TMDB_KEY || config.tmdbKey || null });
    }



    // ——— Statistiques de visionnage (admin) : qui regarde quoi, tops films et séries ———
    if (req.method === 'GET' && p === '/api/stats/watch') {
      requireAdmin(user);
      if (watchStatsCache && Date.now() - watchStatsCache.at < 10 * 60_000 && q.get('force') !== '1') return send(res, 200, watchStatsCache.data);
      const h = jfHeaders(user.token);
      const usersR = await fetch(`${JELLYFIN_URL}/Users`, { headers: h });
      if (!usersR.ok) throw new HttpError(502, `Jellyfin : HTTP ${usersR.status}`);
      const users = await usersR.json();
      const movies = new Map();
      const series = new Map();
      const perUser = [];
      const days = {};
      const since = Date.now() - 30 * 86400_000;
      await Promise.all(
        users.map(async (u) => {
          const r = await fetch(
            `${JELLYFIN_URL}/Users/${u.Id}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=1000&EnableImages=false&Fields=ProviderIds`,
            { headers: h }
          );
          if (!r.ok) return;
          const items = (await r.json()).Items || [];
          let minutes = 0;
          let nMovies = 0;
          let nEpisodes = 0;
          const recent = [];
          for (const it of items) {
            const plays = Math.max(1, (it.UserData && it.UserData.PlayCount) || 1);
            minutes += ((it.RunTimeTicks || 0) / 600_000_000) * plays;
            const last = it.UserData && it.UserData.LastPlayedDate ? Date.parse(it.UserData.LastPlayedDate) : 0;
            if (last >= since) {
              const d = new Date(last).toISOString().slice(0, 10);
              days[d] = (days[d] || 0) + 1;
            }
            if (it.Type === 'Movie') {
              nMovies++;
              const m = movies.get(it.Id) || { id: it.Id, title: it.Name, year: it.ProductionYear, tmdbId: it.ProviderIds && it.ProviderIds.Tmdb, viewers: [], plays: 0 };
              m.viewers.push(u.Name);
              m.plays += plays;
              movies.set(it.Id, m);
            } else {
              nEpisodes++;
              const key = it.SeriesId || it.SeriesName;
              const sr = series.get(key) || { id: it.SeriesId, title: it.SeriesName, viewers: new Set(), episodes: 0 };
              sr.viewers.add(u.Name);
              sr.episodes += 1;
              series.set(key, sr);
            }
            if (recent.length < 5 && last) recent.push({ title: it.Type === 'Episode' ? `${it.SeriesName} · S${it.ParentIndexNumber}E${it.IndexNumber}` : it.Name, at: new Date(last).toISOString() });
          }
          perUser.push({ name: u.Name, minutes: Math.round(minutes), movies: nMovies, episodes: nEpisodes, recent });
        })
      );
      const data = {
        users: perUser.sort((a, b) => b.minutes - a.minutes),
        topMovies: [...movies.values()].sort((a, b) => b.viewers.length - a.viewers.length || b.plays - a.plays).slice(0, 20),
        topSeries: [...series.values()]
          .map((x) => ({ id: x.id, title: x.title, viewers: [...x.viewers], episodes: x.episodes }))
          .sort((a, b) => b.episodes - a.episodes)
          .slice(0, 20),
        days: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n })),
      };
      watchStatsCache = { at: Date.now(), data };
      return send(res, 200, data);
    }

    // ——— Supervision (admin) : services façon UptimeRobot et machine en direct ———
    if (req.method === 'GET' && p === '/api/uptime') {
      requireAdmin(user);
      const st = await status();
      const services = Object.keys(UPTIME_NAMES)
        .filter((k) => st[k] && st[k].configured !== false)
        .map((k) => {
          const e = st[k];
          return { key: k, name: UPTIME_NAMES[k], ok: Boolean(e.ok), ms: e.ms || null, version: e.version || null, error: e.error || null, ...uptimeSummary(k) };
        });
      return send(res, 200, { services });
    }
    if (req.method === 'GET' && p === '/api/system') {
      requireAdmin(user);
      const last = sysHistory[sysHistory.length - 1] || {};
      let load = null;
      let up = null;
      try {
        load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
        up = Math.round(Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]));
      } catch {}
      return send(res, 200, {
        cpu: last.cpu ?? null,
        temp: last.temp ?? null,
        cores: require('os').cpus().length,
        load,
        uptime: up,
        mem: readMem(),
        disks: await Promise.all(disks().map(diskInfo)),
        history: sysHistory.map((x) => ({ cpu: x.cpu, temp: x.temp, rx: x.rx, tx: x.tx })),
        net: { rx: last.rx ?? null, tx: last.tx ?? null, host: NET_DEV === '/host/proc/1/net/dev' },
      });
    }

    // ——— Admin : disques et téléchargements AllDebrid ———
    if (p.startsWith('/api/files') || p.startsWith('/api/downloads') || p === '/api/alldebrid') {
      requireAdmin(user);
      if (req.method === 'GET' && p === '/api/alldebrid') {
        return send(res, 200, { configured: Boolean(process.env.ALLDEBRID_KEY || config.alldebridKey), disks: disks().length });
      }
      if (req.method === 'PUT' && p === '/api/alldebrid') {
        const b = await readBody(req);
        config.alldebridKey = String(b.key || '').trim() || undefined;
        saveConfig();
        return send(res, 200, { configured: Boolean(config.alldebridKey) });
      }
      // Recherche d'un fichier ou dossier par son nom, dans un disque (ou tous), jusqu'à 300 résultats
      if (req.method === 'GET' && p === '/api/files/search') {
        const term = String(q.get('q') || '').trim().toLowerCase();
        if (term.length < 2) return send(res, 200, { results: [] });
        const words = term.split(/\s+/).filter(Boolean);
        const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[._-]+/g, ' ');
        const wanted = words.map(norm);
        const roots = q.get('root') ? [q.get('root')] : disks().map((d) => d.name);
        const results = [];
        const started = Date.now();
        for (const rootName of roots) {
          const { full: base } = safePath(rootName, q.get('path') || '');
          const d = disks().find((x) => x.name === rootName);
          const stack = [base];
          while (stack.length && results.length < 300 && Date.now() - started < 8000) {
            const dir = stack.pop();
            let entries = [];
            try {
              entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
              continue;
            }
            for (const e of entries) {
              if (e.name.startsWith('.')) continue;
              const fullPath = path.join(dir, e.name);
              if (e.isDirectory()) stack.push(fullPath);
              const n = norm(e.name);
              if (wanted.every((w) => n.includes(w))) {
                let size = 0;
                try {
                  if (!e.isDirectory()) size = (await fs.promises.stat(fullPath)).size;
                } catch {}
                results.push({ root: rootName, path: path.relative(d.dir, fullPath), name: e.name, dir: e.isDirectory(), size });
                if (results.length >= 300) break;
              }
            }
          }
        }
        return send(res, 200, { results });
      }
      // « Voir dans le disque » : chemin d'un fichier Jellyfin → disque + dossier (mêmes montages que Jellyfin)
      if (req.method === 'GET' && p === '/api/files/locate') {
        const abs = path.resolve(String(q.get('path') || '/'));
        const d = disks().find((x) => abs === x.dir || abs.startsWith(x.dir + path.sep));
        if (!d) return send(res, 404, { error: 'Ce fichier n’est sur aucun disque connu du serveur Lumio' });
        const rel = path.relative(d.dir, abs);
        let isDir = false;
        try {
          isDir = (await fs.promises.stat(abs)).isDirectory();
        } catch {}
        return send(res, 200, { root: d.name, folder: isDir ? rel : path.dirname(rel) === '.' ? '' : path.dirname(rel), name: isDir ? null : path.basename(rel) });
      }
      if (req.method === 'GET' && p === '/api/files/disks') {
        return send(res, 200, { disks: await Promise.all(disks().map(diskInfo)) });
      }
      if (req.method === 'GET' && p === '/api/files') {
        return send(res, 200, { entries: await listDir(q.get('root'), q.get('path') || '') });
      }
      if (req.method === 'POST' && p === '/api/files/mkdir') {
        const b = await readBody(req);
        const { full } = safePath(b.root, b.path);
        await fs.promises.mkdir(full, { recursive: true });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/files/move') {
        // Renommer ou déplacer (y compris vers un autre disque)
        const b = await readBody(req);
        const from = safePath(b.root, b.from).full;
        const to = safePath(b.toRoot || b.root, b.to).full;
        if (fs.existsSync(to)) throw new HttpError(409, 'Un élément porte déjà ce nom');
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        try {
          await fs.promises.rename(from, to);
        } catch (e) {
          if (e.code !== 'EXDEV') throw e;
          // Autre disque : copie en arrière-plan avec pourcentage
          const job = { id: crypto.randomBytes(5).toString('hex'), name: path.basename(from), dest: b.toRoot || b.root, total: 0, done: 0, status: 'moving' };
          moveJobs.push(job);
          runMove(job, from, to, user.token);
          return send(res, 202, { ok: true, job: job.id });
        }
        if (user.token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(user.token) }).catch(() => {});
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/files/jobs') {
        return send(res, 200, { jobs: moveJobs.map(({ id, name, dest, total, done, status, error }) => ({ id, name, dest, total, done, status, error })) });
      }
      if (req.method === 'POST' && p === '/api/files/delete') {
        const b = await readBody(req);
        const { root, full } = safePath(b.root, b.path);
        if (full === root.dir) throw new HttpError(400, 'Impossible de supprimer le disque');
        await fs.promises.rm(full, { recursive: true, force: true });
        if (user.token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(user.token) }).catch(() => {});
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/downloads') {
        return send(res, 200, { downloads: downloads.map(publicJob).reverse() });
      }
      if (req.method === 'POST' && p === '/api/downloads') {
        const b = await readBody(req);
        const links = String(b.link || '').split(/\s+/).map((x) => x.trim()).filter(Boolean);
        if (!links.length) throw new HttpError(400, 'Lien manquant');
        safePath(b.root, b.folder || '');
        const created = links.map((link) => {
          const job = { id: crypto.randomBytes(5).toString('hex'), link, root: b.root, folder: b.folder || '', status: 'queued',
            name: '', size: 0, done: 0, speed: 0, token: user.token, createdAt: new Date().toISOString() };
          downloads.push(job);
          runDownload(job);
          return publicJob(job);
        });
        return send(res, 201, { downloads: created });
      }
      const dl = p.match(/^\/api\/downloads\/([\w-]+)$/);
      if (req.method === 'DELETE' && dl) {
        const i = downloads.findIndex((x) => x.id === dl[1]);
        if (i < 0) return send(res, 404, { error: 'introuvable' });
        const job = downloads[i];
        if (['queued', 'debrid', 'downloading'].includes(job.status)) {
          job.cancelled = true;
          if (job.abort) job.abort();
        } else downloads.splice(i, 1);
        return send(res, 200, { ok: true });
      }
    }

    // ——— Admin : utilisateurs (droits, quotas) ———
    if (req.method === 'GET' && p === '/api/admin/users') {
      requireAdmin(user);
      const r = await fetch(`${JELLYFIN_URL}/Users`, { headers: jfHeaders(user.token) });
      if (!r.ok) throw new HttpError(502, `Jellyfin : HTTP ${r.status}`);
      const list = await r.json();
      return send(res, 200, {
        settings: settings(),
        users: list.map((u) => {
          const fake = { id: u.Id, name: u.Name, admin: Boolean(u.Policy && u.Policy.IsAdministrator) };
          return {
            id: u.Id,
            name: u.Name,
            admin: fake.admin,
            permissions: permissionsOf(fake),
            custom: userPrefs[u.Id] || {},
            quota: quotaOf(fake),
            requestCount: requests.filter((x) => x.requestedBy.id === u.Id).length,
          };
        }),
      });
    }
    const userEdit = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (req.method === 'PUT' && userEdit) {
      requireAdmin(user);
      const b = await readBody(req);
      const cur = { ...(userPrefs[userEdit[1]] || {}) };
      for (const k of ['autoApprove', 'movieQuotaLimit', 'movieQuotaDays', 'tvQuotaLimit', 'tvQuotaDays']) {
        if (b[k] === null) delete cur[k];
        else if (b[k] !== undefined) cur[k] = k === 'autoApprove' ? Boolean(b[k]) : Math.max(0, Number(b[k]) || 0);
      }
      userPrefs[userEdit[1]] = cur;
      saveUsers();
      return send(res, 200, cur);
    }
    if (req.method === 'PUT' && p === '/api/admin/settings') {
      requireAdmin(user);
      const b = await readBody(req);
      if (b.defaultAutoApprove !== undefined) config.defaultAutoApprove = Boolean(b.defaultAutoApprove);
      if (b.usersSeeAllRequests !== undefined) config.usersSeeAllRequests = Boolean(b.usersSeeAllRequests);
      if (b.ntfyEnabled !== undefined) config.ntfyEnabled = Boolean(b.ntfyEnabled);
      if (typeof b.lockedProfile === 'string') config.lockedProfile = b.lockedProfile.trim();
      if (b.newNtfyTopic) config.ntfyTopic = `lumio-${crypto.randomBytes(8).toString('hex')}`;
      for (const k of ['defaultMovieQuotaLimit', 'defaultMovieQuotaDays', 'defaultTvQuotaLimit', 'defaultTvQuotaDays'])
        if (b[k] !== undefined) config[k] = Math.max(0, Number(b[k]) || 0);
      saveConfig();
      return send(res, 200, settings());
    }

    if (req.method === 'POST' && p === '/api/admin/notify-test') {
      requireAdmin(user);
      await notify({ title: 'Lumio', message: 'Les notifications fonctionnent ✅', tags: ['white_check_mark'] });
      return send(res, 200, { ok: true, topic: ntfyTopic() });
    }

    // ——— Admin : config Radarr / Sonarr envoyée depuis l'appli ———
    if (req.method === 'POST' && p === '/api/admin/arr') {
      requireAdmin(user);
      const b = await readBody(req);
      if (b.radarr) config.radarr = pick(b.radarr, ['url', 'apiKey', 'qualityProfileId', 'rootFolderPath', 'minimumAvailability', 'searchOnAdd']);
      if (b.sonarr) config.sonarr = pick(b.sonarr, ['url', 'apiKey', 'qualityProfileId', 'languageProfileId', 'rootFolderPath', 'seasonFolder', 'searchOnAdd']);
      delete config.alldebrid;
      saveConfig();
      library = null;
      return send(res, 200, await status());
    }

    return send(res, 404, { error: 'introuvable' });
  } catch (e) {
    const code = (e && e.status) || 400;
    return send(res, code, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log(`Serveur Lumio ${VERSION} sur le port ${PORT} (Jellyfin : ${JELLYFIN_URL})`));
