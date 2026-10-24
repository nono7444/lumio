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
const VERSION = '3.38.0';

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
    if (user.admin) jfAdminToken = token;
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
      console.log(`Radarr : ${r.title} déjà présent, surveillé, recherche lancée`);
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
        // Toujours chercher à l'ajout : une demande doit partir en téléchargement
        addOptions: { searchForMovie: true, monitor: 'movieOnly' },
      }),
    });
    console.log(`Radarr : ${r.title} ajouté dans ${r.rootFolderPath}, recherche lancée`);
    return;
  }

  const c = arrConfig('sonarr');
  if (!r.tvdbId) throw new HttpError(400, 'Identifiant TVDB manquant');
  const seasons = (r.seasons || []).map(Number).filter((n) => n > 0);
  const existing = (await arr('sonarr', `/series?tvdbId=${r.tvdbId}`))[0];
  if (existing) {
    const seasonOf = (n) => existing.seasons.find((s) => s.seasonNumber === n) || {};
    const missing = seasons.filter((n) => !seasonOf(n).monitored);
    if (missing.length || !existing.monitored) {
      const set = new Set(missing);
      await arr('sonarr', `/series/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...existing, monitored: true, seasons: existing.seasons.map((s) => (set.has(s.seasonNumber) ? { ...s, monitored: true } : s)) }),
      });
    }
    // Recherche lancée pour toutes les saisons demandées qui n'ont pas encore tous leurs épisodes
    // (avant : une saison déjà surveillée mais vide n'était jamais recherchée, la demande restait sans effet)
    const toSearch = seasons.filter((n) => {
      const st = seasonOf(n).statistics || {};
      return !(st.episodeFileCount > 0 && st.episodeFileCount >= (st.episodeCount || 0));
    });
    for (const n of toSearch)
      await arr('sonarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'SeasonSearch', seriesId: existing.id, seasonNumber: n }) });
    console.log(`Sonarr : ${r.title} — saisons ${seasons.join(', ')} surveillées, recherche lancée pour ${toSearch.join(', ') || 'aucune (déjà complètes)'}`);
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
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: false,
        ignoreEpisodesWithFiles: true,
        ignoreEpisodesWithoutFiles: false,
      },
    }),
  });
  console.log(`Sonarr : ${r.title} ajouté dans ${r.rootFolderPath} (saisons ${seasons.join(', ')}), recherche lancée`);
}

// ——— Bibliothèque Radarr / Sonarr (cache 60 s) pour les statuts ———
let library = null;
let libraryAt = 0;
let libraryPending = null;

// ——— Contenu déjà présent dans Jellyfin (y compris ce qui n'est pas géré par Radarr / Sonarr) ———
let jfIndexToken = null;
let jfAdminToken = null; // jeton d'un admin (sous-titres : il faut le droit de les gérer)
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
    const se = entry && entry.seasons.find((x) => x.seasonNumber === n);
    // Nombre d'épisodes présents / sortis : la fiche affiche « 6/10 épisodes » pour une saison partielle
    return se ? { seasonNumber: n, status: st, have: se.files, total: se.aired } : { seasonNumber: n, status: st };
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

// Demandes en échec (Radarr / Sonarr injoignable un instant…) : renvoyées automatiquement, 3 essais sur 24 h
setInterval(async () => {
  const day = Date.now() - 24 * 3600e3;
  for (const r of requests) {
    if (r.status !== RequestStatus.FAILED || Date.parse(r.createdAt) < day || (r.autoRetries || 0) >= 3) continue;
    r.autoRetries = (r.autoRetries || 0) + 1;
    try {
      await sendToArr(r);
      r.status = RequestStatus.APPROVED;
      delete r.error;
      console.log(`Demande « ${r.title} » renvoyée avec succès (essai ${r.autoRetries})`);
    } catch (e) {
      r.error = String(e.message || e);
    }
    saveRequests();
  }
}, 10 * 60_000);

// Vérifie régulièrement l'arrivée des médias demandés
setInterval(() => {
  if (!requests.some((r) => r.status === RequestStatus.APPROVED)) return;
  loadLibrary(true).then(refreshCompleted).catch(() => {});
}, 2 * 60 * 1000);

// ——— Suppression dans Jellyfin → suppression dans Radarr / Sonarr ———
// Un film ou une série supprimé(e) dans Jellyfin (fichiers effacés) restait dans Radarr / Sonarr, qui le retéléchargeait.
// Toutes les 10 minutes : ce qui était dans Jellyfin et n'y est plus, ET n'a plus aucun fichier dans Radarr / Sonarr,
// est retiré de Radarr / Sonarr (sans exclusion : on peut le redemander). Saison supprimée seule : elle n'est plus surveillée.
// Les demandes correspondantes sont closes : la fiche affiche de nouveau « Demander ».
// Garde-fous : rien si Jellyfin ne répond pas ou semble vide, et au plus 10 suppressions par passage (disque débranché…).
const JF_SEEN_FILE = path.join(DATA_DIR, 'jellyfin-seen.json');
let jfSeen = readJson(JF_SEEN_FILE, null); // { movies: [tmdbId], series: { tvdbId: [saisons] } }
async function syncJellyfinDeletions() {
  if (config.jfDeleteSync === false) return;
  const idx = await loadJfIndex().catch(() => null);
  if (!idx) return;
  const nowMovies = new Set(idx.movies);
  const nowSeries = new Map([...idx.seriesTvdb.entries()].map(([k, v]) => [Number(k), v]));
  const prev = jfSeen;
  jfSeen = { movies: [...nowMovies], series: Object.fromEntries([...nowSeries].map(([k, v]) => [k, [...v]])) };
  writeJson(JF_SEEN_FILE, jfSeen);
  if (!prev) return; // premier passage : on mémorise seulement
  const prevCount = prev.movies.length + Object.keys(prev.series).length;
  if (nowMovies.size + nowSeries.size < prevCount * 0.7) {
    console.log('Suppressions Jellyfin : bibliothèque soudain plus petite, rien n’est supprimé (Jellyfin en cours de scan ou disque absent ?)');
    jfSeen = prev;
    writeJson(JF_SEEN_FILE, prev);
    return;
  }
  const goneMovies = prev.movies.filter((id) => !nowMovies.has(id));
  const goneSeries = Object.keys(prev.series).map(Number).filter((id) => !nowSeries.has(id));
  const goneSeasons = [];
  for (const [id, now] of nowSeries) {
    const before = prev.series[id];
    if (before) for (const n of before) if (!now.has(n)) goneSeasons.push([id, n]);
  }
  if (!goneMovies.length && !goneSeries.length && !goneSeasons.length) return;
  if (goneMovies.length + goneSeries.length > 10) {
    console.log(`Suppressions Jellyfin : ${goneMovies.length + goneSeries.length} titres disparus d'un coup, rien n'est supprimé par sécurité`);
    return;
  }
  const closeRequests = (type, match) => {
    for (const r of requests) {
      if (r.type !== type || !match(r)) continue;
      if (r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED) {
        r.status = RequestStatus.COMPLETED;
        r.deletedAt = new Date().toISOString();
        r.closed = true;
      }
    }
  };
  const done = [];
  if (goneMovies.length && arrConfig('radarr')) {
    const movies = await arr('radarr', '/movie').catch(() => []);
    for (const tmdbId of goneMovies) {
      const m = movies.find((x) => x.tmdbId === tmdbId);
      if (m && m.hasFile) continue; // fichier encore là : Jellyfin le retrouvera au prochain scan
      if (m) await arr('radarr', `/movie/${m.id}?deleteFiles=false&addImportExclusion=false`, { method: 'DELETE' }).catch(() => null);
      closeRequests('movie', (r) => r.tmdbId === tmdbId);
      done.push(m ? m.title : `film ${tmdbId}`);
    }
  }
  if ((goneSeries.length || goneSeasons.length) && arrConfig('sonarr')) {
    const series = await arr('sonarr', '/series').catch(() => []);
    for (const tvdbId of goneSeries) {
      const sr = series.find((x) => x.tvdbId === tvdbId);
      if (sr && sr.statistics && sr.statistics.episodeFileCount > 0) continue;
      if (sr) await arr('sonarr', `/series/${sr.id}?deleteFiles=false&addImportListExclusion=false`, { method: 'DELETE' }).catch(() => null);
      closeRequests('tv', (r) => Number(r.tvdbId) === tvdbId || (sr && r.tmdbId === sr.tmdbId));
      done.push(sr ? sr.title : `série ${tvdbId}`);
    }
    // Saisons supprimées seules : plus surveillées (sinon Sonarr les retélécharge)
    const bySeries = new Map();
    for (const [id, n] of goneSeasons) bySeries.set(id, [...(bySeries.get(id) || []), n]);
    for (const [tvdbId, nums] of bySeries) {
      const sr = series.find((x) => x.tvdbId === tvdbId);
      if (!sr) continue;
      const off = nums.filter((n) => {
        const se = (sr.seasons || []).find((x) => x.seasonNumber === n);
        return se && se.monitored && !(se.statistics && se.statistics.episodeFileCount > 0);
      });
      if (!off.length) continue;
      const full = await arr('sonarr', `/series/${sr.id}`).catch(() => null);
      if (!full) continue;
      for (const se of full.seasons || []) if (off.includes(se.seasonNumber)) se.monitored = false;
      await arr('sonarr', `/series/${sr.id}`, { method: 'PUT', body: JSON.stringify(full) }).catch(() => null);
      closeRequests('tv', (r) => (Number(r.tvdbId) === tvdbId || r.tmdbId === sr.tmdbId) && (r.seasons || []).every((n) => off.includes(n)));
      done.push(`${sr.title} (saison${off.length > 1 ? 's' : ''} ${off.join(', ')})`);
    }
  }
  if (done.length) {
    saveRequests();
    libraryAt = 0; // statuts recalculés tout de suite : « Demander » réapparaît dans l'appli
    console.log(`Supprimé dans Jellyfin, retiré de Radarr / Sonarr : ${done.join(' · ')}`);
    notify({ title: 'Supprimé de Radarr / Sonarr', message: `Supprimé dans Jellyfin : ${done.join(', ')}`, tags: ['wastebasket'] });
  }
}
setTimeout(() => syncJellyfinDeletions().catch((e) => console.log('Suppressions Jellyfin :', e.message)), 60_000);
setInterval(() => syncJellyfinDeletions().catch((e) => console.log('Suppressions Jellyfin :', e.message)), 10 * 60_000);

// ——— Jellyfin : toutes les métadonnées et images remplacées par TMDB (Paramètres → Serveur sur iPhone) ———
async function jellyfinReplaceAllMetadata(token) {
  const r = await fetch(`${JELLYFIN_URL}/Library/VirtualFolders`, { headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé (HTTP ${r.status})`);
  const libs = (await r.json()).filter((l) => ['movies', 'tvshows', 'mixed', undefined, null, ''].includes(l.CollectionType) && l.ItemId);
  const q = new URLSearchParams({
    Recursive: 'true',
    MetadataRefreshMode: 'FullRefresh',
    ImageRefreshMode: 'FullRefresh',
    ReplaceAllMetadata: 'true',
    ReplaceAllImages: 'true',
  });
  let ok = 0;
  for (const l of libs) {
    const x = await fetch(`${JELLYFIN_URL}/Items/${l.ItemId}/Refresh?${q}`, { method: 'POST', headers: jfHeaders(token) }).catch(() => null);
    if (x && x.ok) ok++;
  }
  if (!ok) throw new HttpError(502, 'Jellyfin n’a lancé aucune actualisation');
  return libs.filter((l) => l.ItemId).map((l) => l.Name);
}

// ——— Sous-titres français (OpenSubtitles via le plugin « Open Subtitles » de Jellyfin) ———
// Recherche / téléchargement à la demande depuis le lecteur, et automatiquement pour les nouveaux films et épisodes
// sans sous-titres français (le fichier est enregistré par Jellyfin : il apparaît ensuite partout, TV comprise).
const subToken = () => process.env.JELLYFIN_API_KEY || jfAdminToken;
const FR_LANGS = new Set(['fre', 'fra', 'fr', 'french']);
async function jfItemStreams(token, itemId) {
  const r = await fetch(`${JELLYFIN_URL}/Items?Ids=${encodeURIComponent(itemId)}&Fields=MediaSources,MediaStreams,Path`, { headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé (HTTP ${r.status})`);
  const it = ((await r.json()).Items || [])[0];
  if (!it) throw new HttpError(404, 'Titre introuvable dans Jellyfin');
  const ms = (it.MediaSources || [])[0] || {};
  return { item: it, mediaSourceId: ms.Id || it.Id, streams: ms.MediaStreams || it.MediaStreams || [] };
}
const frSubs = (streams) => streams.filter((x) => x.Type === 'Subtitle' && FR_LANGS.has(String(x.Language || '').toLowerCase()));
async function searchFrSubtitles(token, itemId) {
  const r = await fetch(`${JELLYFIN_URL}/Items/${encodeURIComponent(itemId)}/RemoteSearch/Subtitles/fre?IsPerfectMatch=false`, { headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, r.status === 404 ? 'Recherche indisponible : installe le plugin « Open Subtitles » dans Jellyfin' : `Jellyfin a refusé (HTTP ${r.status})`);
  const list = (await r.json()) || [];
  return list
    .map((x) => ({
      id: x.Id,
      name: x.Name || x.Comment || 'Sous-titres',
      provider: x.ProviderName || '',
      format: x.Format || '',
      downloads: x.DownloadCount || 0,
      rating: x.CommunityRating || 0,
      hearingImpaired: Boolean(x.HearingImpaired),
      forced: Boolean(x.Forced),
      perfect: Boolean(x.IsHashMatch),
    }))
    .sort((a, b) => Number(b.perfect) - Number(a.perfect) || Number(a.hearingImpaired) - Number(b.hearingImpaired) || b.downloads - a.downloads)
    .slice(0, 30);
}
/** Télécharge le sous-titre dans Jellyfin et renvoie la piste créée (pour l'ajouter tout de suite au lecteur). */
async function downloadSubtitle(token, itemId, subtitleId) {
  const before = new Set(frSubs((await jfItemStreams(token, itemId)).streams).map((x) => x.Index));
  const r = await fetch(`${JELLYFIN_URL}/Items/${encodeURIComponent(itemId)}/RemoteSearch/Subtitles/${encodeURIComponent(subtitleId)}`, { method: 'POST', headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, `Téléchargement refusé par Jellyfin (HTTP ${r.status})`);
  // Jellyfin enregistre le fichier puis actualise le titre : on attend la nouvelle piste (20 s max)
  for (let i = 0; i < 10; i++) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const st = await jfItemStreams(token, itemId).catch(() => null);
    const added = st && frSubs(st.streams).find((x) => !before.has(x.Index) && x.IsExternal);
    if (added) return { mediaSourceId: st.mediaSourceId, index: added.Index, codec: added.Codec || 'srt', title: added.DisplayTitle || 'Français' };
  }
  return { mediaSourceId: null, index: null, pending: true };
}
// Automatique : nouveaux films / épisodes (7 derniers jours) sans sous-titres français ni audio français
const subTried = new Set();
async function autoFrenchSubtitles() {
  const token = subToken();
  if (!token || config.autoFrenchSubs === false) return;
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Episode', MinDateLastSaved: since, Fields: 'MediaStreams,DateCreated', SortBy: 'DateCreated', SortOrder: 'Descending', Limit: '60' });
  const r = await fetch(`${JELLYFIN_URL}/Items?${q}`, { headers: jfHeaders(token) });
  if (!r.ok) return;
  let done = 0;
  for (const it of (await r.json()).Items || []) {
    if (done >= 15 || subTried.has(it.Id)) continue;
    const streams = it.MediaStreams || [];
    const frAudio = streams.some((x) => x.Type === 'Audio' && FR_LANGS.has(String(x.Language || '').toLowerCase()));
    if (frSubs(streams).length || frAudio) continue;
    subTried.add(it.Id);
    const list = await searchFrSubtitles(token, it.Id).catch(() => []);
    const best = list.find((x) => !x.forced);
    if (!best) continue;
    await fetch(`${JELLYFIN_URL}/Items/${it.Id}/RemoteSearch/Subtitles/${encodeURIComponent(best.id)}`, { method: 'POST', headers: jfHeaders(token) }).catch(() => null);
    done++;
  }
  if (done) console.log(`Sous-titres français ajoutés automatiquement : ${done}`);
}
setTimeout(() => autoFrenchSubtitles().catch(() => {}), 3 * 60_000);
setInterval(() => autoFrenchSubtitles().catch(() => {}), 60 * 60_000);

// ——— Disques et nettoyage (Profil → Stockage) ———
// Espace des disques vu par Radarr / Sonarr, plus gros titres et ceux que personne n'a regardés.
async function diskSpace() {
  const lists = await Promise.all(
    ['radarr', 'sonarr'].map((k) => (arrConfig(k) ? arr(k, '/diskspace').catch(() => []) : []))
  );
  const byPath = new Map();
  for (const d of lists.flat()) {
    if (!d || !d.totalSpace || d.totalSpace < 20e9) continue; // petits volumes système ignorés
    const key = `${d.totalSpace}:${Math.round(d.freeSpace / 1e9)}`; // même disque monté à deux endroits
    if (![...byPath.values()].some((x) => x.key === key)) byPath.set(d.path, { key, path: d.path, label: d.label || d.path, free: d.freeSpace, total: d.totalSpace });
  }
  return [...byPath.values()].map(({ key, ...d }) => d).sort((a, b) => a.path.localeCompare(b.path));
}
let diskCache = null;
async function diskSummary() {
  if (diskCache && Date.now() - diskCache.at < 5 * 60_000) return diskCache.value;
  const value = await diskSpace().catch(() => []);
  diskCache = { at: Date.now(), value };
  return value;
}
/** Ce que chaque membre de la famille a regardé (films vus, séries entamées), via Jellyfin. */
async function watchedSets(token) {
  const out = { movies: new Map(), series: new Map() }; // tmdbId / tvdbId → date de dernière lecture
  const ur = await fetch(`${JELLYFIN_URL}/Users`, { headers: jfHeaders(token) });
  if (!ur.ok) return out;
  const users = await ur.json();
  const sr = await fetch(`${JELLYFIN_URL}/Items?Recursive=true&IncludeItemTypes=Series&Fields=ProviderIds&EnableImages=false`, { headers: jfHeaders(token) });
  const seriesIds = new Map(); // id Jellyfin → tvdb
  if (sr.ok) for (const x of (await sr.json()).Items || []) if (x.ProviderIds && x.ProviderIds.Tvdb) seriesIds.set(x.Id, Number(x.ProviderIds.Tvdb));
  const keep = (map, k, d) => {
    if (!k) return;
    const t = d ? Date.parse(d) : 0;
    if (!map.has(k) || map.get(k) < t) map.set(k, t);
  };
  for (const u of users) {
    const q = (types) => `${JELLYFIN_URL}/Users/${u.Id}/Items?Recursive=true&IncludeItemTypes=${types}&Filters=IsPlayed&Fields=ProviderIds&EnableImages=false`;
    const [m, e] = await Promise.all([
      fetch(q('Movie'), { headers: jfHeaders(token) }).then((r) => (r.ok ? r.json() : { Items: [] })).catch(() => ({ Items: [] })),
      fetch(q('Episode'), { headers: jfHeaders(token) }).then((r) => (r.ok ? r.json() : { Items: [] })).catch(() => ({ Items: [] })),
    ]);
    for (const x of m.Items || []) keep(out.movies, x.ProviderIds && Number(x.ProviderIds.Tmdb), x.UserData && x.UserData.LastPlayedDate);
    for (const x of e.Items || []) keep(out.series, seriesIds.get(x.SeriesId), x.UserData && x.UserData.LastPlayedDate);
  }
  return out;
}
async function storageReport(token) {
  const [disks, movies, series, watched] = await Promise.all([
    diskSpace(),
    arrConfig('radarr') ? arr('radarr', '/movie').catch(() => []) : [],
    arrConfig('sonarr') ? arr('sonarr', '/series').catch(() => []) : [],
    watchedSets(token).catch(() => ({ movies: new Map(), series: new Map() })),
  ]);
  const items = [];
  for (const m of movies) {
    if (!m.hasFile || !m.sizeOnDisk) continue;
    const last = watched.movies.get(m.tmdbId) || 0;
    items.push({ kind: 'radarr', id: m.id, type: 'movie', tmdbId: m.tmdbId, title: m.title, year: m.year, size: m.sizeOnDisk, added: m.added, watched: last > 0, lastPlayed: last ? new Date(last).toISOString() : null, poster: ((m.images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || null });
  }
  for (const sr of series) {
    const size = sr.statistics && sr.statistics.sizeOnDisk;
    if (!size) continue;
    const last = watched.series.get(sr.tvdbId) || 0;
    items.push({ kind: 'sonarr', id: sr.id, type: 'tv', tmdbId: sr.tmdbId, title: sr.title, year: sr.year, size, added: sr.added, watched: last > 0, lastPlayed: last ? new Date(last).toISOString() : null, poster: ((sr.images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || null });
  }
  const yearAgo = Date.now() - 365 * 86400e3;
  // À nettoyer : jamais regardé et ajouté il y a plus de 6 mois, ou plus regardé depuis un an
  const old = (x) => (!x.watched && Date.parse(x.added || 0) < Date.now() - 182 * 86400e3) || (x.watched && Date.parse(x.lastPlayed) < yearAgo);
  const candidates = items.filter(old).sort((a, b) => b.size - a.size).slice(0, 40);
  const biggest = [...items].sort((a, b) => b.size - a.size).slice(0, 25);
  return { disks, candidates, biggest, totalCandidates: candidates.reduce((n, x) => n + x.size, 0) };
}
// Alerte : un disque à moins de 10 % d'espace libre (une notification par jour au plus)
setInterval(async () => {
  const disks = await diskSpace().catch(() => []);
  const low = disks.filter((d) => d.free / d.total < 0.1);
  if (!low.length) return;
  const today = new Date().toISOString().slice(0, 10);
  if (config.lastDiskAlert === today) return;
  config.lastDiskAlert = today;
  saveConfig();
  notify({
    title: 'Disque presque plein',
    message: low.map((d) => `${d.label} : ${(d.free / 1e9).toFixed(0)} Go libres sur ${(d.total / 1e12).toFixed(1)} To`).join('\n') + '\nProfil → Stockage pour faire de la place.',
    tags: ['floppy_disk'],
    click: 'lumio://settings',
  });
}, 60 * 60_000);

// ——— Intro Skipper (extension Jellyfin qui repère intros, récaps et génériques) : installée depuis Lumio ———
const INTRO_SKIPPER_REPO = 'https://intro-skipper.org/manifest.json';
async function jfJson(token, p2, init = {}) {
  const r = await fetch(`${JELLYFIN_URL}${p2}`, { ...init, headers: { ...jfHeaders(token), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé ${p2} (HTTP ${r.status})`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function introSkipperStatus(token) {
  const plugins = (await jfJson(token, '/Plugins')) || [];
  const p = plugins.find((x) => /intro\s*skipper/i.test(x.Name || ''));
  return p ? { installed: true, version: p.Version, status: p.Status } : { installed: false };
}
/** Lance l'analyse des épisodes / films (tâches planifiées de l'extension). */
async function startIntroSkipperTasks(token) {
  const tasks = (await jfJson(token, '/ScheduledTasks').catch(() => [])) || [];
  const mine = tasks.filter((t) => /intro\s*skipper/i.test(t.Category || '') || /intro|credit|générique|recap/i.test(t.Name || ''));
  for (const t of mine.filter((t) => t.State !== 'Running')) await fetch(`${JELLYFIN_URL}/ScheduledTasks/Running/${t.Id}`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {});
  return mine.length;
}
async function installIntroSkipper(token) {
  const st = await introSkipperStatus(token);
  if (st.installed && st.status !== 'Restart') {
    const n = await startIntroSkipperTasks(token);
    return { ok: true, message: `Intro Skipper est déjà installé (version ${st.version}). Analyse relancée (${n} tâche${n > 1 ? 's' : ''}).` };
  }
  // 1) Dépôt de l'extension ajouté à Jellyfin (s'il n'y est pas)
  const repos = (await jfJson(token, '/Repositories')) || [];
  if (!repos.some((r) => (r.Url || '').includes('intro-skipper'))) {
    repos.push({ Name: 'Intro Skipper', Url: INTRO_SKIPPER_REPO, Enabled: true });
    await jfJson(token, '/Repositories', { method: 'POST', body: JSON.stringify(repos) });
  }
  // 2) Paquet trouvé dans le catalogue puis installé
  let pkg = null;
  for (let i = 0; i < 6 && !pkg; i++) {
    const list = (await jfJson(token, '/Packages').catch(() => [])) || [];
    pkg = list.find((x) => /intro\s*skipper/i.test(x.name || ''));
    if (!pkg) await new Promise((ok) => setTimeout(ok, 3000));
  }
  if (!pkg) throw new HttpError(502, 'Intro Skipper introuvable dans le catalogue de Jellyfin (Jellyfin 10.10 ou plus récent requis).');
  const q = new URLSearchParams({ assemblyGuid: pkg.guid, repositoryUrl: INTRO_SKIPPER_REPO });
  const r = await fetch(`${JELLYFIN_URL}/Packages/Installed/${encodeURIComponent(pkg.name)}?${q}`, { method: 'POST', headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, `Installation refusée par Jellyfin (HTTP ${r.status})`);
  // 3) Jellyfin redémarre pour charger l'extension, puis on lance l'analyse
  setTimeout(() => fetch(`${JELLYFIN_URL}/System/Restart`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {}), 15_000);
  setTimeout(() => startIntroSkipperTasks(token).then((n) => console.log(`Intro Skipper : analyse lancée (${n} tâches)`)).catch(() => {}), 150_000);
  console.log('Intro Skipper : installation lancée');
  return {
    ok: true,
    message: 'Intro Skipper s’installe : Jellyfin redémarre dans 15 s (1 minute de coupure), puis l’analyse de la bibliothèque démarre toute seule. Les boutons « Passer l’intro » apparaîtront au fur et à mesure.',
  };
}

// ——— Retrait d'une demande de Radarr / Sonarr (suppression d'une demande par l'admin) ———
// Film : téléchargements en cours annulés, film retiré de Radarr (fichiers gardés ou effacés).
// Série : saisons de la demande plus surveillées, téléchargements annulés, épisodes effacés si demandé ;
// série retirée de Sonarr s'il ne lui reste rien (aucune saison surveillée ni fichier).
async function removeFromArr(r, deleteFiles) {
  const kind = r.type === 'movie' ? 'radarr' : 'sonarr';
  if (!arrConfig(kind)) return null;
  const cancelQueue = async (match) => {
    const q = await arr(kind, '/queue?pageSize=500&includeUnknownMovieItems=false&includeUnknownSeriesItems=false').catch(() => null);
    let n = 0;
    for (const rec of (q && q.records) || []) {
      if (!match(rec)) continue;
      await arr(kind, `/queue/${rec.id}?removeFromClient=true&blocklist=false`, { method: 'DELETE' }).catch(() => null);
      n++;
    }
    return n;
  };
  if (kind === 'radarr') {
    const m = (await arr('radarr', `/movie?tmdbId=${r.tmdbId}`).catch(() => []))[0];
    if (!m) return 'Le film n’était plus dans Radarr.';
    const n = await cancelQueue((rec) => rec.movieId === m.id);
    await arr('radarr', `/movie/${m.id}?deleteFiles=${deleteFiles}&addImportExclusion=false`, { method: 'DELETE' });
    console.log(`Demande supprimée : « ${m.title} » retiré de Radarr${deleteFiles ? ' avec ses fichiers' : ''} (${n} téléchargement(s) annulé(s))`);
    return `${deleteFiles ? 'Film et fichiers supprimés' : 'Film retiré de Radarr (fichiers gardés)'}${n ? `, ${n} téléchargement${n > 1 ? 's' : ''} annulé${n > 1 ? 's' : ''}` : ''}.`;
  }
  const sr = r.tvdbId ? (await arr('sonarr', `/series?tvdbId=${r.tvdbId}`).catch(() => []))[0] : null;
  if (!sr) return 'La série n’était plus dans Sonarr.';
  const seasons = (r.seasons || []).map(Number);
  const n = await cancelQueue((rec) => rec.seriesId === sr.id && (!seasons.length || seasons.includes(rec.seasonNumber)));
  if (deleteFiles) {
    const files = (await arr('sonarr', `/episodefile?seriesId=${sr.id}`).catch(() => [])) || [];
    const ids = files.filter((f) => !seasons.length || seasons.includes(f.seasonNumber)).map((f) => f.id);
    if (ids.length) await arr('sonarr', '/episodefile/bulk', { method: 'DELETE', body: JSON.stringify({ episodeFileIds: ids }) }).catch(() => null);
  }
  const full = await arr('sonarr', `/series/${sr.id}`);
  for (const se of full.seasons || []) if (!seasons.length || seasons.includes(se.seasonNumber)) se.monitored = false;
  // Autres saisons encore utiles (surveillées ou avec des fichiers) : la série reste dans Sonarr ; sinon elle est retirée
  const stillUsed = (full.seasons || []).filter(
    (se) => se.seasonNumber > 0 && (seasons.length ? !seasons.includes(se.seasonNumber) : false) && (se.monitored || (se.statistics && se.statistics.episodeFileCount > 0))
  );
  if (!stillUsed.length) {
    await arr('sonarr', `/series/${sr.id}?deleteFiles=${deleteFiles}&addImportListExclusion=false`, { method: 'DELETE' });
    console.log(`Demande supprimée : « ${sr.title} » retirée de Sonarr${deleteFiles ? ' avec ses fichiers' : ''}`);
    return `${deleteFiles ? 'Série et fichiers supprimés' : 'Série retirée de Sonarr (fichiers gardés)'}${n ? `, ${n} téléchargement${n > 1 ? 's' : ''} annulé${n > 1 ? 's' : ''}` : ''}.`;
  }
  await arr('sonarr', `/series/${sr.id}`, { method: 'PUT', body: JSON.stringify(full) });
  const what = seasons.length ? `saison${seasons.length > 1 ? 's' : ''} ${seasons.join(', ')}` : 'série';
  console.log(`Demande supprimée : « ${sr.title} » ${what} plus surveillée(s)${deleteFiles ? ', épisodes effacés' : ''}`);
  return `${what[0].toUpperCase() + what.slice(1)} plus téléchargée${seasons.length > 1 ? 's' : ''}${deleteFiles ? ', épisodes effacés' : ''}${n ? `, ${n} téléchargement${n > 1 ? 's' : ''} annulé${n > 1 ? 's' : ''}` : ''}.`;
}

// ——— Liste « À voir » de chaque membre de la famille (films et séries à ne pas oublier) ———
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
let watchlists = readJson(WATCHLIST_FILE, {}); // userId → [{ type, tmdbId, title, year, poster, backdrop, addedAt }]
const saveWatchlists = () => persist(WATCHLIST_FILE, () => watchlists);

// ——— Séries sorties en « parties » (Lupin, La Casa de Papel…) : réparation de la numérotation dans Sonarr ———
// Netflix publie certaines saisons en plusieurs parties, et beaucoup de sorties sont numérotées par partie
// (« S02 » = 2e partie) alors que Sonarr / TheTVDB rangent les deux premières parties dans la saison 1.
// Sonarr range alors « S02E01 » (chapitre 6) à la place du 1er épisode de SA saison 2 (la partie 3).
// Les parties se repèrent toutes seules : épisodes d'une même saison sortis le même jour (mise en ligne d'un bloc).
// Un fichier n'est déplacé que si c'est sans ambiguïté : il vient d'un lot dont le nombre d'épisodes correspond
// à une partie et pas à la saison Sonarr. Déplacement fait par l'import manuel de Sonarr ; doublon : supprimé
// et sa sortie mise sur liste noire (Sonarr ne la reprendra plus).
function seriesParts(episodes) {
  const bySeason = new Map();
  for (const e of episodes) if (e.seasonNumber > 0) bySeason.set(e.seasonNumber, [...(bySeason.get(e.seasonNumber) || []), e]);
  const parts = [];
  let split = false;
  for (const n of [...bySeason.keys()].sort((a, b) => a - b)) {
    const eps = bySeason.get(n).sort((a, b) => a.episodeNumber - b.episodeNumber);
    const day = (e) => (e.airDateUtc || e.airDate || '').slice(0, 10);
    const batches = [];
    for (const e of eps) {
      const last = batches[batches.length - 1];
      if (last && day(last[last.length - 1]) === day(e) && day(e)) last.push(e);
      else batches.push([e]);
    }
    // Saison en parties : au moins 2 blocs, chacun d'au moins 2 épisodes sortis le même jour
    if (batches.length >= 2 && batches.every((b) => b.length >= 2)) {
      split = true;
      parts.push(...batches);
    } else parts.push(eps);
  }
  return split ? parts : null;
}
const SXXEYY = /S(\d{1,2})[ ._-]?E(\d{1,3})/i;
async function numberingPlan(series) {
  const [episodes, files] = await Promise.all([
    arr('sonarr', `/episode?seriesId=${series.id}`),
    arr('sonarr', `/episodefile?seriesId=${series.id}`),
  ]);
  const parts = seriesParts(episodes || []);
  if (!parts) return null;
  const seasonCount = (n) => (episodes || []).filter((e) => e.seasonNumber === n).length;
  const epByFile = new Map((episodes || []).filter((e) => e.episodeFileId).map((e) => [e.episodeFileId, e]));
  // Lots : fichiers importés ensemble (même saison, même groupe, même qualité, à 2 h près)
  const lotKey = (f) => [f.seasonNumber, f.releaseGroup || '', (f.quality && f.quality.quality && f.quality.quality.name) || '', Math.floor(Date.parse(f.dateAdded || 0) / 7.2e6)].join('|');
  const lots = new Map();
  for (const f of files || []) lots.set(lotKey(f), [...(lots.get(lotKey(f)) || []), f]);
  const moves = [];
  for (const f of files || []) {
    const cur = epByFile.get(f.id);
    const m = SXXEYY.exec(f.sceneName || '') || SXXEYY.exec((f.relativePath || '').split('/').pop() || '');
    if (!cur || !m) continue;
    const X = Number(m[1]);
    const Y = Number(m[2]);
    const part = parts[X - 1];
    const target = part && part[Y - 1];
    if (!target || (target.seasonNumber === cur.seasonNumber && target.episodeNumber === cur.episodeNumber)) continue;
    // Preuve : le lot compte autant d'épisodes que la partie X, et pas autant que la saison X de Sonarr
    const lot = lots.get(lotKey(f)) || [];
    if (!(lot.length === part.length && lot.length !== seasonCount(X))) continue;
    const occupied = (episodes || []).find((e) => e.id === target.id && e.hasFile && e.episodeFileId !== f.id);
    moves.push({
      fileId: f.id,
      path: f.path,
      from: `S${String(cur.seasonNumber).padStart(2, '0')}E${String(cur.episodeNumber).padStart(2, '0')}`,
      to: `S${String(target.seasonNumber).padStart(2, '0')}E${String(target.episodeNumber).padStart(2, '0')}`,
      targetEpisodeId: target.id,
      duplicate: Boolean(occupied),
      file: f,
    });
  }
  return { seriesId: series.id, title: series.title, parts: parts.length, moves };
}
async function applyNumbering(plan) {
  let moved = 0;
  let removed = 0;
  const toImport = plan.moves.filter((m) => !m.duplicate);
  // Doublons (l'épisode cible a déjà un fichier) : fichier mal rangé supprimé, sortie mise sur liste noire
  for (const m of plan.moves.filter((x) => x.duplicate)) {
    await arr('sonarr', `/episodefile/${m.fileId}`, { method: 'DELETE' }).catch(() => null);
    removed++;
  }
  if (plan.moves.some((x) => x.duplicate)) {
    const hist = await arr('sonarr', `/history/series?seriesId=${plan.seriesId}&eventType=grabbed`).catch(() => []);
    const bad = new Set(plan.moves.filter((x) => x.duplicate).map((x) => x.file.sceneName).filter(Boolean));
    for (const h of hist || []) if (bad.has(h.sourceTitle)) await arr('sonarr', `/history/failed/${h.id}`, { method: 'POST' }).catch(() => null);
  }
  if (toImport.length) {
    // L'import manuel de Sonarr rattache chaque fichier au bon épisode (et le renomme)
    const folders = [...new Set(toImport.map((m) => m.path.replace(/\/[^/]+$/, '')))];
    const items = [];
    for (const folder of folders) {
      const list = await arr('sonarr', `/manualimport?folder=${encodeURIComponent(folder)}&seriesId=${plan.seriesId}&filterExistingFiles=false`).catch(() => []);
      items.push(...(list || []));
    }
    const files = [];
    for (const m of toImport) {
      const it = items.find((x) => x.path === m.path);
      files.push({
        path: m.path,
        seriesId: plan.seriesId,
        episodeIds: [m.targetEpisodeId],
        quality: (it && it.quality) || m.file.quality,
        languages: (it && it.languages) || m.file.languages || [],
        releaseGroup: m.file.releaseGroup || (it && it.releaseGroup) || '',
        indexerFlags: 0,
        releaseType: 'singleEpisode',
      });
    }
    await arr('sonarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'ManualImport', importMode: 'move', files }) });
    moved = files.length;
  }
  if (moved || removed) {
    console.log(`Numérotation « ${plan.title} » : ${moved} épisode(s) remis à leur place, ${removed} doublon(s) supprimé(s)`);
    library = null;
  }
  return { moved, removed };
}
async function seriesByTvdbOrTmdb(tvdbId, tmdbId) {
  if (tvdbId) return (await arr('sonarr', `/series?tvdbId=${tvdbId}`).catch(() => []))[0] || null;
  const all = await arr('sonarr', '/series').catch(() => []);
  return (all || []).find((x) => x.tmdbId === tmdbId) || null;
}
// Passage automatique : toutes les 6 h (et 10 min après le démarrage), sur toutes les séries de Sonarr
async function autoFixNumbering() {
  if (!arrConfig('sonarr') || config.autoFixNumbering === false) return;
  const all = (await arr('sonarr', '/series').catch(() => [])) || [];
  const fixed = [];
  for (const sr of all) {
    if (!sr.statistics || !sr.statistics.episodeFileCount) continue;
    const plan = await numberingPlan(sr).catch(() => null);
    if (!plan || !plan.moves.length) continue;
    const r = await applyNumbering(plan).catch((e) => (console.log(`Numérotation « ${sr.title} » :`, e.message), null));
    if (r && (r.moved || r.removed)) fixed.push(`${sr.title} (${r.moved + r.removed} épisode${r.moved + r.removed > 1 ? 's' : ''})`);
  }
  if (fixed.length) notify({ title: 'Épisodes remis dans l’ordre', message: fixed.join(', '), tags: ['wrench'] });
}
setTimeout(() => autoFixNumbering().catch(() => {}), 10 * 60_000);
setInterval(() => autoFixNumbering().catch(() => {}), 6 * 3600_000);

// ——— Changer le numéro d'une saison (fiche Jellyfin, admin) : ex. « Saison 3 » qui est en fait la saison 2 ———
// Sonarr gère les fichiers : chaque épisode SxxEyy est rattaché à S(to)Eyy par l'import manuel de Sonarr (qui renomme).
// Sinon : renommage direct sur le disque (dossier « Season 03 » → « Season 02 », S03E05 → S02E05, sous-titres compris).
// Ensuite Jellyfin réactualise la série.
async function jfSeriesRefresh(token, seriesId) {
  const q = new URLSearchParams({ Recursive: 'true', MetadataRefreshMode: 'FullRefresh', ImageRefreshMode: 'Default', ReplaceAllMetadata: 'true', ReplaceAllImages: 'false' });
  await fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {});
  setTimeout(() => fetch(`${JELLYFIN_URL}/Items/${seriesId}/Refresh?${q}`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {}), 25_000);
}
/** Chemin vu par Jellyfin (/media/jellyfin1/SERIES/…) → chemin vu par le serveur Lumio (disques LUMIO_DISKS). */
function localPath(jfPath) {
  if (!jfPath) return null;
  if (fs.existsSync(jfPath)) return jfPath;
  const parts = jfPath.split('/');
  for (const d of disks()) {
    for (const key of [d.name, path.basename(d.dir)]) {
      const i = parts.indexOf(key);
      if (i < 0) continue;
      const candidate = path.join(d.dir, ...parts.slice(i + 1));
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
async function renumberSeason(token, { jfSeriesId, from, to }) {
  from = Number(from);
  to = Number(to);
  if (!(from >= 0) || !(to >= 0) || from === to) throw new HttpError(400, 'Numéros de saison invalides');
  const it = ((await jfJson(token, `/Items?Ids=${encodeURIComponent(jfSeriesId)}&Fields=ProviderIds,Path`)) || {}).Items?.[0];
  if (!it) throw new HttpError(404, 'Série introuvable dans Jellyfin');
  const tvdbId = Number((it.ProviderIds || {}).Tvdb) || null;
  const tmdbId = Number((it.ProviderIds || {}).Tmdb) || null;
  const pad = (n) => String(n).padStart(2, '0');

  // 1) Sonarr, s'il a les fichiers de cette saison
  const sr = arrConfig('sonarr') ? await seriesByTvdbOrTmdb(tvdbId, tmdbId).catch(() => null) : null;
  if (sr) {
    const [episodes, files] = await Promise.all([arr('sonarr', `/episode?seriesId=${sr.id}`), arr('sonarr', `/episodefile?seriesId=${sr.id}`)]);
    const inFrom = (files || []).filter((f) => f.seasonNumber === from);
    if (inFrom.length) {
      const epOfFile = (f) => (episodes || []).filter((e) => e.episodeFileId === f.id);
      const moves = [];
      const missing = [];
      for (const f of inFrom) {
        for (const e of epOfFile(f)) {
          const target = (episodes || []).find((x) => x.seasonNumber === to && x.episodeNumber === e.episodeNumber);
          if (!target) missing.push(`S${pad(to)}E${pad(e.episodeNumber)}`);
          else moves.push({ fileId: f.id, path: f.path, from: `S${pad(from)}E${pad(e.episodeNumber)}`, to: `S${pad(to)}E${pad(e.episodeNumber)}`, targetEpisodeId: target.id, duplicate: Boolean(target.hasFile && target.episodeFileId !== f.id), file: f });
        }
      }
      if (missing.length) throw new HttpError(409, `La saison ${to} n’a pas ces épisodes dans Sonarr : ${missing.join(', ')}`);
      const dup = moves.filter((m) => m.duplicate);
      if (dup.length) throw new HttpError(409, `Ces épisodes de la saison ${to} ont déjà un fichier : ${dup.map((m) => m.to).join(', ')}. Supprime-les d’abord.`);
      const r = await applyNumbering({ seriesId: sr.id, title: sr.title, moves });
      jfSeriesRefresh(token, jfSeriesId);
      return { ok: true, message: `${r.moved} épisode${r.moved > 1 ? 's' : ''} passé${r.moved > 1 ? 's' : ''} de la saison ${from} à la saison ${to} (par Sonarr). Jellyfin se met à jour dans une minute.` };
    }
  }

  // 2) Sur le disque, directement : dossier de la série parcouru (dossiers de sorties et sous-dossiers par épisode compris),
  // chaque vidéo « S03Exx » rangée dans « Season 02 » sous le nom « S02Exx », avec ses sous-titres / .nfo.
  const seriesDir = localPath(it.Path);
  if (!seriesDir) throw new HttpError(502, `Le serveur Lumio n’a pas accès au dossier de la série (${it.Path}). Ajoute ce disque à LUMIO_DISKS.`);
  const VIDEO = /\.(mkv|mp4|avi|m4v|ts|mov|wmv)$/i;
  const epRe = new RegExp(`S0*${from}E(\\d+)`, 'i');
  const found = [];
  const walk = async (dir, depth) => {
    for (const ent of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (ent.isFile() && VIDEO.test(ent.name) && epRe.test(ent.name) && !/sample/i.test(ent.name)) found.push(full);
    }
  };
  await walk(seriesDir, 0);
  if (!found.length) throw new HttpError(404, `Aucune vidéo « S${pad(from)}Exx » trouvée dans ${path.basename(seriesDir)}`);
  const targetDir = path.join(seriesDir, `Season ${pad(to)}`);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let moved = 0;
  const problems = [];
  const oldDirs = new Set();
  for (const file of found) {
    const dir = path.dirname(file);
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    for (const name of await fs.promises.readdir(dir)) {
      if (!name.startsWith(stem)) continue;
      const renamed = name.replace(epRe, (m, e) => `S${pad(to)}E${e}`);
      const dest = path.join(targetDir, renamed);
      if (fs.existsSync(dest)) {
        problems.push(renamed);
        continue;
      }
      await fs.promises.rename(path.join(dir, name), dest);
    }
    if (dir !== targetDir) oldDirs.add(dir);
    moved++;
  }
  // Anciens dossiers (épisode puis sortie) devenus vides ou avec seulement des .nfo / images : supprimés
  const junk = (n) => /\.(nfo|jpg|png|txt|url|exe|srr|sfv)$/i.test(n) || /sample/i.test(n);
  const cleanup = async (d) => {
    if (!d.startsWith(seriesDir + path.sep) || d === targetDir) return;
    const left = await fs.promises.readdir(d).catch(() => null);
    if (left && left.every(junk)) {
      await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {});
      await cleanup(path.dirname(d));
    }
  };
  for (const d of oldDirs) await cleanup(d);
  if (!moved) throw new HttpError(502, `Le serveur Lumio n’a pas accès à ces fichiers (${problems.slice(0, 2).join(', ')}). Monte le dossier des séries dans son conteneur, au même chemin que Jellyfin.`);
  jfSeriesRefresh(token, jfSeriesId);
  console.log(`Saison renumérotée : « ${it.Name} » saison ${from} → ${to} (${moved} fichier(s))`);
  return { ok: true, message: `${moved} épisode${moved > 1 ? 's' : ''} passé${moved > 1 ? 's' : ''} de la saison ${from} à la saison ${to}. Jellyfin se met à jour dans une minute.${problems.length ? ` (${problems.length} fichier(s) laissé(s) en place : un fichier du même nom existe déjà dans « Season ${pad(to)} »)` : ''}` };
}

/** Saisons d'une série dans la numérotation de Sonarr (TheTVDB), avec le nombre d'épisodes. */
async function arrSeasons(tvdbId) {
  if (!tvdbId || !arrConfig('sonarr')) return null;
  const existing = (await arr('sonarr', `/series?tvdbId=${tvdbId}`).catch(() => []))[0];
  const src = existing || ((await arr('sonarr', `/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`).catch(() => [])) || [])[0];
  if (!src) return null;
  return (src.seasons || [])
    .filter((x) => x.seasonNumber > 0)
    .map((x) => ({ seasonNumber: x.seasonNumber, episodes: (x.statistics && (x.statistics.totalEpisodeCount || x.statistics.episodeCount)) || null }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

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
// Affiches / fonds TMDB (affiche en français si possible) : gardés en mémoire 7 jours, une seule requête TMDB à la fois par titre
const posterCache = new Map(); // "movie:603" → { p: '/affiche.jpg' | null, b: '/fond.jpg' | null, at }
const posterPending = new Map();
async function tmdbArt(type, id) {
  const k = `${type}:${id}`;
  const hit = posterCache.get(k);
  if (hit && Date.now() - hit.at < 7 * 86400e3) return hit;
  if (posterPending.has(k)) return posterPending.get(k);
  const job = (async () => {
    const d = await tmdbGet(`/${type}/${id}`, { append_to_response: 'images', include_image_language: 'fr,null,en' });
    const imgs = (d && d.images) || {};
    const fr = (imgs.posters || []).find((x) => x.iso_639_1 === 'fr');
    const clean = (imgs.backdrops || []).find((x) => !x.iso_639_1);
    const v = { p: (fr && fr.file_path) || (d && d.poster_path) || null, b: (clean && clean.file_path) || (d && d.backdrop_path) || null, at: Date.now() };
    if (posterCache.size > 20000) posterCache.clear();
    posterCache.set(k, v);
    return v;
  })().finally(() => posterPending.delete(k));
  posterPending.set(k, job);
  return job;
}
const tmdbPosterPath = async (type, id) => (await tmdbArt(type, id)).p;
// Titre sans identifiant TMDB (métadonnées en cours de remplacement dans Jellyfin) : recherche par nom + année
const findCache = new Map();
async function tmdbFindId(type, q, year) {
  const k = `${type}:${q.toLowerCase()}:${year || ''}`;
  if (findCache.has(k)) return findCache.get(k);
  const params = { query: q, include_adult: 'false' };
  if (year) params[type === 'movie' ? 'year' : 'first_air_date_year'] = year;
  let d = await tmdbGet(`/search/${type}`, params);
  if (year && !(d && d.results && d.results.length)) d = await tmdbGet(`/search/${type}`, { query: q, include_adult: 'false' });
  const id = (d && d.results && d.results[0] && d.results[0].id) || null;
  if (findCache.size > 5000) findCache.clear();
  findCache.set(k, id);
  return id;
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

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new HttpError(413, 'trop volumineux'));
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

/** Fichier .torrent envoyé à AllDebrid (multipart) → identifiant du magnet chez AllDebrid. */
async function uploadTorrentFile(name, buf) {
  const key = process.env.ALLDEBRID_KEY || config.alldebridKey;
  if (!key) throw new HttpError(400, 'Clé AllDebrid non configurée');
  const form = new FormData();
  form.append('files[]', new Blob([buf], { type: 'application/x-bittorrent' }), name.endsWith('.torrent') ? name : `${name}.torrent`);
  const r = await fetch(`${AD_API}/v4/magnet/upload/file`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const j = await r.json().catch(() => null);
  if (!j || j.status !== 'success') throw new HttpError(502, `AllDebrid : ${(j && j.error && (j.error.message || j.error.code)) || `HTTP ${r.status}`}`);
  const f = j.data && j.data.files && j.data.files[0];
  if (!f || f.error) throw new HttpError(502, `AllDebrid : ${(f && f.error && f.error.message) || 'fichier .torrent refusé'}`);
  return { id: f.id, name: f.name || name.replace(/\.torrent$/i, '') };
}

/** Magnet (ou .torrent déjà envoyé : « adid:<id> ») → attend qu'AllDebrid l'ait récupéré → fichiers avec leurs liens. */
async function magnetFiles(magnet, job) {
  let m;
  if (/^adid:\d+$/.test(magnet)) m = { id: Number(magnet.slice(5)), name: job.name };
  else {
    const up = await ad('/v4/magnet/upload', { magnets: [magnet] });
    m = up.magnets && up.magnets[0];
    if (!m || m.error) throw new Error(`AllDebrid : ${(m && m.error && m.error.message) || 'magnet refusé'}`);
  }
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

// ——— Lumio Secour : liens d'hébergeurs pour un film ou un épisode ———
// Adresse et clé : LUMIO_SECOUR_URL / LUMIO_SECOUR_KEY, ou envoyées par l'appli de l'admin.
// La clé AllDebrid reste ici : elle est transmise à Lumio Secour à chaque appel, jamais à l'appli.
const secourUrl = () => (process.env.LUMIO_SECOUR_URL || config.secourUrl || '').replace(/\/+$/, '');
const secourKey = () => process.env.LUMIO_SECOUR_KEY || config.secourKey || '';
async function secour(pathname, { method = 'GET', body, timeout = 60000 } = {}) {
  if (!secourUrl() || !secourKey()) throw new HttpError(400, 'Lumio Secour n’est pas configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const adKey = process.env.ALLDEBRID_KEY || config.alldebridKey;
    const r = await fetch(`${secourUrl()}${pathname}`, {
      method,
      signal: ctrl.signal,
      headers: { 'X-Lumio-Key': secourKey(), ...(adKey ? { 'X-Debrid-Key': adKey } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new HttpError(r.status === 401 ? 502 : r.status >= 500 ? 502 : r.status, `Lumio Secour : ${(j && (j.detail || j.error)) || `HTTP ${r.status}`}`);
    return j;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, e && e.name === 'AbortError' ? 'Lumio Secour ne répond pas (délai dépassé)' : `Lumio Secour injoignable : ${(e && e.message) || e}`);
  } finally {
    clearTimeout(t);
  }
}

/** Nom de fichier lisible à partir d'un lien direct (…/Film.2024.1080p.mkv). */
function fileNameFromUrl(u) {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
    return last && /\.\w{2,4}$/.test(last) ? last : '';
  } catch {
    return '';
  }
}

const downloads = [];

async function downloadTo(url, dest, job) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const ctrl = new AbortController();
  job.abort = () => ctrl.abort();
  const r = await fetch(url, { signal: ctrl.signal });
  if (!r.ok || !r.body) throw new Error(`Téléchargement : HTTP ${r.status}`);
  if (!job.size) job.size = Number(r.headers.get('content-length')) || 0;
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
    if (job.secour) {
      job.status = 'debrid';
      const r = await secour('/lumio/resolve', { method: 'POST', body: job.secour, timeout: 180000 });
      const name = job.fileName || fileNameFromUrl(r.url) || `${job.name || 'fichier'}.mkv`;
      files = [{ rel: name, direct: r.url }];
    } else if (/^magnet:\?/i.test(job.link) || /^[a-f0-9]{40}$/i.test(job.link) || /^adid:\d+$/.test(job.link)) {
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
      const u = f.direct ? { url: f.direct, name: f.rel, size: 0 } : await unlockLink(f.link, job);
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
      console.log(`Demande « ${r.title} » : envoi à ${r.type === 'movie' ? 'Radarr' : 'Sonarr'} impossible — ${r.error}`);
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

// Une erreur oubliée dans une tâche de fond ne doit jamais arrêter le serveur (Docker le relançait :
// « serveur injoignable / redémarrage » dans l'appli, et une demande en cours d'envoi pouvait être perdue).
process.on('unhandledRejection', (e) => console.log('Erreur ignorée (promesse) :', e && e.stack ? e.stack : e));
process.on('uncaughtException', (e) => console.log('Erreur ignorée :', e && e.stack ? e.stack : e));

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health')
    return send(res, 200, {
      ok: true,
      version: VERSION,
      messages: messages.length,
      features: ['chat', 'requests', 'status', 'ideas', 'ratings', 'files', 'watchlist', ...(tmdbKey() ? ['tmdb'] : [])],
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
    // Disques : place libre / totale seulement (aucun titre)
    const disks = (await diskSummary().catch(() => [])).map((d) => ({ label: d.label, free: d.free, total: d.total }));
    return send(res, 200, { ...publicStatusCache.body, machine: { cpu: last.cpu ?? null, temp: last.temp ?? null }, disks, at: new Date().toISOString() });
  }

  // Raccourci pour installer l'appli Android (téléphone)
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

  // Raccourci pour installer l'appli TV : taper « lumio.tondomaine/tv » dans Downloader → Lumio TV (32 bits, toutes les box).
  // L'ancienne appli TV (React Native) n'existe plus.
  if (url.pathname === '/tv' || url.pathname === '/tv.apk') {
    res.writeHead(302, { Location: process.env.TV_APK_URL || 'https://github.com/nono7444/lumio-tv/releases/latest/download/lumio-tv-armeabi-v7a.apk' });
    return res.end();
  }

  // Lumio TV (fork de NuvioTV, dépôt nono7444/lumio-tv) : /tvnuvio = 32 bits (toutes les box), /tvnuvio64 = 64 bits
  if (url.pathname === '/tvnuvio' || url.pathname === '/tvnuvio.apk' || url.pathname === '/tvnuvio64') {
    const file = url.pathname === '/tvnuvio64' ? 'lumio-tv-arm64-v8a.apk' : 'lumio-tv-armeabi-v7a.apk';
    res.writeHead(302, { Location: `https://github.com/nono7444/lumio-tv/releases/latest/download/${file}` });
    return res.end();
  }

  // Affiche TMDB d'un titre (Lumio TV) : redirection vers image.tmdb.org, sans jeton (ce n'est qu'une image publique).
  // /poster/movie/603 ou /poster/tv/1399 ; ?w=w342 par défaut. 404 si TMDB n'a pas d'affiche : l'appli garde alors celle de Jellyfin.
  // /poster/movie/603, /poster/tv/1399 ou /poster/find/movie?q=Titre&y=2026 ; ?kind=backdrop pour l'image de fond.
  const posterM = url.pathname.match(/^\/poster\/(movie|tv)\/(\d{1,9})$/) || url.pathname.match(/^\/poster\/find\/(movie|tv)$/);
  if (req.method === 'GET' && posterM) {
    const backdrop = url.searchParams.get('kind') === 'backdrop';
    const sizes = backdrop ? /^w(300|780|1280)$/ : /^w(92|154|185|342|500|780)$/;
    const w = sizes.test(url.searchParams.get('w') || '') ? url.searchParams.get('w') : backdrop ? 'w1280' : 'w342';
    let id = posterM[2] ? Number(posterM[2]) : null;
    if (!id) {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 200);
      const y = /^\d{4}$/.test(url.searchParams.get('y') || '') ? url.searchParams.get('y') : null;
      if (q) id = await tmdbFindId(posterM[1], q, y).catch(() => null);
    }
    const art = id ? await tmdbArt(posterM[1], id).catch(() => null) : null;
    const posterPath = art && (backdrop ? art.b : art.p);
    if (!posterPath) {
      res.writeHead(404, { 'Cache-Control': 'max-age=3600' });
      return res.end();
    }
    res.writeHead(302, { Location: `https://image.tmdb.org/t/p/${w}${posterPath}`, 'Cache-Control': 'public, max-age=604800' });
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
        // Admin : ?arr=keep (arrêter + retirer de Radarr / Sonarr, garder les fichiers) ou ?arr=files (tout supprimer)
        const mode = q.get('arr');
        let arrMsg = null;
        if (user.admin && (mode === 'keep' || mode === 'files')) arrMsg = await removeFromArr(r, mode === 'files');
        requests = requests.filter((x) => x.id !== r.id);
        saveRequests();
        library = null;
        diskCache = null;
        return send(res, 200, { ok: true, message: arrMsg ? `Demande supprimée. ${arrMsg}` : 'Demande supprimée.' });
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
    // ——— TMDB via le serveur (Lumio TV) : la clé reste ici ———
    if (req.method === 'GET' && p === '/api/tmdb/search') {
      const type = q.get('type') === 'tv' ? 'tv' : 'movie';
      const query = String(q.get('q') || '').trim().slice(0, 200);
      if (!query) return send(res, 200, { results: [] });
      const data = await tmdbGet(`/search/${type}`, { query, include_adult: 'false', page: q.get('page') || '1' });
      const lib = await loadLibrary().catch(() => null);
      const results = ((data && data.results) || []).map((r) => {
        const st = lib ? mediaStatus(lib, type, r.id, null, null).status : MediaStatus.UNKNOWN;
        return { ...r, lumioStatus: st };
      });
      return send(res, 200, { results });
    }
    const tmdbProxy = p.match(/^\/api\/tmdb\/proxy\/((?:movie|tv|find|search|genre|collection|person|discover|trending|configuration|company|network|keyword|list)\/[\w\/.-]*)$/);
    if (req.method === 'GET' && tmdbProxy) {
      const params = {};
      for (const [k, v] of q.entries()) if (k !== 'api_key') params[k] = v;
      const data = await tmdbGet(`/${tmdbProxy[1]}`, params);
      if (data == null) return send(res, 404, { status_message: 'introuvable' });
      return send(res, 200, data);
    }

    // ——— Stockage (admin) : disques, gros titres, titres jamais / plus regardés ———
    if (req.method === 'GET' && p === '/api/admin/storage') {
      requireAdmin(user);
      return send(res, 200, await storageReport(user.token));
    }
    const delM = p.match(/^\/api\/admin\/storage\/(radarr|sonarr)\/(\d+)$/);
    if (req.method === 'DELETE' && delM) {
      requireAdmin(user);
      const [, kind, id] = delM;
      const item = await arr(kind, `/${kind === 'radarr' ? 'movie' : 'series'}/${id}`).catch(() => null);
      if (!item) throw new HttpError(404, 'Introuvable');
      await arr(kind, `/${kind === 'radarr' ? 'movie' : 'series'}/${id}?deleteFiles=true&${kind === 'radarr' ? 'addImportExclusion' : 'addImportListExclusion'}=false`, { method: 'DELETE' });
      // Demandes du titre closes, Jellyfin rescanné pour qu'il disparaisse tout de suite
      for (const r of requests)
        if (r.type === (kind === 'radarr' ? 'movie' : 'tv') && r.tmdbId === item.tmdbId && (r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED)) {
          r.status = RequestStatus.COMPLETED;
          r.deletedAt = new Date().toISOString();
        }
      saveRequests();
      fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(user.token) }).catch(() => {});
      library = null;
      diskCache = null;
      console.log(`Stockage : « ${item.title} » supprimé par ${user.name} (${((item.sizeOnDisk || (item.statistics || {}).sizeOnDisk || 0) / 1e9).toFixed(1)} Go)`);
      return send(res, 200, { ok: true, message: `« ${item.title} » supprimé.` });
    }

    // ——— Numérotation des séries en parties (admin) : aperçu puis réparation ———
    if (p === '/api/admin/numbering' && (req.method === 'GET' || req.method === 'POST')) {
      requireAdmin(user);
      const sr = await seriesByTvdbOrTmdb(Number(q.get('tvdbId')) || null, Number(q.get('tmdbId')) || null);
      if (!sr) return send(res, 200, { plan: null });
      const plan = await numberingPlan(sr);
      const pub = plan && { title: plan.title, parts: plan.parts, moves: plan.moves.map(({ from, to, duplicate }) => ({ from, to, duplicate })) };
      if (req.method === 'GET') return send(res, 200, { plan: pub });
      if (!plan || !plan.moves.length) return send(res, 200, { plan: pub, moved: 0, removed: 0, message: 'Rien à réparer.' });
      const r = await applyNumbering(plan);
      return send(res, 200, { plan: pub, ...r, message: `${r.moved} épisode${r.moved > 1 ? 's' : ''} remis à leur place${r.removed ? `, ${r.removed} doublon${r.removed > 1 ? 's' : ''} supprimé${r.removed > 1 ? 's' : ''}` : ''}. Sonarr les renomme, puis Jellyfin les retrouve au prochain scan.` });
    }

    // ——— Changer le numéro d'une saison (admin) ———
    if (req.method === 'POST' && p === '/api/admin/series/renumber') {
      requireAdmin(user);
      return send(res, 200, await renumberSeason(user.token, await readBody(req)));
    }

    // ——— Saisons d'une série selon Sonarr / TheTVDB (fiches : liste des saisons et demandes) ———
    if (req.method === 'GET' && p === '/api/tv/seasons') {
      return send(res, 200, { seasons: await arrSeasons(Number(q.get('tvdbId'))) });
    }

    // ——— À voir (liste personnelle) ———
    if (p === '/api/watchlist') {
      const list = watchlists[user.id] || [];
      if (req.method === 'GET') {
        const lib = await loadLibrary().catch(() => null);
        return send(res, 200, {
          items: list.map((x) => ({ ...x, status: lib ? mediaStatus(lib, x.type, x.tmdbId, null, null).status : MediaStatus.UNKNOWN })),
        });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const type = b.type === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(b.tmdbId);
        if (!tmdbId) throw new HttpError(400, 'Identifiant TMDB manquant');
        const clean = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
        const item = {
          type,
          tmdbId,
          title: clean(b.title, 200) || '',
          year: clean(b.year, 4),
          poster: typeof b.poster === 'string' && /^https:\/\//.test(b.poster) ? b.poster : undefined,
          backdrop: typeof b.backdrop === 'string' && /^https:\/\//.test(b.backdrop) ? b.backdrop : undefined,
          addedAt: new Date().toISOString(),
        };
        watchlists[user.id] = [item, ...list.filter((x) => !(x.type === type && x.tmdbId === tmdbId))].slice(0, 500);
        saveWatchlists();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        const type = q.get('type') === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(q.get('tmdbId'));
        watchlists[user.id] = list.filter((x) => !(x.type === type && x.tmdbId === tmdbId));
        saveWatchlists();
        return send(res, 200, { ok: true });
      }
    }

    // ——— Sous-titres français (lecteur) ———
    if (req.method === 'GET' && p === '/api/subtitles/search') {
      const token = user.admin ? user.token : subToken();
      if (!token) throw new HttpError(503, 'Un admin doit d’abord ouvrir Lumio une fois');
      return send(res, 200, { results: await searchFrSubtitles(token, String(q.get('itemId') || '')) });
    }
    if (req.method === 'POST' && p === '/api/subtitles/download') {
      const token = user.admin ? user.token : subToken();
      if (!token) throw new HttpError(503, 'Un admin doit d’abord ouvrir Lumio une fois');
      const b = await readBody(req);
      return send(res, 200, await downloadSubtitle(token, String(b.itemId || ''), String(b.subtitleId || '')));
    }

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
    // Avancement de l'actualisation des bibliothèques Jellyfin (remplacement TMDB, scan) : pourcentage par bibliothèque
    if (req.method === 'GET' && p === '/api/admin/jellyfin/refresh-status') {
      requireAdmin(user);
      const r = await fetch(`${JELLYFIN_URL}/Library/VirtualFolders`, { headers: jfHeaders(user.token) });
      if (!r.ok) throw new HttpError(502, `Jellyfin a refusé (HTTP ${r.status})`);
      const libs = (await r.json())
        .filter((l) => l.ItemId)
        .map((l) => {
          const active = l.RefreshStatus === 'Active' || (l.RefreshProgress != null && l.RefreshProgress < 100);
          return { name: l.Name, active, progress: active ? Math.max(0, Math.min(100, Math.round(l.RefreshProgress || 0))) : 100 };
        });
      const running = libs.filter((l) => l.active);
      const progress = libs.length ? Math.round(libs.reduce((n, l) => n + l.progress, 0) / libs.length) : 100;
      return send(res, 200, { active: running.length > 0, progress, libraries: libs });
    }
    if (req.method === 'GET' && p === '/api/admin/jellyfin/intro-skipper') {
      requireAdmin(user);
      return send(res, 200, await introSkipperStatus(user.token));
    }
    if (req.method === 'POST' && p === '/api/admin/jellyfin/intro-skipper') {
      requireAdmin(user);
      return send(res, 200, await installIntroSkipper(user.token));
    }
    if (req.method === 'POST' && p === '/api/admin/jellyfin/replace-metadata') {
      requireAdmin(user);
      const names = await jellyfinReplaceAllMetadata(user.token);
      return send(res, 200, { ok: true, message: `Métadonnées et images remplacées par TMDB : ${names.join(', ')}. Jellyfin travaille en arrière-plan (de quelques minutes à une heure selon la taille).` });
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
        const out = { configured: Boolean(process.env.ALLDEBRID_KEY || config.alldebridKey), fromEnv: Boolean(process.env.ALLDEBRID_KEY), disks: disks().length };
        // ?check=1 : vérifie la clé et renvoie l'état du compte (premium, date de fin)
        if (out.configured && q.get('check')) {
          try {
            const u = (await ad('/v4/user')).user || {};
            out.account = { username: u.username || null, premium: Boolean(u.isPremium), premiumUntil: u.premiumUntil ? new Date(u.premiumUntil * 1000).toISOString() : null };
          } catch (e) {
            out.error = String((e && e.message) || e);
          }
        }
        return send(res, 200, out);
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
      // Fichier .torrent (envoyé en base64 par l'appli) → AllDebrid → disque choisi
      if (req.method === 'POST' && p === '/api/downloads/torrent') {
        const b = await readBody(req, 15 * 1024 * 1024);
        safePath(b.root, b.folder || '');
        const buf = Buffer.from(String(b.data || ''), 'base64');
        if (!buf.length || buf.length > 10 * 1024 * 1024) throw new HttpError(400, 'Fichier .torrent invalide');
        const up = await uploadTorrentFile(String(b.name || 'fichier.torrent').slice(0, 200), buf);
        const job = { id: crypto.randomBytes(5).toString('hex'), link: `adid:${up.id}`, root: b.root, folder: b.folder || '', status: 'queued',
          name: up.name, size: 0, done: 0, speed: 0, token: user.token, createdAt: new Date().toISOString() };
        downloads.push(job);
        runDownload(job);
        return send(res, 201, { downloads: [publicJob(job)] });
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

    // ——— Admin : Lumio Secour (liens d'hébergeurs → AllDebrid → disques) ———
    if (p === '/api/secour' || p.startsWith('/api/secour/')) {
      requireAdmin(user);
      if (req.method === 'GET' && p === '/api/secour') {
        const out = { configured: Boolean(secourUrl() && secourKey()), url: secourUrl() || null, fromEnv: Boolean(process.env.LUMIO_SECOUR_URL),
          alldebrid: Boolean(process.env.ALLDEBRID_KEY || config.alldebridKey), disks: disks().length };
        if (out.configured) {
          try {
            const ping = await secour('/lumio/ping', { timeout: 8000 });
            Object.assign(out, { online: true, version: ping.version, sources: ping.sources || [], tmdb: ping.tmdb });
          } catch (e) {
            Object.assign(out, { online: false, error: e.message });
          }
        }
        return send(res, 200, out);
      }
      if (req.method === 'PUT' && p === '/api/secour') {
        const b = await readBody(req);
        if (b.url !== undefined) config.secourUrl = String(b.url || '').trim().replace(/\/+$/, '') || undefined;
        if (b.key !== undefined && String(b.key).trim()) config.secourKey = String(b.key).trim();
        if (b.url === '') delete config.secourKey;
        saveConfig();
        return send(res, 200, { configured: Boolean(secourUrl() && secourKey()) });
      }
      // Réglages du fork (sources, TMDB, cache…) : relayés tels quels, la clé Lumio Secour reste ici
      if (req.method === 'GET' && p === '/api/secour/settings') return send(res, 200, await secour('/lumio/settings', { timeout: 15000 }));
      if (req.method === 'PUT' && p === '/api/secour/settings') {
        const b = await readBody(req);
        return send(res, 200, await secour('/lumio/settings', { method: 'PUT', body: { updates: b.updates || {} }, timeout: 15000 }));
      }
      const secSet = p.match(/^\/api\/secour\/settings\/([A-Z0-9_]+)$/);
      if (req.method === 'DELETE' && secSet) return send(res, 200, await secour(`/lumio/settings/${secSet[1]}`, { method: 'DELETE', timeout: 15000 }));
      if (req.method === 'GET' && p === '/api/secour/health') {
        return send(res, 200, await secour(`/lumio/health${q.get('refresh') ? '?refresh=true' : ''}`, { timeout: 60000 }));
      }
      if (req.method === 'GET' && p === '/api/secour/links') {
        const type = q.get('type') === 'tv' || q.get('type') === 'series' ? 'series' : 'movie';
        let imdb = String(q.get('imdb') || '');
        if (!/^tt\d+$/.test(imdb) && q.get('tmdbId')) {
          const ext = await tmdbGet(`/${type === 'series' ? 'tv' : 'movie'}/${Number(q.get('tmdbId'))}/external_ids`).catch(() => null);
          imdb = (ext && ext.imdb_id) || '';
        }
        if (!/^tt\d+$/.test(imdb)) throw new HttpError(400, 'Identifiant IMDb introuvable pour ce titre');
        const qs = new URLSearchParams({ imdb, type });
        if (type === 'series') {
          qs.set('season', String(Number(q.get('season')) || 1));
          qs.set('episode', String(Number(q.get('episode')) || 1));
        }
        return send(res, 200, await secour(`/lumio/links?${qs}`, { timeout: 90000 }));
      }
      if (req.method === 'POST' && p === '/api/secour/download') {
        if (!(process.env.ALLDEBRID_KEY || config.alldebridKey)) throw new HttpError(400, 'Clé AllDebrid non configurée (Téléchargements)');
        const b = await readBody(req);
        const link = String(b.link || '').trim();
        if (!/^https?:\/\//.test(link)) throw new HttpError(400, 'Lien invalide');
        safePath(b.root, b.folder || '');
        const job = { id: crypto.randomBytes(5).toString('hex'), link, root: b.root, folder: b.folder || '', status: 'queued',
          name: String(b.name || '').slice(0, 200), size: Number(b.sizeBytes) || 0, done: 0, speed: 0, token: user.token,
          createdAt: new Date().toISOString(),
          secour: pick(b, ['link', 'hoster', 'source', 'season', 'episode', 'type']) };
        job.secour.link = link;
        downloads.push(job);
        runDownload(job);
        return send(res, 201, { download: publicJob(job) });
      }
      return send(res, 404, { error: 'introuvable' });
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
