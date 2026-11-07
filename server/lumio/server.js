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
const zlib = require('zlib');

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
const VERSION = '3.89.0';

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
// Lumio Auto actif : Radarr et Sonarr ne sont plus utilisés du tout (même s'ils sont encore configurés)
// (et pour de bon une fois Lumio Auto activé : Radarr / Sonarr ont été retirés du serveur)
const arrOff = () => Boolean(config.auto && (config.auto.enabled === true || config.auto.arrRemoved === true));
function arrConfig(kind) {
  if (arrOff()) return null;
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
// Quotas pour protéger le ratio : 2 films et 1 série par semaine pour les membres (l'admin n'a pas de limite). Posé une seule fois.
if (!config.quotaPresetRatio) {
  config.quotaPresetRatio = true;
  config.defaultMovieQuotaLimit = 2;
  config.defaultMovieQuotaDays = 7;
  config.defaultTvQuotaLimit = 1;
  config.defaultTvQuotaDays = 7;
  config.tvQuotaUnit = 'series';
  try {
    writeJson(CONFIG_FILE, config);
  } catch {}
}
const tvBySeries = () => config.tvQuotaUnit === 'series';

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
    tvQuotaUnit: tvBySeries() ? 'series' : 'seasons',
    usersSeeAllRequests: config.usersSeeAllRequests === true,
    lockedProfile: lockedProfileName('radarr'),
    lockedProfileSonarr: lockedProfileName('sonarr'),
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
/** Bonus du rang d'un membre (films, saisons en plus sur le quota), d'après le dernier classement calculé. */
function gradeBonusOf(userId) {
  const u = rewardsCache && rewardsCache.value.users.find((x) => x.id === userId);
  return (u && u.grade && u.grade.bonus) || { movies: 0, seasons: 0 };
}

function quotaOf(user) {
  const base = permissionsOf(user);
  const bonus = gradeBonusOf(user.id);
  // Un quota de 0 = illimité : le bonus ne s'ajoute qu'aux quotas fixés
  const perm = {
    ...base,
    movieQuotaLimit: base.movieQuotaLimit ? base.movieQuotaLimit + (bonus.movies || 0) : 0,
    tvQuotaLimit: base.tvQuotaLimit ? base.tvQuotaLimit + (bonus.seasons || 0) : 0,
  };
  const since = (days) => Date.now() - days * 86400000;
  const mine = requests.filter((r) => r.requestedBy.id === user.id && r.status !== RequestStatus.DECLINED);
  const movieUsed = mine.filter((r) => r.type === 'movie' && Date.parse(r.createdAt) > since(perm.movieQuotaDays)).length;
  const tvRecent = mine.filter((r) => r.type === 'tv' && Date.parse(r.createdAt) > since(perm.tvQuotaDays));
  const tvUsed = tvBySeries() ? new Set(tvRecent.map((r) => r.tmdbId)).size : tvRecent.reduce((n, r) => n + (r.seasons || []).length, 0);
  return {
    movie: { limit: perm.movieQuotaLimit, days: perm.movieQuotaDays, used: movieUsed, remaining: perm.movieQuotaLimit ? Math.max(0, perm.movieQuotaLimit - movieUsed) : null },
    tv: { limit: perm.tvQuotaLimit, days: perm.tvQuotaDays, used: tvUsed, remaining: perm.tvQuotaLimit ? Math.max(0, perm.tvQuotaLimit - tvUsed) : null, unit: tvBySeries() ? 'series' : 'seasons' },
    bonus,
  };
}

// ——— Appels Radarr / Sonarr ———
/** Erreur Radarr / Sonarr « hors service » (injoignable, délai, erreur 5xx, clé refusée) : le groupe de secours prend le relais. */
const arrDown = (e, msg) => Object.assign(e instanceof HttpError ? e : new HttpError(502, msg || String(e)), { arrDown: true });
async function arr(kind, p, init = {}) {
  const c = arrConfig(kind);
  if (!c) throw arrDown(new HttpError(503, `${label(kind)} n'est pas configuré sur le serveur Lumio`));
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
      const err = new HttpError(502, `${label(kind)} : ${msg}`);
      throw res.status === 401 || res.status >= 500 ? arrDown(err) : err;
    }
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') throw arrDown(new HttpError(504, `${label(kind)} ne répond pas`));
    if (e instanceof HttpError) throw e;
    throw arrDown(new HttpError(502, `${label(kind)} injoignable`));
  } finally {
    clearTimeout(t);
  }
}

async function folders(kind) {
  if (autoOn()) {
    const list = autoFolderChoices(kind);
    const def = (autoCfg().folders || {})[kind === 'radarr' ? 'movie' : 'tv'];
    return { folders: list.map((f) => ({ path: f.path, accessible: true })), default: (list.find((f) => f.path === def) || list[0] || {}).path || null };
  }
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

// Profil de qualité imposé à toutes les demandes, s'il existe dans Radarr / Sonarr :
// films → « HD-1080p nono », séries et animés (Sonarr) → « HD-1080p copy »
const lockedProfileName = (kind) =>
  kind === 'sonarr'
    ? (config.lockedProfileSonarr !== undefined ? config.lockedProfileSonarr : process.env.LOCKED_PROFILE_SONARR || 'HD-1080p copy') || ''
    : (config.lockedProfile !== undefined ? config.lockedProfile : process.env.LOCKED_PROFILE || 'HD-1080p nono') || '';
// Comparaison souple : « HD - 1080p Copy » = « HD-1080p copy »
const normName = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function profiles(kind) {
  if (autoOn()) {
    const pf = autoProfile();
    const name = `Lumio Auto · FR ${pf.resolution}p${pf.h265 === 'required' ? ' H.265' : ''}`;
    return { profiles: [{ id: 1, name }], default: 1, locked: { id: 1, name } };
  }
  const list = await arr(kind, '/qualityprofile');
  const c = arrConfig(kind);
  const lockName = normName(lockedProfileName(kind));
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
  const [items, seasons] = await Promise.all([get('Movie,Series', 'ProviderIds,Path'), get('Season', 'ChildCount')]);
  const idx = { movies: new Set(), moviesImdb: new Set(), series: new Map(), seriesTvdb: new Map(), seriesById: new Map(), seriesJf: new Map(), seriesJfTvdb: new Map() };
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
      if (p.Tmdb) idx.seriesJf.set(Number(p.Tmdb), { id: i.Id, path: i.Path || null });
      if (p.Tvdb) idx.seriesJfTvdb.set(Number(p.Tvdb), { id: i.Id, path: i.Path || null });
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
    if (r.status !== RequestStatus.APPROVED || r.via === 'secour' || r.via === 'auto') continue;
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
      await sendOrSecour(r);
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
// Espace des disques vu par Radarr / Sonarr et plus gros titres.
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
/** Sans Radarr / Sonarr : les titres des dossiers de la bibliothèque, avec leur taille sur le disque. */
let diskTitlesCache = null;
function dirSize(dir) {
  let n = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    try {
      if (e.isDirectory()) n += dirSize(f);
      else if (e.isFile()) n += fs.statSync(f).size;
    } catch {}
  }
  return n;
}
function diskTitles() {
  if (diskTitlesCache && Date.now() - diskTitlesCache.at < 10 * 60e3) return diskTitlesCache.items;
  const items = [];
  const seen = new Set();
  for (const [kind, type] of [['radarr', 'movie'], ['sonarr', 'tv']])
    for (const f of autoFolderChoices(kind)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      let names = [];
      try {
        names = fs.readdirSync(f.path, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
      } catch {}
      for (const n of names) {
        const full = path.join(f.path, n);
        const size = dirSize(full);
        if (!size) continue;
        const m = n.match(/\[tmdbid-(\d+)\]/);
        const y = n.match(/\((\d{4})\)/);
        let added = null;
        try {
          added = fs.statSync(full).birthtime.toISOString();
        } catch {}
        items.push({ kind: 'disk', id: Buffer.from(full).toString('base64url'), type, tmdbId: m ? Number(m[1]) : null, title: n.replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\(\d{4}\)/, '').trim(), year: y ? Number(y[1]) : null, size, added, watched: false, lastPlayed: null, poster: null, folder: f.folder });
      }
    }
  diskTitlesCache = { at: Date.now(), items };
  return items;
}
async function storageReport(token) {
  if (arrOff()) {
    const disks = await diskSpace().catch(() => []);
    const biggest = [...diskTitles()].sort((a, b) => b.size - a.size).slice(0, 25);
    return { disks, candidates: [], biggest, totalCandidates: 0 };
  }
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
  // Plus de suggestions « à nettoyer » (titres jamais / plus regardés) : l'admin supprime lui-même ce qu'il veut
  const candidates = [];
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

// ——— Appels JSON à Jellyfin ———
async function jfJson(token, p2, init = {}) {
  const r = await fetch(`${JELLYFIN_URL}${p2}`, { ...init, headers: { ...jfHeaders(token), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé ${p2} (HTTP ${r.status})`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
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
// Date de sortie en numérique (VOD) d'un film, en France de préférence ; série : prochain épisode ou 1re diffusion
const digitalCache = new Map();
async function digitalDate(type, id) {
  const k = `${type}:${id}`;
  const hit = digitalCache.get(k);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.v;
  let v = null;
  try {
    if (type === 'movie') {
      const r = await tmdbGet(`/movie/${id}/release_dates`);
      const all = (r && r.results) || [];
      const pick = (cc) => {
        const c = all.find((x) => x.iso_3166_1 === cc);
        const d = c && (c.release_dates || []).filter((x) => x.type === 4).map((x) => x.release_date).sort()[0];
        return d || null;
      };
      v = pick('FR') || pick('US') || all.flatMap((x) => (x.release_dates || []).filter((y) => y.type === 4).map((y) => y.release_date)).sort()[0] || null;
      if (!v) {
        const m = await tmdbGet(`/movie/${id}`);
        v = (m && m.release_date) || null;
      }
    } else {
      const t = await tmdbGet(`/tv/${id}`);
      v = (t && ((t.next_episode_to_air && t.next_episode_to_air.air_date) || t.first_air_date)) || null;
    }
  } catch {}
  digitalCache.set(k, { at: Date.now(), v: v ? String(v).slice(0, 10) : null });
  return v ? String(v).slice(0, 10) : null;
}

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
  if (!(from >= 0) || !(to >= 0)) throw new HttpError(400, 'Numéros de saison invalides');
  // Même numéro : on range seulement (vidéos « S02Exx » encore dans des dossiers d'une autre saison → « Season 02 »)
  const tidyOnly = from === to;
  const it = ((await jfJson(token, `/Items?Ids=${encodeURIComponent(jfSeriesId)}&Fields=ProviderIds,Path`)) || {}).Items?.[0];
  if (!it) throw new HttpError(404, 'Série introuvable dans Jellyfin');
  const tvdbId = Number((it.ProviderIds || {}).Tvdb) || null;
  const tmdbId = Number((it.ProviderIds || {}).Tmdb) || null;
  const pad = (n) => String(n).padStart(2, '0');

  // 1) Sonarr, s'il a les fichiers de cette saison
  const sr = !tidyOnly && arrConfig('sonarr') ? await seriesByTvdbOrTmdb(tvdbId, tmdbId).catch(() => null) : null;
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
  // Vidéos déjà renommées (S02Exx) mais restées dans un dossier « …S03… » : rangées aussi
  const epReTo = new RegExp(`S0*${to}E(\\d+)`, 'i');
  const fromDirRe = new RegExp(`(^|[._ -])(S|Season[ ._-]?|Saison[ ._-]?)0*${from}(?!\\d)`, 'i');
  const found = [];
  const walk = async (dir, depth) => {
    for (const ent of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (ent.isFile() && VIDEO.test(ent.name) && !/sample/i.test(ent.name)) {
        const rel = path.relative(seriesDir, dir);
        if (tidyOnly) {
          // Rangement : vidéo de la saison, ailleurs que dans « Season NN »
          if (epReTo.test(ent.name) && rel && path.resolve(dir) !== path.resolve(seriesDir, `Season ${pad(to)}`)) found.push(full);
        } else if (epRe.test(ent.name)) found.push(full);
        else if (epReTo.test(ent.name) && rel.split(path.sep).some((seg) => fromDirRe.test(seg))) found.push(full);
      }
    }
  };
  await walk(seriesDir, 0);
  if (!found.length)
    throw new HttpError(404, tidyOnly ? `Rien à ranger : les épisodes de la saison ${to} sont déjà dans « Season ${pad(to)} ».` : `Aucune vidéo « S${pad(from)}Exx » trouvée dans ${path.basename(seriesDir)}`);
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
  return { ok: true, message: `${moved} épisode${moved > 1 ? 's' : ''} ${tidyOnly ? `rangé${moved > 1 ? 's' : ''} dans « Season ${pad(to)} »` : `passé${moved > 1 ? 's' : ''} de la saison ${from} à la saison ${to}`}. Jellyfin se met à jour dans une minute.${problems.length ? ` (${problems.length} fichier(s) laissé(s) en place : un fichier du même nom existe déjà dans « Season ${pad(to)} »)` : ''}` };
}

// ——— En attente dans Radarr / Sonarr : surveillés mais pas encore téléchargés (onglet Demandes) ———
let wantedCache = null;
async function arrWanted() {
  if (wantedCache && Date.now() - wantedCache.at < 60_000) return wantedCache.value;
  const img = (x) => ((x.images || []).find((i) => i.coverType === 'poster') || {}).remoteUrl || null;
  const [movies, missing, queue] = await Promise.all([
    arrConfig('radarr') ? arr('radarr', '/movie').catch(() => []) : [],
    arrConfig('sonarr') ? arr('sonarr', '/wanted/missing?page=1&pageSize=1000&monitored=true&includeSeries=true&sortKey=airDateUtc&sortDirection=descending').catch(() => null) : null,
    queueIndex().catch(() => ({ movies: new Map(), series: new Map() })),
  ]);
  const items = [];
  const now = Date.now();
  for (const m of movies || []) {
    if (!m.monitored || m.hasFile) continue;
    const release = m.digitalRelease || m.physicalRelease || m.inCinemas || null;
    const q = queue.movies.get(m.tmdbId);
    items.push({
      type: 'movie',
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      poster: img(m),
      added: m.added,
      released: Boolean(m.isAvailable),
      release,
      state: q ? q.state : m.isAvailable ? 'searching' : 'upcoming',
      progress: q && q.progress != null ? q.progress : null,
    });
  }
  const bySeries = new Map();
  for (const r of (missing && missing.records) || []) {
    const srs = r.series;
    if (!srs || (r.airDateUtc && Date.parse(r.airDateUtc) > now)) continue;
    const e = bySeries.get(srs.id) || { type: 'tv', tmdbId: srs.tmdbId, tvdbId: srs.tvdbId, title: srs.title, year: srs.year, poster: img(srs), added: srs.added, missing: 0, seasons: new Set(), released: true };
    e.missing++;
    e.seasons.add(r.seasonNumber);
    bySeries.set(srs.id, e);
  }
  for (const e of bySeries.values()) {
    const q = queue.series.get(e.tvdbId) || [];
    const prog = q.filter((x) => x.progress != null);
    items.push({
      ...e,
      seasons: [...e.seasons].sort((a, b) => a - b),
      state: q.length ? (q.some((x) => x.state === 'warning') ? 'warning' : 'downloading') : 'searching',
      progress: prog.length ? Math.round(prog.reduce((n, x) => n + x.progress, 0) / prog.length) : null,
    });
  }
  // En téléchargement d'abord, puis recherche, puis à venir ; les plus récents en premier
  const rank = { downloading: 0, importing: 0, warning: 1, searching: 2, upcoming: 3 };
  items.sort((a, b) => (rank[a.state] ?? 2) - (rank[b.state] ?? 2) || Date.parse(b.added || 0) - Date.parse(a.added || 0));
  wantedCache = { at: Date.now(), value: items };
  return items;
}

// ——— Récompenses de la famille : points, grades et badges ———
// Heures regardées et coups de cœur (Jellyfin), notes données, demandes, messages du chat, titres « À voir ».
// 10 rangs, un écusson chacun dans l'appli (tier 0 à 9 : bois, bronze, cuivre, argent, acier, puis écussons dorés).
// Bonus de rang : demandes en plus sur le quota (films, saisons), pour les membres qui ont un quota.
const GRADES = [
  { min: 0, name: 'Spectateur', emoji: '🍿', tier: 0, bonus: { movies: 0, seasons: 0 } },
  { min: 100, name: 'Habitué', emoji: '🎟️', tier: 1, bonus: { movies: 0, seasons: 1 } },
  { min: 250, name: 'Cinéphile', emoji: '🎬', tier: 2, bonus: { movies: 1, seasons: 1 } },
  { min: 500, name: 'Critique', emoji: '📝', tier: 3, bonus: { movies: 1, seasons: 2 } },
  { min: 900, name: 'Expert', emoji: '🔎', tier: 4, bonus: { movies: 2, seasons: 2 } },
  { min: 1500, name: 'Réalisateur', emoji: '🎥', tier: 5, bonus: { movies: 2, seasons: 3 } },
  { min: 2500, name: 'Producteur', emoji: '💼', tier: 6, bonus: { movies: 3, seasons: 3 } },
  { min: 4000, name: 'Star', emoji: '🌟', tier: 7, bonus: { movies: 3, seasons: 4 } },
  { min: 6000, name: 'Icône', emoji: '👑', tier: 8, bonus: { movies: 4, seasons: 5 } },
  { min: 9000, name: 'Légende', emoji: '🏆', tier: 9, bonus: { movies: 5, seasons: 6 } },
];
const BADGES = [
  { id: 'marathon', emoji: '🏃', name: 'Marathonien', desc: '100 heures regardées', test: (x) => x.hours >= 100 },
  { id: 'binge', emoji: '📺', name: 'Accro aux séries', desc: '200 épisodes vus', test: (x) => x.episodes >= 200 },
  { id: 'cine', emoji: '🎞️', name: 'Ciné-club', desc: '50 films vus', test: (x) => x.movies >= 50 },
  { id: 'critic', emoji: '⭐', name: 'Critique', desc: '20 titres notés', test: (x) => x.ratings >= 20 },
  { id: 'heart', emoji: '❤️', name: 'Coup de cœur', desc: '25 « J’aime »', test: (x) => x.likes >= 25 },
  { id: 'explorer', emoji: '🧭', name: 'Explorateur', desc: '10 demandes', test: (x) => x.requests >= 10 },
  { id: 'chatty', emoji: '💬', name: 'Bavard', desc: '50 messages dans le chat', test: (x) => x.messages >= 50 },
  { id: 'planner', emoji: '🔖', name: 'Prévoyant', desc: '15 titres dans « À voir »', test: (x) => x.watchlist >= 15 },
  { id: 'first', emoji: '🥇', name: 'Premier de la famille', desc: 'Le plus de points', test: (x, rank) => rank === 1 },
];
let rewardsCache = null;
async function rewardsBoard(token) {
  if (rewardsCache && Date.now() - rewardsCache.at < 10 * 60_000) return rewardsCache.value;
  const users = ((await jfJson(token, '/Users').catch(() => [])) || []).filter((u) => !(u.Policy && u.Policy.IsDisabled));
  const rows = [];
  for (const u of users) {
    const q = (types, filter) =>
      jfJson(token, `/Users/${u.Id}/Items?Recursive=true&IncludeItemTypes=${types}&Filters=${filter}&Fields=RunTimeTicks&EnableImages=false`).catch(() => ({ Items: [] }));
    const [played, favs] = await Promise.all([q('Movie,Episode', 'IsPlayed'), q('Movie,Series,Episode', 'IsFavorite')]);
    const items = (played && played.Items) || [];
    const ticks = items.reduce((n, x) => n + (x.RunTimeTicks || 0), 0);
    const x = {
      id: u.Id,
      name: u.Name,
      hours: Math.round(ticks / 36e9),
      movies: items.filter((i) => i.Type === 'Movie').length,
      episodes: items.filter((i) => i.Type === 'Episode').length,
      likes: ((favs && favs.Items) || []).length,
      ratings: Object.values(ratings).filter((e) => e.votes && e.votes[u.Id]).length,
      requests: requests.filter((r) => r.requestedBy && r.requestedBy.id === u.Id).length,
      messages: messages.filter((m) => m.userId === u.Id).length,
      watchlist: (watchlists[u.Id] || []).length,
    };
    x.points = x.hours * 10 + x.ratings * 15 + x.likes * 3 + x.requests * 5 + x.messages * 1 + x.watchlist * 2;
    rows.push(x);
  }
  rows.sort((a, b) => b.points - a.points);
  rows.forEach((x, i) => {
    x.rank = i + 1;
    const g = [...GRADES].reverse().find((g) => x.points >= g.min) || GRADES[0];
    const next = GRADES.find((n) => n.min > x.points) || null;
    x.grade = { name: g.name, emoji: g.emoji, min: g.min, tier: g.tier, bonus: g.bonus };
    x.next = next ? { name: next.name, emoji: next.emoji, min: next.min, tier: next.tier } : null;
    x.badges = BADGES.filter((b) => b.test(x, x.rank)).map(({ id, emoji, name, desc }) => ({ id, emoji, name, desc }));
  });
  const value = { users: rows, grades: GRADES, badges: BADGES.map(({ id, emoji, name, desc }) => ({ id, emoji, name, desc })) };
  rewardsCache = { at: Date.now(), value };
  return value;
}

// Classement recalculé régulièrement : les bonus de rang (quotas) restent à jour même si personne n'ouvre les stats
setInterval(() => {
  const t = jfAdminToken || process.env.JELLYFIN_API_KEY;
  if (t) rewardsBoard(t).catch(() => {});
}, 15 * 60_000);

/** Saisons d'une série dans la numérotation de Sonarr (TheTVDB), avec le nombre d'épisodes. */
async function arrSeasons(tvdbId) {
  if (arrOff() && tvdbId) {
    // Sans Sonarr : saisons d'après TMDB (identifiant TVDB → série TMDB)
    const f = await tmdbGet(`/find/${tvdbId}`, { external_source: 'tvdb_id' }).catch(() => null);
    const id = f && f.tv_results && f.tv_results[0] && f.tv_results[0].id;
    const tv = id ? await tmdbGet(`/tv/${id}`).catch(() => null) : null;
    if (!tv) return null;
    return (tv.seasons || []).filter((x) => x.season_number > 0).map((x) => ({ seasonNumber: x.season_number, episodes: x.episode_count || null })).sort((a, b) => a.seasonNumber - b.seasonNumber);
  }
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
  if (r.via === 'auto' && r.status === RequestStatus.APPROVED) return autoDownloadOf(r);
  // Groupe de secours : progression des téléchargements Lumio Secour (même forme que la file Radarr / Sonarr)
  if (r.via === 'secour' && r.status === RequestStatus.APPROVED && r.secour) {
    const cur = r.secour.items.find((i) => i.status === 'downloading' || i.status === 'searching');
    const job = cur && cur.download ? downloads.find((d) => d.id === cur.download) : null;
    const pct = job && job.size ? Math.round((job.done / job.size) * 100) : null;
    return {
      state: 'downloading',
      via: 'secour',
      progress: r.secour.total > 1 ? Math.round(((r.secour.done + (pct || 0) / 100) / r.secour.total) * 100) : pct,
      count: r.secour.total > 1 ? r.secour.total - r.secour.done : undefined,
      title: cur ? `Lumio Secour${cur.label ? ` · ${cur.label}` : ''}${cur.status === 'searching' ? ' · recherche' : ''}` : 'Lumio Secour · en attente',
    };
  }
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
  if (autoOn() || r.via === 'auto') return autoRecheck(r);
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

// ——— Plateformes (mode « production ») : Netflix, Disney+, Prime Video, Apple TV+, Max, Canal+ ———
// Dans ta bibliothèque : titres dont le studio / la chaîne (renseignés par Jellyfin depuis TMDB) correspond à la plateforme.
// Dernières sorties : créations récentes de la plateforme (TMDB : chaînes pour les séries, sociétés de production pour les films),
// marquées « sur ton serveur » ou non, pour pouvoir demander ce qu'on a raté.
const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', provider: 8, color: '#E50914', networks: [213], companies: ['Netflix'], studio: /netflix/i },
  {
    id: 'disney',
    name: 'Disney+',
    provider: 337,
    color: '#113CCF',
    networks: [2739],
    companies: ['Walt Disney Pictures', 'Pixar', 'Marvel Studios', 'Lucasfilm Ltd.', 'Walt Disney Animation Studios'],
    studio: /disney|pixar|marvel studios|lucasfilm/i,
  },
  { id: 'prime', name: 'Prime Video', provider: 119, color: '#00A8E1', networks: [1024], companies: ['Amazon Studios', 'Amazon MGM Studios'], studio: /amazon|prime video/i },
  { id: 'apple', name: 'Apple TV+', provider: 350, color: '#8E8E93', networks: [2552], companies: ['Apple Studios', 'Apple Original Films'], studio: /apple tv|apple studios|apple original/i },
  { id: 'max', name: 'Max', provider: 1899, color: '#002BE7', networks: [49, 3186], companies: ['HBO Films'], studio: /\bhbo\b|^max$/i },
  { id: 'canal', name: 'Canal+', provider: 381, color: '#1A1A1A', networks: [285], companies: ['Canal+', 'StudioCanal'], studio: /canal\+|studiocanal/i },
];
let providerIcons = null; // provider_id → chemin de l'icône (TMDB, France)
async function providerIcon(id) {
  if (!id) return null;
  if (!providerIcons) {
    const map = {};
    for (const kind of ['movie', 'tv']) {
      const r = await tmdbGet(`/watch/providers/${kind}`, { watch_region: 'FR' }).catch(() => null);
      for (const x of (r && r.results) || []) if (x.logo_path && !map[x.provider_id]) map[x.provider_id] = x.logo_path;
    }
    if (!Object.keys(map).length) return null;
    providerIcons = map;
  }
  return providerIcons[id] ? `https://image.tmdb.org/t/p/w300${providerIcons[id]}` : null;
}
const platformMeta = new Map(); // id → { logo, networks (vérifiés), companies (ids), at }
async function platformInfo(pf) {
  const hit = platformMeta.get(pf.id);
  if (hit && Date.now() - hit.at < 7 * 86400e3) return hit;
  // Chaînes : identifiants TMDB vérifiés par leur nom (une chaîne inconnue est ignorée) ; logo de la première
  let logo = null;
  const networks = [];
  for (const id of pf.networks) {
    const n = await tmdbGet(`/network/${id}`).catch(() => null);
    if (!n || !n.name) continue;
    networks.push(id);
    if (!logo && n.logo_path) logo = n.logo_path;
  }
  // Sociétés de production : retrouvées par leur nom exact
  const companies = [];
  for (const name of pf.companies) {
    const r = await tmdbGet('/search/company', { query: name }).catch(() => null);
    const exact = ((r && r.results) || []).filter((c) => String(c.name).toLowerCase() === name.toLowerCase());
    for (const c of exact.slice(0, 2)) {
      companies.push(c.id);
      if (!logo && c.logo_path) logo = c.logo_path;
    }
  }
  // Icône officielle en couleur (celle de l'appli, carrée) : plus belle et toujours lisible, contrairement aux logos recolorés
  const icon = await providerIcon(pf.provider).catch(() => null);
  const v = { logo: logo ? `https://image.tmdb.org/t/p/w300${logo}` : null, icon, networks, companies, at: Date.now() };
  platformMeta.set(pf.id, v);
  return v;
}

/** Bibliothèque Jellyfin avec studios / chaînes (gardée 30 min). */
let studioLib = null;
async function jfStudioLibrary(token) {
  if (studioLib && Date.now() - studioLib.at < 30 * 60_000) return studioLib.items;
  const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Series', Fields: 'Studios,ProviderIds,PremiereDate,DateCreated', EnableImages: 'false', EnableUserData: 'false' });
  const r = await fetch(`${JELLYFIN_URL}/Items?${q}`, { headers: jfHeaders(token) });
  if (!r.ok) throw new HttpError(502, `Jellyfin : HTTP ${r.status}`);
  const items = ((await r.json()).Items || [])
    .map((i) => ({
      type: i.Type === 'Series' ? 'tv' : 'movie',
      tmdbId: Number(i.ProviderIds && i.ProviderIds.Tmdb) || 0,
      title: i.Name,
      year: i.ProductionYear ? String(i.ProductionYear) : undefined,
      date: i.PremiereDate || (i.ProductionYear ? `${i.ProductionYear}-01-01` : null),
      added: i.DateCreated || null,
      studios: (i.Studios || []).map((x) => x.Name).filter(Boolean),
    }))
    .filter((i) => i.tmdbId);
  studioLib = { at: Date.now(), items };
  return items;
}

/** Affiches TMDB (en cache), quelques-unes à la fois. */
async function withPosters(list) {
  const out = [...list];
  let i = 0;
  const worker = async () => {
    while (i < out.length) {
      const k = i++;
      const x = out[k];
      if (x.poster) continue;
      const art = await tmdbArt(x.type, x.tmdbId).catch(() => null);
      out[k] = { ...x, poster: art && art.p ? `https://image.tmdb.org/t/p/w342${art.p}` : null };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

const platformCache = new Map(); // `${id}:${sort}` → { at, value }
async function platformPage(pf, token, sort) {
  const key = `${pf.id}:${sort}`;
  const hit = platformCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.value;
  const info = await platformInfo(pf);
  const all = await jfStudioLibrary(token);
  const onServer = new Set(all.map((x) => `${x.type}:${x.tmdbId}`));
  const byDate = (a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0);
  const order = (list) => (sort === 'asc' ? [...list].sort(byDate).reverse() : [...list].sort(byDate));

  // Sur ton serveur
  const library = order(all.filter((x) => x.studios.some((n) => pf.studio.test(n)))).map(({ studios, added, ...x }) => ({ ...x, available: true }));

  // Dernières sorties de la plateforme (films et séries déjà sortis)
  const today = new Date().toISOString().slice(0, 10);
  const latest = [];
  if (info.companies.length) {
    for (const page of [1, 2]) {
      const d = await tmdbGet('/discover/movie', {
        with_companies: info.companies.join('|'),
        sort_by: 'primary_release_date.desc',
        'primary_release_date.lte': today,
        'vote_count.gte': '10',
        include_adult: 'false',
        page: String(page),
      }).catch(() => null);
      for (const m of (d && d.results) || [])
        latest.push({ type: 'movie', tmdbId: m.id, title: m.title, year: (m.release_date || '').slice(0, 4) || undefined, date: m.release_date || null, poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null });
    }
  }
  if (info.networks.length) {
    for (const page of [1, 2]) {
      const d = await tmdbGet('/discover/tv', {
        with_networks: info.networks.join('|'),
        sort_by: 'first_air_date.desc',
        'first_air_date.lte': today,
        'vote_count.gte': '5',
        include_adult: 'false',
        page: String(page),
      }).catch(() => null);
      for (const t of (d && d.results) || [])
        latest.push({ type: 'tv', tmdbId: t.id, title: t.name, year: (t.first_air_date || '').slice(0, 4) || undefined, date: t.first_air_date || null, poster: t.poster_path ? `https://image.tmdb.org/t/p/w342${t.poster_path}` : null });
    }
  }
  const seen = new Set();
  const latestOut = order(latest.filter((x) => !seen.has(`${x.type}:${x.tmdbId}`) && seen.add(`${x.type}:${x.tmdbId}`)))
    .slice(0, 60)
    .map((x) => ({ ...x, available: onServer.has(`${x.type}:${x.tmdbId}`) }));

  const libraryOut = await withPosters(library);
  // Tout mélangé (sur ton serveur ou à demander), par date de sortie : surtout les dernières sorties
  const mixed = new Map();
  for (const x of [...latestOut, ...libraryOut]) if (!mixed.has(`${x.type}:${x.tmdbId}`)) mixed.set(`${x.type}:${x.tmdbId}`, x);
  const items = order([...mixed.values()]).slice(0, 120);
  const value = { id: pf.id, name: pf.name, logo: info.logo, icon: info.icon || null, color: pf.color, items, library: libraryOut, latest: latestOut };
  platformCache.set(key, { at: Date.now(), value });
  return value;
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
  if (autoOn()) return autoQueue();
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
  // Lumio Auto avec qBittorrent : qBittorrent et le VPN (port ouvert) sont surveillés
  const qc = (config.auto && config.auto.qbit) || {};
  if (config.auto && (config.auto.enabled || config.auto.arrRemoved) && qc.url) {
    const t0 = Date.now();
    try {
      const ver = await (await qbitFetch('/api/v2/app/version')).text();
      out.qbit = { ok: true, configured: true, ms: Date.now() - t0, version: ver.replace(/^v/, '') };
    } catch (e) {
      out.qbit = { ok: false, configured: true, ms: Date.now() - t0, error: e.message };
    }
    out.vpn = vpnPort.port
      ? { ok: true, configured: true, ms: 0, version: `port ${vpnPort.port}` }
      : { ok: false, configured: true, ms: 0, error: vpnPort.error || 'aucun port ouvert' };
  }
  await Promise.all(
    ['radarr', 'sonarr'].map(async (kind) => {
      if (arrOff()) return;
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
    // Radarr / Sonarr retirés : on oublie leur historique
    if (arrOff() && (uptime.radarr || uptime.sonarr)) {
      delete uptime.radarr;
      delete uptime.sonarr;
    }
    for (const key of ['lumio', 'jellyfin', 'radarr', 'sonarr', 'qbit', 'vpn']) {
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

const UPTIME_NAMES = { lumio: 'Serveur Lumio', jellyfin: 'Jellyfin', radarr: 'Radarr', sonarr: 'Sonarr', qbit: 'qBittorrent', vpn: 'VPN (ProtonVPN)' };
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
  return { id: f.id, name: f.name || name.replace(/\.torrent$/i, ''), ready: Boolean(f.ready) };
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

// ——— Lumio Secour intégré : le moteur de liens (fork de WAStream, en Python) tourne dans ce conteneur ———
// Lancé et surveillé par ce serveur, il n'écoute que sur 127.0.0.1 : rien n'est exposé, ce n'est plus un addon Stremio.
// Désactivable avec LUMIO_SECOUR_EMBEDDED=0 (ou remplacé par un service à part avec LUMIO_SECOUR_URL).
// Réglages du moteur par variables d'environnement : préfixe SECOUR_ (ex. SECOUR_WAWACITY_URL=https://…), ou depuis l'appli.
// Python du moteur : image récente (/opt/secour), sinon installé tout seul dans /data/secour (voir installSecourEngine)
const SECOUR_VENV = path.join(DATA_DIR, 'secour', 'venv');
const secourPy = () =>
  process.env.LUMIO_SECOUR_PYTHON || (fs.existsSync('/opt/secour/bin/python') ? '/opt/secour/bin/python' : path.join(SECOUR_VENV, 'bin', 'python'));
const SECOUR_PORT = Number(process.env.LUMIO_SECOUR_PORT || 7010);
let secourProc = null;
let secourRestarts = 0;
let secourInstall = null; // { state: 'installing' | 'error', message }
const secourWanted = () => !process.env.LUMIO_SECOUR_URL && process.env.LUMIO_SECOUR_EMBEDDED !== '0';
const secourEmbedded = () => secourWanted() && fs.existsSync(secourPy());

/** Lance une commande, renvoie sa sortie (erreur si le code de sortie n'est pas 0). */
function run(cmd, args, { input, timeout = 15 * 60_000 } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => c.kill('SIGKILL'), timeout);
    c.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    c.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} : code ${code} — ${out.trim().split('\n').slice(-4).join(' | ')}`));
    });
    if (input) {
      c.stdin.end(input);
    }
  });
}

/**
 * Installation sans SSH : avec l'ancienne image (node:alpine, sans Python), le serveur installe lui-même
 * Python (apk) et le moteur Lumio Secour (code de cette version, pris sur GitHub) dans /data/secour.
 * Refait à chaque nouvelle version du serveur, et Python est remis après une reconstruction du conteneur.
 */
async function installSecourEngine() {
  if (!secourWanted() || process.env.LUMIO_SECOUR_PYTHON || fs.existsSync('/opt/secour/bin/python') || secourInstall?.state === 'installing') return;
  const dir = path.join(DATA_DIR, 'secour');
  const stamp = path.join(dir, 'engine.json');
  const done = readJson(stamp, {});
  const pyOk = fs.existsSync('/usr/bin/python3');
  if (done.version === VERSION && pyOk && fs.existsSync(path.join(SECOUR_VENV, 'bin', 'python'))) return;
  if (!fs.existsSync('/sbin/apk')) return; // autre système : il faut l'image Docker récente
  secourInstall = { state: 'installing', message: 'Installation de Lumio Secour…' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!pyOk) {
      console.log('Lumio Secour : installation de Python dans le conteneur…');
      await run('apk', ['add', '--no-cache', 'python3']);
    }
    if (done.version !== VERSION || !fs.existsSync(path.join(SECOUR_VENV, 'bin', 'python'))) {
      console.log(`Lumio Secour : téléchargement du moteur (serveur ${VERSION})…`);
      const ref = process.env.LUMIO_SECOUR_REF || 'main';
      const r = await fetch(`https://codeload.github.com/nono7444/lumio/tar.gz/refs/heads/${ref}`);
      if (!r.ok) throw new Error(`GitHub : HTTP ${r.status}`);
      const tgz = Buffer.from(await r.arrayBuffer());
      const src = path.join(dir, 'src');
      fs.rmSync(src, { recursive: true, force: true });
      fs.mkdirSync(src, { recursive: true });
      await run('tar', ['-xz', '-C', src, '--strip-components=4', `lumio-${ref}/server/lumio/secour`], { input: tgz });
      if (!fs.existsSync(path.join(src, 'pyproject.toml'))) throw new Error('code du moteur introuvable dans l’archive GitHub');
      fs.rmSync(SECOUR_VENV, { recursive: true, force: true });
      await run('python3', ['-m', 'venv', SECOUR_VENV]);
      const pip = path.join(SECOUR_VENV, 'bin', 'pip');
      try {
        await run(pip, ['install', '--no-cache-dir', '--quiet', src]);
      } catch (e) {
        // Paquet sans version précompilée pour alpine : outils de compilation, puis nouvel essai
        console.log(`Lumio Secour : compilation nécessaire (${e.message.slice(0, 160)})`);
        await run('apk', ['add', '--no-cache', 'build-base', 'python3-dev', 'libffi-dev']);
        await run(pip, ['install', '--no-cache-dir', '--quiet', src]);
      }
      writeJson(stamp, { version: VERSION, at: new Date().toISOString() });
    }
    secourInstall = null;
    console.log('Lumio Secour : moteur installé');
    startEmbeddedSecour();
  } catch (e) {
    secourInstall = { state: 'error', message: `Installation de Lumio Secour impossible : ${String((e && e.message) || e).slice(0, 300)}` };
    console.log(secourInstall.message);
    setTimeout(() => {
      secourInstall = null;
      installSecourEngine();
    }, 30 * 60_000);
  }
}

function startEmbeddedSecour() {
  if (!secourEmbedded() || secourProc) return;
  // Secrets propres au moteur : créés une fois, gardés dans config.json (jamais dans Git ni dans l'appli)
  if (!config.secourEmbeddedKey) config.secourEmbeddedKey = crypto.randomBytes(24).toString('hex');
  if (!config.secourSecret) config.secourSecret = crypto.randomBytes(32).toString('hex');
  saveConfig();
  const dir = path.join(DATA_DIR, 'secour');
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: dir,
    TZ: process.env.TZ || 'Europe/Paris',
    PORT: String(SECOUR_PORT),
    LUMIO_SECOUR_HOST: '127.0.0.1',
    LUMIO_API_KEY: config.secourEmbeddedKey,
    SECRET_KEY: config.secourSecret,
    DATABASE_TYPE: 'sqlite',
    DATABASE_PATH: path.join(dir, 'secour.db'),
    LOG_LEVEL: process.env.SECOUR_LOG_LEVEL || 'INFO',
    // Contrôle des sites : une fois par nuit vers minuit (déclenché par ce serveur), plus toutes les minutes
    HEALTH_CHECK_INTERVAL: process.env.SECOUR_HEALTH_CHECK_INTERVAL || String(7 * 86400),
    DOMAIN_SYNC_INTERVAL: process.env.SECOUR_DOMAIN_SYNC_INTERVAL || String(7 * 86400),
  };
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('SECOUR_') && k !== 'SECOUR_LOG_LEVEL') env[k.slice(7)] = v;
  const { spawn } = require('child_process');
  const child = spawn(secourPy(), ['-m', 'lumio_secour.main'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  secourProc = child;
  const log = (buf) => {
    for (const line of String(buf).split('\n')) {
      // eslint-disable-next-line no-control-regex
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (clean && !/\| DEBUG/.test(clean)) console.log(`[Secour] ${clean.slice(0, 400)}`);
      // Un site a changé d'adresse (redirection suivie par le moteur) : l'admin est prévenu
      const moved = clean.match(/\[Lumio\] (.+?) a déménagé : (\S+) → (\S+)/);
      if (moved) notify({ title: '🛟 Lumio Secour : nouvelle adresse', message: `${moved[1]} : ${moved[2]} → ${moved[3]} (mise à jour toute seule)`, tags: ['globe_with_meridians'] }).catch(() => {});
    }
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('error', (e) => console.log(`Lumio Secour : démarrage impossible — ${e.message}`));
  child.on('exit', (code) => {
    secourProc = null;
    const wait = Math.min(60, 5 * ++secourRestarts);
    console.log(`Lumio Secour arrêté (code ${code}), relance dans ${wait} s`);
    setTimeout(startEmbeddedSecour, wait * 1000);
  });
  setTimeout(() => (secourRestarts = 0), 120_000);
  console.log(`Lumio Secour intégré lancé (127.0.0.1:${SECOUR_PORT})`);
}
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    if (secourProc) secourProc.kill('SIGTERM');
    process.exit(0);
  });

/** Après un téléchargement Lumio Secour : Radarr / Sonarr arrêtent de chercher ce titre (pas de doublon), sans rien effacer. */
async function arrHandOff(r) {
  try {
    if (r.type === 'movie') {
      if (!arrConfig('radarr')) return;
      const m = (await arr('radarr', `/movie?tmdbId=${r.tmdbId}`))[0];
      if (!m) return;
      if (m.monitored) await arr('radarr', `/movie/${m.id}`, { method: 'PUT', body: JSON.stringify({ ...m, monitored: false }) });
      const q = await arr('radarr', '/queue?page=1&pageSize=200').catch(() => ({ records: [] }));
      for (const x of (q.records || []).filter((x) => x.movieId === m.id))
        await arr('radarr', `/queue/${x.id}?removeFromClient=true&blocklist=false`, { method: 'DELETE' }).catch(() => {});
    } else {
      if (!arrConfig('sonarr') || !r.tvdbId) return;
      const s = (await arr('sonarr', `/series?tvdbId=${r.tvdbId}`))[0];
      if (!s) return;
      const wanted = new Set((r.seasons || []).map(Number));
      if (s.seasons.some((x) => wanted.has(x.seasonNumber) && x.monitored))
        await arr('sonarr', `/series/${s.id}`, { method: 'PUT', body: JSON.stringify({ ...s, seasons: s.seasons.map((x) => (wanted.has(x.seasonNumber) ? { ...x, monitored: false } : x)) }) });
      const q = await arr('sonarr', '/queue?page=1&pageSize=500&includeEpisode=true').catch(() => ({ records: [] }));
      for (const x of (q.records || []).filter((x) => x.seriesId === s.id && (!x.episode || wanted.has(x.episode.seasonNumber))))
        await arr('sonarr', `/queue/${x.id}?removeFromClient=true&blocklist=false`, { method: 'DELETE' }).catch(() => {});
    }
    console.log(`Lumio Secour : « ${r.title} » retiré de la recherche ${r.type === 'movie' ? 'Radarr' : 'Sonarr'}`);
  } catch (e) {
    console.log(`Lumio Secour : ${r.type === 'movie' ? 'Radarr' : 'Sonarr'} pas mis à jour pour « ${r.title} » (${e.message})`);
  }
}

// ——— Chaque nuit vers minuit (heure de Paris) : contrôle des sites, nouvelles adresses suivies toutes seules ———
setInterval(async () => {
  if (!secourUrl() || !secourKey()) return;
  const now = new Date();
  const paris = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (t) => (paris.find((x) => x.type === t) || {}).value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  if (part('hour') !== '00' || config.secourNightly === day) return;
  config.secourNightly = day;
  saveConfig();
  try {
    const r = await secour('/lumio/check', { method: 'POST', timeout: 300000 });
    console.log(`Lumio Secour : contrôle de nuit — ${r.summary ? `${r.summary.online}/${r.summary.total} sources en ligne` : 'fait'}`);
  } catch (e) {
    console.log(`Lumio Secour : contrôle de nuit impossible — ${e.message}`);
  }
}, 5 * 60_000);

// ——— Groupe de secours : quand Radarr / Sonarr ne marchent plus, Lumio Secour prend le relais ———
// La demande reste « approuvée » : Lumio cherche les liens, les convertit avec la clé AllDebrid du serveur
// et range les fichiers façon Jellyfin (Films/Titre (année)/…, Séries/Titre (année)/Season 01/…), un à la fois.
const secourAutoOn = () => config.secourAuto !== false && Boolean(secourUrl() && secourKey()) && Boolean(secourDebridKey()) && disks().length > 0;

/** Dossier de destination : réglé dans l'appli, sinon SECOUR_MOVIES / SECOUR_SERIES (« disque:dossier »), sinon deviné. */
function secourTarget(kind, r) {
  const set = (config.secourTargets || {})[kind];
  if (set && disks().some((d) => d.name === set.root)) return set;
  const envv = process.env[kind === 'movie' ? 'SECOUR_MOVIES' : 'SECOUR_SERIES'];
  if (envv && envv.includes(':')) {
    const [root, ...rest] = envv.split(':');
    if (disks().some((d) => d.name === root)) return { root, folder: rest.join(':').replace(/^\/+|\/+$/g, '') };
  }
  // Même nom de dossier que dans Radarr / Sonarr (ex. /movies/Films → « Films » sur un des disques)
  const wanted = r && r.rootFolderPath ? String(r.rootFolderPath).replace(/\/+$/, '').split('/').pop() : '';
  const guesses = [wanted, ...(kind === 'movie' ? ['Films', 'films', 'Movies', 'movies'] : ['Séries', 'Series', 'séries', 'series', 'TV', 'tv'])].filter(Boolean);
  for (const g of guesses) for (const d of disks()) if (fs.existsSync(path.join(d.dir, g))) return { root: d.name, folder: g };
  const d = disks()[0];
  return d ? { root: d.name, folder: kind === 'movie' ? 'Films' : 'Séries' } : null;
}
function secourAutoView() {
  return {
    enabled: config.secourAuto !== false,
    force: Boolean(config.secourForce),
    ready: secourAutoOn(),
    alldebrid: Boolean(secourDebridKey()),
    service: secourService(),
    engine: Boolean(secourUrl() && secourKey()),
    disks: disks().map((d) => d.name),
    movie: secourTarget('movie'),
    tv: secourTarget('tv'),
    queue: secourQueue.length + (secourBusy ? 1 : 0),
  };
}

/** Envoie à Radarr / Sonarr ; s'ils sont hors service, bascule sur le groupe de secours. */
async function sendOrSecour(r) {
  // Lumio Auto actif : il remplace Radarr / Sonarr
  if (autoOn()) {
    await autoFromRequest(r);
    return;
  }

  // Simulation (admin) : Radarr / Sonarr considérés en panne, tout passe par Lumio Secour
  if (config.secourForce && secourAutoOn()) {
    startSecour(r, 'simulation : Radarr / Sonarr considérés en panne');
    return;
  }
  try {
    await sendToArr(r);
    if (r.via === 'secour' && r.secour && r.secour.state !== 'running') delete r.via;
  } catch (e) {
    if (!(e && e.arrDown) || !secourAutoOn()) throw e;
    if (r.via === 'secour' && r.secour && ['queued', 'running'].includes(r.secour.state)) return;
    startSecour(r, e.message);
  }
}

const secourQueue = [];
// Demande refusée ou supprimée pendant le travail : on s'arrête
const secourStopped = (r) => !requests.includes(r) || r.status === RequestStatus.DECLINED || !r.secour || r.secour.state === 'cancelled';
let secourBusy = false;
function startSecour(r, reason, opts = {}) {
  if (!secourUrl() || !secourKey()) throw new HttpError(400, 'Lumio Secour n’est pas prêt');
  if (!secourDebridKey()) throw new HttpError(400, `Clé ${secourServiceName()} non configurée (Lumio Secour)`);
  if (!secourTarget(r.type === 'movie' ? 'movie' : 'tv', r)) throw new HttpError(400, 'Aucun disque configuré (LUMIO_DISKS)');
  r.status = RequestStatus.APPROVED;
  r.via = 'secour';
  r.secour = { state: 'queued', reason: String(reason || '').slice(0, 200), startedAt: new Date().toISOString(), done: 0, total: 0, items: [] };
  // Source imposée (bouton « DL » → choix du site), sinon toutes les sources
  if (opts.source) r.secour.source = String(opts.source).slice(0, 60);
  delete r.error;
  saveRequests();
  if (!secourQueue.includes(r.id)) secourQueue.push(r.id);
  console.log(`Groupe de secours : « ${r.title} » confié à Lumio Secour (${r.secour.reason})`);
  notify({ title: '🛟 Lumio Secour prend le relais', message: `${r.title} — ${r.secour.reason}`, tags: ['sos'], image: r.poster, click: 'lumio://activity' }).catch(() => {});
  runSecourQueue();
}

const cleanName = (t) => String(t || 'Sans titre').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const pad2 = (n) => String(n).padStart(2, '0');

/** Classe les liens : dispo AllDebrid, français / multi, 1080p, puis taille raisonnable. */
function rankSecourLinks(links) {
  const lang = (l) => {
    const t = String(l || '');
    if (/multi/i.test(t)) return 0;
    if (/vostfr|sub/i.test(t)) return 30;
    if (/fr|vf/i.test(t)) return 2;
    if (/unknown/i.test(t)) return 20;
    return 40;
  };
  const res = (q) => {
    const t = String(q || '');
    if (/1080/.test(t)) return 0;
    if (/2160|4k|uhd/i.test(t)) return 8;
    if (/720/.test(t)) return 10;
    return 25;
  };
  const size = (b) => (!b ? 6 : b > 25e9 ? 12 : b < 300e6 ? 15 : 0);
  return [...links].sort((a, b) => (a.cached ? 0 : 100) + lang(a.language) + res(a.quality) + size(a.sizeBytes) - ((b.cached ? 0 : 100) + lang(b.language) + res(b.quality) + size(b.sizeBytes)));
}

/** Cherche et télécharge un film ou un épisode ; essaie les meilleurs liens l'un après l'autre. */
async function secourGrab(r, item, target, folder, baseName, query) {
  const dir = safePath(target.root, folder).full;
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${baseName}.`) && !f.endsWith('.part')) : null;
  if (existing) {
    item.status = 'present';
    return true;
  }
  item.status = 'searching';
  const qs = new URLSearchParams(query);
  const found = await secour(`/lumio/links?${qs}`, { timeout: 120000 });
  const wanted = r.secour && r.secour.source ? r.secour.source.toLowerCase() : '';
  const all = (found && found.links) || [];
  const candidates = rankSecourLinks(wanted ? all.filter((l) => String(l.source || '').toLowerCase() === wanted) : all).slice(0, 6);
  if (!candidates.length) {
    item.status = 'notfound';
    item.error = wanted ? `Aucun lien sur ${r.secour.source}${all.length ? ` (${all.length} ailleurs)` : ''}` : 'Aucun lien trouvé';
    return false;
  }
  for (const l of candidates) {
    if (secourStopped(r)) return false;
    const job = {
      id: crypto.randomBytes(5).toString('hex'), link: l.link, root: target.root, folder, status: 'queued', quiet: true,
      name: `${r.title}${item.label ? ` · ${item.label}` : ''}`, baseName, size: Number(l.sizeBytes) || 0, done: 0, speed: 0,
      token: process.env.JELLYFIN_API_KEY || jfAdminToken || jfIndexToken, createdAt: new Date().toISOString(),
      secour: { link: l.link, hoster: l.hoster, source: l.source, season: l.season, episode: l.episode, type: query.type },
    };
    downloads.push(job);
    item.status = 'downloading';
    item.download = job.id;
    item.quality = l.quality;
    await runDownload(job);
    if (job.status === 'done') {
      item.status = 'done';
      delete item.error;
      return true;
    }
    item.error = job.error || 'échec';
    console.log(`Groupe de secours : ${job.name} — lien ${l.hoster} en échec (${item.error}), lien suivant`);
  }
  item.status = 'error';
  return false;
}

async function processSecour(r) {
  const s = r.secour;
  s.state = 'running';
  s.items = [];
  const kind = r.type === 'movie' ? 'movie' : 'tv';
  const target = secourTarget(kind, r);
  const ext = await tmdbGet(`/${kind}/${r.tmdbId}/external_ids`).catch(() => null);
  const imdb = ext && ext.imdb_id;
  if (!imdb) throw new Error('Identifiant IMDb introuvable sur TMDB');
  const show = `${cleanName(r.title)}${r.year ? ` (${r.year})` : ''}`;
  if (kind === 'movie') {
    const item = { label: '', status: 'queued' };
    s.items.push(item);
    s.total = 1;
    saveRequests();
    const ok = await secourGrab(r, item, target, path.posix.join(target.folder, show), show, { imdb, type: 'movie' });
    s.done = ok ? 1 : 0;
    if (!ok) throw new Error(item.error || 'aucun lien utilisable');
    return;
  }
  // Séries : épisodes déjà sortis des saisons demandées
  const today = new Date().toISOString().slice(0, 10);
  for (const n of (r.seasons || []).map(Number).filter((x) => x > 0)) {
    const season = await tmdbGet(`/tv/${r.tmdbId}/season/${n}`).catch(() => null);
    for (const ep of (season && season.episodes) || []) if (ep.air_date && ep.air_date <= today) s.items.push({ label: `S${pad2(n)}E${pad2(ep.episode_number)}`, season: n, episode: ep.episode_number, status: 'queued' });
  }
  s.total = s.items.length;
  saveRequests();
  if (!s.total) throw new Error('Aucun épisode sorti pour ces saisons');
  for (const item of s.items) {
    if (secourStopped(r)) return;
    try {
      const ok = await secourGrab(r, item, target, path.posix.join(target.folder, show, `Season ${pad2(item.season)}`), `${show} - ${item.label}`, {
        imdb, type: 'series', season: String(item.season), episode: String(item.episode),
      });
      if (ok) s.done += 1;
    } catch (e) {
      item.status = 'error';
      item.error = String((e && e.message) || e);
    }
    saveRequests();
  }
  if (!s.done) throw new Error('Aucun épisode trouvé');
}

async function runSecourQueue() {
  if (secourBusy) return;
  secourBusy = true;
  try {
    while (secourQueue.length) {
      const r = requests.find((x) => x.id === secourQueue[0]);
      if (r && r.via === 'secour' && r.status === RequestStatus.APPROVED) {
        try {
          await processSecour(r);
          r.secour.state = 'done';
          r.status = RequestStatus.COMPLETED;
          r.completedAt = new Date().toISOString();
          arrHandOff(r).catch(() => {});
          const missing = r.secour.items.filter((i) => !['done', 'present'].includes(i.status)).length;
          const what = r.type === 'tv' ? ` (${r.secour.done}/${r.secour.total} épisodes${missing ? `, ${missing} introuvable${missing > 1 ? 's' : ''}` : ''})` : '';
          notify({ title: '🛟 Disponible via Lumio Secour', message: `${r.title}${what} · demandé par ${r.requestedBy.name}`, tags: ['tada'], image: r.poster }).catch(() => {});
          notifyFamily({ title: '🎉 Disponible', message: `${r.title} est prêt à regarder`, tags: ['tada'], image: r.poster, click: 'lumio://' });
        } catch (e) {
          if (r.secour.state !== 'cancelled') {
            r.secour.state = 'error';
            r.status = RequestStatus.FAILED;
            r.error = `Lumio Secour : ${String((e && e.message) || e)}`;
            notify({ title: '🛟 Lumio Secour : échec', message: `${r.title} — ${r.error}`, tags: ['warning'], image: r.poster }).catch(() => {});
          }
        }
        saveRequests();
        library = null;
      }
      secourQueue.shift();
    }
  } finally {
    secourBusy = false;
  }
}

// ——— Service de téléchargement de Lumio Secour : AllDebrid (clé gardée sur ce serveur) ———
const secourService = () => 'alldebrid';
const secourDebridKey = () => process.env.ALLDEBRID_KEY || config.alldebridKey || '';
const secourServiceName = () => 'AllDebrid';

// ——— Lumio Secour : liens d'hébergeurs pour un film ou un épisode ———
// Adresse et clé : LUMIO_SECOUR_URL / LUMIO_SECOUR_KEY, ou envoyées par l'appli de l'admin.
// La clé AllDebrid reste ici : elle est transmise à Lumio Secour à chaque appel, jamais à l'appli.
// Intégré : le moteur tourne dans le même conteneur (127.0.0.1) et a priorité sur une ancienne adresse enregistrée.
const secourUrl = () => (process.env.LUMIO_SECOUR_URL || (secourEmbedded() ? `http://127.0.0.1:${SECOUR_PORT}` : config.secourUrl) || '').replace(/\/+$/, '');
const secourKey = () => process.env.LUMIO_SECOUR_KEY || (secourEmbedded() ? config.secourEmbeddedKey : config.secourKey) || '';
async function secour(pathname, { method = 'GET', body, timeout = 60000 } = {}) {
  if (!secourUrl() || !secourKey()) throw new HttpError(400, 'Lumio Secour n’est pas configuré');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const adKey = secourDebridKey();
    const tk = tmdbKey();
    const r = await fetch(`${secourUrl()}${pathname}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'X-Lumio-Key': secourKey(),
        ...(adKey ? { 'X-Debrid-Key': adKey, 'X-Debrid-Service': secourService() } : {}),
        ...(tk ? { 'X-Tmdb-Key': tk } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
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
  if (!job.quiet) notify({ title: '⬇️ Téléchargement AllDebrid lancé', message: job.name || job.link.slice(0, 120), tags: ['arrow_down'], click: 'lumio://downloads' });
  try {
    const { full } = safePath(job.root, job.folder);
    let files;
    if (job.secour) {
      job.status = 'debrid';
      const r = await secour('/lumio/resolve', { method: 'POST', body: job.secour, timeout: 180000 });
      const fromUrl = fileNameFromUrl(r.url);
      const ext = (fromUrl.match(/\.\w{2,4}$/) || ['.mkv'])[0];
      const name = job.baseName ? `${job.baseName}${ext}` : job.fileName || fromUrl || `${job.name || 'fichier'}.mkv`;
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
    if (!job.quiet) notify({ title: 'Téléchargement terminé', message: job.name || 'Fichier', tags: ['white_check_mark'] }).catch(() => {});
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

// ——— Book : livres, BD, mangas et livres audio (C411, Tr4ker, Wawacity) → AllDebrid → disque, puis lecture dans l'appli ———
// Analyse des titres et des pages Wawacity reprise de Book Loo Store (licence MIT, github.com/Loo-stick/bookloo).
// Les clés C411 / Tr4ker restent sur ce serveur (réglées par l'admin dans l'appli), comme la clé AllDebrid.
const BOOK_KINDS = {
  mangas: { label: 'Mangas', torznab: [7030], wawa: 'mangas' },
  bd: { label: 'BD', torznab: [7030], wawa: 'bd' },
  comics: { label: 'Comics', torznab: [7030], wawa: 'bd' },
  livres: { label: 'Livres', torznab: [7020], wawa: 'ebooks' },
  audio: { label: 'Livres audio', torznab: [3030], wawa: null },
};
const BOOK_TRACKERS = {
  c411: { label: 'C411', url: 'https://c411.org/api', key: () => process.env.BOOKS_C411_KEY || (config.books && config.books.c411Key) || '' },
  tr4ker: { label: 'Tr4ker', url: 'https://tr4ker.net/torznab', key: () => process.env.BOOKS_TR4KER_KEY || (config.books && config.books.tr4kerKey) || '' },
};
const BOOK_EXT = { '.cbz': 'bd', '.cbr': 'bd', '.zip': 'bd', '.epub': 'epub', '.pdf': 'pdf', '.mp3': 'audio', '.m4b': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio' };
const bookFound = new Map(); // id → { kind: 'torrent'|'wawa', link, title, source, at }
const wawaBase = () => String(process.env.BOOKS_WAWACITY_URL || (config.books && config.books.wawacity) || process.env.SECOUR_WAWACITY_URL || 'https://www.wawacity.estate').replace(/\/+$/, '');

function booksDir() {
  const b = config.books || {};
  const d = disks();
  if (!d.length) return null;
  const root = b.root && d.some((x) => x.name === b.root) ? b.root : d[0].name;
  return { root, folder: b.root ? b.folder || '' : 'Livres' };
}

const decodeHtml = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
const textOf = (html) => decodeHtml(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Numéro de tome, plage (pack) ou intégrale, depuis le nom d'une release. */
function bookVolumes(title) {
  const t = String(title).replace(/[._]+/g, ' ');
  if (/\bint[eé]grale?\b|\bcomplete\b|\bcollection compl[eè]te\b/i.test(t)) return { genre: 'pack', range: 'Intégrale' };
  let m = t.match(/\b(?:T(?:ome)?s?|Vol(?:ume)?s?\.?)\s*0*(\d{1,4})\s*(?:-|à|a|au|to)\s*(?:T(?:ome)?\s*)?0*(\d{1,4})\b/i);
  if (m && Number(m[2]) > Number(m[1])) return { genre: 'pack', range: `T${Number(m[1])} à T${Number(m[2])}` };
  m = t.match(/\(\s*Tomes?\s*0*(\d{1,4})\s*(?:-|à)\s*0*(\d{1,4})\s*\)/i);
  if (m && Number(m[2]) > Number(m[1])) return { genre: 'pack', range: `T${Number(m[1])} à T${Number(m[2])}` };
  m = t.match(/\b(?:T(?:ome)?|Vol(?:ume)?\.?|#)\s*0*(\d{1,4})\b/i);
  if (m) return { genre: 'tome', tome: Number(m[1]) };
  return { genre: 'livre' };
}
const bookFormat = (t) => {
  const m = String(t).match(/\b(cbz|cbr|epub|pdf|mobi|azw3|mp3|m4b|flac)\b/i);
  return m ? m[1].toUpperCase() : '';
};
const notFrench = (t) => /\b(ENG|ENGLISH|VO|SPANISH|ITA|GERMAN|JAP|RAW)\b/i.test(t) && !/\b(FR|FRENCH|VF|VOSTFR|MULTI)\b/i.test(t);

async function torznabSearch(id, q, kind) {
  const tr = BOOK_TRACKERS[id];
  const key = tr.key();
  if (!key) return { id, label: tr.label, state: 'nokey', items: [] };
  const url = `${tr.url}?t=search&q=${encodeURIComponent(q)}&cat=${BOOK_KINDS[kind].torznab.join(',')}&limit=100&apikey=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Lumio' } });
    const xml = await r.text();
    const err = xml.match(/<error[^>]*description="([^"]*)"/i);
    if (err) return { id, label: tr.label, state: 'error', message: decodeHtml(err[1]), items: [] };
    if (!r.ok) return { id, label: tr.label, state: 'error', message: `HTTP ${r.status}`, items: [] };
    const items = [];
    for (const block of xml.split(/<item>/i).slice(1)) {
      const title = decodeHtml((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
      const enc = block.match(/<enclosure[^>]*url="([^"]+)"/i);
      const link = decodeHtml(enc ? enc[1] : ((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim());
      const attr = (n) => (block.match(new RegExp(`name="${n}"\\s+value="([^"]*)"`, 'i')) || [])[1];
      const size = Number(attr('size') || (block.match(/<size>(\d+)<\/size>/i) || [])[1] || 0);
      if (!title || !link) continue;
      items.push({ title, link, size, seeders: Number(attr('seeders') || 0), hash: (attr('infohash') || '').toLowerCase(), source: tr.label });
    }
    return { id, label: tr.label, state: 'ok', items };
  } catch (e) {
    return { id, label: tr.label, state: 'error', message: ctrl.signal.aborted ? 'pas de réponse' : String(e.message || e), items: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function wawaSearch(q, kind) {
  if (!BOOK_KINDS[kind].wawa) return { id: 'wawacity', label: 'Wawacity', state: 'skip', items: [] };
  try {
    const r = await fetch(`${wawaBase()}/?p=ebooks&search=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    const html = (await r.text()).replace(/<!--[\s\S]*?-->/g, '');
    const items = [];
    const seen = new Set();
    const re = /<a\s+href="\?p=ebook&(?:amp;)?id=(\d+)-[^"]*"([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && items.length < 40) {
      if (seen.has(m[1])) continue;
      const title = textOf(m[2]);
      if (!title) continue;
      seen.add(m[1]);
      items.push({ title, link: m[1], size: 0, seeders: null, source: 'Wawacity', wawa: true });
    }
    return { id: 'wawacity', label: 'Wawacity', state: 'ok', items };
  } catch (e) {
    return { id: 'wawacity', label: 'Wawacity', state: 'error', message: String(e.message || e), items: [] };
  }
}

/** Liens d'une fiche Wawacity : dl-protect → (redirecteur AllDebrid) → hébergeur → AllDebrid. */
async function wawaLinks(id) {
  const r = await fetch(`${wawaBase()}/?p=ebook&id=${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  const html = (await r.text()).replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const block of html.split(/<tr[^>]*class="link-row"[^>]*>/i).slice(1)) {
    const l = block.match(/href="(https?:\/\/dl-protect[^"]+)"/i);
    if (!l) continue;
    const url = decodeHtml(l[1]);
    const fn = url.match(/[?&]fn=([^&]+)/);
    if (fn) {
      try {
        const v = Buffer.from(decodeURIComponent(fn[1]), 'base64').toString('utf8');
        if (v.includes('|')) continue; // encart publicitaire
      } catch {}
    }
    const cells = block.split(/<\/td>/i).map(textOf).filter(Boolean);
    if (!cells[1] || /^anonyme$/i.test(cells[1])) continue;
    out.push({ host: cells[1], url });
  }
  return out;
}

async function wawaResolve(id) {
  const links = await wawaLinks(id);
  if (!links.length) throw new HttpError(422, 'Cette fiche Wawacity ne donne aucun lien');
  for (const l of links) {
    for (let i = 0; i < 3; i++) {
      try {
        const d = await ad('/v4/link/redirector', { link: l.url });
        const host = (d.links || []).find((x) => /^https?:\/\//.test(x));
        if (host) return host;
        break;
      } catch (e) {
        if (!/REDIRECTOR_ERROR|TEMPORARY|UNAVAILABLE/i.test(String(e.message))) break;
        await sleep(3000);
      }
    }
  }
  throw new HttpError(502, 'AllDebrid n’a pu ouvrir aucun lien de cette fiche');
}

// ——— Lecture : liens signés (images, lecteur PDF et audio n'envoient pas de jeton) ———
const BOOK_SECRET = (() => {
  const f = path.join(DATA_DIR, 'books.secret');
  try {
    const s = fs.readFileSync(f);
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(32);
  try { fs.writeFileSync(f, s, { mode: 0o600 }); } catch {}
  return s;
})();
function bookSign(root, rel) {
  const body = Buffer.from(JSON.stringify({ r: root, p: rel, e: Date.now() + 24 * 3600_000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', BOOK_SECRET).update(body).digest('base64url')}`;
}
function bookVerify(tok) {
  const [body, sig] = String(tok).split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', BOOK_SECRET).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (t.e < Date.now()) return null;
    return safePath(t.r, t.p).full;
  } catch {
    return null;
  }
}

// ——— ZIP (CBZ, EPUB) lu directement sur le disque ———
const zipCache = new Map();
async function zipEntries(file) {
  const st = await fs.promises.stat(file);
  const hit = zipCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.entries;
  const fh = await fs.promises.open(file, 'r');
  try {
    const tailLen = Math.min(st.size, 66000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, st.size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Archive illisible (pas un ZIP / CBZ)');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const size = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const xlen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      const off = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
      if (!name.endsWith('/')) entries.push({ name, method, csize, size, off });
      p += 46 + nlen + xlen + clen;
    }
    zipCache.set(file, { mtime: st.mtimeMs, entries });
    if (zipCache.size > 30) zipCache.delete(zipCache.keys().next().value);
    return entries;
  } finally {
    await fh.close();
  }
}
async function zipRead(file, e) {
  if (e.size > 200 * 1024 * 1024) throw new Error('Fichier trop gros');
  const fh = await fs.promises.open(file, 'r');
  try {
    const h = Buffer.alloc(30);
    await fh.read(h, 0, 30, e.off);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('Entrée illisible');
    const start = e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const raw = Buffer.alloc(e.csize);
    await fh.read(raw, 0, e.csize, start);
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
    throw new Error('Compression non prise en charge');
  } finally {
    await fh.close();
  }
}
const isImage = (n) => /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n);
const natural = (a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
const imgType = (n) => IMG_TYPES[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';

async function epubBook(file) {
  const entries = await zipEntries(file);
  const by = (n) => entries.find((e) => e.name === n);
  const container = by('META-INF/container.xml');
  if (!container) throw new Error('Ce fichier n’est pas un EPUB');
  const opfPath = ((await zipRead(file, container)).toString('utf8').match(/full-path="([^"]+)"/i) || [])[1];
  const opfE = opfPath && by(opfPath);
  if (!opfE) throw new Error('Livre sans manifeste');
  const opf = (await zipRead(file, opfE)).toString('utf8');
  const dir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '') : '';
  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = (m[0].match(/\bid="([^"]+)"/i) || [])[1];
    const href = (m[0].match(/\bhref="([^"]+)"/i) || [])[1];
    if (id && href) manifest[id] = path.posix.normalize((dir ? `${dir}/` : '') + decodeURIComponent(href));
  }
  const chapters = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => manifest[m[1]]).filter(Boolean);
  const title = textOf((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || [])[1] || '');
  return { entries, chapters, title };
}

function bookTitle(name) {
  return String(name)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\b(FRENCH|FR|VF|MULTi|CBZ|CBR|EPUB|PDF|Digital|NoTag)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || name;
}

async function bookLibrary() {
  const dir = booksDir();
  if (!dir) return { dir: null, books: [] };
  const { full } = safePath(dir.root, dir.folder);
  await fs.promises.mkdir(full, { recursive: true }).catch(() => {});
  const found = [];
  const walk = async (rel, depth) => {
    if (depth > 5 || found.length > 3000) return;
    let list = [];
    try { list = await fs.promises.readdir(path.join(full, rel), { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r, depth + 1);
      else if (BOOK_EXT[path.extname(e.name).toLowerCase()] && !e.name.endsWith('.part')) {
        try { found.push({ rel: r, name: e.name, st: await fs.promises.stat(path.join(full, r)) }); } catch {}
      }
    }
  };
  await walk('', 0);
  return {
    dir,
    books: found
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
      .map((f) => {
        const rel = dir.folder ? `${dir.folder}/${f.rel}` : f.rel;
        return {
          name: f.name,
          title: bookTitle(f.name),
          folder: f.rel.includes('/') ? f.rel.replace(/\/[^/]*$/, '') : '',
          path: rel,
          format: BOOK_EXT[path.extname(f.name).toLowerCase()],
          size: f.st.size,
          modified: f.st.mtime.toISOString(),
          token: bookSign(dir.root, rel),
        };
      }),
  };
}

/** Routes de lecture par lien signé (sans jeton Jellyfin). Renvoie true si la requête est traitée. */
async function bookFileRoutes(req, res, p, q) {
  const m = p.match(/^\/api\/books\/f\/([A-Za-z0-9_.-]+)\/(file|pages|page\/\d+|epub|epub\/\d+|res)$/);
  if (!m || req.method !== 'GET') return false;
  const file = bookVerify(m[1]);
  if (!file) {
    send(res, 403, { error: 'Lien expiré : rouvre le livre depuis Book' });
    return true;
  }
  const what = m[2];
  try {
    if (what === 'file') {
      const st = await fs.promises.stat(file);
      const ext = path.extname(file).toLowerCase();
      const type = { '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.mp3': 'audio/mpeg', '.m4b': 'audio/mp4', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' }[ext] || 'application/octet-stream';
      const range = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
      let start = 0;
      let end = st.size - 1;
      if (range) {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
        if (!range[1] && range[2]) start = Math.max(0, st.size - Number(range[2]));
      }
      res.writeHead(range ? 206 : 200, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return true;
    }
    if (what === 'pages' || what.startsWith('page/')) {
      const pages = (await zipEntries(file)).filter((e) => isImage(e.name)).sort((a, b) => natural(a.name, b.name));
      if (!pages.length) throw new Error('Aucune planche lisible (seuls les CBZ s’ouvrent ici)');
      if (what === 'pages') {
        send(res, 200, { title: bookTitle(path.basename(file)), pages: pages.length });
        return true;
      }
      const e = pages[Number(what.slice(5))];
      if (!e) throw new Error('Page absente');
      const buf = await zipRead(file, e);
      res.writeHead(200, { 'Content-Type': imgType(e.name), 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
      res.end(buf);
      return true;
    }
    const book = await epubBook(file);
    if (what === 'epub') {
      const titles = [];
      for (const [i, c] of book.chapters.entries()) {
        const e = book.entries.find((x) => x.name === c);
        let t = null;
        if (e) {
          const html = (await zipRead(file, e)).toString('utf8');
          t = textOf((html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
        }
        titles.push(t && t.length < 120 ? t : `Chapitre ${i + 1}`);
      }
      send(res, 200, { title: book.title || bookTitle(path.basename(file)), chapters: titles });
      return true;
    }
    if (what === 'res') {
      const name = String(q.get('f') || '');
      const e = book.entries.find((x) => x.name === name);
      if (!e || !isImage(name) && !/\.svg$/i.test(name)) throw new Error('Ressource absente');
      const buf = await zipRead(file, e);
      res.writeHead(200, { 'Content-Type': imgType(name), 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
      res.end(buf);
      return true;
    }
    // Un chapitre en page HTML, prête à lire (taille et thème choisis dans l'appli)
    const n = Number(what.slice(5));
    const c = book.chapters[n];
    const e = c && book.entries.find((x) => x.name === c);
    if (!e) throw new Error('Chapitre absent');
    const base = c.includes('/') ? c.replace(/\/[^/]*$/, '') : '';
    let html = (await zipRead(file, e)).toString('utf8');
    html = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<(link|meta|style)[^>]*>(?:[\s\S]*?<\/style>)?/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\s(src|xlink:href|href)="([^"]+)"/gi, (all, attr, val) => {
        if (/^(https?:|#|mailto:|data:)/i.test(val)) return attr.toLowerCase() === 'href' ? '' : all;
        if (attr.toLowerCase() === 'href' && !isImage(val)) return '';
        const target = path.posix.normalize((base ? `${base}/` : '') + decodeURIComponent(val.split('#')[0]));
        return ` ${attr}="/api/books/f/${m[1]}/res?f=${encodeURIComponent(target)}"`;
      });
    const theme = q.get('theme') === 'clair' ? ['#fff', '#111'] : q.get('theme') === 'sepia' ? ['#f4ecd8', '#3b2f1e'] : ['#000', '#e8e6e3'];
    const size = Math.min(32, Math.max(13, Number(q.get('size')) || 19));
    const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>
html,body{margin:0;background:${theme[0]};color:${theme[1]}}
body{font:${size}px/1.6 "New York","Iowan Old Style",Georgia,serif;padding:calc(env(safe-area-inset-top) + 64px) 22px calc(env(safe-area-inset-bottom) + 90px);word-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
article{max-width:680px;margin:0 auto}img,svg{max-width:100%;height:auto;display:block;margin:1em auto}
h1,h2,h3{line-height:1.25;font-family:-apple-system,system-ui,sans-serif}p{margin:0 0 .9em;text-align:justify}a{color:inherit}
</style></head><body><article>${html}</article></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return true;
  } catch (e) {
    send(res, 422, { error: String(e.message || e) });
    return true;
  }
}

/** Routes Book (utilisateur connecté). Renvoie true si la requête est traitée. */
async function bookRoutes(req, res, p, q, user) {
  if (!p.startsWith('/api/books')) return false;
  if (req.method === 'GET' && p === '/api/books/settings') {
    const dir = booksDir();
    send(res, 200, {
      c411: Boolean(BOOK_TRACKERS.c411.key()),
      tr4ker: Boolean(BOOK_TRACKERS.tr4ker.key()),
      alldebrid: Boolean(process.env.ALLDEBRID_KEY || config.alldebridKey),
      wawacity: wawaBase(),
      dir,
      disks: disks().map((d) => d.name),
      admin: Boolean(user.admin),
    });
    return true;
  }
  if (req.method === 'PUT' && p === '/api/books/settings') {
    requireAdmin(user);
    const b = await readBody(req);
    const cur = config.books || {};
    if (typeof b.c411Key === 'string') cur.c411Key = b.c411Key.trim() || undefined;
    if (typeof b.tr4kerKey === 'string') cur.tr4kerKey = b.tr4kerKey.trim() || undefined;
    if (typeof b.wawacity === 'string') cur.wawacity = b.wawacity.trim().replace(/\/+$/, '') || undefined;
    if (typeof b.root === 'string') {
      safePath(b.root, b.folder || '');
      cur.root = b.root;
      cur.folder = String(b.folder || '');
    }
    config.books = cur;
    saveConfig();
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && p === '/api/books/search') {
    const query = String(q.get('q') || '').trim();
    const kind = BOOK_KINDS[q.get('kind')] ? q.get('kind') : 'mangas';
    if (query.length < 2) {
      send(res, 200, { results: [], sources: [] });
      return true;
    }
    const all = await Promise.all([torznabSearch('c411', query, kind), torznabSearch('tr4ker', query, kind), wawaSearch(query, kind)]);
    const now = Date.now();
    for (const [k, v] of bookFound) if (now - v.at > 3 * 3600_000) bookFound.delete(k);
    const words = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter((w) => w.length > 1);
    const seen = new Set();
    const results = [];
    for (const s of all) {
      for (const it of s.items) {
        if (notFrench(it.title)) continue;
        const dedupe = it.hash || `${it.source}:${it.title}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const id = crypto.randomBytes(6).toString('hex');
        bookFound.set(id, { kind: it.wawa ? 'wawa' : 'torrent', link: it.link, title: it.title, source: it.source, at: now, hash: it.hash });
        const norm = it.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[._]+/g, ' ');
        results.push({
          id,
          title: it.title,
          source: it.source,
          size: it.size || 0,
          seeders: it.seeders,
          format: bookFormat(it.title),
          close: words.every((w) => norm.includes(w)),
          ...bookVolumes(it.title),
        });
      }
    }
    const weight = { tome: 0, livre: 1, pack: 2 };
    results.sort((a, b) => Number(b.close) - Number(a.close) || weight[a.genre] - weight[b.genre] || (a.tome ?? 0) - (b.tome ?? 0) || (b.seeders ?? 0) - (a.seeders ?? 0));
    send(res, 200, { results, sources: all.map((s) => ({ id: s.id, label: s.label, state: s.state, count: s.items.length, message: s.message })) });
    return true;
  }
  if (req.method === 'POST' && p === '/api/books/download') {
    const b = await readBody(req);
    const found = bookFound.get(String(b.id || ''));
    if (!found) throw new HttpError(404, 'Résultat expiré : relance la recherche');
    const dir = booksDir();
    if (!dir) throw new HttpError(503, 'Aucun disque n’est relié au serveur Lumio');
    let link;
    let name = found.title;
    if (found.kind === 'torrent') {
      const r = await fetch(found.link, { headers: { 'User-Agent': 'Lumio' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new HttpError(502, `${found.source} n’a pas donné le .torrent (HTTP ${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf[0] !== 0x64) throw new HttpError(502, `${found.source} n’a pas donné un vrai .torrent`);
      const up = await uploadTorrentFile(`${cleanName(found.title)}.torrent`, buf);
      link = `adid:${up.id}`;
      name = up.name || name;
    } else {
      link = await wawaResolve(found.link);
    }
    const job = { id: crypto.randomBytes(5).toString('hex'), link, root: dir.root, folder: dir.folder, status: 'queued', book: true, quiet: true,
      name, size: 0, done: 0, speed: 0, token: null, createdAt: new Date().toISOString(), by: user.name };
    downloads.push(job);
    runDownload(job);
    send(res, 201, { job: publicJob(job) });
    return true;
  }
  if (req.method === 'GET' && p === '/api/books/jobs') {
    send(res, 200, { jobs: downloads.filter((j) => j.book).map(publicJob).reverse() });
    return true;
  }
  const jm = p.match(/^\/api\/books\/jobs\/([\w-]+)$/);
  if (req.method === 'DELETE' && jm) {
    const i = downloads.findIndex((x) => x.id === jm[1] && x.book);
    if (i < 0) throw new HttpError(404, 'introuvable');
    const job = downloads[i];
    if (['queued', 'debrid', 'downloading'].includes(job.status)) {
      job.cancelled = true;
      if (job.abort) job.abort();
    } else downloads.splice(i, 1);
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && p === '/api/books/library') {
    send(res, 200, await bookLibrary());
    return true;
  }
  if (req.method === 'POST' && p === '/api/books/delete') {
    const b = await readBody(req);
    const file = bookVerify(String(b.token || ''));
    if (!file) throw new HttpError(403, 'Lien expiré');
    await fs.promises.rm(file, { force: true });
    zipCache.delete(file);
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lumio Auto (bêta) : remplace Radarr / Sonarr pour l'essentiel, écrit pour Lumio (aucun code repris d'eux).
// - Indexeurs à soi (Torznab : C411, Tr4ker, Jackett…) et/ou Prowlarr, avec limite de requêtes par site
// - Veille RSS des nouveautés + recherche automatique de ce qui manque (films sortis, épisodes diffusés)
// - Profil : français, 1080p, H.265 (fichiers légers), tailles maximales
// - Envoi à rdt-client (API qBittorrent, comme Radarr / Sonarr) ou directement à AllDebrid
// - Import : renommage propre, rangement dans le bon dossier ([tmdbid-…] pour Jellyfin), analyse Jellyfin
// Désactivé par défaut : rien ne change tant que l'admin ne l'active pas (appli bêta → Lumio Auto).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const AUTO_FILE = path.join(DATA_DIR, 'auto.json');
const auto = readJson(AUTO_FILE, {});
for (const k of ['items', 'grabs', 'blocked', 'log']) if (!Array.isArray(auto[k])) auto[k] = [];
if (!auto.have || typeof auto.have !== 'object') auto.have = {};
// Codec de ce que Lumio Auto a rangé ({ 'tv:1399': { '2:1': { c: 'h264', at } } }) : pour remplacer plus tard par du H.265
if (!auto.haveCodec || typeof auto.haveCodec !== 'object') auto.haveCodec = {};
// Séries retirées à la main du suivi (on ne les reprend pas avec les séries en cours de la bibliothèque)
if (!Array.isArray(auto.unfollowed)) auto.unfollowed = [];
if (!Array.isArray(auto.missingHidden)) auto.missingHidden = []; // séries masquées de « À compléter »
// Radarr / Sonarr retirés dès que Lumio Auto a été configuré (même s'il est éteint = mode AllDebrid)
if (config.auto && !config.auto.arrRemoved && (config.auto.enabled === true || (Array.isArray(config.auto.indexers) && config.auto.indexers.length))) {
  config.auto.arrRemoved = true;
  saveConfig();
}
// 3.74 : les séries reprises de la bibliothèque (sans demande) ne rattrapent plus les anciens épisodes
for (const it of auto.items)
  if (it.type === 'tv' && !it.since && !(it.requestIds || []).length && (it.events || []).some((e) => /bibliothèque/.test(e.msg || '')))
    it.since = new Date(Date.parse(it.addedAt || Date.now()) - 2 * 86400e3).toISOString().slice(0, 10);
// 3.75 : plus aucune nouvelle saison lancée toute seule ; séries reprises de la bibliothèque : saison en cours seulement
if (!auto.v375) {
  auto.v375 = true;
  for (const it of auto.items) {
    if (it.type !== 'tv') continue;
    it.future = false;
    if (it.since && !(it.requestIds || []).length && it.seasons.length > 1) it.seasons = [Math.min(...it.seasons)];
  }
}
// Volume téléchargé par indexeur et par jour ({ ixId: { '2026-11-04': octets } }) : quota des trackers privés
if (!auto.dlStats || typeof auto.dlStats !== 'object') auto.dlStats = {};
// Ratio par site : compteurs cumulés de qBittorrent (gardés même après retrait des torrents) + ratio de départ saisi par l'admin
if (!auto.siteStats || typeof auto.siteStats !== 'object') auto.siteStats = {};
if (!auto.ratioBase || typeof auto.ratioBase !== 'object') auto.ratioBase = {};
let autoSaveTimer = null;
const autoSave = () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => writeJson(AUTO_FILE, auto), 400);
};
const autoCfg = () => {
  if (!config.auto || typeof config.auto !== 'object') config.auto = {};
  return config.auto;
};
// Lumio Auto tourne dès qu'il a été activé une fois (Radarr / Sonarr retirés) :
// interrupteur allumé = torrents (qBittorrent…) ; éteint = mode AllDebrid, seulement les versions déjà en cache
// Deux interrupteurs dans l'appli :
//  - « Lumio Auto » (enabled) : cherche et télécharge tout seul ; éteint = les demandes attendent dans la liste
//  - « AllDebrid » (debridOnly) : seulement les versions en cache AllDebrid au lieu des torrents (qBittorrent)
// Les demandes passent par Lumio Auto dès qu'il a été configuré (Radarr / Sonarr retirés), même en pause.
const autoOn = () => autoCfg().enabled === true || autoCfg().arrRemoved === true;
const autoActive = () => autoCfg().enabled === true;
const autoDebridOnly = () => autoCfg().debridOnly === true;
function autoLog(msg, level = 'info') {
  auto.log.unshift({ at: new Date().toISOString(), level, msg: String(msg).slice(0, 400) });
  if (auto.log.length > 300) auto.log.length = 300;
  autoSave();
  console.log(`Lumio Auto : ${msg}`);
}
const autoId = () => crypto.randomBytes(5).toString('hex');

// ——— Profil de qualité ———
const AUTO_PROFILE = {
  resolution: 1080, // 2160 | 1080 | 720
  allowLower: false, // accepter 720p si rien en 1080p
  h265: 'preferred', // 'required' | 'preferred' | 'any'
  h265Wait: 48, // sortie récente : on attend une version H.265 pendant ce nombre d'heures avant de prendre du H.264
  upgradeDays: 30, // version H.264 rangée : on cherche encore du H.265 (plus léger) pendant ce nombre de jours, puis on remplace
  languages: ['multi', 'vff', 'truefrench', 'french'], // ordre de préférence (VFQ et VF2 = piste québécoise : refusées sauf si on les ajoute)
  maxMovieGb: 8,
  maxEpisodeGb: 2.5,
  minSeeders: 1,
  maxActive: 1, // téléchargements en même temps (un à la fois par défaut)
  searchEveryMin: 60,
  rssEveryMin: 20,
};
const autoProfile = () => {
  const c = autoCfg();
  // Ancien profil « H.265 obligatoire » : bloquait tout quand le site n'avait que du H.264 → H.265 de préférence + attente + remplacement
  if (c.profile && !c.profileV2) {
    c.profileV2 = true;
    if (c.profile.h265 === 'required') c.profile.h265 = 'preferred';
    saveConfig();
  }
  // Plus de VFQ par défaut (doublage québécois, même dans un MULTI)
  if (c.profile && !c.profileV3) {
    c.profileV3 = true;
    if (Array.isArray(c.profile.languages)) c.profile.languages = c.profile.languages.filter((l) => l !== 'vfq');
    saveConfig();
  }
  // VF2 = deux pistes françaises (France + Québec) : la piste québécoise passe souvent en premier → plus acceptée par défaut
  if (c.profile && !c.profileV4) {
    c.profileV4 = true;
    if (Array.isArray(c.profile.languages)) c.profile.languages = c.profile.languages.filter((l) => l !== 'vf2' && l !== 'vfq');
    saveConfig();
  }
  return { ...AUTO_PROFILE, ...(c.profile || {}) };
};
/** Date de sortie de ce qu'on cherche (film : sortie vidéo ; épisode / saison : diffusion). */
function autoWantAir(item, want) {
  const m = item.meta || {};
  if (item.type === 'movie') return m.availableFrom ? Date.parse(m.availableFrom) : null;
  const eps = (m.seasons && m.seasons[want.season]) || [];
  const airs = (want.kind === 'episode' ? eps.filter((e) => e.e === want.episode) : eps).map((e) => Date.parse(e.air)).filter(Boolean);
  return airs.length ? Math.max(...airs) : null;
}
/** Sortie récente : on n'accepte que du H.265 pendant quelques heures (les encodages légers arrivent souvent après). */
function autoWaitH265(item, want, pf = autoProfile()) {
  if (pf.h265 !== 'preferred' || !(pf.h265Wait > 0)) return null;
  const air = autoWantAir(item, want);
  if (!air || Date.now() - air > 30 * 86400e3) return null;
  const until = Math.max(air, Date.parse(item.addedAt || 0) || 0) + pf.h265Wait * 3600e3;
  return until > Date.now() ? until : null;
}
/** Ce que Lumio Auto a rangé en H.264 récemment : à remplacer par du H.265 s'il apparaît. */
function autoUpgradeWants(item, pf = autoProfile()) {
  if (pf.h265 === 'any' || !(pf.upgradeDays > 0)) return [];
  const hc = auto.haveCodec[autoItemKey(item.type, item.tmdbId)] || {};
  const old = Object.entries(hc).filter(([, v]) => v && v.c !== 'h265' && Date.now() - v.at < pf.upgradeDays * 86400e3).map(([k]) => k);
  if (!old.length) return [];
  if (item.type === 'movie') return old.includes('movie') ? [{ kind: 'movie', h265Only: true, upgrade: true }] : [];
  const bySeason = {};
  for (const k of old) {
    const [sn, e] = k.split(':').map(Number);
    (bySeason[sn] = bySeason[sn] || []).push(e);
  }
  return Object.entries(bySeason).map(([sn, eps]) => {
    const all = ((item.meta && item.meta.seasons && item.meta.seasons[sn]) || []).map((x) => x.e);
    return eps.length === 1 && all.length > 1
      ? { kind: 'episode', season: Number(sn), episode: eps[0], h265Only: true, upgrade: true }
      : { kind: 'season', season: Number(sn), count: all.length || eps.length, episodes: all.length ? all : eps.sort((a, b) => a - b), h265Only: true, upgrade: true };
  });
}

// ——— Réseau : DNS 1.1.1.1 pour les sites ———
// Les trackers (c411.org…) sont bloqués ou détournés par certains DNS (box, FAI) : on demande leur adresse
// directement à Cloudflare (1.1.1.1), puis Quad9 / Google en secours. Les noms internes de Docker
// (prowlarr, rdt-client, une IP locale…) restent résolus normalement par le conteneur.
const autoResolver = new (require('dns').promises.Resolver)();
autoResolver.setServers(['1.1.1.1', '1.0.0.1', '9.9.9.9', '8.8.8.8']);
const isInternalHost = (h) => !h.includes('.') || /^(\d+\.){3}\d+$/.test(h) || /\.(local|lan|internal|home)$/i.test(h);
const autoLookup = (hostname, opts, cb) => {
  const done = (address, family) => cb(null, opts && opts.all ? [{ address, family }] : address, family);
  const system = (internal) =>
    require('dns').lookup(hostname, { family: 4 }, (err, address, family) => {
      // Un site public qui pointe sur la machine elle-même : DNS qui bloque
      if (err || (!internal && (/^127\./.test(address) || address === '0.0.0.0'))) return cb(err || new Error('adresse bloquée par le DNS'));
      done(address, family);
    });
  if (isInternalHost(hostname)) return system(true);
  autoResolver
    .resolve4(hostname)
    .then((ips) => (ips && ips[0] ? done(ips[0], 4) : system()))
    .catch(() => system());
};
/** Requête HTTP(S) robuste (DNS de secours, redirections, délai) → { status, headers, buf, text() } */
function autoHttp(url, { method = 'GET', headers = {}, body = null, timeout = 30000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('adresse invalide'));
    }
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(
      u,
      { method, headers: { 'User-Agent': 'Lumio', ...headers }, lookup: autoLookup, timeout },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          if (/^magnet:/i.test(loc)) return resolve({ status: 200, headers: res.headers, magnet: loc, buf: Buffer.alloc(0), text: () => '' });
          if (redirects <= 0) return reject(new Error('trop de redirections'));
          return autoHttp(new URL(loc, u).toString(), { method: 'GET', headers, timeout, redirects: redirects - 1 }).then(resolve, reject);
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > 20e6) req.destroy(new Error('réponse trop grande'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buf, text: () => buf.toString('utf8') });
        });
      }
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('pas de réponse'), { name: 'TimeoutError' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const netError = (e) => {
  const code = (e && (e.code || (e.cause && e.cause.code))) || '';
  if (e && e.name === 'TimeoutError') return 'pas de réponse (délai dépassé)';
  if (code === 'ECONNREFUSED') return 'connexion refusée (ECONNREFUSED) : mauvaise adresse ou port, ou service arrêté';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `nom introuvable (${code}) : vérifie l’adresse`;
  if (code === 'ECONNRESET') return 'connexion coupée par le site';
  if (/certificate|CERT/i.test(code + (e && e.message))) return 'certificat HTTPS refusé';
  return String(code || (e && e.message) || e);
};

// ——— Indexeurs ———
// { id, name, type: 'c411' | 'torznab' | 'prowlarr', url, key, enabled, rss, search, maxPerHour, catMovie, catTv, catAnime, caps }
// C411 (d'après sa définition Torznab publique) : https://c411.org/api/torznab, clé API (page Intégrations),
// 15 requêtes / minute (4,1 s entre deux), recherche séries par tmdbid / imdbid / saison / épisode.
const IDX_PRESETS = {
  c411: { name: 'C411', url: 'https://c411.org/api/torznab', gapMs: 4100, maxPerHour: 60, catMovie: '2000', catTv: '5000', catAnime: '5070' },
  torznab: { gapMs: 3000, maxPerHour: 15, catMovie: '2000', catTv: '5000', catAnime: '5070' },
  prowlarr: { gapMs: 1000, maxPerHour: 30 },
};
const autoIndexers = () => (Array.isArray(autoCfg().indexers) ? autoCfg().indexers : []);
const idxCalls = new Map(); // id → horodatages des requêtes de la dernière heure
const idxStatus = new Map(); // id → { ok, at, message, count, url }
function idxAllowed(ix) {
  const now = Date.now();
  const list = (idxCalls.get(ix.id) || []).filter((t) => now - t < 3600e3);
  idxCalls.set(ix.id, list);
  const max = Number(ix.maxPerHour) || (IDX_PRESETS[ix.type] || IDX_PRESETS.torznab).maxPerHour;
  return list.length < max;
}
const parseCats = (v, def) =>
  String(v || def)
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => n > 0);
const torznabBase = (ix) => {
  let u = String(ix.url || '').trim().replace(/\/+$/, '');
  // « https://c411.org » ou « …/api » tout court : on complète l'adresse Torznab
  if (ix.type === 'c411' && !/\/api\/torznab$/.test(u)) u = u.replace(/\/api$/, '') + '/api/torznab';
  return u;
};
const hideKey = (u) => String(u).replace(/(apikey=)[^&]+/i, '$1•••');

const torznabAttrsSeen = {};
function parseTorznab(xml, ix) {
  const items = [];
  for (const block of xml.split(/<item>/i).slice(1)) {
    const tag = (n) => decodeHtml(((block.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i')) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim());
    const attr = (n) => (block.match(new RegExp(`name="${n}"\\s+value="([^"]*)"`, 'i')) || [])[1];
    const title = tag('title');
    const enc = block.match(/<enclosure[^>]*url="([^"]+)"/i);
    let link = decodeHtml(enc ? enc[1] : tag('link'));
    const magnet = attr('magneturl');
    if (!link && magnet) link = decodeHtml(magnet);
    if (!title || !link) continue;
    const imdb = attr('imdbid') || attr('imdb');
    // Langue donnée par le site en plus du nom (C411 : « Multi VF2 (FR + QC inclus) ») : attributs, description, catégories
    const attrs = {};
    for (const m of block.matchAll(/name="([^"]+)"\s+value="([^"]*)"/gi)) attrs[m[1].toLowerCase()] = decodeHtml(m[2]);
    const langHint = [
      ...Object.entries(attrs).filter(([k]) => /lang|audio|dub|tag|flag|genre/.test(k)).map(([, v]) => v),
      tag('description'),
      ...[...block.matchAll(/<category[^>]*>([^<]*)<\/category>/gi)].map((m) => m[1]),
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 400);
    if (!torznabAttrsSeen[ix.id]) {
      torznabAttrsSeen[ix.id] = true;
      autoLog(`${ix.name} : infos données par le site → ${Object.keys(attrs).join(', ') || 'aucune'}${tag('description') ? ' + description' : ''}`);
    }
    items.push({
      langHint: langHint || null,
      title,
      link,
      magnet: magnet ? decodeHtml(magnet) : null,
      size: Number(attr('size') || tag('size') || 0),
      seeders: attr('seeders') != null ? Number(attr('seeders')) : null,
      leechers: attr('peers') != null ? Math.max(0, Number(attr('peers')) - Number(attr('seeders') || 0)) : attr('leechers') != null ? Number(attr('leechers')) : null,
      grabs: attr('grabs') != null ? Number(attr('grabs')) : null,
      hash: (attr('infohash') || '').toLowerCase() || null,
      tmdbId: attr('tmdbid') ? Number(attr('tmdbid')) : null,
      imdbId: imdb ? (String(imdb).startsWith('tt') ? imdb : `tt${String(imdb).padStart(7, '0')}`) : null,
      guid: tag('guid') || link,
      pub: tag('pubDate') || null,
      details: tag('comments') || (tag('link') !== link ? tag('link') : null),
      freeleech: attr('downloadvolumefactor') === '0',
      indexer: ix.name,
      indexerId: ix.id,
    });
  }
  return items;
}

/** Ce que l'indexeur sait chercher (t=caps) : par identifiant TMDB / IMDb, saison, épisode. */
async function idxCaps(ix, force = false) {
  if (ix.type === 'prowlarr') return null;
  if (!force && ix.caps && Date.now() - Date.parse(ix.caps.at || 0) < 7 * 864e5) return ix.caps;
  try {
    const qs = new URLSearchParams({ t: 'caps' });
    if (ix.key) qs.set('apikey', ix.key);
    const base = torznabBase(ix);
    const r = await autoHttp(`${base}${base.includes('?') ? '&' : '?'}${qs}`, { timeout: 20000 });
    const xml = r.text();
    const mode = (n) => {
      const m = xml.match(new RegExp(`<${n}[^>]*available="yes"[^>]*supportedParams="([^"]*)"`, 'i')) || xml.match(new RegExp(`<${n}[^>]*supportedParams="([^"]*)"[^>]*available="yes"`, 'i'));
      return m ? m[1].split(',').map((x) => x.trim().toLowerCase()) : null;
    };
    ix.caps = { at: new Date().toISOString(), tv: mode('tv-search'), movie: mode('movie-search') };
    saveConfig();
  } catch {}
  return ix.caps || null;
}

/**
 * Une requête à un indexeur. Avec des identifiants (tmdbid, imdbid, saison, épisode) quand le site les accepte,
 * sinon recherche texte ; sans rien : dernières sorties (veille RSS).
 */
async function idxQuery(ix, { q = '', cats = [], mode = 'search', ids = {} }) {
  if (!idxAllowed(ix)) return { skipped: true, items: [] };
  const preset = IDX_PRESETS[ix.type] || IDX_PRESETS.torznab;
  const prev = idxCalls.get(ix.id);
  const gap = prev.length ? (Number(ix.gapMs) || preset.gapMs) - (Date.now() - prev[prev.length - 1]) : 0;
  if (gap > 0) await sleep(gap);
  idxCalls.get(ix.id).push(Date.now());
  let shown = '';
  try {
    let items;
    if (ix.type === 'prowlarr') {
      const qs = new URLSearchParams({ query: q, type: mode === 'tvsearch' ? 'tvsearch' : mode === 'movie' ? 'movie' : 'search', limit: '100' });
      for (const c of cats) qs.append('categories', String(c));
      const url = `${String(ix.url).replace(/\/+$/, '')}/api/v1/search?${qs}`;
      shown = url;
      const r = await autoHttp(url, { headers: { 'X-Api-Key': ix.key || '' }, timeout: 90000 });
      if (r.status === 401) throw new Error('clé API Prowlarr refusée (401)');
      if (r.status >= 400) throw new Error(`Prowlarr a répondu HTTP ${r.status}`);
      let list = [];
      try {
        list = JSON.parse(r.text());
      } catch {
        throw new Error('réponse de Prowlarr illisible (est-ce bien l’adresse de Prowlarr ?)');
      }
      items = (Array.isArray(list) ? list : [])
        .filter((x) => !x.protocol || x.protocol === 'torrent')
        .map((x) => ({
          title: x.title,
          link: x.downloadUrl || x.magnetUrl,
          magnet: x.magnetUrl || null,
          size: Number(x.size) || 0,
          seeders: x.seeders != null ? Number(x.seeders) : null,
          leechers: x.leechers != null ? Number(x.leechers) : null,
          grabs: x.grabs != null ? Number(x.grabs) : null,
          hash: (x.infoHash || '').toLowerCase() || null,
          tmdbId: x.tmdbId || null,
          imdbId: x.imdbId ? `tt${String(x.imdbId).replace(/^tt/, '').padStart(7, '0')}` : null,
          guid: x.guid || x.downloadUrl || x.magnetUrl,
          pub: x.publishDate || null,
          details: x.infoUrl || null,
          indexer: x.indexer ? `${x.indexer} (Prowlarr)` : ix.name,
          indexerId: ix.id,
        }))
        .filter((x) => x.title && x.link);
    } else {
      const base = torznabBase(ix);
      const qs = new URLSearchParams({ t: mode, limit: '100', extended: '1' });
      if (q) qs.set('q', q);
      for (const [k, v] of Object.entries(ids)) if (v != null && v !== '') qs.set(k, String(v));
      if (cats.length) qs.set('cat', cats.join(','));
      if (ix.key) qs.set('apikey', ix.key);
      const url = `${base}${base.includes('?') ? '&' : '?'}${qs}`;
      shown = hideKey(url);
      const r = await autoHttp(url, { timeout: 30000 });
      const xml = r.text();
      const err = xml.match(/<error[^>]*code="(\d+)"[^>]*description="([^"]*)"/i) || xml.match(/<error[^>]*description="([^"]*)"/i);
      if (err) throw new Error(`${ix.name} : ${decodeHtml(err[err.length - 1])}${err.length > 2 ? ` (code ${err[1]})` : ''}`);
      if (r.status === 401 || r.status === 403) throw new Error(`clé API refusée (HTTP ${r.status}) : génère-la sur la page Intégrations du site`);
      if (r.status === 429) throw new Error('trop de requêtes (429) : le site limite, Lumio réessaiera plus tard');
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      if (!/<rss|<channel/i.test(xml)) throw new Error('réponse inattendue (pas du Torznab) : vérifie l’adresse');
      items = parseTorznab(xml, ix);
    }
    idxStatus.set(ix.id, { ok: true, at: new Date().toISOString(), count: items.length, url: shown });
    return { items, url: shown };
  } catch (e) {
    const message = netError(e);
    idxStatus.set(ix.id, { ok: false, at: new Date().toISOString(), message, url: shown });
    return { error: message, items: [], url: shown };
  }
}

const catsFor = (ix, item) =>
  item.type === 'movie'
    ? parseCats(ix.catMovie, '2000')
    : item.anime
      ? [...parseCats(ix.catTv, '5000'), ...parseCats(ix.catAnime, '5070')]
      : parseCats(ix.catTv, '5000');

// ——— Lecture des noms de releases ———
const autoNorm = (t) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const stripArticle = (n) => n.replace(/^(the|le|la|les|l|a|an) /, '');

// Doublage québécois : VFQ, VQ, QC, Québec, French-Canadian, FRCA… (VF2 en contient aussi une)
const QUEBEC_RE = /\b(vfq|vq|qc|qu[eé]bec|canadian|french[ -]?canadian|frca|fr[ -]?ca|vf2)\b/;
function autoParse(title) {
  const t = String(title).replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
  const low = t.toLowerCase();
  const r = { raw: title };
  r.resolution = /\b(2160p|4k|uhd)\b/.test(low) ? 2160 : /\b1080[pi]\b/.test(low) ? 1080 : /\b720p\b/.test(low) ? 720 : /\b(480p|576p|dvdrip|xvid)\b/.test(low) ? 480 : 0;
  r.codec = /\b(x ?265|h ?265|hevc)\b/.test(low) ? 'h265' : /\b(x ?264|h ?264|avc)\b/.test(low) ? 'h264' : /\bav1\b/.test(low) ? 'av1' : null;
  const langs = [];
  if (/\bmulti\b/.test(low)) langs.push('multi');
  if (/\bvff\b/.test(low)) langs.push('vff');
  if (/\btruefrench\b/.test(low)) langs.push('truefrench');
  if (/\bvf2\b/.test(low)) langs.push('vf2');
  if (QUEBEC_RE.test(low)) langs.push('vfq');
  if (/\bvfi\b|\bfrench\b|\bvf\b/.test(low)) langs.push('french');
  r.langs = langs;
  r.vostfr = /\b(vostfr|subfrench|vost)\b/.test(low) && !langs.length;
  r.bad = /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|screener|scr|dvdscr|r5)\b/.test(low) ? 'copie de cinéma' : /\bremux\b/.test(low) ? 'remux (trop lourd)' : /\b(3d|sbs)\b/.test(low) ? 'version 3D' : null;
  r.source = /\bblu ?ray|bdrip|brrip\b/.test(low) ? 'bluray' : /\bweb ?dl\b/.test(low) ? 'webdl' : /\bweb ?rip|\bweb\b/.test(low) ? 'webrip' : /\bhdtv\b/.test(low) ? 'hdtv' : null;
  // Épisode(s)
  let m = t.match(/\bS(\d{1,2}) ?E(\d{1,4})(?: ?-? ?E?(\d{1,4}))?\b/i);
  if (m) {
    r.season = Number(m[1]);
    r.episode = Number(m[2]);
    r.episodeEnd = m[3] && Number(m[3]) > r.episode ? Number(m[3]) : r.episode;
  } else if ((m = t.match(/\bS(\d{1,2}) ?- ?S?(\d{1,2})\b/i))) {
    r.seasons = [];
    for (let s = Number(m[1]); s <= Number(m[2]); s++) r.seasons.push(s);
  } else if ((m = t.match(/\b(?:S|saison |season )(\d{1,2})\b/i))) {
    r.season = Number(m[1]);
    r.pack = true;
  } else if (/\b(int[ée]grale|complete|compl[eè]te)\b/i.test(t)) {
    r.complete = true;
  }
  // Anime : « Titre - 1093 » ou « Titre E1093 » (numérotation absolue)
  if (r.episode == null && !r.pack && !r.seasons) {
    const a = t.match(/(?: - | E| Ep ?)(\d{1,4})\b(?! ?p\b)/i);
    if (a && Number(a[1]) < 2000) r.absolute = Number(a[1]);
  }
  const years = [...t.matchAll(/\b(19[2-9]\d|20[0-4]\d)\b/g)].map((x) => ({ y: Number(x[1]), i: x.index }));
  // Nom : tout ce qui précède l'année, l'épisode ou la première étiquette technique
  const stops = [
    t.search(/\bS\d{1,2}(?: ?E\d{1,4})?\b/i),
    t.search(/\b(saison|season|int[ée]grale|complete)\b/i),
    t.search(/\b(2160p|1080[pi]|720p|480p|multi|vff|vf2|vfq|truefrench|french|vostfr|bluray|web|hdtv|x26[45]|h26[45]|hevc|repack|proper)\b/i),
    r.absolute != null ? t.search(/(?: - | E| Ep ?)\d{1,4}\b/i) : -1,
  ];
  // L'année ne coupe le nom que si ce n'est pas le tout début (« 1917 », « 2012 »)
  const yearHit = years.find((x) => x.i > 0);
  if (yearHit) stops.push(yearHit.i);
  const cut = Math.min(...stops.filter((x) => x > 0), t.length);
  r.year = yearHit ? yearHit.y : null;
  r.name = autoNorm(t.slice(0, cut).replace(/[\[(].*$/, ''));
  return r;
}

const itemNames = (item) => {
  const set = new Set();
  for (const n of [item.title, item.originalTitle, ...(item.altTitles || [])]) {
    const x = autoNorm(n);
    if (!x) continue;
    set.add(x);
    set.add(stripArticle(x));
  }
  return [...set];
};
const nameMatches = (item, rel) => {
  const n = rel.name;
  if (!n) return false;
  return itemNames(item).some((c) => n === c || stripArticle(n) === c);
};

/**
 * Note d'une release pour un titre. Toutes les raisons de refus sont gardées (comme la recherche interactive
 * de Radarr / Sonarr) : reasons[] ; rejected = la première, ou null si la release est acceptée.
 */
function autoScore(rel, item, want) {
  const pf = autoProfile();
  const p = autoParse(rel.title);
  // Le nom dit souvent juste « MULTi » : on regarde aussi la langue donnée par le site (VF2, QC, VFQ…)
  if (rel.langHint) {
    const h = String(rel.langHint).toLowerCase().replace(/[._]+/g, ' ');
    if (QUEBEC_RE.test(h) && !p.langs.includes('vfq')) p.langs.push('vfq');
    if (/\bvf2\b/.test(h) && !p.langs.includes('vf2')) p.langs.push('vf2');
  }
  const out = { ...rel, parsed: p, score: 0, rejected: null, reasons: [] };
  const no = (why) => out.reasons.push(why);
  // Bon titre : par identifiant quand l'indexeur le donne (TMDB / IMDb), sinon par le nom
  const idMatch = (rel.tmdbId && rel.tmdbId === item.tmdbId) || (rel.imdbId && item.imdbId && rel.imdbId === item.imdbId);
  const idOther = (rel.tmdbId && rel.tmdbId !== item.tmdbId) || (rel.imdbId && item.imdbId && rel.imdbId !== item.imdbId);
  out.matchedBy = idMatch ? 'identifiant' : nameMatches(item, p) ? 'nom' : null;
  if (autoBlocked(rel)) no('déjà essayée (liste noire)');
  if (idOther && !idMatch) no('autre titre (identifiant différent)');
  else if (!out.matchedBy) no(`autre titre (« ${p.name || '?'} »)`);
  if (item.type === 'movie') {
    if (p.season != null || p.seasons || p.episode != null) no('c’est une série');
    if (!idMatch && p.year && item.year && Math.abs(p.year - item.year) > 1) no(`autre année (${p.year})`);
  } else {
    if (want.kind === 'episode') {
      const ok = (p.season === want.season && p.episode != null && p.episode <= want.episode && p.episodeEnd >= want.episode) || (item.anime && p.absolute != null && p.absolute === want.absolute);
      if (!ok) no(p.pack || p.seasons ? 'pack de saison (épisode demandé)' : p.season != null ? `autre épisode (S${autoPad(p.season)}${p.episode != null ? `E${autoPad(p.episode)}` : ''})` : 'épisode introuvable dans le nom');
    } else if (want.kind === 'season') {
      if (!(p.pack && p.season === want.season) && !(p.seasons && p.seasons.includes(want.season))) no(p.episode != null ? 'un seul épisode (saison entière demandée)' : 'pas la saison demandée');
    }
  }
  if (p.bad) no(p.bad);
  if (p.vostfr) no('VOSTFR seulement');
  else if (!p.langs.length) no('pas de version française indiquée');
  else if (!p.langs.some((l) => pf.languages.includes(l))) no(`langue non acceptée (${p.langs.join(', ').toUpperCase()})`);
  // MULTI.VFQ : la piste française est québécoise ; refusée sauf si VFQ est dans les langues (ou VFF / TRUEFRENCH / VF2 aussi présents)
  // Toute piste québécoise est refusée (même avec une piste VFF à côté : le lecteur peut choisir la québécoise),
  // sauf si VFQ (ou VF2) est coché dans les langues
  else if (p.langs.includes('vfq') && !pf.languages.includes('vfq') && !(p.langs.includes('vf2') && pf.languages.includes('vf2'))) no(p.langs.includes('vf2') ? 'VF2 (contient le doublage québécois)' : 'VFQ (doublage québécois)');
  if (p.resolution && p.resolution > pf.resolution) no(`${p.resolution}p (trop lourd)`);
  else if (p.resolution !== pf.resolution && !(pf.allowLower && p.resolution >= 720)) no(p.resolution ? `${p.resolution}p (${pf.resolution}p demandé)` : 'résolution inconnue');
  if ((pf.h265 === 'required' || want.h265Only) && p.codec !== 'h265')
    no(p.codec ? `${p.codec.toUpperCase()} (${want.upgrade ? 'déjà là, on attend du H.265' : want.h265Only ? 'sortie récente : on attend du H.265' : 'H.265 demandé'})` : 'codec inconnu (H.265 demandé)');
  const gb = (rel.size || 0) / 1e9;
  const per = want.kind === 'season' ? Math.max(1, want.count || 1) : 1;
  const max = item.type === 'movie' ? pf.maxMovieGb : pf.maxEpisodeGb * per;
  if (gb > max) no(`${gb.toFixed(1)} Go (max ${max.toFixed(1)} Go)`);
  if (rel.seeders != null && rel.seeders < pf.minSeeders) no(`${rel.seeders} source (minimum ${pf.minSeeders})`);
  // Trackers privés : volume maximum par jour (sauf freeleech, qui ne compte pas dans le ratio)
  const ixq = autoIndexers().find((x) => x.id === rel.indexerId);
  const cap = ixq ? Number(ixq.maxGbPerDay ?? (ixq.type === 'c411' ? 15 : 0)) : 0;
  if (autoDebridOnly() && item.notCached && Date.now() - (item.notCached[rel.guid] || 0) < 24 * 3600e3) no('pas en cache AllDebrid (réessai demain)');
  if (cap > 0 && !rel.freeleech && !autoDebridOnly()) {
    const used = autoDlToday(ixq.id) / 1e9;
    if (used + gb > cap) no(`quota du jour atteint sur ${ixq.name} (${used.toFixed(1)} / ${cap} Go)`);
  }
  out.rejected = out.reasons[0] || null;
  // Note : langue d'abord, puis codec, source, sources actives, taille raisonnable
  const li = p.langs.length ? Math.min(...p.langs.map((l) => (pf.languages.indexOf(l) >= 0 ? pf.languages.indexOf(l) : 9))) : 9;
  out.score += 100 - li * 8;
  if (p.codec === 'h265') out.score += pf.h265 === 'any' ? 5 : 30;
  out.score += { bluray: 12, webdl: 10, webrip: 8, hdtv: 3 }[p.source] || 0;
  if (p.resolution === pf.resolution) out.score += 20;
  out.score += Math.min(rel.seeders || 0, 50) / 5;
  if (idMatch) out.score += 5;
  if (rel.freeleech) out.score += 40; // ne compte pas dans le ratio : toujours préféré
  if (gb > 0 && gb < 0.25 * per) out.score -= 15; // suspect, trop petit
  else if (gb > 0 && max > 0) out.score -= Math.min(15, (gb / max) * 15); // à qualité égale : le fichier le plus léger
  if (/\b(repack|proper)\b/i.test(rel.title)) out.score += 2;
  return out;
}

// Liste noire : versions en échec ou annulées (clé = guid ou empreinte), avec le titre et la raison
const blockKey = (b) => (typeof b === 'string' ? b : b.key);
const autoBlocked = (rel) => auto.blocked.some((b) => blockKey(b) === rel.guid || (rel.hash && blockKey(b) === rel.hash));

// ——— Titres suivis ———
// item : { id, type, tmdbId, tvdbId, title, originalTitle, altTitles, year, anime, root, folder, seasons, future,
//          requestIds, addedAt, meta: { at, available, seasons: { n: [{ e, air }] } }, nextSearch, fails, note }
const autoItemKey = (type, tmdbId) => `${type}:${tmdbId}`;
const findItem = (type, tmdbId) => auto.items.find((i) => i.type === type && i.tmdbId === Number(tmdbId));

function autoFolderChoices(kind) {
  const list = [];
  for (const d of disks()) {
    let names = [];
    try {
      names = fs.readdirSync(d.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {}
    for (const n of names) {
      const low = n.toLowerCase();
      const movie = /film|movie|kid|enfant|jeunesse|famil|4k|doc/.test(low);
      const tv = /s[eé]rie|tv|show|anim/.test(low);
      if ((kind === 'radarr' && movie && !/s[eé]rie/.test(low)) || (kind === 'sonarr' && tv)) list.push({ path: path.join(d.dir, n), root: d.name, folder: n, name: n });
    }
  }
  const score = (n) => {
    const low = n.toLowerCase();
    if (/kid|enfant|jeunesse|famil/.test(low)) return 9;
    if (kind === 'radarr') return /film|movie/.test(low) ? 0 : 2;
    return /s[eé]rie|tv|show/.test(low) ? 0 : /anim/.test(low) ? 1 : 2;
  };
  return list.sort((a, b) => score(a.name) - score(b.name));
}
/** Dossier d'arrivée : chemin Lumio exact, ou même nom de dossier qu'un chemin Radarr / Sonarr (« /movies/KIDS » → KIDS). */
function autoResolveFolder(kind, wanted) {
  const list = autoFolderChoices(kind);
  if (wanted) {
    const clean = String(wanted).replace(/\/+$/, '');
    const exact = list.find((f) => f.path === clean);
    if (exact) return exact;
    const base = clean.split('/').pop().toLowerCase();
    const same = list.find((f) => f.name.toLowerCase() === base);
    if (same) return same;
  }
  const def = (autoCfg().folders || {})[kind === 'radarr' ? 'movie' : 'tv'];
  return list.find((f) => f.path === def) || list[0] || null;
}

async function autoMeta(item, force = false) {
  if (!force && item.meta && Date.now() - Date.parse(item.meta.at || 0) < 12 * 3600e3) return item;
  const today = new Date().toISOString().slice(0, 10);
  if (item.type === 'movie') {
    const m = await tmdbGet(`/movie/${item.tmdbId}`, { append_to_response: 'release_dates,alternative_titles' });
    if (!m) throw new Error('film introuvable sur TMDB');
    item.title = m.title || item.title;
    item.originalTitle = m.original_title;
    item.imdbId = m.imdb_id || item.imdbId || null;
    item.year = m.release_date ? Number(m.release_date.slice(0, 4)) : item.year;
    item.altTitles = ((m.alternative_titles && m.alternative_titles.titles) || []).filter((x) => ['FR', 'US', 'GB', 'CA', 'BE'].includes(x.iso_3166_1)).map((x) => x.title).slice(0, 8);
    // Disponible : sortie numérique / physique passée, ou cinéma depuis plus de 45 jours
    const dates = [];
    for (const c of (m.release_dates && m.release_dates.results) || []) for (const d of c.release_dates || []) dates.push({ type: d.type, date: String(d.release_date).slice(0, 10) });
    const digital = dates.filter((d) => d.type === 4 || d.type === 5).map((d) => d.date).sort()[0];
    const cinema = dates.filter((d) => d.type === 2 || d.type === 3).map((d) => d.date).sort()[0] || m.release_date;
    const plus45 = cinema ? new Date(Date.parse(cinema) + 45 * 864e5).toISOString().slice(0, 10) : null;
    const avail = [digital, plus45].filter(Boolean).sort()[0] || null;
    item.meta = { at: new Date().toISOString(), availableFrom: avail, available: Boolean(avail && avail <= today) };
    return item;
  }
  const s = await tmdbGet(`/tv/${item.tmdbId}`, { append_to_response: 'alternative_titles,external_ids' });
  if (!s) throw new Error('série introuvable sur TMDB');
  item.title = s.name || item.title;
  item.originalTitle = s.original_name;
  item.year = s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : item.year;
  item.tvdbId = item.tvdbId || (s.external_ids && s.external_ids.tvdb_id) || null;
  item.imdbId = (s.external_ids && s.external_ids.imdb_id) || item.imdbId || null;
  item.altTitles = ((s.alternative_titles && s.alternative_titles.results) || []).filter((x) => ['FR', 'US', 'GB', 'CA', 'BE', 'JP'].includes(x.iso_3166_1)).map((x) => x.title).slice(0, 8);
  if (!item.anime) item.anime = (s.genres || []).some((g) => g.id === 16) && (s.origin_country || []).includes('JP');
  const seasons = {};
  const all = (s.seasons || []).filter((x) => x.season_number > 0);
  // Saisons suivies : celles demandées, et les nouvelles saisons si « suivre la suite »
  if (item.future === true) {
    const maxKnown = Math.max(0, ...(item.seasonsKnown || []));
    for (const x of all) if (x.season_number > maxKnown && item.seasonsKnown && !item.seasons.includes(x.season_number)) item.seasons.push(x.season_number);
  }
  item.seasonsKnown = all.map((x) => x.season_number);
  for (const n of item.seasons || []) {
    const d = await tmdbGet(`/tv/${item.tmdbId}/season/${n}`).catch(() => null);
    seasons[n] = ((d && d.episodes) || []).map((e) => ({ e: e.episode_number, air: e.air_date || null }));
  }
  item.meta = { at: new Date().toISOString(), status: s.status, seasons };
  return item;
}

// ——— Ce qui est déjà là (Jellyfin + ce que Lumio Auto a importé) ———
async function jfSeriesEpisodes(item) {
  const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
  const lib = await loadLibrary().catch(() => null);
  const jfId = lib && lib.jf && lib.jf.seriesJf && ((item.tvdbId && lib.jf.seriesJfTvdb.get(Number(item.tvdbId))) || lib.jf.seriesJf.get(item.tmdbId));
  const have = new Set(auto.have[autoItemKey('tv', item.tmdbId)] || []);
  if (!jfId || !token) return { have, jf: null };
  try {
    const r = await fetch(`${JELLYFIN_URL}/Shows/${jfId.id}/Episodes?IsMissing=false&Fields=Path`, { headers: jfHeaders(token), signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      for (const e of (await r.json()).Items || []) {
        if (e.LocationType === 'Virtual' || e.ParentIndexNumber == null || e.IndexNumber == null) continue;
        for (let n = e.IndexNumber; n <= (e.IndexNumberEnd || e.IndexNumber); n++) have.add(`${e.ParentIndexNumber}:${n}`);
      }
    }
  } catch {}
  return { have, jf: jfId };
}
async function movieInJellyfin(item) {
  if ((auto.have[autoItemKey('movie', item.tmdbId)] || []).length) return true;
  const lib = await loadLibrary().catch(() => null);
  return Boolean(lib && lib.jf && lib.jf.movies.has(item.tmdbId));
}

/** Ce qu'il reste à trouver pour un titre : [{ kind: 'movie' | 'season' | 'episode', season, episode, count, absolute }] */
async function autoWanted(item) {
  const busy = new Set(auto.grabs.filter((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state)).flatMap((g) => g.episodes || ['movie']));
  if (item.type === 'movie') {
    if (busy.has('movie')) return [];
    if (!(item.meta && item.meta.available)) return [];
    return (await movieInJellyfin(item)) ? [] : [{ kind: 'movie' }];
  }
  const { have } = await jfSeriesEpisodes(item);
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  let absolute = 0;
  const seasonNums = Object.keys((item.meta && item.meta.seasons) || {}).map(Number).sort((a, b) => a - b);
  const extra = new Set(item.extraEps || []); // épisodes lancés un par un depuis « Manquants »
  for (const n of seasonNums) {
    const eps = item.meta.seasons[n] || [];
    const full = (item.fullSeasons || []).includes(n);
    const inSeason = item.seasons.includes(n);
    // Série reprise de la bibliothèque : seulement les épisodes diffusés à partir du jour où on la suit (pas de rattrapage)
    const aired = eps.filter((e) => e.air && e.air <= today && (!item.since || full || extra.has(`${n}:${e.e}`) || e.air >= item.since));
    let missing = aired.filter((e) => !have.has(`${n}:${e.e}`) && !busy.has(`${n}:${e.e}`));
    if (!inSeason) missing = missing.filter((e) => extra.has(`${n}:${e.e}`));
    const firstAbs = absolute;
    absolute += eps.length;
    if (!missing.length) continue;
    // Saison terminée et entièrement manquante : on cherche d'abord le pack de la saison
    if (inSeason && (full || !item.since) && missing.length === eps.length && aired.length === eps.length && eps.length > 1) out.push({ kind: 'season', season: n, count: eps.length, episodes: eps.map((e) => e.e) });
    else for (const e of missing) out.push({ kind: 'episode', season: n, episode: e.e, absolute: firstAbs + e.e });
  }
  return out;
}

// ——— Recherche ———
// ——— Recherche ———
// Pour chaque indexeur : d'abord par identifiant (tmdbid / imdbid + saison / épisode) si le site sait le faire,
// puis en texte (« Titre S01E02 », « Titre 2024 ») si rien n'est revenu.
function autoTextQueries(item, want) {
  const names = [...new Set([item.title, item.originalTitle].filter(Boolean))];
  if (item.type === 'movie') return names.map((n) => `${n} ${item.year || ''}`.trim());
  if (want.kind === 'season') return names.map((n) => `${n} S${autoPad(want.season)}`);
  const q = names.map((n) => `${n} S${autoPad(want.season)}E${autoPad(want.episode)}`);
  if (item.anime && want.absolute) q.push(`${names[names.length - 1]} ${want.absolute}`);
  return q;
}
function autoIdQuery(ix, item, want) {
  const caps = ix.caps || {};
  if (item.type === 'movie') {
    const params = caps.movie || [];
    if (params.includes('tmdbid')) return { mode: 'movie', ids: { tmdbid: item.tmdbId } };
    if (params.includes('imdbid') && item.imdbId) return { mode: 'movie', ids: { imdbid: item.imdbId } };
    return null;
  }
  const params = caps.tv || [];
  const ep = want.kind === 'episode' ? { season: want.season, ep: want.episode } : want.kind === 'season' ? { season: want.season } : {};
  if (params.includes('tmdbid')) return { mode: 'tvsearch', ids: { tmdbid: item.tmdbId, ...ep } };
  if (params.includes('imdbid') && item.imdbId) return { mode: 'tvsearch', ids: { imdbid: item.imdbId, ...ep } };
  if (params.includes('tvdbid') && item.tvdbId) return { mode: 'tvsearch', ids: { tvdbid: item.tvdbId, ...ep } };
  return null;
}

async function autoSearch(item, want, { interactive = false } = {}) {
  const ixs = autoIndexers().filter((ix) => ix.enabled !== false && ix.search !== false);
  const found = new Map();
  const status = [];
  for (const ix of ixs) {
    let seen = 0;
    let error = null;
    let skipped = false;
    const tries = [];
    await idxCaps(ix);
    const byId = autoIdQuery(ix, item, want);
    const plan = [
      ...(byId ? [{ ...byId, label: `${byId.mode} ${Object.entries(byId.ids).map(([k, v]) => `${k}=${v}`).join(' ')}` }] : []),
      ...autoTextQueries(item, want).slice(0, interactive ? 3 : 2).map((q) => ({ mode: 'search', q, label: `« ${q} »` })),
    ];
    for (const step of plan) {
      const r = await idxQuery(ix, { q: step.q || '', cats: catsFor(ix, item), mode: step.mode, ids: step.ids || {} });
      tries.push({ query: step.label, count: r.items.length, error: r.error || null, skipped: Boolean(r.skipped), url: r.url || null });
      if (r.skipped) skipped = true;
      if (r.error) error = r.error;
      for (const rel of r.items) if (!found.has(rel.guid)) found.set(rel.guid, rel), seen++;
      // Une étape qui a donné des résultats suffit (sauf en recherche interactive : on montre tout)
      if (r.items.length && !interactive) break;
      if (r.error || r.skipped) break;
    }
    status.push({ id: ix.id, name: ix.name, count: seen, error, skipped, tries });
  }
  const scored = [...found.values()].map((rel) => autoScore(rel, item, want)).sort((a, b) => (a.rejected ? 1 : 0) - (b.rejected ? 1 : 0) || b.score - a.score);
  return { results: scored, status };
}

// ——— Clients de téléchargement ———
// rdt-client parle comme qBittorrent (même branchement que dans Radarr / Sonarr)
let rdtCookie = null;
async function rdtFetch(p2, init = {}, retry = true) {
  const c = autoCfg().rdt || {};
  if (!c.url) throw new Error('adresse de rdt-client manquante');
  const base = String(c.url).replace(/\/+$/, '');
  if (!rdtCookie) {
    const r = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
      body: new URLSearchParams({ username: c.user || '', password: c.pass || '' }),
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    if (!r.ok || /fail/i.test(txt)) throw new Error('rdt-client refuse l’identifiant ou le mot de passe');
    rdtCookie = (r.headers.get('set-cookie') || '').split(';')[0] || 'SID=';
  }
  const r = await fetch(`${base}${p2}`, { ...init, headers: { ...(init.headers || {}), Cookie: rdtCookie, Referer: base }, signal: AbortSignal.timeout(30000) });
  if (r.status === 403 && retry) {
    rdtCookie = null;
    return rdtFetch(p2, init, false);
  }
  if (!r.ok) throw new Error(`rdt-client : HTTP ${r.status}`);
  return r;
}
const rdtCategory = () => (autoCfg().rdt && autoCfg().rdt.category) || 'lumio';

// qBittorrent (derrière le VPN Gluetun) : même API ; il partage (seed) après le téléchargement
let qbitCookie = null;
async function qbitFetch(p2, init = {}, retry = true) {
  const c = autoCfg().qbit || {};
  if (!c.url) throw new Error('adresse de qBittorrent manquante');
  const base = String(c.url).replace(/\/+$/, '');
  if (!qbitCookie) {
    const r = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
      body: new URLSearchParams({ username: c.user || '', password: c.pass || '' }),
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    if (!r.ok || /fail/i.test(txt)) throw new Error(r.status === 403 ? 'qBittorrent a bloqué l’adresse après trop d’essais : attends quelques minutes' : 'qBittorrent refuse l’identifiant ou le mot de passe');
    qbitCookie = (r.headers.get('set-cookie') || '').split(';')[0] || 'SID=';
  }
  const r = await fetch(`${base}${p2}`, { ...init, headers: { ...(init.headers || {}), Cookie: qbitCookie, Referer: base }, signal: AbortSignal.timeout(30000) });
  if (r.status === 403 && retry) {
    qbitCookie = null;
    return qbitFetch(p2, init, false);
  }
  if (!r.ok) throw new Error(`qBittorrent : HTTP ${r.status}`);
  return r;
}
const qbitCategory = () => (autoCfg().qbit && autoCfg().qbit.category) || 'lumio';
const CLIENT_LABEL = { rdt: 'rdt-client', qbit: 'qBittorrent', alldebrid: 'AllDebrid' };
const tcFetch = (kind, p2, init) => (kind === 'qbit' ? qbitFetch(p2, init) : rdtFetch(p2, init));
const tcCategory = (kind) => (kind === 'qbit' ? qbitCategory() : rdtCategory());
/** Client d'une version : celui choisi pour son indexeur, sinon celui par défaut. */
function autoClientFor(rel) {
  const c = autoCfg();
  const ix = autoIndexers().find((x) => x.id === rel.indexerId || x.name === rel.indexer);
  const ok = (k) => ['rdt', 'qbit', 'alldebrid'].includes(k);
  return ix && ok(ix.client) ? ix.client : ok(c.client) ? c.client : 'rdt';
}
// Règle des trackers privés (C411 : « 72 h de partage OU ratio 1 sur le torrent », sinon c'est un Hit & Run) :
// Lumio ne retire jamais un torrent avant, et prévient si on veut le supprimer à la main.
const HR_SEED_S = 72 * 3600;
const hrSafe = (seedTime, ratio) => (Number(seedTime) || 0) >= HR_SEED_S || (Number(ratio) || 0) >= 1;
const hrLeft = (seedTime) => Math.max(0, Math.ceil((HR_SEED_S - (Number(seedTime) || 0)) / 3600));
// Objectif de partage (seed) : ratio ou durée, le premier atteint
const autoSeed = () => ({ ratio: 1, days: 7, smart: true, summary: true, ...((autoCfg().seed) || {}) });

// Empreinte d'un .torrent (SHA-1 du dictionnaire « info »), pour suivre le téléchargement
function torrentHash(buf) {
  let i = 0;
  const skip = () => {
    const c = buf[i];
    if (c === 0x69) {
      i = buf.indexOf(0x65, i) + 1;
    } else if (c === 0x6c || c === 0x64) {
      i++;
      while (buf[i] !== 0x65) {
        if (c === 0x64) skip();
        skip();
      }
      i++;
    } else {
      const colon = buf.indexOf(0x3a, i);
      const len = Number(buf.slice(i, colon).toString());
      i = colon + 1 + len;
    }
  };
  if (buf[0] !== 0x64) return null;
  i = 1;
  while (i < buf.length && buf[i] !== 0x65) {
    const colon = buf.indexOf(0x3a, i);
    const len = Number(buf.slice(i, colon).toString());
    const key = buf.slice(colon + 1, colon + 1 + len).toString();
    i = colon + 1 + len;
    const start = i;
    skip();
    if (key === 'info') return crypto.createHash('sha1').update(buf.slice(start, i)).digest('hex');
  }
  return null;
}
function magnetHash(m) {
  const x = String(m).match(/xt=urn:btih:([a-z0-9]+)/i);
  if (!x) return null;
  const h = x[1];
  if (h.length === 40) return h.toLowerCase();
  if (h.length === 32) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of h.toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, '0');
    return bits.match(/.{4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
  }
  return null;
}

async function fetchTorrent(rel) {
  if (/^magnet:/i.test(rel.link)) return { magnet: rel.link };
  let r;
  try {
    r = await autoHttp(rel.link, { timeout: 30000 });
  } catch (e) {
    if (rel.magnet) return { magnet: rel.magnet };
    throw new Error(`${rel.indexer} : .torrent injoignable (${netError(e)})`);
  }
  if (r.magnet) return { magnet: r.magnet };
  if (r.status === 401 || r.status === 403) throw new Error(`${rel.indexer} refuse le .torrent (HTTP ${r.status}) : clé ou quota`);
  if (r.status >= 400) throw new Error(`${rel.indexer} n’a pas donné le .torrent (HTTP ${r.status})`);
  const buf = r.buf;
  if (buf[0] !== 0x64) {
    if (rel.magnet) return { magnet: rel.magnet };
    throw new Error(`${rel.indexer} n’a pas donné un vrai .torrent (page d’erreur ou limite atteinte)`);
  }
  return { buf };
}

/** Envoie la release au client choisi ; renvoie les infos de suivi. */
async function autoSend(rel, item, grab) {
  const t = await fetchTorrent(rel);
  const client = autoDebridOnly() ? 'alldebrid' : autoClientFor(rel);
  if (client === 'rdt' || client === 'qbit') {
    const fd = new FormData();
    if (t.buf) fd.append('torrents', new Blob([t.buf], { type: 'application/x-bittorrent' }), `${cleanName(rel.title)}.torrent`);
    else fd.append('urls', t.magnet);
    fd.append('category', tcCategory(client));
    if (client === 'qbit') {
      // Un dossier de téléchargement par disque (/downloads/<disque>) : le fichier arrive sur le disque de sa
      // bibliothèque, et le lien dur marche (sinon c'est une copie le temps du partage)
      const dest = autoResolveFolder(item.type === 'movie' ? 'radarr' : 'sonarr', item.folderPath);
      const qc = autoCfg().qbit || {};
      if (dest && qc.perDisk !== false) fd.append('savepath', `${String(qc.remotePath || '/downloads').replace(/\/+$/, '')}/${dest.root}`);
    }
    const r = await tcFetch(client, '/api/v2/torrents/add', { method: 'POST', body: fd });
    const txt = await r.text();
    if (/fail/i.test(txt)) throw new Error(`${CLIENT_LABEL[client]} a refusé le torrent`);
    grab.client = client;
    grab.hash = (t.buf ? torrentHash(t.buf) : magnetHash(t.magnet)) || rel.hash || null;
    return;
  }
  // AllDebrid direct (comme Lumio Secour) : téléchargé dans un dossier caché du disque, puis rangé
  const dest = autoResolveFolder(item.type === 'movie' ? 'radarr' : 'sonarr', item.folderPath);
  if (!dest) throw new Error('aucun dossier de destination');
  let link;
  let up;
  if (t.buf) up = await uploadTorrentFile(`${cleanName(rel.title)}.torrent`, t.buf);
  else {
    const u = await ad('/v4/magnet/upload', { magnets: [t.magnet] });
    const m = u.magnets && u.magnets[0];
    if (!m || m.error) throw new Error(`AllDebrid : ${(m && m.error && m.error.message) || 'magnet refusé'}`);
    up = { id: m.id, ready: Boolean(m.ready) };
  }
  // Mode AllDebrid (interrupteur éteint) : seulement ce qu'AllDebrid a déjà en cache (instantané, rien côté tracker)
  if (autoDebridOnly() && !up.ready) {
    await ad('/v4/magnet/delete', { id: up.id }).catch(() => {});
    throw Object.assign(new Error('pas en cache AllDebrid'), { notCached: true });
  }
  link = `adid:${up.id}`;
  const job = {
    id: crypto.randomBytes(5).toString('hex'),
    link,
    root: dest.root,
    folder: `.lumio-auto/${grab.id}`,
    status: 'queued',
    quiet: true,
    auto: true,
    name: rel.title,
    size: 0,
    done: 0,
    speed: 0,
    token: null,
    createdAt: new Date().toISOString(),
    by: 'Lumio Auto',
  };
  downloads.push(job);
  runDownload(job);
  grab.client = 'alldebrid';
  grab.jobId = job.id;
}

/** Envoie la meilleure version ; en mode AllDebrid, essaie les suivantes tant qu'elles ne sont pas en cache. */
async function autoTryGrab(item, results, want) {
  const ok = results.filter((r) => !r.rejected).slice(0, autoDebridOnly() ? 6 : 1);
  for (const r of ok) {
    try {
      await autoGrab(item, r, want);
      return true;
    } catch (e) {
      if (!e.notCached) return false;
    }
  }
  return false;
}
const autoDlToday = (ixId) => ((auto.dlStats[ixId] || {})[new Date().toISOString().slice(0, 10)] || 0);
async function autoGrab(item, rel, want, by = 'auto') {
  const grab = {
    id: autoId(),
    itemId: item.id,
    title: item.title,
    release: { title: rel.title, size: rel.size, indexer: rel.indexer, indexerId: rel.indexerId, freeleech: Boolean(rel.freeleech), guid: rel.guid, seeders: rel.seeders },
    episodes: item.type === 'movie' ? ['movie'] : want.kind === 'season' ? (want.episodes || []).map((e) => `${want.season}:${e}`) : episodesOf(rel, want),
    want,
    state: 'sent',
    progress: 0,
    startedAt: new Date().toISOString(),
    by,
  };
  try {
    await autoSend(rel, item, grab);
  } catch (e) {
    if (e.notCached) {
      item.notCached = item.notCached || {};
      item.notCached[rel.guid] = Date.now();
      throw e;
    }
    autoBlock(rel, `envoi impossible : ${e.message}`);
    autoEvent(item, 'failed', `Envoi impossible : ${e.message}`);
    autoLog(`${item.title} : envoi impossible (${e.message})`, 'error');
    throw e;
  }
  auto.grabs.unshift(grab);
  if (!rel.freeleech && rel.indexerId && grab.client !== 'alldebrid') {
    const day = new Date().toISOString().slice(0, 10);
    const st0 = (auto.dlStats[rel.indexerId] = auto.dlStats[rel.indexerId] || {});
    st0[day] = (st0[day] || 0) + (rel.size || 0);
    for (const d of Object.keys(st0)) if (d < new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10)) delete st0[d];
  }
  if (auto.grabs.length > 200) auto.grabs.length = 200;
  item.needsChoice = false;
  autoEvent(item, 'sent', `${want.upgrade ? 'Version H.265 plus légère trouvée, elle remplacera l’ancienne. ' : ''}Envoyé à ${CLIENT_LABEL[grab.client] || grab.client} : ${rel.title}`, { indexer: rel.indexer, size: rel.size, by });
  autoSave();
  autoLog(`${item.title} : ${rel.title} envoyé à ${CLIENT_LABEL[grab.client] || grab.client} (${rel.indexer})`);
  notify({ title: '⬇️ Lumio Auto', message: `${item.title} · ${rel.title}`, tags: ['arrow_down'], click: 'lumio://activity' });
  return grab;
}
function episodesOf(rel, want) {
  const p = autoParse(rel.title);
  if (p.episode != null && p.season != null) {
    const out = [];
    for (let e = p.episode; e <= p.episodeEnd; e++) out.push(`${p.season}:${e}`);
    return out;
  }
  return [`${want.season}:${want.episode}`];
}
function autoBlock(rel, reason = null) {
  for (const key of [rel.guid, rel.hash].filter(Boolean))
    if (!auto.blocked.some((b) => blockKey(b) === key)) auto.blocked.unshift({ key, title: rel.title, indexer: rel.indexer || null, reason, at: new Date().toISOString() });
  if (auto.blocked.length > 500) auto.blocked.length = 500;
  autoSave();
}

// ——— Suivi des téléchargements et import ———
const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|mov|wmv)$/i;
const SUB_EXT = /\.(srt|ass|ssa|sub|idx|vtt)$/i;
function listFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    if (fs.existsSync(dir) && fs.statSync(dir).isFile()) out.push(dir);
    return out;
  }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(f, out);
    else out.push(f);
  }
  return out;
}
/** Chemin rdt-client → chemin vu par Lumio (« /data/downloads/lumio/X » → « /media/jellyfin3/downloads/lumio/X »). */
function rdtLocalPath(remote, name, kind = 'rdt') {
  const c = autoCfg()[kind] || {};
  const tries = [];
  if (remote) {
    const from = String(c.remotePath || (kind === 'qbit' ? '/downloads' : '/data/downloads')).replace(/\/+$/, '');
    // qBittorrent : /downloads/<disque>/X → <disque>/<dossier>/X
    if (kind === 'qbit' && remote.startsWith(from + '/')) {
      const [disk, ...rest] = remote.slice(from.length + 1).split('/');
      if (disks().some((d) => d.name === disk)) {
        try {
          tries.push(safePath(disk, path.join(c.localFolder || 'downloads/qbit', ...rest)).full);
        } catch {}
      }
    }
    if (c.localRoot && remote.startsWith(from)) {
      try {
        tries.push(safePath(c.localRoot, path.join(c.localFolder || '', remote.slice(from.length))).full);
      } catch {}
    }
    tries.push(remote);
  }
  // Dernier recours : le nom du torrent dans le dossier des téléchargements
  if (c.localRoot && name) {
    try {
      const base = safePath(c.localRoot, c.localFolder || '').full;
      tries.push(path.join(base, tcCategory(kind), name), path.join(base, name));
    } catch {}
  }
  return tries.find((p2) => fs.existsSync(p2)) || null;
}

const autoPad = (n) => String(n).padStart(2, '0');
const safeFile = (n) => String(n).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');

/** qBittorrent : lien dur (le même fichier à deux endroits, sans place en plus) pour continuer à partager ; copie si impossible. */
async function linkFile(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) await fs.promises.unlink(dest).catch(() => {});
  try {
    await fs.promises.link(src, dest);
  } catch {
    await fs.promises.copyFile(src, dest);
  }
}
async function moveFile(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) await fs.promises.unlink(dest).catch(() => {});
  try {
    await fs.promises.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(src, dest);
    await fs.promises.unlink(src).catch(() => {});
  }
}

/** Dossier de la série dans la bibliothèque : celui que Jellyfin connaît déjà, sinon un nouveau. */
async function seriesDir(item) {
  const { jf } = await jfSeriesEpisodes(item);
  const known = jf && jf.path ? localPath(jf.path) : null;
  if (known) return known;
  const dest = autoResolveFolder('sonarr', item.folderPath);
  if (!dest) throw new Error('aucun dossier pour les séries');
  return path.join(dest.path, safeFile(`${item.title}${item.year ? ` (${item.year})` : ''} [tmdbid-${item.tmdbId}]`));
}
function seasonDir(base, n) {
  try {
    const hit = fs.readdirSync(base, { withFileTypes: true }).find((e) => e.isDirectory() && new RegExp(`^(season|saison)\\s*0*${n}$`, 'i').test(e.name.trim()));
    if (hit) return path.join(base, hit.name);
  } catch {}
  return path.join(base, `Season ${autoPad(n)}`);
}

async function autoImport(grab, srcPath) {
  // qBittorrent : le fichier reste en place pour le partage, la bibliothèque reçoit un lien dur
  const place = grab.client === 'qbit' ? linkFile : moveFile;
  const item = auto.items.find((i) => i.id === grab.itemId);
  if (!item) throw new Error('titre retiré de Lumio Auto');
  const files = listFiles(srcPath);
  const videos = files.filter((f) => VIDEO_EXT.test(f) && !/\bsample\b/i.test(path.basename(f)) && fs.statSync(f).size > 30e6);
  if (!videos.length) throw new Error('aucune vidéo dans le téléchargement');
  const done = [];
  if (item.type === 'movie') {
    const dest = autoResolveFolder('radarr', item.folderPath);
    if (!dest) throw new Error('aucun dossier pour les films');
    const main = videos.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    const base = safeFile(`${item.title}${item.year ? ` (${item.year})` : ''}`);
    const dir = path.join(dest.path, `${base} [tmdbid-${item.tmdbId}]`);
    // Remplacement (version plus légère) : l'ancien fichier vidéo part
    try {
      for (const f of fs.readdirSync(dir)) if (VIDEO_EXT.test(f) && f !== `${base}${path.extname(main)}`) fs.unlinkSync(path.join(dir, f));
    } catch {}
    await place(main, path.join(dir, `${base}${path.extname(main)}`));
    for (const s of files.filter((f) => SUB_EXT.test(f))) await place(s, path.join(dir, `${base}.${path.basename(s).split('.').slice(-2).join('.')}`)).catch(() => {});
    done.push('movie');
  } else {
    const base = await seriesDir(item);
    const counts = Object.entries((item.meta && item.meta.seasons) || {}).sort((a, b) => a[0] - b[0]);
    for (const v of videos) {
      const p = autoParse(path.basename(v));
      let season = p.season;
      let ep = p.episode;
      let epEnd = p.episodeEnd;
      if (ep == null && p.absolute != null) {
        // Numérotation absolue (animés) → saison / épisode d'après TMDB
        let left = p.absolute;
        for (const [n, eps] of counts) {
          if (left <= eps.length) {
            season = Number(n);
            ep = epEnd = left;
            break;
          }
          left -= eps.length;
        }
      }
      if (season == null && grab.want && grab.want.season != null) season = grab.want.season;
      if (ep == null) {
        const m = path.basename(v).match(/(?:\bE|\bEp(?:isode)?\s?|\s-\s)(\d{1,3})\b/i);
        if (m) ep = epEnd = Number(m[1]);
      }
      if (season == null || ep == null) continue;
      const tag = `S${autoPad(season)}E${autoPad(ep)}${epEnd > ep ? `-E${autoPad(epEnd)}` : ''}`;
      const name = safeFile(`${item.title} - ${tag}`);
      const dir = seasonDir(base, season);
      try {
        for (const f of fs.readdirSync(dir)) if (VIDEO_EXT.test(f) && f.startsWith(`${name}.`) && f !== `${name}${path.extname(v)}`) fs.unlinkSync(path.join(dir, f));
      } catch {}
      await place(v, path.join(dir, `${name}${path.extname(v)}`));
      const stem = path.basename(v, path.extname(v));
      for (const s of files.filter((f) => SUB_EXT.test(f) && path.basename(f).startsWith(stem))) await place(s, path.join(dir, `${name}${path.basename(s).slice(stem.length)}`)).catch(() => {});
      for (let e = ep; e <= epEnd; e++) done.push(`${season}:${e}`);
    }
    if (!done.length) throw new Error('aucun épisode reconnu dans le téléchargement');
  }
  const key = autoItemKey(item.type, item.tmdbId);
  auto.have[key] = [...new Set([...(auto.have[key] || []), ...done])];
  const codec = autoParse(grab.release.title).codec || null;
  const hc = (auto.haveCodec[key] = auto.haveCodec[key] || {});
  for (const d of done) hc[d] = { c: codec, at: Date.now() };
  autoSave();
  const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
  if (token) fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(token) }).catch(() => {});
  library = null;
  return done;
}

async function autoCleanup(grab, srcPath) {
  try {
    if ((grab.client === 'rdt' || grab.client === 'qbit') && grab.hash)
      await tcFetch(grab.client, '/api/v2/torrents/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hashes: grab.hash, deleteFiles: 'true' }) });
  } catch {}
  try {
    if (grab.client === 'alldebrid' && srcPath && srcPath.includes(`${path.sep}.lumio-auto${path.sep}`)) await fs.promises.rm(srcPath, { recursive: true, force: true });
  } catch {}
}

// États qBittorrent renvoyés par rdt-client, en clair
const RDT_STATES = {
  metaDL: 'récupération des infos',
  queuedDL: 'en file d’attente',
  stalledDL: 'bloqué : pas de source',
  pausedDL: 'en pause',
  stoppedDL: 'en pause',
  checkingDL: 'vérification',
  allocating: 'préparation',
  downloading: 'téléchargement',
  forcedDL: 'téléchargement (forcé)',
  moving: 'déplacement',
  error: 'erreur',
  missingFiles: 'fichiers manquants',
  uploading: 'terminé',
  stalledUP: 'terminé',
  pausedUP: 'terminé',
  stoppedUP: 'terminé',
  queuedUP: 'terminé',
  forcedUP: 'terminé',
};
let autoTicking = false;
async function autoProgressTick() {
  if (autoTicking) return; // tourne même en pause : on finit et range ce qui est déjà lancé
  autoTicking = true;
  try {
    const active = auto.grabs.filter((g) => ['sent', 'downloading'].includes(g.state));
    const lists = {};
    for (const kind of ['rdt', 'qbit'])
      if (active.some((g) => g.client === kind)) {
        try {
          lists[kind] = await (await tcFetch(kind, `/api/v2/torrents/info?category=${encodeURIComponent(tcCategory(kind))}`)).json();
        } catch (e) {
          autoLog(`${CLIENT_LABEL[kind]} injoignable (${e.message})`, 'error');
        }
      }
    for (const g of active) {
      let src = null;
      let finished = false;
      let failed = null;
      if (g.paused) continue;
      if (g.client === 'rdt' || g.client === 'qbit') {
        const rdtList = lists[g.client];
        if (!rdtList) continue;
        const t = rdtList.find((x) => (g.hash && x.hash && x.hash.toLowerCase() === g.hash) || x.name === g.release.title);
        if (!t) {
          if (Date.now() - Date.parse(g.startedAt) > 15 * 60e3) failed = `disparu de ${CLIENT_LABEL[g.client]}`;
        } else {
          g.hash = g.hash || (t.hash || '').toLowerCase();
          g.progress = Math.round((Number(t.progress) || 0) * 100);
          g.speed = Number(t.dlspeed) || 0;
          g.size = Number(t.size || t.total_size) || g.release.size || 0;
          g.downloaded = Number(t.downloaded || t.completed) || Math.round((g.size || 0) * (Number(t.progress) || 0));
          g.eta = Number(t.eta) > 0 && Number(t.eta) < 8640000 ? Number(t.eta) : g.speed > 0 && g.size ? Math.round((g.size - g.downloaded) / g.speed) : null;
          g.clientState = t.state || null;
          g.seeders = Number(t.num_complete) || 0;
          g.leechers = Number(t.num_incomplete) || 0;
          if (/^(paused|stopped)DL$/i.test(t.state || '')) g.lastMoveAt = Date.now();
          g.statusText = RDT_STATES[t.state] || (Number(t.progress) >= 1 ? 'terminé, en attente du rangement' : 'téléchargement');
          g.state = 'downloading';
          if (/error|missing/i.test(t.state || '')) failed = `${CLIENT_LABEL[g.client]} : ${t.state}`;
          else if (Number(t.progress) >= 1 && !/^(downloading|metaDL|forcedMetaDL|queuedDL|stalledDL|checkingDL|allocating|pausedDL|stoppedDL|forcedDL|moving)$/i.test(t.state || '')) {
            src = rdtLocalPath(t.content_path || (t.save_path && path.join(t.save_path, t.name)), t.name, g.client);
            if (src) finished = true;
            else if (!g.missingSince) g.missingSince = Date.now();
            else if (Date.now() - g.missingSince > 30 * 60e3) failed = `fichiers introuvables (vérifie les chemins ${CLIENT_LABEL[g.client]} dans les réglages)`;
          }
        }
      } else {
        const job = downloads.find((d) => d.id === g.jobId);
        if (!job) failed = 'téléchargement AllDebrid perdu';
        else {
          g.state = 'downloading';
          g.progress = job.size ? Math.round((job.done / job.size) * 100) : 0;
          g.speed = job.speed || 0;
          g.size = job.size || g.release.size || 0;
          g.downloaded = job.done || 0;
          g.eta = g.speed > 0 && job.size ? Math.round((job.size - job.done) / g.speed) : null;
          g.clientState = job.status;
          g.statusText = { queued: 'en file d’attente', debrid: 'débridage AllDebrid', downloading: 'téléchargement' }[job.status] || job.status;
          if (job.status === 'done') {
            finished = true;
            src = safePath(job.root, job.folder).full;
          } else if (['error', 'cancelled'].includes(job.status)) failed = job.error || 'échec AllDebrid';
        }
      }
      // Bloqué trop longtemps sans avancer : on abandonne et on cherche une autre version
      if (!finished && !failed && g.state === 'downloading') {
        if (g.progress !== g.lastProgress) (g.lastProgress = g.progress), (g.lastMoveAt = Date.now());
        else if (Date.now() - (g.lastMoveAt || Date.parse(g.startedAt)) > 8 * 3600e3) failed = 'bloqué depuis 8 h';
      }
      if (failed) {
        g.state = 'failed';
        g.error = failed;
        autoBlock(g.release, failed);
        await autoCleanup(g, null);
        autoLog(`${g.title} : échec (${failed}), une autre version sera cherchée`, 'error');
        const item = auto.items.find((i) => i.id === g.itemId);
        autoEvent(item, 'failed', `Téléchargement en échec : ${failed}. Version mise en liste noire, une autre sera cherchée.`);
        if (item) item.nextSearch = Date.now() + 5 * 60e3;
        continue;
      }
      if (finished) {
        g.state = 'importing';
        autoSave();
        try {
          const done = await autoImport(g, src);
          g.state = 'done';
          g.progress = 100;
          g.doneAt = new Date().toISOString();
          if (g.client === 'qbit') {
            g.seeding = true;
            g.seedSince = Date.now();
          } else await autoCleanup(g, src);
          autoLog(`${g.title} : importé (${done.includes('movie') ? 'film' : done.length + ' épisode(s)'})`);
          autoEvent(auto.items.find((i) => i.id === g.itemId), 'imported', `Rangé dans la bibliothèque (${done.includes('movie') ? 'film' : done.length + ' épisode(s)'})`);
          notify({ title: '✅ Lumio Auto · importé', message: g.title, tags: ['white_check_mark'], click: 'lumio://activity' });
          autoCompleteRequests();
          // Une place se libère (un téléchargement à la fois) : l'épisode suivant part tout de suite, sans attendre 15 min
          const nextIt = auto.items.find((i) => i.id === g.itemId);
          if (nextIt) nextIt.nextSearch = 0;
          setTimeout(() => autoSearchTick().catch(() => {}), 5000);
        } catch (e) {
          g.state = 'failed';
          g.error = `import : ${e.message}`;
          g.importSrc = src;
          autoLog(`${g.title} : import impossible (${e.message})`, 'error');
          autoEvent(auto.items.find((i) => i.id === g.itemId), 'failed', `Rangement impossible : ${e.message}`);
        }
      }
    }
    autoSave();
  } finally {
    autoTicking = false;
  }
}

/** Demandes passées par Lumio Auto : « Terminée » quand tout ce qui était demandé est arrivé. */
async function autoCompleteRequests() {
  let changed = false;
  for (const r of requests) {
    if (r.via !== 'auto' || r.status !== RequestStatus.APPROVED) continue;
    const item = findItem(r.type === 'movie' ? 'movie' : 'tv', r.tmdbId);
    if (!item) continue;
    const wanted = await autoWanted(item).catch(() => null);
    const busy = auto.grabs.some((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state));
    const relevant = (wanted || []).filter((w) => item.type === 'movie' || (r.seasons || []).includes(w.season));
    const ready = item.type === 'movie' ? item.meta && item.meta.available : true;
    if (wanted && ready && !busy && !relevant.length) {
      r.status = RequestStatus.COMPLETED;
      r.completedAt = new Date().toISOString();
      changed = true;
      notify({ title: 'Disponible dans Jellyfin', message: `${r.title} · demandé par ${r.requestedBy.name}`, tags: ['tada'], image: r.poster });
      notifyFamily({ title: '🎉 Disponible', message: `${r.title} est prêt à regarder`, tags: ['tada'], image: r.poster, click: 'lumio://' });
    }
  }
  if (changed) saveRequests();
}

// Historique d'un titre (comme l'onglet « Historique » de Radarr / Sonarr), affiché dans l'appli
function autoEvent(item, type, msg, extra = {}) {
  if (!item) return;
  item.events = item.events || [];
  item.events.unshift({ at: new Date().toISOString(), type, msg: String(msg).slice(0, 300), ...extra });
  if (item.events.length > 40) item.events.length = 40;
}

// Compte rendu d'une recherche (affiché dans l'appli et dans le journal)
const wantLabel = (w) => (w.kind === 'movie' ? 'film' : w.kind === 'season' ? `saison ${w.season} complète` : `S${autoPad(w.season)}E${autoPad(w.episode)}`);
function autoReport(item, want, res) {
  const kept = res.results.filter((r) => !r.rejected);
  const reasons = {};
  for (const r of res.results) if (r.rejected) reasons[r.rejected.replace(/[\d.,]+ Go \(max[^)]*\)/, 'trop lourd')] = (reasons[r.rejected.replace(/[\d.,]+ Go \(max[^)]*\)/, 'trop lourd')] || 0) + 1;
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`);
  item.lastReport = {
    at: new Date().toISOString(),
    want: wantLabel(want),
    total: res.results.length,
    kept: kept.length,
    best: kept[0] ? kept[0].title : null,
    // Sources / téléchargeurs de la meilleure version trouvée (pastille des affiches, admin)
    swarm: (kept[0] || res.results[0]) ? { s: (kept[0] || res.results[0]).seeders ?? null, l: (kept[0] || res.results[0]).leechers ?? null } : null,
    sites: res.status.map((x) => ({ name: x.name, count: x.count, error: x.error || null, skipped: Boolean(x.skipped), tries: x.tries || [] })),
    reasons: top,
  };
  autoEvent(
    item,
    kept.length ? 'found' : 'none',
    `Recherche ${wantLabel(want)} : ${res.results.length} résultat(s)${kept.length ? `, ${kept.length} acceptable(s)` : top.length ? ` — écartés : ${top.join(', ')}` : ''}`,
    { sites: item.lastReport.sites.map((x) => ({ name: x.name, count: x.count, error: x.error })) }
  );
  const sites = res.status.map((x) => `${x.name} ${x.error ? `erreur (${x.error})` : x.skipped ? 'limite atteinte' : x.count}`).join(', ');
  autoLog(
    `${item.title} · ${wantLabel(want)} : ${res.results.length} trouvé(s) [${sites || 'aucun indexeur'}]${kept.length ? ` → ${kept[0].title}` : res.results.length ? ` → rien de bon (${top.join(', ')})` : ''}`,
    kept.length ? 'info' : 'warn'
  );
}

// ——— Recherche automatique de ce qui manque ———
let autoSearching = false;
async function autoSearchTick(force = false) {
  if (!autoActive() || autoSearching) return;
  autoSearching = true;
  try {
    const pf = autoProfile();
    const active = () => auto.grabs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state)).length;
    let searches = 0;
    for (const item of [...auto.items].sort((a, b) => (a.nextSearch || 0) - (b.nextSearch || 0))) {
      if (active() >= pf.maxActive) break;
      if (!force && (item.nextSearch || 0) > Date.now()) continue;
      if (item.paused) continue;
      if (searches >= 6) break; // les sites limitent le nombre de recherches
      try {
        await autoMeta(item);
      } catch (e) {
        item.note = `TMDB : ${e.message}`;
        continue;
      }
      let wanted = await autoWanted(item);
      let upgrading = false;
      if (!wanted.length) {
        const up = autoUpgradeWants(item, pf);
        if (up.length && (force || (item.nextUpgrade || 0) <= Date.now())) {
          wanted = up;
          upgrading = true;
          item.nextUpgrade = Date.now() + 24 * 3600e3;
        } else {
          item.note = item.type === 'movie' && !(item.meta && item.meta.available) ? `pas encore sorti${item.meta && item.meta.availableFrom ? ` (prévu le ${item.meta.availableFrom})` : ''}` : up.length ? 'complet · une version H.265 plus légère est guettée' : 'rien ne manque';
          item.nextSearch = Date.now() + 6 * 3600e3;
          continue;
        }
      }
      let grabbed = false;
      let waitUntil = 0;
      let quotaWait = false;
      let notCachedAll = false;
      for (const w of wanted) {
        const u = autoWaitH265(item, w, pf);
        if (u) (w.h265Only = true), (waitUntil = Math.max(waitUntil, u));
      }
      // Une saison complète manquante : le pack d'abord, sinon les épisodes un par un
      for (const want of wanted.slice(0, 4)) {
        if (active() >= pf.maxActive) break;
        searches++;
        item.searching = wantLabel(want);
        const res1 = await autoSearch(item, want);
        autoReport(item, want, res1);
        const results = res1.results;
        let best = results.find((r) => !r.rejected);
        // Une bonne version existe, mais le quota du jour du tracker est atteint : on attend demain (pas de choix à faire)
        if (!best && results.some((r) => r.reasons.length && r.reasons.every((x) => x.startsWith('quota du jour')))) quotaWait = true;
        if (!best && want.kind === 'season' && !want.upgrade) {
          // Pas de pack : on passe aux épisodes de cette saison
          for (const e of want.episodes.slice(0, 3)) {
            const w2 = { kind: 'episode', season: want.season, episode: e, h265Only: want.h265Only };
            item.searching = wantLabel(w2);
            const r2 = await autoSearch(item, w2);
            autoReport(item, w2, r2);
            searches++;
            if (r2.results.some((r) => !r.rejected)) {
              grabbed = await autoTryGrab(item, r2.results, w2);
              if (grabbed) break;
              if (autoDebridOnly()) notCachedAll = true;
            }
          }
          continue;
        }
        if (best) {
          const ok = await autoTryGrab(item, results, want);
          if (ok) grabbed = true;
          else if (autoDebridOnly()) notCachedAll = true;
        }
        if (grabbed && want.kind === 'movie') break;
      }
      item.searching = null;
      // Rien de mieux pour l'instant : pas de choix à faire, on guette
      if (!grabbed && notCachedAll) {
        item.needsChoice = false;
        item.note = 'mode AllDebrid : aucune version en cache pour l’instant (réessai dans 6 h, ou coupe AllDebrid pour passer en torrent)';
        item.nextSearch = Date.now() + 6 * 3600e3;
        item.lastSearch = new Date().toISOString();
        autoSave();
        continue;
      }
      if (!grabbed && quotaWait && !upgrading) {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 10, 0, 0);
        item.needsChoice = false;
        item.note = 'quota du jour du tracker atteint (ratio protégé) : reprise demain';
        item.nextSearch = tomorrow.getTime();
        item.lastSearch = new Date().toISOString();
        autoSave();
        continue;
      }
      if (!grabbed && (upgrading || waitUntil)) {
        item.needsChoice = false;
        item.note = upgrading
          ? 'complet · une version H.265 plus légère est guettée'
          : `en attente d’une version H.265 (sinon H.264 à partir du ${new Date(waitUntil).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Paris' })})`;
        item.nextSearch = upgrading ? Date.now() + 6 * 3600e3 : Math.min(Date.now() + 2 * 3600e3, waitUntil + 60e3);
        item.lastSearch = new Date().toISOString();
        autoSave();
        continue;
      }
      item.fails = grabbed ? 0 : (item.fails || 0) + 1;
      item.needsChoice = !grabbed;
      item.note = grabbed ? 'téléchargement lancé' : 'rien d’automatique : choisis une version (recherche interactive)';
      if (!grabbed && !item.choiceNotified) {
        item.choiceNotified = true;
        notify({ title: '🔎 Lumio Auto · à toi de choisir', message: `${item.title} : aucune version ne correspond au profil. Ouvre la recherche interactive.`, tags: ['mag'], click: 'lumio://auto' });
      }
      if (grabbed) item.choiceNotified = false;
      // Pas trouvé : on réessaie de moins en moins souvent (1 h, 3 h, 6 h, puis 12 h)
      const wait = [pf.searchEveryMin, 180, 360, 720][Math.min(item.fails || 0, 3)];
      item.nextSearch = Date.now() + (grabbed ? 15 : wait) * 60e3;
      item.lastSearch = new Date().toISOString();
      autoSave();
    }
  } catch (e) {
    autoLog(`recherche : ${e.message}`, 'error');
  } finally {
    for (const i of auto.items) i.searching = null;
    autoSearching = false;
  }
}

// ——— Veille RSS : les dernières sorties de chaque site, comparées à ce qui manque ———
let autoRssBusy = false;
async function autoRssTick() {
  if (!autoActive() || autoRssBusy || !auto.items.length) return;
  autoRssBusy = true;
  try {
    const pf = autoProfile();
    const releases = [];
    for (const ix of autoIndexers().filter((x) => x.enabled !== false && x.rss !== false && x.type !== 'prowlarr')) {
      const cats = [...new Set([...parseCats(ix.catMovie, '2000'), ...parseCats(ix.catTv, '5000'), ...parseCats(ix.catAnime, '5070')])];
      const r = await idxQuery(ix, { q: '', cats });
      releases.push(...r.items);
    }
    if (!releases.length) return;
    const active = () => auto.grabs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state)).length;
    for (const item of auto.items) {
      if (item.paused || active() >= pf.maxActive) continue;
      const names = itemNames(item);
      const mine = releases.filter((rel) => names.includes(autoParse(rel.title).name) || names.includes(stripArticle(autoParse(rel.title).name)));
      if (!mine.length) continue;
      await autoMeta(item).catch(() => null);
      const wanted = await autoWanted(item).catch(() => []);
      for (const want of wanted) {
        const best = mine.map((rel) => autoScore(rel, item, want)).filter((x) => !x.rejected).sort((a, b) => b.score - a.score)[0];
        if (best) {
          await autoGrab(item, best, want, 'rss').catch(() => {});
          break;
        }
      }
    }
  } catch (e) {
    autoLog(`veille RSS : ${e.message}`, 'error');
  } finally {
    autoRssBusy = false;
  }
}

setInterval(() => autoProgressTick().catch(() => {}), 10_000);

// ——— Partage (seed) qBittorrent : jusqu'au ratio ou à la durée voulus, puis le torrent est retiré ———
// (le fichier de la bibliothèque est un lien dur : il reste quand le torrent et sa copie sont supprimés)
let autoSeedBusy = false;
async function autoSeedTick() {
  if (autoSeedBusy) return;
  const seeding = auto.grabs.filter((g) => g.seeding && g.client === 'qbit' && g.hash);
  if (!seeding.length) return;
  autoSeedBusy = true;
  try {
    const list = await (await qbitFetch(`/api/v2/torrents/info?hashes=${seeding.map((g) => g.hash).join('|')}`)).json();
    const goal = autoSeed();
    for (const g of seeding) {
      const t = list.find((x) => (x.hash || '').toLowerCase() === g.hash);
      if (!t) {
        g.seeding = false;
        g.seedEnd = 'retiré de qBittorrent';
        continue;
      }
      g.ratio = Math.round((Number(t.ratio) || 0) * 100) / 100;
      g.uploaded = Number(t.uploaded) || 0;
      g.seedTime = Number(t.seeding_time) || Math.round((Date.now() - (g.seedSince || Date.now())) / 1000);
      g.upSpeed = Number(t.upspeed) || 0;
      g.leechers = Number(t.num_incomplete) || 0; // gens qui téléchargent ce torrent sur le site
      g.seeders = Number(t.num_complete) || 0;
      if (g.uploaded > (g.lastUploaded || 0)) (g.lastUploaded = g.uploaded), (g.lastUpAt = Date.now());
      if (!g.lastUpAt) g.lastUpAt = g.seedSince || Date.now();
      // On garde le partage tant que le ratio n'est pas atteint ET la durée minimum passée ; au plus 60 jours
      const byRatio = !(goal.ratio > 0) || g.ratio >= goal.ratio;
      const byTime = !(goal.days > 0) || g.seedTime >= goal.days * 86400;
      const tooLong = g.seedTime >= 60 * 86400;
      let why = null;
      if (tooLong) why = `60 j de partage (ratio ${g.ratio})`;
      else if (byRatio && byTime) {
        // Partage intelligent : encore demandé (3 personnes ou plus le téléchargent) → on le garde
        if (goal.smart && g.leechers >= 3) g.seedNote = `gardé : ${g.leechers} personnes le téléchargent`;
        else why = `ratio ${g.ratio} et ${goal.days} j atteints`;
      } else if (goal.smart && byTime && Date.now() - g.lastUpAt > 14 * 86400e3) {
        // Partage intelligent : durée minimum passée et plus personne ne le demande depuis 14 jours → place libérée
        why = `plus demandé depuis 14 j (ratio ${g.ratio})`;
      } else g.seedNote = null;
      if (why && !hrSafe(g.seedTime, g.ratio)) why = null; // règle C411 : 72 h ou ratio 1 avant tout retrait
      if (why) {
        await qbitFetch('/api/v2/torrents/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ hashes: g.hash, deleteFiles: 'true' }) }).catch(() => {});
        g.seeding = false;
        g.seedEnd = why;
        g.seedNote = null;
        autoLog(`${g.title} : partage terminé (${why}), torrent retiré`);
      }
    }
    autoSave();
  } catch (e) {
    autoLog(`partage : qBittorrent injoignable (${e.message})`, 'warn');
  } finally {
    autoSeedBusy = false;
  }
}
setInterval(() => autoSeedTick().catch(() => {}), 2 * 60_000);

// ——— Ratio par site (C411…) ———
// Toutes les 5 min : on additionne ce que chaque torrent de Lumio a envoyé / reçu depuis la dernière fois,
// rangé par site. Le freeleech reçu est compté à part (il ne compte pas dans le ratio du site).
function grabSite(g) {
  if (g.release && g.release.indexerId) return g.release.indexerId;
  const ix = autoIndexers().find((x) => g.release && x.name === g.release.indexer);
  return ix ? ix.id : null;
}
let ratioBusy = false;
async function autoRatioTick() {
  if (ratioBusy || !(autoCfg().qbit || {}).url) return;
  ratioBusy = true;
  try {
    const list = await (await qbitFetch('/api/v2/torrents/info')).json();
    const byHash = new Map(auto.grabs.filter((g) => g.hash && g.client === 'qbit').map((g) => [g.hash, g]));
    for (const t of list) {
      const hash = String(t.hash || '').toLowerCase();
      const g = byHash.get(hash);
      const site = g && grabSite(g);
      if (!site) continue;
      const st = (auto.siteStats[site] = auto.siteStats[site] || { up: 0, down: 0, freeDown: 0, last: {} });
      const prev = st.last[hash] || { u: 0, d: 0 };
      const u = Number(t.uploaded) || 0;
      const d = Number(t.downloaded) || 0;
      if (u > prev.u) st.up += u - prev.u;
      if (d > prev.d) {
        if (g.release && g.release.freeleech) st.freeDown += d - prev.d;
        else st.down += d - prev.d;
      }
      st.last[hash] = { u: Math.max(u, prev.u), d: Math.max(d, prev.d), at: Date.now() };
    }
    // On oublie les torrents disparus depuis 30 jours (leurs chiffres restent dans les totaux)
    for (const st of Object.values(auto.siteStats)) for (const [h, v] of Object.entries(st.last)) if (Date.now() - (v.at || 0) > 30 * 86400e3) delete st.last[h];
    autoSave();
  } catch (e) {
    // qBittorrent injoignable : on réessaie au prochain tour
  } finally {
    ratioBusy = false;
  }
}
setTimeout(() => autoRatioTick().catch(() => {}), 60_000);
setInterval(() => autoRatioTick().catch(() => {}), 5 * 60_000);

async function autoRatioReport() {
  await autoRatioTick().catch(() => {});
  let qb = null;
  try {
    const main = await (await qbitFetch('/api/v2/sync/maindata?rid=0')).json();
    const ss = (main && main.server_state) || {};
    qb = { up: Number(ss.alltime_ul) || 0, down: Number(ss.alltime_dl) || 0, upSpeed: Number(ss.up_info_speed) || 0, downSpeed: Number(ss.dl_info_speed) || 0, ratio: Number(ss.global_ratio) || null };
  } catch {}
  const sites = autoIndexers().map((ix) => {
    const st = auto.siteStats[ix.id] || { up: 0, down: 0, freeDown: 0 };
    const base = auto.ratioBase[ix.id] || null;
    const cap = Number(ix.maxGbPerDay ?? (ix.type === 'c411' ? 15 : 0)) || 0;
    const grabs = auto.grabs.filter((g) => grabSite(g) === ix.id);
    const seeding = grabs.filter((g) => g.seeding);
    const hr = seeding
      .filter((g) => !hrSafe(g.seedTime, g.ratio))
      .map((g) => ({ title: g.title, hoursLeft: hrLeft(g.seedTime), ratio: g.ratio ?? 0 }))
      .sort((a, b) => b.hoursLeft - a.hoursLeft);
    // Estimation du ratio sur le site = chiffres saisis (profil du site) + ce que Lumio a fait depuis
    let estimate = null;
    if (base && base.down > 0) {
      const up = base.up + Math.max(0, st.up - (base.lumioUp || 0));
      const down = base.down + Math.max(0, st.down - (base.lumioDown || 0));
      estimate = { up, down, ratio: down > 0 ? Math.round((up / down) * 100) / 100 : null, since: base.at };
    }
    const days = Object.entries(auto.dlStats[ix.id] || {}).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 7).map(([day, bytes]) => ({ day, bytes }));
    return {
      id: ix.id,
      name: ix.name,
      type: ix.type || null,
      lumio: { up: st.up, down: st.down, freeDown: st.freeDown, ratio: st.down > 0 ? Math.round((st.up / st.down) * 100) / 100 : null },
      estimate,
      base,
      today: autoDlToday(ix.id),
      cap: cap ? cap * 1e9 : 0,
      days,
      seeding: seeding.length,
      upSpeed: seeding.reduce((n, g) => n + (g.upSpeed || 0), 0),
      hr,
      rules: ix.type === 'c411' || /c411/i.test(ix.name || '') ? ['Garder chaque torrent 72 h ou jusqu’au ratio 1 (Hit & Run)', 'Ratio global au-dessus de 1', 'Le freeleech ne compte pas en téléchargement'] : [],
    };
  });
  return { qbit: qb, sites, at: new Date().toISOString() };
}

// ——— Résumé du soir (21 h) : envoyé / reçu dans la journée, partages, quota des sites ———
const parisNow = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return { day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, hour: d.getHours() };
};
/** État public (widget) : en ligne / hors ligne, compteurs, machine, disques ; aucun titre, aucune clé. */
async function publicStatusBody() {
  if (!publicStatusCache || Date.now() - publicStatusCache.at > 30_000) {
    const s = await status().catch(() => null);
    const pick = (k, x) =>
      x && x.configured !== false ? { ok: Boolean(x.ok), queue: typeof x.queue === 'number' ? x.queue : undefined, ms: x.ms || undefined, ...uptimeSummary(k) } : undefined;
    publicStatusCache = {
      at: Date.now(),
      body: s
        ? { lumio: { ok: true, version: VERSION, ...uptimeSummary('lumio') }, jellyfin: pick('jellyfin', s.jellyfin), radarr: pick('radarr', s.radarr), sonarr: pick('sonarr', s.sonarr), qbit: pick('qbit', s.qbit), vpn: pick('vpn', s.vpn), pending: s.lumio.pending }
        : { lumio: { ok: true, version: VERSION } },
    };
  }
  // Processeur et chaleur toujours frais (mesurés toutes les 2 s), sans détail sensible
  const last = sysHistory[sysHistory.length - 1] || {};
  // Disques : place libre / totale seulement (aucun titre)
  const disks = (await diskSummary().catch(() => [])).map((d) => ({ label: d.label, free: d.free, total: d.total }));
  return { ...publicStatusCache.body, machine: { cpu: last.cpu ?? null, temp: last.temp ?? null }, disks, at: new Date().toISOString() };
}

let widgetExtraCache = null;
async function widgetExtrasCached() {
  if (!widgetExtraCache || Date.now() - widgetExtraCache.at > 30_000) widgetExtraCache = { at: Date.now(), body: await widgetExtras().catch(() => ({})) };
  return widgetExtraCache.body;
}
/** Pour le widget de l'admin : torrents en partage (nombre, vitesse, Go envoyés) et lectures en cours sur Jellyfin. */
async function widgetExtras() {
  const out = {};
  const q = autoCfg().qbit || {};
  if (q.url) {
    try {
      const [list, main] = await Promise.all([
        qbitFetch('/api/v2/torrents/info?filter=completed').then((r) => r.json()),
        qbitFetch('/api/v2/sync/maindata?rid=0').then((r) => r.json()),
      ]);
      const st = (main && main.server_state) || {};
      const seeding = list.filter((t) => /UP$|^uploading$/.test(t.state) && t.state !== 'pausedUP' && t.state !== 'stoppedUP');
      const names = new Map(auto.grabs.filter((g) => g.hash).map((g) => [g.hash, g.title]));
      const ul = Number(st.alltime_ul) || 0;
      out.seed = {
        count: seeding.length,
        active: seeding.filter((t) => t.upspeed > 0).length,
        up: Number(st.up_info_speed) || seeding.reduce((n, t) => n + (t.upspeed || 0), 0),
        total: ul,
        today: auto.daySnap && auto.daySnap.ul <= ul ? ul - auto.daySnap.ul : null,
        top: seeding
          .filter((t) => t.upspeed > 0)
          .sort((a, b) => b.upspeed - a.upspeed)
          .slice(0, 3)
          .map((t) => ({ title: names.get(t.hash) || String(t.name).replace(/[._]+/g, ' ').slice(0, 40), up: t.upspeed, ratio: Math.round((Number(t.ratio) || 0) * 100) / 100 })),
      };
    } catch {}
  }
  const token = jfAdminToken || process.env.JELLYFIN_API_KEY;
  if (token) {
    try {
      const r = await fetch(`${JELLYFIN_URL}/Sessions?ActiveWithinSeconds=120`, { headers: jfHeaders(token) });
      const list = r.ok ? await r.json() : [];
      out.watching = list
        .filter((x) => x.NowPlayingItem && x.UserName)
        .slice(0, 4)
        .map((x) => {
          const it = x.NowPlayingItem;
          const ep = it.Type === 'Episode' && it.SeriesName ? `${it.SeriesName} · S${it.ParentIndexNumber ?? '?'}E${it.IndexNumber ?? '?'}` : it.Name;
          const pos = x.PlayState && x.PlayState.PositionTicks;
          return { user: x.UserName, title: ep, progress: it.RunTimeTicks && pos ? Math.round((pos / it.RunTimeTicks) * 100) : null, paused: Boolean(x.PlayState && x.PlayState.IsPaused), device: x.DeviceName || null };
        });
    } catch {}
  }
  return out;
}

async function autoSummaryTick() {
  const q = autoCfg().qbit || {};
  if (!q.url || !autoOn()) return;
  let st;
  try {
    st = (await (await qbitFetch('/api/v2/sync/maindata?rid=0')).json()).server_state || {};
  } catch {
    return;
  }
  const ul = Number(st.alltime_ul) || 0;
  const dl = Number(st.alltime_dl) || 0;
  const { day, hour } = parisNow();
  // Point de départ de la journée (premier passage après minuit)
  if (!auto.daySnap || auto.daySnap.day !== day) {
    auto.daySnap = { day, ul, dl };
    autoSave();
    return;
  }
  if (hour < 21 || auto.lastSummary === day || autoSeed().summary === false) return;
  auto.lastSummary = day;
  autoSave();
  const go = (b) => `${(Math.max(0, b) / 1e9).toFixed(1)} Go`;
  const seeding = auto.grabs.filter((g) => g.seeding).length;
  const quotas = autoIndexers()
    .filter((ix) => Number(ix.maxGbPerDay ?? (ix.type === 'c411' ? 15 : 0)) > 0)
    .map((ix) => `${ix.name} ${(autoDlToday(ix.id) / 1e9).toFixed(1)}/${ix.maxGbPerDay ?? 15} Go`);
  const total = Number(st.global_ratio) || null;
  notify({
    title: '📊 Lumio · ta journée',
    message: `↑ ${go(ul - auto.daySnap.ul)} envoyés · ↓ ${go(dl - auto.daySnap.dl)} reçus\n${seeding} en partage${total ? ` · ratio qBittorrent ${total}` : ''}${quotas.length ? `\nQuota : ${quotas.join(' · ')}` : ''}`,
    tags: ['bar_chart'],
    click: 'lumio://auto',
  });
}
setTimeout(() => autoSummaryTick().catch(() => {}), 60_000);
setInterval(() => autoSummaryTick().catch(() => {}), 10 * 60_000);

// ——— Port du VPN : Gluetun ouvre un port chez ProtonVPN (il change à chaque connexion) ; on le recopie dans qBittorrent ———
// (la commande de Gluetun échoue quand qBittorrent redémarre en même temps, et le port retombait à 0)
let vpnPort = { port: null, at: null, error: null, fixed: null };
const gluetunBase = () => {
  const q = autoCfg().qbit || {};
  if (q.gluetun) return String(q.gluetun).replace(/\/+$/, '');
  try {
    const u = new URL(q.url);
    return `${u.protocol}//${u.hostname}:8000`;
  } catch {
    return null;
  }
};
async function vpnPortTick() {
  const q = autoCfg().qbit || {};
  if (!q.url) return;
  const base = gluetunBase();
  if (!base) return;
  let port = null;
  for (const p2 of ['/v1/portforward', '/v1/openvpn/portforwarded']) {
    try {
      const r = await fetch(`${base}${p2}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      port = Number(j.port || (Array.isArray(j.ports) && j.ports[0])) || null;
      if (port) break;
    } catch (e) {
      vpnPort.error = `Gluetun injoignable (${netError(e)})`;
    }
  }
  vpnPort.at = new Date().toISOString();
  if (!port) {
    vpnPort.port = null;
    if (!vpnPort.error) vpnPort.error = 'aucun port ouvert par le VPN pour le moment';
    return;
  }
  vpnPort.port = port;
  vpnPort.error = null;
  try {
    const pref = await (await qbitFetch('/api/v2/app/preferences')).json();
    if (Number(pref.listen_port) !== port || (pref.current_network_interface && pref.current_network_interface !== 'tun0')) {
      await qbitFetch('/api/v2/app/setPreferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ json: JSON.stringify({ listen_port: port, current_network_interface: 'tun0', random_port: false, upnp: false }) }),
      });
      vpnPort.fixed = new Date().toISOString();
      autoLog(`qBittorrent : port du VPN remis à ${port} (il était à ${pref.listen_port})`);
    }
  } catch (e) {
    vpnPort.error = `qBittorrent : ${e.message}`;
  }
}
setTimeout(() => vpnPortTick().catch(() => {}), 30_000);
setInterval(() => vpnPortTick().catch(() => {}), 2 * 60_000);
setInterval(() => autoSearchTick().catch(() => {}), 5 * 60_000);
let autoRssLast = 0;
setInterval(() => {
  if (Date.now() - autoRssLast < autoProfile().rssEveryMin * 60e3) return;
  autoRssLast = Date.now();
  autoRssTick().catch(() => {});
}, 60_000);

// ——— Ajout d'un titre (demande validée, ou à la main) ———
async function autoAdd({ type, tmdbId, tvdbId, title, seasons, folderPath, future, requestId }) {
  type = type === 'tv' ? 'tv' : 'movie';
  tmdbId = Number(tmdbId);
  if (!tmdbId) throw new HttpError(400, 'Identifiant TMDB manquant');
  let item = findItem(type, tmdbId);
  if (!item) {
    // Les nouvelles saisons ne partent jamais toutes seules : on les demande (sauf « suivre la suite » activé sur la fiche)
    item = { id: autoId(), type, tmdbId, tvdbId: tvdbId || null, title: title || `#${tmdbId}`, seasons: [], future: future === true, requestIds: [], addedAt: new Date().toISOString(), nextSearch: 0 };
    auto.items.unshift(item);
  }
  if (folderPath) item.folderPath = folderPath;
  if (!item.folderPath) {
    const f = autoResolveFolder(type === 'movie' ? 'radarr' : 'sonarr', null);
    item.folderPath = f ? f.path : null;
  }
  if (type === 'tv') {
    for (const n of (seasons || []).map(Number).filter((n) => n > 0)) if (!item.seasons.includes(n)) item.seasons.push(n);
    item.seasons.sort((a, b) => a - b);
    if (/anim/i.test(String(item.folderPath || ''))) item.anime = true;
  }
  if (requestId && !item.requestIds.includes(requestId)) item.requestIds.push(requestId);
  item.paused = false;
  item.nextSearch = 0;
  item.fails = 0;
  await autoMeta(item, true).catch((e) => (item.note = `TMDB : ${e.message}`));
  autoSave();
  autoLog(`${item.title} ajouté${type === 'tv' ? ` (saisons ${item.seasons.join(', ') || '—'})` : ''}`);
  autoEvent(item, 'added', requestId ? 'Demande validée : ajouté au suivi' : 'Ajouté à la main au suivi');
  setTimeout(() => autoSearchTick().catch(() => {}), 1500);
  return item;
}

/** Demande validée → Lumio Auto (à la place de Radarr / Sonarr quand il est activé). */
/** Demandes validées avant l'activation de Lumio Auto, encore chez Radarr / Sonarr. */
const autoAdoptable = () => requests.filter((r) => r.status === RequestStatus.APPROVED && r.via !== 'auto' && !(r.via === 'secour' && r.secour && ['queued', 'running'].includes(r.secour.state)));
async function autoFromRequest(r) {
  await autoAdd({ type: r.type, tmdbId: r.tmdbId, tvdbId: r.tvdbId, title: r.title, seasons: r.seasons, folderPath: r.rootFolderPath, requestId: r.id });
  r.via = 'auto';
}

/** File de téléchargement (onglet Demandes → Téléchargements) quand Lumio Auto remplace Radarr / Sonarr. */
function autoQueue() {
  const fmt = (sec) => (sec > 0 ? `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` : undefined);
  const records = auto.grabs
    .filter((g) => ['sent', 'downloading', 'importing'].includes(g.state))
    .map((g, i) => {
      const item = auto.items.find((x) => x.id === g.itemId) || {};
      const size = g.size || g.release.size || 0;
      const [sn, ep] = g.episodes.length === 1 && g.episodes[0] !== 'movie' ? g.episodes[0].split(':').map(Number) : [];
      return {
        id: i + 1,
        source: item.type === 'movie' ? 'radarr' : 'sonarr',
        title: g.release.title,
        status: g.paused ? 'paused' : g.state === 'sent' ? 'queued' : g.state === 'importing' ? 'importing' : 'downloading',
        trackedDownloadState: g.paused ? 'paused' : g.state === 'importing' ? 'importing' : g.state === 'sent' ? 'queued' : 'downloading',
        size,
        sizeleft: Math.max(0, size - (g.downloaded || Math.round((size * (g.progress || 0)) / 100))),
        timeleft: fmt(g.eta),
        downloadClient: `Lumio Auto · ${CLIENT_LABEL[g.client] || g.client}`,
        errorMessage: /bloqué|erreur|manquants/.test(g.statusText || '') ? `${CLIENT_LABEL[g.client] || g.client} : ${g.statusText}` : undefined,
        movie: item.type === 'movie' ? { title: item.title, tmdbId: item.tmdbId, year: item.year } : undefined,
        series: item.type === 'tv' ? { title: item.title, tvdbId: item.tvdbId, tmdbId: item.tmdbId } : undefined,
        episode: sn ? { seasonNumber: sn, episodeNumber: ep } : undefined,
      };
    });
  return { records, errors: [] };
}
/** « Relancer la recherche » d'une demande : Lumio Auto cherche tout de suite sur les indexeurs. */
async function autoRecheck(r) {
  if (r.via !== 'auto') {
    await autoFromRequest(r);
    saveRequests();
  }
  const item = findItem(r.type === 'movie' ? 'movie' : 'tv', r.tmdbId);
  if (!item) return { found: false, message: 'Titre introuvable dans Lumio Auto.' };
  if (auto.grabs.some((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state))) return { found: true, message: 'Déjà en téléchargement.' };
  item.paused = false;
  item.fails = 0;
  item.nextSearch = 0;
  item.nextUpgrade = 0;
  await autoSearchTick().catch(() => {});
  if (auto.grabs.some((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state))) return { found: true, message: 'Version trouvée, le téléchargement démarre.' };
  if (item.needsChoice) return { found: false, message: 'Aucune version ne correspond au profil : choisis-en une dans l’onglet Auto (recherche interactive).' };
  return { found: false, message: `Lumio Auto : ${item.note || 'toujours rien pour le moment'}.` };
}
/** Demande supprimée : Lumio Auto arrête de la suivre (et annule ses téléchargements en cours). */
async function autoForgetRequest(r, deleteFiles = false) {
  const item = findItem(r.type === 'movie' ? 'movie' : 'tv', r.tmdbId);
  if (!item) return null;
  item.requestIds = (item.requestIds || []).filter((x) => x !== r.id);
  if (item.requestIds.length) {
    autoSave();
    return 'Le titre reste suivi pour une autre demande.';
  }
  for (const g of auto.grabs.filter((x) => x.itemId === item.id && ['sent', 'downloading'].includes(x.state))) {
    if (g.client === 'alldebrid') {
      const job = downloads.find((d) => d.id === g.jobId);
      if (job) job.cancelled = true;
    }
    await autoCleanup(g, null);
    g.state = 'failed';
    g.error = 'demande supprimée';
  }
  auto.items = auto.items.filter((x) => x !== item);
  autoLog(`${item.title} : demande supprimée, plus suivi`);
  let msg = 'Lumio Auto ne le suit plus, fichiers gardés.';
  if (deleteFiles) {
    // Le dossier du titre seulement (jamais la racine de la bibliothèque)
    try {
      const kind = item.type === 'movie' ? 'radarr' : 'sonarr';
      const dest = autoResolveFolder(kind, item.folderPath);
      const dir =
        item.type === 'movie'
          ? dest && path.join(dest.path, `${safeFile(`${item.title}${item.year ? ` (${item.year})` : ''}`)} [tmdbid-${item.tmdbId}]`)
          : await seriesDir(item);
      const roots = [...autoFolderChoices('radarr'), ...autoFolderChoices('sonarr')].map((f) => path.resolve(f.path));
      if (dir && fs.existsSync(dir) && !roots.includes(path.resolve(dir)) && roots.some((r0) => path.resolve(dir).startsWith(r0 + path.sep))) {
        await fs.promises.rm(dir, { recursive: true, force: true });
        msg = 'Lumio Auto ne le suit plus, fichiers supprimés.';
        library = null;
      } else msg = 'Lumio Auto ne le suit plus (aucun dossier à supprimer trouvé).';
    } catch (e) {
      msg = `Lumio Auto ne le suit plus, mais les fichiers n’ont pas pu être supprimés (${e.message}).`;
    }
  }
  delete auto.have[autoItemKey(item.type, item.tmdbId)];
  delete auto.haveCodec[autoItemKey(item.type, item.tmdbId)];
  autoSave();
  return msg;
}
/** Lumio Auto actif : les demandes validées avant son activation passent chez lui (plus de lien avec Radarr / Sonarr). */
async function autoAdoptAll() {
  if (!autoOn()) return 0;
  let n = 0;
  for (const r of autoAdoptable()) {
    try {
      await autoFromRequest(r);
      n++;
    } catch (e) {
      autoLog(`${r.title} : reprise impossible (${e.message})`, 'warn');
    }
  }
  if (n) {
    saveRequests();
    autoLog(`${n} demande(s) reprise(s) de Radarr / Sonarr`);
  }
  return n;
}
setTimeout(() => autoAdoptAll().catch(() => {}), 20_000);

/**
 * Comme Sonarr : les séries encore en cours de diffusion déjà dans Jellyfin sont suivies (nouveaux épisodes chaque semaine),
 * même sans demande dans Lumio. On suit la dernière saison présente et les suivantes ; les épisodes déjà diffusés
 * qui manquent dans ces saisons sont téléchargés aussi.
 */
let autoFollowBusy = false;
async function autoFollowLibrary() {
  if (!autoOn() || autoFollowBusy || !tmdbKey()) return { added: [] };
  autoFollowBusy = true;
  const added = [];
  try {
    const idx = await loadJfIndex();
    if (!idx) return { added, error: 'Jellyfin pas encore joignable (un admin doit ouvrir Lumio une fois)' };
    for (const [tmdbId, jf] of idx.seriesJf) {
      if (findItem('tv', tmdbId) || auto.unfollowed.includes(tmdbId)) continue;
      const tv = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      if (!tv || !['Returning Series', 'In Production', 'Planned'].includes(tv.status)) continue;
      const have = [...(idx.series.get(tmdbId) || [])];
      const last = have.length ? Math.max(...have) : null;
      const tmdbSeasons = (tv.seasons || []).map((x) => x.season_number).filter((n) => n > 0);
      // Seulement la saison en cours (la dernière présente) ; une autre saison se demande
      const seasons = last ? [last] : tmdbSeasons.slice(-1);
      if (!seasons.length) continue;
      const folder = jf.path ? path.dirname(jf.path) : null;
      try {
        await autoAdd({ type: 'tv', tmdbId, tvdbId: (tv.external_ids && tv.external_ids.tvdb_id) || null, title: tv.name, seasons, folderPath: folder, future: false });
        const it = findItem('tv', tmdbId);
        if (it) it.since = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
        if (it) autoEvent(it, 'added', `Série en cours dans la bibliothèque : nouveaux épisodes de la saison ${seasons.join(', ')} suivis`);
        added.push(tv.name);
      } catch (e) {
        autoLog(`${tv.name} : suivi impossible (${e.message})`, 'warn');
      }
    }
    if (added.length) {
      autoLog(`${added.length} série(s) en cours de la bibliothèque maintenant suivie(s) : ${added.slice(0, 12).join(', ')}${added.length > 12 ? '…' : ''}`);
      notify({ title: '📺 Lumio Auto', message: `${added.length} série(s) en cours suivie(s) : nouveaux épisodes téléchargés chaque semaine`, tags: ['tv'], click: 'lumio://auto' });
    }
    return { added };
  } finally {
    autoFollowBusy = false;
  }
}
setTimeout(() => autoFollowLibrary().catch((e) => autoLog(`séries en cours : ${e.message}`, 'warn')), 90_000);

/**
 * « À compléter » : pour chaque série de Jellyfin, les épisodes déjà diffusés qui manquent (saison par saison).
 * Rien ne part tout seul : c'est l'admin qui lance une saison depuis l'onglet Auto. Recalculé toutes les 12 h.
 */
function autoUnhide(tmdbId) {
  auto.missingHidden = auto.missingHidden.filter((x) => x !== tmdbId);
}
let missingScan = { at: 0, busy: false, series: [] };
async function autoMissingScan() {
  if (missingScan.busy || !tmdbKey()) return missingScan;
  missingScan.busy = true;
  try {
    const idx = await loadJfIndex();
    const token = process.env.JELLYFIN_API_KEY || jfIndexToken;
    if (!idx || !token) return missingScan;
    // Tous les épisodes présents, en une requête
    const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Episode', IsMissing: 'false', EnableImages: 'false', EnableUserData: 'false', Fields: 'ParentId' });
    const r = await fetch(`${JELLYFIN_URL}/Items?${q}`, { headers: jfHeaders(token), signal: AbortSignal.timeout(60000) });
    const eps = r.ok ? (await r.json()).Items || [] : [];
    const haveBy = new Map(); // id Jellyfin de la série → Set("s:e")
    for (const e of eps) {
      if (e.LocationType === 'Virtual' || e.ParentIndexNumber == null || e.IndexNumber == null || !e.SeriesId) continue;
      if (!haveBy.has(e.SeriesId)) haveBy.set(e.SeriesId, new Set());
      for (let n = e.IndexNumber; n <= (e.IndexNumberEnd || e.IndexNumber); n++) haveBy.get(e.SeriesId).add(`${e.ParentIndexNumber}:${n}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const [tmdbId, jf] of idx.seriesJf) {
      const have = new Set([...(haveBy.get(jf.id) || []), ...(auto.have[autoItemKey('tv', tmdbId)] || [])]);
      const base = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
      if (!base) continue;
      const nums = (base.seasons || []).map((x) => x.season_number).filter((n) => n > 0);
      if (!nums.length) continue;
      const seasonsData = {};
      for (let i = 0; i < nums.length; i += 20) {
        const part = nums.slice(i, i + 20);
        const d = await tmdbGet(`/tv/${tmdbId}`, { append_to_response: part.map((n) => `season/${n}`).join(',') }).catch(() => null);
        for (const n of part) seasonsData[n] = (d && d[`season/${n}`] && d[`season/${n}`].episodes) || [];
      }
      const item = findItem('tv', tmdbId);
      const busy = new Set(item ? auto.grabs.filter((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state)).flatMap((g) => g.episodes || []) : []);
      const seasons = [];
      for (const n of nums) {
        const all = seasonsData[n];
        const aired = all.filter((e) => e.air_date && e.air_date <= today);
        const missing = aired.filter((e) => !have.has(`${n}:${e.episode_number}`)).map((e) => e.episode_number);
        if (!missing.length) continue;
        seasons.push({ season: n, missing, aired: aired.length, total: all.length, have: aired.length - missing.length, busy: missing.filter((e) => busy.has(`${n}:${e}`)).length, asked: Boolean(item && item.seasons.includes(n) && (!item.since || (item.fullSeasons || []).includes(n))), askedEps: item ? missing.filter((e) => (item.extraEps || []).includes(`${n}:${e}`)) : [] });
      }
      if (!seasons.length) continue;
      out.push({ tmdbId, title: base.name, year: base.first_air_date ? Number(base.first_air_date.slice(0, 4)) : null, poster: base.poster_path ? `https://image.tmdb.org/t/p/w185${base.poster_path}` : null, status: base.status, followed: Boolean(item), seasons, missing: seasons.reduce((n, x) => n + x.missing.length, 0) });
      await new Promise((ok) => setTimeout(ok, 120)); // doux avec TMDB
    }
    out.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    missingScan = { at: Date.now(), busy: false, series: out };
    return missingScan;
  } finally {
    missingScan.busy = false;
  }
}
setTimeout(() => autoMissingScan().catch((e) => autoLog(`à compléter : ${e.message}`, 'warn')), 150_000);
setInterval(() => autoMissingScan().catch(() => {}), 12 * 3600e3);
setInterval(() => autoFollowLibrary().catch(() => {}), 12 * 3600e3);

/** Progression d'une demande passée par Lumio Auto (même forme que la file Radarr / Sonarr). */
function autoDownloadOf(r) {
  const item = findItem(r.type === 'movie' ? 'movie' : 'tv', r.tmdbId);
  if (!item) return undefined;
  const gs = auto.grabs.filter((g) => g.itemId === item.id && ['sent', 'downloading', 'importing'].includes(g.state));
  if (!gs.length)
    return {
      state: 'searching',
      via: 'auto',
      progress: null,
      title: item.needsChoice ? 'Lumio Auto · à toi de choisir une version (onglet Auto)' : `Lumio Auto · ${item.searching ? `recherche ${item.searching}` : item.note || 'recherche en cours'}`,
    };
  const g = gs[0];
  return {
    state: 'downloading',
    via: 'auto',
    progress: g.progress || 0,
    count: gs.length > 1 ? gs.length : undefined,
    title: `Lumio Auto · ${g.state === 'importing' ? 'rangement' : g.release.title}`,
  };
}

const publicIndexer = (ix) => ({ ...ix, todayGb: Math.round(autoDlToday(ix.id) / 1e8) / 10, key: undefined, hasKey: Boolean(ix.key), status: idxStatus.get(ix.id) || null, callsLastHour: (idxCalls.get(ix.id) || []).filter((t) => Date.now() - t < 3600e3).length });
function publicItem(item) {
  const gs = auto.grabs.filter((g) => g.itemId === item.id);
  return {
    id: item.id,
    type: item.type,
    tmdbId: item.tmdbId,
    title: item.title,
    year: item.year,
    anime: Boolean(item.anime),
    seasons: item.seasons,
    future: item.future === true,
    folderPath: item.folderPath,
    paused: Boolean(item.paused),
    note: item.note || null,
    available: item.meta ? item.meta.available !== false : null,
    availableFrom: item.meta ? item.meta.availableFrom || null : null,
    have: (auto.have[autoItemKey(item.type, item.tmdbId)] || []).length,
    nextSearch: item.nextSearch ? new Date(item.nextSearch).toISOString() : null,
    lastSearch: item.lastSearch || null,
    active: gs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state)).length,
    searching: item.searching || null,
    lastReport: item.lastReport || null,
    needsChoice: Boolean(item.needsChoice),
    imdbId: item.imdbId || null,
    events: (item.events || []).slice(0, 25),
    requestedBy: [...new Set(requests.filter((r) => (item.requestIds || []).includes(r.id)).map((r) => r.requestedBy && r.requestedBy.name).filter(Boolean))],
    addedAt: item.addedAt || null,
  };
}

async function autoRoutes(req, res, p, q, user) {
  if (!p.startsWith('/api/auto')) return false;
  requireAdmin(user);
  const c = autoCfg();
  if (req.method === 'GET' && p === '/api/auto/state') {
    send(res, 200, {
      enabled: autoActive(),
      debridOnly: autoDebridOnly(),
      client: ['alldebrid', 'qbit'].includes(c.client) ? c.client : 'rdt',
      qbit: { url: (c.qbit || {}).url || '', user: (c.qbit || {}).user || '', hasPass: Boolean((c.qbit || {}).pass), category: qbitCategory(), remotePath: (c.qbit || {}).remotePath || '/downloads', localRoot: (c.qbit || {}).localRoot || '', localFolder: (c.qbit || {}).localFolder || 'downloads/qbit' },
      seed: autoSeed(),
      vpnPort,
      rdt: { url: (c.rdt || {}).url || '', user: (c.rdt || {}).user || '', hasPass: Boolean((c.rdt || {}).pass), category: rdtCategory(), remotePath: (c.rdt || {}).remotePath || '/data/downloads', localRoot: (c.rdt || {}).localRoot || '', localFolder: (c.rdt || {}).localFolder || 'downloads' },
      alldebrid: Boolean(process.env.ALLDEBRID_KEY || config.alldebridKey),
      profile: autoProfile(),
      indexers: autoIndexers().map(publicIndexer),
      folders: { movie: autoFolderChoices('radarr'), tv: autoFolderChoices('sonarr'), defaults: c.folders || {} },
      disks: disks().map((d) => d.name),
      items: auto.items.map(publicItem),
      grabs: auto.grabs.slice(0, 60),
      adoptable: autoAdoptable().length,
      log: auto.log.slice(0, 80),
    });
    return true;
  }
  if (req.method === 'PUT' && p === '/api/auto/settings') {
    const b = await readBody(req);
    if (typeof b.debridOnly === 'boolean') {
      c.debridOnly = b.debridOnly;
      autoLog(b.debridOnly ? 'AllDebrid activé : seulement les versions en cache AllDebrid' : 'AllDebrid désactivé : torrents par qBittorrent');
      for (const i of auto.items) if (!i.paused) i.nextSearch = Math.min(i.nextSearch || 0, Date.now() + 60e3);
    }
    if (typeof b.enabled === 'boolean') {
      c.enabled = b.enabled;
      if (b.enabled) c.arrRemoved = true;

      if (b.enabled) setTimeout(() => autoAdoptAll().then(() => autoFollowLibrary()).catch(() => {}), 1000);
      autoLog(b.enabled ? 'activé : les demandes passent par Lumio Auto' : 'en pause : les nouvelles demandes attendent (ce qui est lancé continue et reste en partage)');
    }
    if (['rdt', 'alldebrid', 'qbit'].includes(b.client)) c.client = b.client;
    if (b.qbit && typeof b.qbit === 'object') {
      c.qbit = c.qbit || {};
      for (const k of ['url', 'user', 'category', 'remotePath', 'localRoot', 'localFolder']) if (typeof b.qbit[k] === 'string') c.qbit[k] = b.qbit[k].trim();
      if (typeof b.qbit.pass === 'string' && b.qbit.pass) c.qbit.pass = b.qbit.pass; // jamais renvoyé à l'appli
      qbitCookie = null;
    }
    if (b.seed && typeof b.seed === 'object') {
      c.seed = { ...autoSeed() };
      for (const k of ['ratio', 'days']) if (Number(b.seed[k]) >= 0) c.seed[k] = Number(b.seed[k]);
      for (const k of ['smart', 'summary']) if (typeof b.seed[k] === 'boolean') c.seed[k] = b.seed[k];
    }
    if (b.rdt && typeof b.rdt === 'object') {
      c.rdt = c.rdt || {};
      for (const k of ['url', 'user', 'category', 'remotePath', 'localRoot', 'localFolder']) if (typeof b.rdt[k] === 'string') c.rdt[k] = b.rdt[k].trim();
      if (typeof b.rdt.pass === 'string' && b.rdt.pass) c.rdt.pass = b.rdt.pass; // jamais renvoyé à l'appli
      rdtCookie = null;
    }
    if (b.profile && typeof b.profile === 'object') {
      const pf = { ...(c.profile || {}) };
      for (const [k, v] of Object.entries(b.profile)) {
        if (!(k in AUTO_PROFILE)) continue;
        if (k === 'languages' && Array.isArray(v)) pf[k] = v.map(String).filter(Boolean);
        else if (k === 'h265' && ['required', 'preferred', 'any'].includes(v)) pf[k] = v;
        else if (k === 'allowLower') pf[k] = Boolean(v);
        else if (['h265Wait', 'upgradeDays'].includes(k) && Number(v) >= 0) pf[k] = Number(v);
        else if (typeof AUTO_PROFILE[k] === 'number' && Number(v) > 0) pf[k] = Number(v);
      }
      c.profile = pf;
    }
    if (b.folders && typeof b.folders === 'object') c.folders = { movie: b.folders.movie || null, tv: b.folders.tv || null };
    saveConfig();
    send(res, 200, { ok: true });
    return true;
  }
  // Indexeurs : ajout / modification (la clé reste sur le serveur)
  // Onglet « Ratio » : ratio par site, quota du jour, torrents encore sous la règle des 72 h
  if (req.method === 'GET' && p === '/api/auto/ratio') {
    send(res, 200, await autoRatioReport());
    return true;
  }
  // Chiffres du profil du site (envoyé / reçu, en octets) pour estimer le vrai ratio ; vide = effacer
  if (req.method === 'POST' && p === '/api/auto/ratio/base') {
    const b = await readBody(req);
    const ix = autoIndexers().find((x) => x.id === b.indexerId);
    if (!ix) throw new HttpError(404, 'Site inconnu');
    if (b.clear) delete auto.ratioBase[ix.id];
    else {
      const up = Number(b.up);
      const down = Number(b.down);
      if (!(up >= 0) || !(down > 0)) throw new HttpError(400, 'Envoyé et reçu en Go, reçu plus grand que 0');
      await autoRatioTick().catch(() => {});
      const st = auto.siteStats[ix.id] || { up: 0, down: 0 };
      auto.ratioBase[ix.id] = { up, down, at: new Date().toISOString(), lumioUp: st.up, lumioDown: st.down };
    }
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/indexers') {
    const b = await readBody(req);
    const type = ['c411', 'prowlarr', 'torznab'].includes(b.type) ? b.type : 'torznab';
    const preset = IDX_PRESETS[type];
    const url = String(b.url || preset.url || '').trim();
    if (!/^https?:\/\//.test(url)) throw new HttpError(400, 'Adresse de l’indexeur invalide (elle doit commencer par http:// ou https://)');
    const list = autoIndexers();
    let ix = b.id ? list.find((x) => x.id === b.id) : null;
    if (!ix) {
      ix = { id: autoId(), enabled: true, rss: type !== 'prowlarr', search: true, maxPerHour: preset.maxPerHour, catMovie: preset.catMovie, catTv: preset.catTv, catAnime: preset.catAnime };
      list.push(ix);
    }
    ix.type = type;
    ix.name = String(b.name || ix.name || preset.name || 'Indexeur').slice(0, 40);
    ix.url = url;
    if (typeof b.key === 'string' && b.key) ix.key = b.key.trim();
    for (const k of ['enabled', 'rss', 'search']) if (typeof b[k] === 'boolean') ix[k] = b[k];
    if (Number(b.maxPerHour) > 0) ix.maxPerHour = Math.min(500, Number(b.maxPerHour));
    if (b.maxGbPerDay != null && Number(b.maxGbPerDay) >= 0) ix.maxGbPerDay = Number(b.maxGbPerDay);
    for (const k of ['catMovie', 'catTv', 'catAnime']) if (typeof b[k] === 'string' && b[k].trim()) ix[k] = b[k].replace(/[^\d,]/g, '');
    if (ix.type === 'prowlarr') ix.rss = false;
    if (typeof b.client === 'string') ix.client = ['rdt', 'qbit', 'alldebrid'].includes(b.client) ? b.client : '';
    ix.caps = null;
    c.indexers = list;
    saveConfig();
    await idxCaps(ix, true);
    send(res, 200, { indexer: publicIndexer(ix) });
    return true;
  }
  let m = p.match(/^\/api\/auto\/indexers\/([a-f0-9]+)(\/test)?$/);
  if (m) {
    const list = autoIndexers();
    const ix = list.find((x) => x.id === m[1]);
    if (!ix) throw new HttpError(404, 'Indexeur introuvable');
    if (req.method === 'DELETE' && !m[2]) {
      c.indexers = list.filter((x) => x !== ix);
      saveConfig();
      send(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'POST' && m[2]) {
      idxCalls.set(ix.id, (idxCalls.get(ix.id) || []).filter((t) => Date.now() - t > 5000));
      const caps = await idxCaps(ix, true);
      const r = await idxQuery({ ...ix, maxPerHour: 1000 }, { q: ix.type === 'prowlarr' ? 'test' : '', cats: [...parseCats(ix.catMovie, '2000'), ...parseCats(ix.catTv, '5000')] });
      const capsTxt = caps ? `Recherche films : ${caps.movie ? caps.movie.join(', ') : 'non'} · séries : ${caps.tv ? caps.tv.join(', ') : 'non'}` : ix.type === 'prowlarr' ? 'Prowlarr' : 'capacités inconnues (t=caps sans réponse)';
      send(res, 200, r.error ? { ok: false, message: r.error, url: r.url, caps: capsTxt } : { ok: true, message: `${r.items.length} résultat(s) reçu(s)`, sample: r.items.slice(0, 5).map((x) => x.title), url: r.url, caps: capsTxt });
      return true;
    }
  }
  if (req.method === 'POST' && p === '/api/auto/test-client') {
    const tb = await readBody(req).catch(() => ({}));
    const kind = ['rdt', 'qbit', 'alldebrid'].includes(tb.client) ? tb.client : c.client === 'alldebrid' ? 'alldebrid' : c.client === 'qbit' ? 'qbit' : 'rdt';
    if (kind === 'qbit') {
      qbitCookie = null;
      try {
        const ver = await (await qbitFetch('/api/v2/app/version')).text();
        await vpnPortTick().catch(() => {});
        const pref = await (await qbitFetch('/api/v2/app/preferences')).json().catch(() => ({}));
        const list = await (await qbitFetch('/api/v2/torrents/info')).json();
        const iface = pref.current_network_interface;
        send(res, 200, {
          ok: true,
          message: `qBittorrent ${ver} répond (${list.length} torrent(s)) · port ${pref.listen_port || '?'}${iface ? ` · interface ${iface}` : ''}.\nVPN : ${vpnPort.port ? `port ouvert ${vpnPort.port}${Number(pref.listen_port) === vpnPort.port ? ' ✓' : ' (recopié dans qBittorrent)'}` : vpnPort.error || 'port inconnu'}.`,
        });
      } catch (e) {
        send(res, 200, { ok: false, message: netError(e) });
      }
      return true;
    }
    if (kind === 'alldebrid') {
      send(res, 200, process.env.ALLDEBRID_KEY || config.alldebridKey ? { ok: true, message: 'Clé AllDebrid présente sur le serveur.' } : { ok: false, message: 'Clé AllDebrid non configurée.' });
      return true;
    }
    rdtCookie = null;
    try {
      const list = await (await rdtFetch('/api/v2/torrents/info')).json();
      const probe = rdtLocalPath(null, null);
      send(res, 200, { ok: true, message: `rdt-client répond (${list.length} torrent(s)).${c.rdt && c.rdt.localRoot ? '' : ' Pense à choisir le dossier des téléchargements vu par Lumio.'}`, probe });
    } catch (e) {
      send(res, 200, { ok: false, message: e.message });
    }
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/items') {
    const b = await readBody(req);
    const item = await autoAdd({ type: b.type, tmdbId: b.tmdbId, title: b.title, seasons: b.seasons, folderPath: b.folderPath, future: b.future });
    send(res, 200, { item: publicItem(item) });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/search-all') {
    for (const i of auto.items) i.nextSearch = 0;
    autoSearchTick(true).catch(() => {});
    autoRssLast = 0;
    send(res, 200, { ok: true, message: 'Recherche lancée pour tous les titres suivis.' });
    return true;
  }
  m = p.match(/^\/api\/auto\/items\/([a-f0-9]+)(?:\/(search|releases|grab|pause))?$/);
  if (m) {
    const item = auto.items.find((i) => i.id === m[1]);
    if (!item) throw new HttpError(404, 'Titre introuvable');
    if (req.method === 'DELETE' && !m[2]) {
      auto.items = auto.items.filter((i) => i !== item);
      // Retiré à la main : ne plus le reprendre automatiquement (séries en cours de la bibliothèque)
      if (item.type === 'tv' && !auto.unfollowed.includes(item.tmdbId)) auto.unfollowed.push(item.tmdbId);
      autoSave();
      send(res, 200, { ok: true });
      return true;
    }
    if (req.method === 'PATCH' && !m[2]) {
      const b = await readBody(req);
      if (Array.isArray(b.seasons) && item.type === 'tv') item.seasons = b.seasons.map(Number).filter((n) => n > 0).sort((a, b2) => a - b2);
      if (typeof b.future === 'boolean') item.future = b.future;
      if (typeof b.folderPath === 'string') item.folderPath = b.folderPath;
      if (typeof b.anime === 'boolean') item.anime = b.anime;
      item.nextSearch = 0;
      await autoMeta(item, true).catch(() => {});
      autoSave();
      send(res, 200, { item: publicItem(item) });
      return true;
    }
    if (req.method === 'POST' && m[2] === 'pause') {
      item.paused = !item.paused;
      autoSave();
      send(res, 200, { item: publicItem(item) });
      return true;
    }
    if (req.method === 'POST' && m[2] === 'search') {
      item.nextSearch = 0;
      item.fails = 0;
      autoSearchTick().catch(() => {});
      send(res, 200, { ok: true, message: 'Recherche lancée.' });
      return true;
    }
    // Recherche manuelle : toutes les versions trouvées, avec la raison si elles sont écartées
    if (req.method === 'GET' && m[2] === 'releases') {
      await autoMeta(item).catch(() => {});
      const wanted = await autoWanted(item);
      const season = q.get('season') ? Number(q.get('season')) : null;
      const episode = q.get('episode') ? Number(q.get('episode')) : null;
      const want =
        item.type === 'movie'
          ? { kind: 'movie' }
          : episode != null && season != null
            ? { kind: 'episode', season, episode }
            : season != null
              ? { kind: 'season', season, count: ((item.meta && item.meta.seasons[season]) || []).length, episodes: ((item.meta && item.meta.seasons[season]) || []).map((e) => e.e) }
              : wanted[0] || { kind: 'season', season: item.seasons[0] || 1, count: 1, episodes: [] };
      const { results, status } = await autoSearch(item, want, { interactive: true });
      send(res, 200, {
        want,
        wanted: wanted.slice(0, 40),
        status,
        results: results.slice(0, 100).map((r) => ({
          title: r.title,
          size: r.size,
          seeders: r.seeders,
          leechers: r.leechers ?? null,
          grabs: r.grabs ?? null,
          indexer: r.indexer,
          guid: r.guid,
          score: Math.round(r.score),
          rejected: r.rejected,
          reasons: r.reasons || [],
          ageDays: r.pub && !isNaN(Date.parse(r.pub)) ? Math.max(0, Math.round((Date.now() - Date.parse(r.pub)) / 864e5)) : null,
          quality: [r.parsed.resolution ? `${r.parsed.resolution}p` : null, r.parsed.codec ? r.parsed.codec.toUpperCase().replace('H265', 'H.265').replace('H264', 'H.264') : null, r.parsed.source ? { bluray: 'BluRay', webdl: 'WEB-DL', webrip: 'WEBRip', hdtv: 'HDTV' }[r.parsed.source] : null].filter(Boolean).join(' · '),
          languages: r.parsed.langs.map((l) => l.toUpperCase()),
          matchedBy: r.matchedBy || null,
          freeleech: Boolean(r.freeleech),
          details: r.details || null,
        })),
      });
      // Gardées 30 min pour « Prendre celle-ci »
      autoLastResults.set(item.id, { at: Date.now(), want, results });
      return true;
    }
    if (req.method === 'POST' && m[2] === 'grab') {
      const b = await readBody(req);
      const last = autoLastResults.get(item.id);
      const rel = last && Date.now() - last.at < 30 * 60e3 ? last.results.find((r) => r.guid === b.guid) : null;
      if (!rel) throw new HttpError(404, 'Résultat expiré : relance la recherche');
      const g = await autoGrab(item, rel, last.want, user.name);
      send(res, 200, { grab: g });
      return true;
    }
  }
  // Vider l'historique : retire les lignes terminées / en échec ; ce qui télécharge ou partage encore n'est jamais touché
  if (p === '/api/auto/grabs/clear-history' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const only = b && (b.filter === 'done' || b.filter === 'failed') ? b.filter : null;
    const before = auto.grabs.length;
    auto.grabs = auto.grabs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state) || g.seeding || (only && g.state !== only));
    const removed = before - auto.grabs.length;
    autoSave();
    send(res, 200, { ok: true, removed, message: removed ? `${removed} ligne(s) retirée(s) de l’historique` : 'Historique déjà vide' });
    return true;
  }
  m = p.match(/^\/api\/auto\/grabs\/([a-f0-9]+)$/);
  if (m && req.method === 'DELETE') {
    // Comme « Retirer de la file » dans Radarr : retirer du client, liste noire, chercher une autre version (au choix)
    const g = auto.grabs.find((x) => x.id === m[1]);
    if (!g) throw new HttpError(404, 'Téléchargement introuvable');
    const q = new URL(req.url, 'http://x').searchParams;
    const opt = (k, d) => (q.has(k) ? q.get(k) === '1' : d);
    const running = ['sent', 'downloading'].includes(g.state);
    const item = auto.items.find((i) => i.id === g.itemId);
    if (running) {
      if (opt('client', true)) {
        if (g.client === 'alldebrid') {
          const job = downloads.find((d) => d.id === g.jobId);
          if (job) job.cancelled = true;
        }
        await autoCleanup(g, null);
      }
      g.state = 'failed';
      g.error = 'annulé';
      g.doneAt = new Date().toISOString();
      if (opt('blocklist', true)) autoBlock(g.release, `annulé par ${user.name}`);
      autoEvent(item, 'failed', `Téléchargement annulé par ${user.name}${opt('blocklist', true) ? ' (version en liste noire)' : ''}`);
      if (item && opt('search', true)) item.nextSearch = Date.now() + 10e3;
      else if (item) item.nextSearch = Date.now() + 6 * 3600e3;
    } else {
      // Version en partage : retirée de qBittorrent aussi (la bibliothèque garde son fichier), sauf règle C411
      if (g.seeding && opt('client', true)) {
        if (!opt('force', false) && !hrSafe(g.seedTime, g.ratio))
          throw new HttpError(409, `Règle C411 : encore ${hrLeft(g.seedTime)} h de partage (ou un ratio de 1) avant de pouvoir le retirer sans Hit & Run.`);
        await autoCleanup(g, null);
      }
      if (opt('blocklist', false)) autoBlock(g.release, `retiré par ${user.name}`);
      if (item && opt('search', false)) item.nextSearch = Date.now() + 10e3;
      auto.grabs = auto.grabs.filter((x) => x !== g);
    }
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  m = p.match(/^\/api\/auto\/grabs\/([a-f0-9]+)\/(pause|resume|retry-import)$/);
  if (m && req.method === 'POST') {
    const g = auto.grabs.find((x) => x.id === m[1]);
    if (!g) throw new HttpError(404, 'Téléchargement introuvable');
    const action = m[2];
    if (action === 'retry-import') {
      if (g.state !== 'failed' || !g.importSrc || !fs.existsSync(g.importSrc)) throw new HttpError(400, 'Les fichiers téléchargés ne sont plus là : relance une recherche.');
      g.state = 'importing';
      g.error = undefined;
      autoSave();
      try {
        const done = await autoImport(g, g.importSrc);
        g.state = 'done';
        g.progress = 100;
        g.doneAt = new Date().toISOString();
        if (g.client === 'qbit') {
          g.seeding = true;
          g.seedSince = Date.now();
        } else await autoCleanup(g, g.importSrc);
        delete g.importSrc;
        autoEvent(auto.items.find((i) => i.id === g.itemId), 'imported', `Rangé à la main par ${user.name} (${done.includes('movie') ? 'film' : done.length + ' épisode(s)'})`);
        autoCompleteRequests();
      } catch (e) {
        g.state = 'failed';
        g.error = `import : ${e.message}`;
        autoSave();
        throw new HttpError(400, `Rangement impossible : ${e.message}`);
      }
      autoSave();
      send(res, 200, { ok: true, message: 'Rangé dans la bibliothèque' });
      return true;
    }
    if (!['sent', 'downloading'].includes(g.state)) throw new HttpError(400, 'Ce téléchargement n’est plus en cours');
    if (!['rdt', 'qbit'].includes(g.client) || !g.hash) throw new HttpError(400, 'Pause possible seulement avec rdt-client ou qBittorrent');
    const hashes = new URLSearchParams({ hashes: g.hash });
    const call = async (a, b) => {
      try {
        await tcFetch(g.client, `/api/v2/torrents/${a}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: hashes });
      } catch {
        await tcFetch(g.client, `/api/v2/torrents/${b}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: hashes });
      }
    };
    try {
      if (action === 'pause') await call('pause', 'stop');
      else await call('resume', 'start');
    } catch (e) {
      throw new HttpError(502, `${CLIENT_LABEL[g.client]} n’accepte pas la ${action === 'pause' ? 'pause' : 'reprise'} : ${e.message}`);
    }
    g.paused = action === 'pause';
    g.statusText = g.paused ? 'en pause' : 'reprise…';
    g.lastMoveAt = Date.now();
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  // ——— Pastille des affiches (admin) : sources / téléchargeurs par titre ———
  // Titres en partage ou en téléchargement : chiffres de qBittorrent ; sinon, la dernière recherche de Lumio Auto
  if (req.method === 'GET' && p === '/api/auto/swarm') {
    const out = {};
    for (const it of auto.items) {
      const sw = it.lastReport && it.lastReport.swarm;
      if (sw && (sw.s != null || sw.l != null)) out[autoItemKey(it.type, it.tmdbId)] = { s: sw.s, l: sw.l, src: 'recherche' };
    }
    for (const g of [...auto.grabs].reverse()) {
      if (!(g.seeding || ['sent', 'downloading'].includes(g.state)) || g.seeders == null) continue;
      const it = auto.items.find((x) => x.id === g.itemId);
      if (!it) continue;
      const k = autoItemKey(it.type, it.tmdbId);
      const prev = out[k] && out[k].src === 'qbit' ? out[k] : { s: 0, l: 0 };
      out[k] = { s: Math.max(prev.s, g.seeders || 0), l: prev.l + (g.leechers || 0), src: 'qbit', seeding: Boolean(g.seeding) || prev.seeding };
    }
    send(res, 200, { swarm: out });
    return true;
  }
  // ——— qBittorrent depuis l'appli (admin) : liste des torrents, vitesses, actions ———
  if (req.method === 'GET' && p === '/api/auto/qbit') {
    try {
      const [list, info, alt] = await Promise.all([
        qbitFetch('/api/v2/torrents/info?sort=added_on&reverse=true').then((r) => r.json()),
        qbitFetch('/api/v2/transfer/info').then((r) => r.json()),
        qbitFetch('/api/v2/transfer/speedLimitsMode').then((r) => r.text()).catch(() => '0'),
      ]);
      const ours = new Map(auto.grabs.filter((g) => g.hash).map((g) => [g.hash, g]));
      send(res, 200, {
        ok: true,
        transfer: { dl: info.dl_info_speed || 0, up: info.up_info_speed || 0, dlLimit: info.dl_rate_limit || 0, upLimit: info.up_rate_limit || 0, alt: String(alt).trim() === '1', status: info.connection_status || null },
        vpnPort: vpnPort.port,
        torrents: list.slice(0, 300).map((t) => ({
          hash: t.hash,
          name: t.name,
          state: t.state,
          progress: Math.round((Number(t.progress) || 0) * 1000) / 10,
          size: t.size || t.total_size || 0,
          dl: t.dlspeed || 0,
          up: t.upspeed || 0,
          ratio: Math.round((Number(t.ratio) || 0) * 100) / 100,
          uploaded: t.uploaded || 0,
          eta: t.eta > 0 && t.eta < 8640000 ? t.eta : null,
          seeds: t.num_seeds,
          peers: t.num_leechs,
          category: t.category || '',
          addedOn: t.added_on ? new Date(t.added_on * 1000).toISOString() : null,
          seedTime: t.seeding_time || 0,
          hrLeftH: Number(t.progress) >= 1 && !hrSafe(t.seeding_time, t.ratio) ? hrLeft(t.seeding_time) : 0,
          swarmLeechers: t.num_incomplete ?? null,
          swarmSeeders: t.num_complete ?? null,
          tracker: (() => {
            try {
              return t.tracker ? new URL(t.tracker).hostname.replace(/^(www|tracker)\./, '') : '';
            } catch {
              return '';
            }
          })(),
          lumio: ours.has((t.hash || '').toLowerCase()) ? ours.get(t.hash.toLowerCase()).title : null,
        })),
      });
    } catch (e) {
      send(res, 200, { ok: false, error: e.message, torrents: [] });
    }
    return true;
  }
  // Réglages de partage de qBittorrent (file d'attente, nombre de torrents actifs, vitesses, emplacements d'envoi)
  const QB_PREFS = ['scheduler_enabled', 'schedule_from_hour', 'schedule_from_min', 'schedule_to_hour', 'schedule_to_min', 'scheduler_days', 'queueing_enabled', 'max_active_torrents', 'max_active_uploads', 'max_active_downloads', 'dont_count_slow_torrents', 'up_limit', 'dl_limit', 'max_uploads', 'max_uploads_per_torrent', 'max_connec', 'max_connec_per_torrent', 'alt_up_limit', 'alt_dl_limit'];
  if (p === '/api/auto/qbit/prefs') {
    if (req.method === 'POST') {
      const b = await readBody(req);
      const out = {};
      for (const k of QB_PREFS) {
        if (!(k in b)) continue;
        if (typeof b[k] === 'boolean') out[k] = b[k];
        else if (Number.isFinite(Number(b[k]))) out[k] = Math.max(-1, Math.round(Number(b[k])));
      }
      // « Envoi à fond la nuit » : de 1 h à 8 h, qBittorrent passe sur ses vitesses « alternatives », sans limite
      if (b.night === true) Object.assign(out, { scheduler_enabled: true, schedule_from_hour: 1, schedule_from_min: 0, schedule_to_hour: 8, schedule_to_min: 0, scheduler_days: 0, alt_up_limit: 0, alt_dl_limit: 0 });
      if (b.night === false) out.scheduler_enabled = false;
      if (!Object.keys(out).length) throw new HttpError(400, 'Rien à changer');
      await qbitFetch('/api/v2/app/setPreferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ json: JSON.stringify(out) }),
      });
      autoLog(`qBittorrent : réglages de partage changés par ${user.name} (${Object.keys(out).join(', ')})`);
    }
    const pref = await (await qbitFetch('/api/v2/app/preferences')).json();
    const prefs = {};
    for (const k of QB_PREFS) prefs[k] = pref[k];
    send(res, 200, { prefs, seed: autoSeed() });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/qbit/action') {
    const b = await readBody(req);
    const hashes = (Array.isArray(b.hashes) ? b.hashes : []).filter((h) => /^[a-f0-9]{40}$/i.test(h));
    const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
    const both = async (a1, a2, o) => {
      try {
        await qbitFetch(`/api/v2/torrents/${a1}`, form(o));
      } catch {
        await qbitFetch(`/api/v2/torrents/${a2}`, form(o));
      }
    };
    const h = hashes.join('|');
    if (b.action === 'alt') await qbitFetch('/api/v2/transfer/toggleSpeedLimitsMode', form({}));
    else if (!hashes.length) throw new HttpError(400, 'Aucun torrent choisi');
    else if (b.action === 'pause') await both('stop', 'pause', { hashes: h });
    else if (b.action === 'resume') await both('start', 'resume', { hashes: h });
    else if (b.action === 'recheck') await qbitFetch('/api/v2/torrents/recheck', form({ hashes: h }));
    else if (b.action === 'reannounce') await qbitFetch('/api/v2/torrents/reannounce', form({ hashes: h }));
    else if (b.action === 'delete' || b.action === 'deleteFiles') {
      if (!b.force) {
        const info = await (await qbitFetch(`/api/v2/torrents/info?hashes=${h}`)).json().catch(() => []);
        const risky = info.filter((t) => Number(t.progress) >= 1 && !hrSafe(t.seeding_time, t.ratio));
        if (risky.length)
          throw new HttpError(
            409,
            `Règle C411 : ${risky.length > 1 ? `${risky.length} torrents n’ont` : '« ' + risky[0].name.slice(0, 60) + ' » n’a'} pas encore 72 h de partage ni un ratio de 1 (encore ${hrLeft(Math.min(...risky.map((t) => t.seeding_time || 0)))} h). Le supprimer maintenant compte comme un Hit & Run.`
          );
      }
      await qbitFetch('/api/v2/torrents/delete', form({ hashes: h, deleteFiles: b.action === 'deleteFiles' ? 'true' : 'false' }));
      // Torrents suivis par Lumio : plus en partage (la bibliothèque garde ses fichiers : liens durs)
      for (const g of auto.grabs) if (g.hash && hashes.map((x) => x.toLowerCase()).includes(g.hash)) {
        if (['sent', 'downloading'].includes(g.state)) {
          g.state = 'failed';
          g.error = `supprimé de qBittorrent par ${user.name}`;
        }
        g.seeding = false;
        g.seedEnd = g.seedEnd || 'retiré à la main';
      }
      autoSave();
    } else throw new HttpError(400, 'Action inconnue');
    autoLog(`qBittorrent : ${b.action} (${hashes.length || 'vitesse'}) par ${user.name}`);
    send(res, 200, { ok: true });
    return true;
  }
  // « À compléter » : saisons / épisodes manquants des séries de la bibliothèque (lancés à la main)
  if (req.method === 'GET' && p === '/api/auto/missing') {
    if (q.get('refresh') === '1' || Date.now() - missingScan.at > 12 * 3600e3) {
      const run = autoMissingScan().catch(() => null);
      if (!missingScan.at) await Promise.race([run, new Promise((ok) => setTimeout(ok, 20000))]);
    }
    const hidden = new Set(auto.missingHidden);
    send(res, 200, { at: missingScan.at ? new Date(missingScan.at).toISOString() : null, busy: missingScan.busy, series: missingScan.series.filter((x) => !hidden.has(x.tmdbId)), hidden: hidden.size });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/missing/get') {
    const b = await readBody(req);
    const tmdbId = Number(b.tmdbId);
    // Soit des saisons entières, soit des épisodes précis ({ season, episodes: [4, 5] })
    const eps = Array.isArray(b.episodes) ? b.episodes.map(Number).filter((n) => n > 0) : [];
    const seasons = eps.length ? [] : (Array.isArray(b.seasons) ? b.seasons : [b.season]).map(Number).filter((n) => n > 0);
    const sr = missingScan.series.find((x) => x.tmdbId === tmdbId);
    if (!tmdbId || (!seasons.length && !(eps.length && Number(b.season) > 0))) throw new HttpError(400, 'Série, saison ou épisode manquant');
    const idx = await loadJfIndex().catch(() => null);
    const jf = idx && idx.seriesJf.get(tmdbId);
    const item = await autoAdd({ type: 'tv', tmdbId, title: (sr && sr.title) || b.title, seasons, folderPath: jf && jf.path ? path.dirname(jf.path) : null, future: false });
    // Saison demandée à la main : tous ses épisodes manquants, même anciens
    item.fullSeasons = [...new Set([...(item.fullSeasons || []), ...seasons])];
    const sn = Number(b.season);
    if (eps.length) item.extraEps = [...new Set([...(item.extraEps || []), ...eps.map((e) => `${sn}:${e}`)])];
    item.nextSearch = 0;
    autoUnhide(tmdbId);
    autoSave();
    if (sr)
      for (const x of sr.seasons) {
        if (seasons.includes(x.season)) x.asked = true;
        if (eps.length && x.season === sn) x.askedEps = [...new Set([...(x.askedEps || []), ...eps])];
      }
    const what = eps.length ? `S${autoPad(sn)} ${eps.map((e) => `E${autoPad(e)}`).join(', ')}` : `saison ${seasons.join(', ')}`;
    autoEvent(item, 'added', `${what} à compléter, lancé à la main par ${user.name}`);
    setTimeout(() => autoSearchTick().catch(() => {}), 2000);
    send(res, 200, { ok: true, message: `${item.title} : ${what} lancé${autoActive() ? '' : ' (Lumio Auto est en pause : ça partira quand tu le rallumeras)'}` });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/missing/hide') {
    const b = await readBody(req);
    const tmdbId = Number(b.tmdbId);
    if (b.show) autoUnhide(tmdbId);
    else if (tmdbId && !auto.missingHidden.includes(tmdbId)) auto.missingHidden.push(tmdbId);
    if (b.reset) auto.missingHidden = [];
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/follow-library') {
    const r = await autoFollowLibrary();
    send(res, 200, { ...r, message: r.error || (r.added.length ? `${r.added.length} série(s) en cours suivie(s) : ${r.added.join(', ')}` : 'Toutes les séries en cours sont déjà suivies.') });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/adopt') {
    if (!autoOn()) throw new HttpError(400, 'Active d’abord Lumio Auto');
    let ok = 0;
    const errors = [];
    for (const r of autoAdoptable()) {
      try {
        await autoFromRequest(r);
        ok++;
      } catch (e) {
        errors.push(`${r.title} : ${e.message}`);
      }
    }
    saveRequests();
    autoLog(`${ok} demande(s) reprise(s) de Radarr / Sonarr par ${user.name}`);
    send(res, 200, { ok, errors, message: `${ok} demande(s) reprise(s) : Lumio Auto les cherche peu à peu (C411 limite le nombre de recherches).${errors.length ? ` ${errors.length} erreur(s).` : ''}` });
    return true;
  }
  if (req.method === 'GET' && p === '/api/auto/blocklist') {
    send(res, 200, { blocked: auto.blocked.slice(0, 200).map((b) => (typeof b === 'string' ? { key: b, title: null } : b)) });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/blocklist/remove') {
    const b = await readBody(req);
    auto.blocked = auto.blocked.filter((x) => blockKey(x) !== b.key);
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'POST' && p === '/api/auto/unblock') {
    auto.blocked = [];
    autoSave();
    send(res, 200, { ok: true });
    return true;
  }
  throw new HttpError(404, 'Route Lumio Auto inconnue');
}
const autoLastResults = new Map();

// ——— Profils de la famille (façon « Qui regarde ? ») ———
// Un profil = un compte Jellyfin à part (reprise, vus, « À voir » séparés), créé par l'admin depuis l'appli.
// Le mot de passe de chaque profil est inventé et gardé ici : l'appli ne le voit jamais, elle reçoit juste une session.
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const profileStore = readJson(PROFILES_FILE, {});
if (!profileStore.owners || typeof profileStore.owners !== 'object') profileStore.owners = {};
const saveProfiles = () => writeJson(PROFILES_FILE, profileStore);
const pinHash = (pin, salt) => crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
const ownerProfiles = (ownerId) => (profileStore.owners[ownerId] = profileStore.owners[ownerId] || []);
const publicProfile = (p) => ({ id: p.id, jfUserId: p.jfUserId, name: p.name, avatar: p.avatar || '🙂', color: p.color || '#3D8BFF', kind: p.kind === 'kid' ? 'kid' : 'adult', hasPin: Boolean(p.pin), maxAge: p.maxAge || null, libraries: p.libraries || null, linked: Boolean(p.linked) });
const jfDevice = (deviceId) => String(deviceId || 'lumio-profile').replace(/[^\w.-]/g, '').slice(0, 80) || 'lumio-profile';

async function jfAuthAs(name, password, deviceId) {
  const r = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `MediaBrowser Client="Lumio", Device="Lumio", DeviceId="${jfDevice(deviceId)}", Version="${VERSION}"`,
    },
    body: JSON.stringify({ Username: name, Pw: password || '' }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) throw new HttpError(401, 'Identifiant ou mot de passe refusé par Jellyfin');
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé la connexion (HTTP ${r.status})`);
  return r.json();
}

/** Règles Jellyfin d'un profil : pas admin ; un profil enfant ne voit que ses bibliothèques et un âge maximum. */
async function applyProfilePolicy(token, p) {
  const user = await jfJson(token, `/Users/${p.jfUserId}`);
  const pol = { ...(user.Policy || {}) };
  pol.IsAdministrator = false;
  pol.EnableContentDeletion = false;
  pol.EnableRemoteControlOfOtherUsers = false;
  pol.EnableSharedDeviceControl = false;
  if (p.kind === 'kid') {
    const libs = Array.isArray(p.libraries) ? p.libraries : [];
    pol.EnableAllFolders = !libs.length;
    pol.EnabledFolders = libs;
    pol.MaxParentalRating = p.maxAge ? Number(p.maxAge) : null;
    pol.BlockUnratedItems = p.maxAge ? ['Movie', 'Series'] : [];
  } else {
    pol.EnableAllFolders = true;
    pol.EnabledFolders = [];
    pol.MaxParentalRating = null;
    pol.BlockUnratedItems = [];
  }
  const r = await fetch(`${JELLYFIN_URL}/Users/${p.jfUserId}/Policy`, { method: 'POST', headers: { ...jfHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(pol) });
  if (!r.ok) throw new HttpError(502, `Jellyfin a refusé les réglages du profil (HTTP ${r.status})`);
}

function profileFields(p, b) {
  if (typeof b.name === 'string' && b.name.trim()) p.name = b.name.trim().slice(0, 24);
  if (typeof b.avatar === 'string' && b.avatar) p.avatar = b.avatar.slice(0, 8);
  if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) p.color = b.color;
  if (b.kind === 'kid' || b.kind === 'adult') p.kind = b.kind;
  if (b.maxAge === null || Number(b.maxAge) > 0) p.maxAge = b.maxAge === null ? null : Number(b.maxAge);
  if (Array.isArray(b.libraries)) p.libraries = b.libraries.map(String).filter((x) => /^[0-9a-f-]{32,36}$/i.test(x));
  if (b.pin === null || b.pin === '') delete p.pin;
  else if (typeof b.pin === 'string' && /^\d{4}$/.test(b.pin)) {
    p.pinSalt = crypto.randomBytes(8).toString('hex');
    p.pin = pinHash(b.pin, p.pinSalt);
  }
}

async function profileRoutes(req, res, p, q, user) {
  if (!p.startsWith('/api/profiles')) return false;
  // Les profils appartiennent au compte admin qui les a créés
  if (req.method === 'GET' && p === '/api/profiles') {
    if (!user.admin) return send(res, 200, { owner: false, profiles: [] }), true;
    send(res, 200, { owner: true, profiles: ownerProfiles(user.id).map(publicProfile) });
    return true;
  }
  requireAdmin(user);
  const list = ownerProfiles(user.id);
  if (req.method === 'GET' && p === '/api/profiles/libraries') {
    const r = await fetch(`${JELLYFIN_URL}/Library/VirtualFolders`, { headers: jfHeaders(user.token) });
    if (!r.ok) throw new HttpError(502, `Jellyfin a refusé (HTTP ${r.status})`);
    send(res, 200, { libraries: (await r.json()).filter((l) => l.ItemId).map((l) => ({ id: l.ItemId, name: l.Name, type: l.CollectionType || null })) });
    return true;
  }
  // Nouveau profil : nouveau compte Jellyfin
  if (req.method === 'POST' && p === '/api/profiles') {
    const b = await readBody(req);
    const prof = { id: crypto.randomBytes(5).toString('hex'), kind: 'adult', createdAt: new Date().toISOString() };
    profileFields(prof, b);
    if (!prof.name) throw new HttpError(400, 'Choisis un prénom pour le profil');
    if (b.linkUser) {
      // Compte Jellyfin qui existe déjà (ex. celui de ta femme) : son mot de passe est vérifié puis gardé ici
      const a = await jfAuthAs(String(b.linkUser), String(b.linkPassword || ''), `lumio-check-${prof.id}`);
      prof.jfUserId = a.User.Id;
      prof.jfName = a.User.Name;
      prof.pass = String(b.linkPassword || '');
      prof.linked = true;
      if (list.some((x) => x.jfUserId === prof.jfUserId)) throw new HttpError(409, 'Ce compte est déjà un profil');
      fetch(`${JELLYFIN_URL}/Sessions/Logout`, { method: 'POST', headers: jfHeaders(a.AccessToken) }).catch(() => {});
    } else {
      const pass = crypto.randomBytes(18).toString('base64url');
      // Nom Jellyfin unique (deux « Léo » possibles côté Lumio)
      let jfName = prof.name;
      const existing = await jfJson(user.token, '/Users').catch(() => []);
      const taken = new Set((existing || []).map((u) => String(u.Name).toLowerCase()));
      for (let i = 2; taken.has(jfName.toLowerCase()); i++) jfName = `${prof.name} ${i}`;
      const r = await fetch(`${JELLYFIN_URL}/Users/New`, { method: 'POST', headers: { ...jfHeaders(user.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: jfName, Password: pass }) });
      if (!r.ok) throw new HttpError(502, `Jellyfin n’a pas pu créer le compte (HTTP ${r.status})`);
      const nu = await r.json();
      prof.jfUserId = nu.Id;
      prof.jfName = nu.Name;
      prof.pass = pass;
    }
    if (!prof.linked) await applyProfilePolicy(user.token, prof);
    list.push(prof);
    saveProfiles();
    console.log(`Profil « ${prof.name} » ${prof.linked ? 'relié' : 'créé'} par ${user.name}`);
    send(res, 201, { profile: publicProfile(prof) });
    return true;
  }
  const m = p.match(/^\/api\/profiles\/([a-f0-9]+)(\/switch)?$/);
  if (!m) throw new HttpError(404, 'Profil introuvable');
  const prof = list.find((x) => x.id === m[1]);
  if (!prof) throw new HttpError(404, 'Profil introuvable');
  // Passer sur ce profil : le serveur ouvre une session Jellyfin à son nom et la donne à l'appli
  if (req.method === 'POST' && m[2]) {
    const b = await readBody(req);
    if (prof.pin && pinHash(String(b.pin || ''), prof.pinSalt) !== prof.pin) throw new HttpError(403, 'Code incorrect');
    const a = await jfAuthAs(prof.jfName, prof.pass, b.deviceId);
    send(res, 200, {
      session: { token: a.AccessToken, userId: a.User.Id, userName: a.User.Name, isAdmin: Boolean(a.User.Policy && a.User.Policy.IsAdministrator), deviceId: jfDevice(b.deviceId) },
      profile: publicProfile(prof),
    });
    return true;
  }
  if (req.method === 'PATCH') {
    const b = await readBody(req);
    profileFields(prof, b);
    if (!prof.linked || b.kind || b.libraries || b.maxAge !== undefined) await applyProfilePolicy(user.token, prof);
    saveProfiles();
    send(res, 200, { profile: publicProfile(prof) });
    return true;
  }
  if (req.method === 'DELETE') {
    // Supprimer le profil ; le compte Jellyfin (et son historique) n'est effacé que si on le demande
    if (q.get('deleteAccount') === '1' && !prof.linked) {
      await fetch(`${JELLYFIN_URL}/Users/${prof.jfUserId}`, { method: 'DELETE', headers: jfHeaders(user.token) }).catch(() => {});
    }
    profileStore.owners[user.id] = list.filter((x) => x !== prof);
    saveProfiles();
    send(res, 200, { ok: true });
    return true;
  }
  throw new HttpError(405, 'Action inconnue');
}

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
  if (!autoOn() && !arrConfig(kindOf(type))) throw new HttpError(503, `${label(kindOf(type))} n'est pas configuré sur le serveur Lumio`);
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
    if (quota.movie.remaining === 0) throw new HttpError(429, `Quota atteint : ${quota.movie.limit} film(s) tous les ${quota.movie.days} jours, pour protéger le ratio. Réessaie plus tard ou demande à l’admin.`);
  } else {
    if (!Number(b.tvdbId) && !autoOn()) throw new HttpError(400, 'Pas d’identifiant TVDB : Sonarr ne peut pas ajouter cette série.');
    const wanted = (Array.isArray(b.seasons) ? b.seasons : []).map(Number).filter((n) => n > 0);
    if (!wanted.length) throw new HttpError(400, 'Choisis au moins une saison.');
    const st = mediaStatus(lib, 'tv', tmdbId, b.tvdbId, wanted);
    // Saisons déjà disponibles ou déjà demandées : ignorées, comme dans Seerr
    seasons = st.seasons.filter((s) => s.status === MediaStatus.UNKNOWN).map((s) => s.seasonNumber);
    if (!seasons.length) throw new HttpError(409, 'Ces saisons sont déjà disponibles ou demandées.');
    // Quota en séries : une demande = une série, quel que soit le nombre de saisons (sauf une série déjà demandée par lui)
    if (tvBySeries() && quota.tv.remaining === 0 && !requests.some((r) => r.type === 'tv' && r.tmdbId === tmdbId && r.requestedBy.id === user.id))
      throw new HttpError(429, `Quota atteint : ${quota.tv.limit} série(s) tous les ${quota.tv.days} jours, pour protéger le ratio. Réessaie plus tard ou demande à l’admin.`);
    if (!tvBySeries() && quota.tv.remaining != null && seasons.length > quota.tv.remaining)
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
      await sendOrSecour(r);
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
    await sendOrSecour(r);
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
      features: ['chat', 'requests', 'status', 'ideas', 'ratings', 'files', 'watchlist', 'books', ...(tmdbKey() ? ['tmdb'] : []), ...(arrOff() ? ['auto'] : [])],
      // Lumio Auto actif : il fait le travail de Radarr / Sonarr (l'appli ne demande plus leur config)
      radarr: arrOff() || Boolean(arrConfig('radarr')),
      sonarr: arrOff() || Boolean(arrConfig('sonarr')),
    });

  // État public pour le widget iOS : en ligne / hors ligne et compteurs seulement (aucun titre, aucune clé)
  // Public : en plus des services, des compteurs du partage et le nombre de lectures (jamais de titre ni de nom)
  if (url.pathname === '/status/public') {
    const x = await widgetExtrasCached();
    const seed = x.seed ? { count: x.seed.count, active: x.seed.active, up: x.seed.up, total: x.seed.total, today: x.seed.today } : undefined;
    return send(res, 200, { ...(await publicStatusBody()), seed, watchingCount: x.watching ? x.watching.length : undefined });
  }

  // Widget de l'admin : l'état public + le partage (seed) et qui regarde quoi. Protégé par la clé du widget.
  if (url.pathname === '/status/widget') {
    const k = String(url.searchParams.get('k') || '');
    const okKey = config.widgetKey && k.length === config.widgetKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(config.widgetKey));
    if (!okKey) return send(res, 401, { error: 'clé du widget invalide' });
    const x = await widgetExtrasCached();
    return send(res, 200, { ...(await publicStatusBody()), ...x, watchingCount: x.watching ? x.watching.length : undefined });
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

  // Book : lecture des livres par lien signé (sans jeton Jellyfin)
  if (url.pathname.startsWith('/api/books/f/') && (await bookFileRoutes(req, res, url.pathname, url.searchParams))) return;

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
    // Book (livres, BD, mangas, audio)
    if (await bookRoutes(req, res, p, q, user)) return;
    if (await profileRoutes(req, res, p, q, user)) return;
    if (await autoRoutes(req, res, p, q, user)) return;

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
        if (user.admin && (mode === 'keep' || mode === 'files') && r.via === 'auto') arrMsg = await autoForgetRequest(r, mode === 'files');
        else if (user.admin && (mode === 'keep' || mode === 'files')) arrMsg = await removeFromArr(r, mode === 'files');
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

    // ——— Déplacer un film / une série vers un autre dossier (admin) : Radarr / Sonarr déplacent les fichiers ———
    if (p === '/api/arr/move') {
      requireAdmin(user);
      const type = q.get('type') === 'tv' ? 'tv' : 'movie';
      const kind = kindOf(type);
      const tmdbId = Number(q.get('tmdbId'));
      if (!tmdbId) throw new HttpError(400, 'Identifiant TMDB manquant');
      const list = await arr(kind, type === 'movie' ? `/movie?tmdbId=${tmdbId}` : '/series');
      const found = (Array.isArray(list) ? list : []).find((x) => Number(x.tmdbId) === tmdbId);
      if (!found) throw new HttpError(404, `${label(kind)} ne connaît pas ce titre`);
      const current = String(found.rootFolderPath || (found.path ? found.path.replace(/\/[^/]+\/?$/, '') : '')).replace(/\/+$/, '');
      if (req.method === 'GET') {
        const f = await folders(kind);
        return send(res, 200, { current, path: found.path || null, folders: f.folders });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const target = String(b.rootFolderPath || '').trim();
        const f = await folders(kind);
        if (!f.folders.some((x) => x.path.replace(/\/+$/, '') === target.replace(/\/+$/, ''))) throw new HttpError(400, 'Dossier inconnu');
        if (target.replace(/\/+$/, '') === current) return send(res, 200, { moved: false, message: 'Déjà dans ce dossier' });
        await arr(kind, type === 'movie' ? '/movie/editor' : '/series/editor', {
          method: 'PUT',
          body: JSON.stringify({ [type === 'movie' ? 'movieIds' : 'seriesIds']: [found.id], rootFolderPath: target, moveFiles: true }),
        });
        console.log(`${user.name} déplace « ${found.title} » vers ${target}`);
        return send(res, 200, { moved: true, message: `${label(kind)} déplace les fichiers vers ${target}` });
      }
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
    const delDisk = p.match(/^\/api\/admin\/storage\/disk\/([\w-]+)$/);
    if (req.method === 'DELETE' && delDisk) {
      requireAdmin(user);
      const it = diskTitles().find((x) => x.id === delDisk[1]);
      if (!it) throw new HttpError(404, 'Introuvable (liste trop ancienne, recharge)');
      const full = Buffer.from(it.id, 'base64url').toString();
      const roots = [...autoFolderChoices('radarr'), ...autoFolderChoices('sonarr')].map((f) => path.resolve(f.path));
      if (!roots.some((r0) => path.resolve(full).startsWith(r0 + path.sep)) || roots.includes(path.resolve(full))) throw new HttpError(400, 'Dossier refusé');
      await fs.promises.rm(full, { recursive: true, force: true });
      if (it.tmdbId) {
        const key = autoItemKey(it.type, it.tmdbId);
        delete auto.have[key];
        delete auto.haveCodec[key];
        auto.items = auto.items.filter((x) => !(x.type === it.type && x.tmdbId === it.tmdbId));
        autoSave();
        for (const r of requests)
          if (r.type === it.type && r.tmdbId === it.tmdbId && (r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED)) {
            r.status = RequestStatus.COMPLETED;
            r.deletedAt = new Date().toISOString();
          }
        saveRequests();
      }
      diskTitlesCache = null;
      fetch(`${JELLYFIN_URL}/Library/Refresh`, { method: 'POST', headers: jfHeaders(user.token) }).catch(() => {});
      library = null;
      diskCache = null;
      console.log(`Stockage : « ${it.title} » supprimé par ${user.name} (${(it.size / 1e9).toFixed(1)} Go)`);
      return send(res, 200, { ok: true, message: `« ${it.title} » supprimé.` });
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

    // ——— En attente dans Radarr / Sonarr (onglet Demandes) ———
    if (req.method === 'GET' && p === '/api/arr/wanted') {
      if (autoOn()) return send(res, 200, { items: [] });
      return send(res, 200, { items: await arrWanted() });
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

    // ——— Récompenses de la famille ———
    if (req.method === 'GET' && p === '/api/rewards') {
      const token = user.admin ? user.token : jfAdminToken || process.env.JELLYFIN_API_KEY;
      if (!token) throw new HttpError(503, 'Un admin doit d’abord ouvrir Lumio une fois');
      const b = await rewardsBoard(token);
      return send(res, 200, { ...b, me: user.id });
    }

    // ——— Widget iOS de l'admin : clé à part (lecture seule, propre au widget), gardée dans l'App Group du téléphone ———
    if (req.method === 'GET' && p === '/api/widget/key') {
      if (!user.admin) throw new HttpError(403, 'Réservé à l’admin');
      if (!config.widgetKey) {
        config.widgetKey = crypto.randomBytes(24).toString('hex');
        writeJson(CONFIG_FILE, config);
      }
      return send(res, 200, { key: config.widgetKey });
    }

    // ——— Plateformes (Netflix, Disney+…) : logos, puis titres de la bibliothèque et dernières sorties ———
    if (req.method === 'GET' && p === '/api/platforms') {
      const list = await Promise.all(
        PLATFORMS.map(async (pf) => {
          const i = await platformInfo(pf).catch(() => ({}));
          return { id: pf.id, name: pf.name, logo: i.logo || null, icon: i.icon || null, color: pf.color };
        })
      );
      return send(res, 200, { platforms: list });
    }
    const pfMatch = p.match(/^\/api\/platforms\/([a-z]+)$/);
    if (req.method === 'GET' && pfMatch) {
      const pf = PLATFORMS.find((x) => x.id === pfMatch[1]);
      if (!pf) throw new HttpError(404, 'Plateforme inconnue');
      if (!tmdbKey()) throw new HttpError(503, 'Clé TMDB manquante sur le serveur');
      return send(res, 200, await platformPage(pf, user.token, q.get('sort') === 'asc' ? 'asc' : 'desc'));
    }

    // ——— À voir (liste personnelle) ———
    if (p === '/api/watchlist') {
      const list = watchlists[user.id] || [];
      if (req.method === 'GET') {
        const lib = await loadLibrary().catch(() => null);
        return send(res, 200, {
          items: await Promise.all(
            list.map(async (x) => ({
              ...x,
              status: lib ? mediaStatus(lib, x.type, x.tmdbId, null, null).status : MediaStatus.UNKNOWN,
              digital: tmdbKey() ? await digitalDate(x.type, x.tmdbId).catch(() => null) : null,
            }))
          ),
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
    // Dossiers de chaque bibliothèque Jellyfin : l'appli trie les titres par bibliothèque d'après leur chemin
    // (Jellyfin renvoie parfois des titres d'autres bibliothèques). Rien de secret : seulement les noms et les chemins.
    if (req.method === 'GET' && p === '/api/jf/libraries') {
      const token = user.admin ? user.token : jfAdminToken || process.env.JELLYFIN_API_KEY;
      if (!token) return send(res, 200, { libraries: [] });
      const r = await fetch(`${JELLYFIN_URL}/Library/VirtualFolders`, { headers: jfHeaders(token) });
      if (!r.ok) return send(res, 200, { libraries: [] });
      const libraries = (await r.json())
        .filter((l) => l.ItemId)
        .map((l) => ({ id: l.ItemId, name: l.Name, type: l.CollectionType ?? null, locations: l.Locations ?? [] }));
      return send(res, 200, { libraries });
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
    // Mise à jour des conteneurs Docker de la maison (docker compose pull + up -d), faite par la machine
    if (req.method === 'POST' && p === '/api/admin/server/containers') {
      requireAdmin(user);
      const dir = path.join(DATA_DIR, 'host-actions');
      if (!fs.existsSync(path.join(dir, '.helper-containers')))
        throw new HttpError(409, 'Le service de la machine doit d’abord être réinstallé une fois (install-host-actions.sh) pour mettre à jour les conteneurs.');
      fs.writeFileSync(path.join(dir, 'update-containers'), JSON.stringify({ by: user.name, at: new Date().toISOString() }));
      console.log(`Mise à jour des conteneurs demandée par ${user.name}`);
      return send(res, 200, { ok: true, message: 'Mise à jour des conteneurs lancée : les services mis à jour redémarrent un par un (quelques minutes).' });
    }
    if (req.method === 'GET' && p === '/api/admin/host/status') {
      requireAdmin(user);
      const dir = path.join(DATA_DIR, 'host-actions');
      const pending = fs.existsSync(path.join(dir, 'reboot'));
      // Résultat de la dernière mise à jour des conteneurs (écrit par la machine)
      let containers = null;
      try {
        const log = fs.readFileSync(path.join(dir, 'containers-last.log'), 'utf8');
        const st = fs.statSync(path.join(dir, 'containers-last.log'));
        const code = (log.match(/LUMIO_EXIT=(\d+)/) || [])[1];
        const updated = [...log.matchAll(/Container (\S+)\s+(?:Recreated|Started)/g)].map((m) => m[1]);
        containers = {
          at: st.mtime.toISOString(),
          running: code === undefined,
          ok: code === '0',
          updated: [...new Set(updated)],
          tail: log.trim().split('\n').slice(-6).join('\n').slice(-600),
        };
      } catch {
        containers = null;
      }
      // Avancement en direct (pourcentage et étape), écrit par la machine pendant la mise à jour
      let containersProgress = null;
      try {
        const raw = fs.readFileSync(path.join(dir, 'containers-progress'), 'utf8').trim();
        const m = raw.match(/^(\d+)\s*(.*)$/);
        if (m) containersProgress = { pct: Math.min(100, Number(m[1])), step: m[2] || '' };
      } catch {
        containersProgress = null;
      }
      if (containers && containersProgress && containersProgress.pct < 100) containers.running = true;
      return send(res, 200, {
        containersProgress,
        rebootPending: pending,
        updatePending: fs.existsSync(path.join(dir, 'update')),
        containersPending: fs.existsSync(path.join(dir, 'update-containers')),
        helperInstalled: fs.existsSync(path.join(dir, '.helper')),
        containersHelper: fs.existsSync(path.join(dir, '.helper-containers')),
        containers,
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
        const out = { configured: Boolean(secourUrl() && secourKey()), url: secourUrl() || null, fromEnv: Boolean(process.env.LUMIO_SECOUR_URL) || secourEmbedded(),
          embedded: secourEmbedded() || Boolean(secourInstall), install: secourInstall || undefined, alldebrid: Boolean(secourDebridKey()), service: secourService(), disks: disks().length,
          auto: secourAutoView() };
        if (secourInstall) Object.assign(out, { online: false, error: secourInstall.message });
        else if (out.configured) {
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
      // Groupe de secours : activé ou non, dossiers de destination
      if (req.method === 'GET' && p === '/api/secour/auto') return send(res, 200, secourAutoView());
      if (req.method === 'PUT' && p === '/api/secour/auto') {
        const b = await readBody(req);
        if (typeof b.enabled === 'boolean') config.secourAuto = b.enabled;
        if (typeof b.force === 'boolean') config.secourForce = b.force;
        for (const k of ['movie', 'tv']) {
          const t = b[k];
          if (t && typeof t === 'object') {
            safePath(t.root, t.folder || '');
            config.secourTargets = { ...(config.secourTargets || {}), [k]: { root: String(t.root), folder: String(t.folder || '').replace(/^\/+|\/+$/g, '') } };
          }
        }
        saveConfig();
        return send(res, 200, secourAutoView());
      }
      // Admin : bouton « DL » d'une fiche → téléchargement direct par Lumio Secour (crée ou reprend la demande)
      if (req.method === 'POST' && p === '/api/secour/grab') {
        const b = await readBody(req);
        const type = b.type === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(b.tmdbId);
        if (!tmdbId) throw new HttpError(400, 'Identifiant TMDB manquant');
        let seasons;
        if (type === 'tv') {
          seasons = (Array.isArray(b.seasons) ? b.seasons : []).map(Number).filter((n) => n > 0);
          if (!seasons.length) {
            const t = await tmdbGet(`/tv/${tmdbId}`).catch(() => null);
            seasons = ((t && t.seasons) || []).map((x) => x.season_number).filter((n) => n > 0);
          }
          if (!seasons.length) throw new HttpError(400, 'Aucune saison à télécharger');
        }
        const open = (x) => x.type === type && x.tmdbId === tmdbId && [RequestStatus.PENDING, RequestStatus.APPROVED, RequestStatus.FAILED].includes(x.status);
        let r = requests.find((x) => open(x) && (type === 'movie' || JSON.stringify([...(x.seasons || [])].sort()) === JSON.stringify([...seasons].sort())));
        if (r && r.via === 'secour' && r.secour && ['queued', 'running'].includes(r.secour.state)) return send(res, 200, { request: r, already: true });
        const isNew = !r;
        if (!r) {
          r = {
            id: `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
            type,
            tmdbId,
            tvdbId: type === 'tv' && Number(b.tvdbId) ? Number(b.tvdbId) : undefined,
            title: String(b.title || '').slice(0, 200),
            year: b.year ? String(b.year).slice(0, 4) : undefined,
            poster: typeof b.poster === 'string' && /^https:\/\//.test(b.poster) ? b.poster : undefined,
            backdrop: typeof b.backdrop === 'string' && /^https:\/\//.test(b.backdrop) ? b.backdrop : undefined,
            seasons,
            status: RequestStatus.APPROVED,
            requestedBy: { id: user.id, name: user.name },
            createdAt: new Date().toISOString(),
          };
          requests.unshift(r);
        }
        r.modifiedBy = { id: user.id, name: user.name };
        r.modifiedAt = new Date().toISOString();
        try {
          startSecour(r, `téléchargement direct par ${user.name}${b.source ? ` · ${String(b.source).slice(0, 60)}` : ''}`, { source: b.source });
        } catch (e) {
          if (isNew) requests.splice(requests.indexOf(r), 1); // pas de demande fantôme si Lumio Secour n'est pas prêt
          throw e;
        }
        library = null;
        return send(res, 201, { request: r });
      }
      // Admin : passer une demande par le groupe de secours à la main
      const viaSec = p.match(/^\/api\/secour\/requests\/([\w-]+)$/);
      if (req.method === 'POST' && viaSec) {
        const r = requests.find((x) => x.id === viaSec[1]);
        if (!r) throw new HttpError(404, 'Demande introuvable');
        if (r.status === RequestStatus.DECLINED || r.status === RequestStatus.COMPLETED) throw new HttpError(409, 'Cette demande est close.');
        startSecour(r, `lancé à la main par ${user.name}`);
        return send(res, 200, { request: r });
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
        if (!secourDebridKey()) throw new HttpError(400, `Clé ${secourServiceName()} non configurée (Lumio Secour)`);
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
      if (typeof b.lockedProfileSonarr === 'string') config.lockedProfileSonarr = b.lockedProfileSonarr.trim();
      if (b.newNtfyTopic) config.ntfyTopic = `lumio-${crypto.randomBytes(8).toString('hex')}`;
      if (b.tvQuotaUnit === 'series' || b.tvQuotaUnit === 'seasons') config.tvQuotaUnit = b.tvQuotaUnit;
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

// Lumio Secour intégré (installé tout seul si l'image n'a pas Python), puis reprise des demandes interrompues
if (secourEmbedded()) startEmbeddedSecour();
installSecourEngine();
for (const r of requests)
  if (r.via === 'secour' && r.status === RequestStatus.APPROVED && r.secour && ['queued', 'running'].includes(r.secour.state)) secourQueue.push(r.id);
if (secourQueue.length) setTimeout(runSecourQueue, 20_000);

