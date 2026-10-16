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
const MAX_MESSAGES = 3000;
const MAX_TEXT = 2000;
const VERSION = '3.4.0';

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

const timers = {};
function persist(file, getData) {
  clearTimeout(timers[file]);
  timers[file] = setTimeout(() => writeJson(file, getData()), 250);
}
const saveMessages = () => persist(MESSAGES_FILE, () => messages);
const saveRequests = () => persist(REQUESTS_FILE, () => requests);
const saveUsers = () => persist(USERS_FILE, () => userPrefs);
const saveIdeas = () => persist(IDEAS_FILE, () => ideas);
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
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const ntfyTopic = () => process.env.NTFY_TOPIC || config.ntfyTopic;
const publicUrl = () => (process.env.PUBLIC_URL || config.publicUrl || '').replace(/\/+$/, '');
const sign = (id, action) => crypto.createHmac('sha256', config.hookSecret).update(`${action}:${id}`).digest('hex').slice(0, 32);

async function notify({ title, message, tags, image, click, actions }) {
  if (config.ntfyEnabled === false || !ntfyTopic()) return;
  try {
    await fetch(NTFY_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}) },
      body: JSON.stringify({ topic: ntfyTopic(), title, message, tags, attach: image, click: click || 'lumio://activity', actions }),
    });
  } catch {}
}

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
  return {
    folders: list.map((f) => ({ path: f.path, freeSpace: f.freeSpace, accessible: f.accessible !== false })),
    default: c.rootFolderPath || (list[0] && list[0].path) || null,
  };
}

async function profiles(kind) {
  const list = await arr(kind, '/qualityprofile');
  const c = arrConfig(kind);
  return { profiles: list.map((p) => ({ id: p.id, name: p.name })), default: c.qualityProfileId || (list[0] && list[0].id) || null };
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
  const { profiles: list, default: def } = await profiles(kind);
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

let publicStatusCache = null;

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
      features: ['chat', 'requests', 'status', 'ideas'],
      radarr: Boolean(arrConfig('radarr')),
      sonarr: Boolean(arrConfig('sonarr')),
    });

  // État public pour le widget iOS : en ligne / hors ligne et compteurs seulement (aucun titre, aucune clé)
  if (url.pathname === '/status/public') {
    if (!publicStatusCache || Date.now() - publicStatusCache.at > 60_000) {
      const s = await status().catch(() => null);
      const pick = (x) => (x ? { ok: Boolean(x.ok), queue: typeof x.queue === 'number' ? x.queue : undefined } : undefined);
      publicStatusCache = {
        at: Date.now(),
        body: s ? { lumio: { ok: true, version: VERSION }, jellyfin: pick(s.jellyfin), radarr: pick(s.radarr), sonarr: pick(s.sonarr), pending: s.lumio.pending } : { lumio: { ok: true, version: VERSION } },
      };
    }
    return send(res, 200, publicStatusCache.body);
  }

  // Raccourci pour installer l'appli TV : taper « lumio.tondomaine/tv » dans Downloader
  if (url.pathname === '/tv' || url.pathname === '/tv.apk') {
    res.writeHead(302, { Location: process.env.TV_APK_URL || 'https://github.com/nono7444/lumio-tv/releases/latest/download/lumio-tv.apk' });
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

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'introuvable' });

  const user = await whoAmI(req.headers['x-jellyfin-token']);
  if (!user) return send(res, 401, { error: 'jeton Jellyfin invalide' });

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
      ideas.unshift(idea);
      saveIdeas();
      if (!user.admin)
        notify({
          title: `${idea.kind === 'bug' ? 'Bug signalé' : 'Nouvelle idée'} · ${user.name}`,
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
      const lib = await loadLibrary().catch(() => ({ movies: new Map(), seriesByTvdb: new Map(), seriesByTmdb: new Map() }));
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

    const one = p.match(/^\/api\/requests\/([\w-]+)(?:\/(approve|decline|retry))?$/);
    if (one) {
      const r = requests.find((x) => x.id === one[1]);
      if (!r) return send(res, 404, { error: 'demande introuvable' });
      const action = one[2];
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
      return send(res, 200, { ...f, profiles: pr ? pr.profiles : [], defaultProfile: pr ? pr.default : null });
    }

    if (req.method === 'GET' && p === '/api/queue') return send(res, 200, await queue());
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, await status());

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
