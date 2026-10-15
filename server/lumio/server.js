// Serveur Lumio : chat familial + téléchargements Radarr/Sonarr pour tous + état des services.
// Sans dépendance. Authentification : le jeton Jellyfin de l'appli, vérifié auprès de ton serveur Jellyfin.
// Les clés Radarr/Sonarr restent ici, jamais sur les téléphones.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3456);
const JELLYFIN_URL = (process.env.JELLYFIN_URL || 'http://jellyfin:8096').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_MESSAGES = 3000;
const MAX_TEXT = 2000;
const VERSION = '2.1.0';

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

let messages = readJson(FILE, []);
let history = readJson(HISTORY_FILE, []);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ——— Config Radarr / Sonarr : envoyée depuis l'appli par un admin, ou par variables d'environnement ———
let config = readJson(CONFIG_FILE, {});
function arrConfig(kind) {
  const c = { ...(config[kind] || {}) };
  const env = kind.toUpperCase();
  if (process.env[`${env}_URL`]) c.url = process.env[`${env}_URL`];
  if (process.env[`${env}_API_KEY`]) c.apiKey = process.env[`${env}_API_KEY`];
  if (c.url) c.url = String(c.url).trim().replace(/\/+$/, '');
  return c.url && c.apiKey ? c : null;
}
const label = (kind) => (kind === 'radarr' ? 'Radarr' : 'Sonarr');

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(FILE, messages), 300);
}

// ——— Vérification du jeton Jellyfin (mise en cache 10 min) ———
const users = new Map();

async function whoAmI(token) {
  if (!token) return null;
  const hit = users.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const res = await fetch(`${JELLYFIN_URL}/Users/Me`, {
      headers: { Authorization: `MediaBrowser Client="LumioServer", Device="server", DeviceId="lumio-server", Version="${VERSION}", Token="${token}"` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    const user = { id: me.Id, name: me.Name, admin: Boolean(me.Policy && me.Policy.IsAdministrator) };
    users.set(token, { user, until: Date.now() + 10 * 60 * 1000 });
    return user;
  } catch {
    return null;
  }
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

async function qualityProfile(kind) {
  const c = arrConfig(kind);
  if (c.qualityProfileId) return c.qualityProfileId;
  const list = await arr(kind, '/qualityprofile');
  if (!list.length) throw new HttpError(500, 'Aucun profil de qualité');
  return list[0].id;
}

async function checkFolder(kind, wanted) {
  const { folders: list, default: def } = await folders(kind);
  if (!wanted) return def;
  const clean = String(wanted).replace(/\/+$/, '');
  const hit = list.find((f) => f.path.replace(/\/+$/, '') === clean);
  if (!hit) throw new HttpError(400, `Dossier inconnu : ${wanted}`);
  return hit.path;
}

async function grabMovie(b) {
  const tmdbId = Number(b.tmdbId);
  if (!tmdbId) throw new HttpError(400, 'tmdbId manquant');
  const existing = (await arr('radarr', `/movie?tmdbId=${tmdbId}`))[0];
  if (existing) {
    if (existing.hasFile) return { added: false, message: 'Ce film est déjà disponible.', title: existing.title };
    if (!existing.monitored) {
      await arr('radarr', `/movie/${existing.id}`, { method: 'PUT', body: JSON.stringify({ ...existing, monitored: true }) });
    }
    await arr('radarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'MoviesSearch', movieIds: [existing.id] }) });
    return { added: false, message: 'Déjà dans Radarr : recherche relancée.', title: existing.title };
  }
  if (b.askFolder && !b.rootFolderPath) return { needFolder: true, ...(await folders('radarr')) };
  const c = arrConfig('radarr');
  const found = await arr('radarr', `/movie/lookup/tmdb?tmdbId=${tmdbId}`);
  const rootFolderPath = await checkFolder('radarr', b.rootFolderPath);
  const movie = await arr('radarr', '/movie', {
    method: 'POST',
    body: JSON.stringify({
      ...found,
      id: undefined,
      qualityProfileId: await qualityProfile('radarr'),
      rootFolderPath,
      monitored: true,
      minimumAvailability: c.minimumAvailability || 'released',
      addOptions: { searchForMovie: c.searchOnAdd !== false, monitor: 'movieOnly' },
    }),
  });
  return { added: true, message: `Ajouté dans ${rootFolderPath} : le film se télécharge.`, title: movie.title, folder: rootFolderPath };
}

async function grabSeries(b) {
  const tvdbId = Number(b.tvdbId);
  if (!tvdbId) throw new HttpError(400, 'tvdbId manquant');
  const seasons = Array.isArray(b.seasons) ? b.seasons.map(Number).filter((n) => n > 0) : [];
  const c = arrConfig('sonarr');
  const existing = (await arr('sonarr', `/series?tvdbId=${tvdbId}`))[0];
  if (existing) {
    const wanted = seasons.length ? seasons : existing.seasons.filter((s) => s.seasonNumber > 0).map((s) => s.seasonNumber);
    const missing = wanted.filter((n) => !(existing.seasons.find((s) => s.seasonNumber === n) || {}).monitored);
    if (!missing.length) return { added: false, message: 'Déjà suivie par Sonarr.', title: existing.title };
    const set = new Set(missing);
    await arr('sonarr', `/series/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...existing,
        monitored: true,
        seasons: existing.seasons.map((s) => (set.has(s.seasonNumber) ? { ...s, monitored: true } : s)),
      }),
    });
    if (c.searchOnAdd !== false) {
      for (const n of missing) {
        await arr('sonarr', '/command', { method: 'POST', body: JSON.stringify({ name: 'SeasonSearch', seriesId: existing.id, seasonNumber: n }) });
      }
    }
    return {
      added: true,
      message: missing.length === 1 ? `Saison ${missing[0]} envoyée à Sonarr.` : `${missing.length} saisons envoyées à Sonarr.`,
      title: existing.title,
    };
  }
  if (b.askFolder && !b.rootFolderPath) return { needFolder: true, ...(await folders('sonarr')) };
  const list = await arr('sonarr', `/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`);
  const found = list && list[0];
  if (!found) throw new HttpError(404, 'Série introuvable dans Sonarr');
  const rootFolderPath = await checkFolder('sonarr', b.rootFolderPath);
  const wanted = new Set(seasons.length ? seasons : found.seasons.map((s) => s.seasonNumber).filter((n) => n > 0));
  const series = await arr('sonarr', '/series', {
    method: 'POST',
    body: JSON.stringify({
      ...found,
      id: undefined,
      qualityProfileId: await qualityProfile('sonarr'),
      ...(c.languageProfileId ? { languageProfileId: c.languageProfileId } : {}),
      rootFolderPath,
      seasonFolder: c.seasonFolder !== false,
      monitored: true,
      seriesType: b.seriesType === 'anime' ? 'anime' : found.seriesType || 'standard',
      seasons: found.seasons.map((s) => ({ seasonNumber: s.seasonNumber, monitored: wanted.has(s.seasonNumber) })),
      addOptions: {
        searchForMissingEpisodes: c.searchOnAdd !== false,
        searchForCutoffUnmetEpisodes: false,
        ignoreEpisodesWithFiles: true,
        ignoreEpisodesWithoutFiles: false,
      },
    }),
  });
  return { added: true, message: `Ajoutée dans ${rootFolderPath} : la série se télécharge.`, title: series.title, folder: rootFolderPath };
}

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


// ——— Stream via AllDebrid : le torrent choisi par Radarr/Sonarr (envoyé à rdt-client) est retrouvé dans AllDebrid ———
const AD = process.env.ALLDEBRID_BASE || 'https://api.alldebrid.com';
function debridKey() {
  return process.env.ALLDEBRID_API_KEY || (config.alldebrid && config.alldebrid.apiKey) || '';
}

async function ad(path, params) {
  const key = debridKey();
  if (!key) throw new HttpError(503, 'Clé AllDebrid non configurée sur le serveur Lumio');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((x) => body.append(`${k}[]`, String(x)));
    else if (v !== undefined) body.append(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${AD}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!json || json.status !== 'success') {
      const err = json && json.error;
      throw new HttpError(502, `AllDebrid : ${(err && (err.message || err.code)) || `HTTP ${res.status}`}`);
    }
    return json.data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, e && e.name === 'AbortError' ? 'AllDebrid ne répond pas' : 'AllDebrid injoignable');
  } finally {
    clearTimeout(t);
  }
}

const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv)$/i;

function flattenFiles(nodes, out = []) {
  for (const n of nodes || []) {
    if (n.e) flattenFiles(n.e, out);
    else if (n.l) out.push({ name: n.n, size: n.s || 0, link: n.l });
  }
  return out;
}

function pickFile(files, season, episode) {
  const videos = files.filter((f) => VIDEO_RE.test(f.name) && !/sample|extras?\b|trailer/i.test(f.name));
  const pool = videos.length ? videos : files;
  if (season != null && episode != null) {
    const s = Number(season);
    const e = Number(episode);
    const re = new RegExp(`(s0?${s}[ ._-]?e0?${e}(?!\\d))|(\\b${s}x0?${e}(?!\\d))`, 'i');
    const hit = pool.filter((f) => re.test(f.name)).sort((a, b) => b.size - a.size)[0];
    if (hit) return hit;
    if (pool.length > 1) return null;
  }
  return [...pool].sort((a, b) => b.size - a.size)[0] || null;
}

/** Torrent en cours pour ce titre dans la file Radarr / Sonarr (hash = downloadId). */
async function queueTorrent(q) {
  if (q.type === 'tv') {
    const series = (await arr('sonarr', `/series?tvdbId=${Number(q.tvdbId)}`))[0];
    if (!series) return { state: 'absent' };
    const list = await arr('sonarr', `/queue?page=1&pageSize=200&seriesIds=${series.id}&includeEpisode=true`);
    const recs = (list.records || []).filter((r) => r.seriesId === series.id && r.downloadId);
    const ep = recs.find((r) => r.episode && r.episode.seasonNumber === Number(q.season) && r.episode.episodeNumber === Number(q.episode));
    const sea = recs.find((r) => r.episode && r.episode.seasonNumber === Number(q.season));
    const rec = ep || sea;
    return rec ? { state: 'queued', hash: rec.downloadId, title: rec.title, protocol: rec.protocol } : { state: 'searching' };
  }
  const movie = (await arr('radarr', `/movie?tmdbId=${Number(q.tmdbId)}`))[0];
  if (!movie) return { state: 'absent' };
  if (movie.hasFile) return { state: 'imported' };
  const list = await arr('radarr', `/queue?page=1&pageSize=200&movieIds=${movie.id}`);
  const rec = (list.records || []).find((r) => r.movieId === movie.id && r.downloadId);
  return rec ? { state: 'queued', hash: rec.downloadId, title: rec.title, protocol: rec.protocol } : { state: 'searching' };
}

const unlocked = new Map(); // hash:season:episode → { url, filename, until }

async function debridStream(q) {
  const cacheKey = `${q.type}:${q.tmdbId}:${q.tvdbId}:${q.season}:${q.episode}`;
  const hit = unlocked.get(cacheKey);
  if (hit && hit.until > Date.now()) return { status: 'ready', url: hit.url, filename: hit.filename };

  const t = await queueTorrent(q);
  if (t.state === 'absent') return { status: 'absent', message: 'Pas encore dans Radarr / Sonarr.' };
  if (t.state === 'imported') return { status: 'imported', message: 'Déjà téléchargé : il arrive dans Jellyfin.' };
  if (t.state === 'searching') return { status: 'searching', message: 'Recherche d’une release…' };
  if (t.protocol && t.protocol !== 'torrent') return { status: 'unsupported', message: 'Release Usenet : pas de stream possible.' };
  const hash = String(t.hash).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return { status: 'unsupported', message: 'Identifiant de torrent inconnu.' };

  // AllDebrid renvoie le magnet déjà présent (ajouté par rdt-client) ou l'ajoute
  const up = await ad('/v4/magnet/upload', { magnets: [hash] });
  const m = up.magnets && up.magnets[0];
  if (!m || m.error) throw new HttpError(502, `AllDebrid : ${(m && m.error && m.error.message) || 'magnet refusé'}`);
  if (!m.ready) {
    const st = await ad('/v4.1/magnet/status', { id: m.id }).catch(() => null);
    const mag = st && (Array.isArray(st.magnets) ? st.magnets[0] : st.magnets);
    const pct = mag && mag.size ? Math.round((mag.downloaded / mag.size) * 100) : null;
    if (mag && mag.statusCode > 4) return { status: 'error', message: `AllDebrid : ${mag.status}` };
    return { status: 'downloading', progress: pct, message: `AllDebrid prépare le fichier${pct != null ? ` (${pct} %)` : ''}…`, release: t.title };
  }
  const filesRes = await ad('/v4/magnet/files', { id: [m.id] });
  const entry = filesRes.magnets && filesRes.magnets[0];
  const file = pickFile(flattenFiles(entry && entry.files), q.type === 'tv' ? q.season : null, q.type === 'tv' ? q.episode : null);
  if (!file) return { status: 'error', message: 'Épisode introuvable dans le torrent.' };
  const un = await ad('/v4/link/unlock', { link: file.link });
  let link = un.link;
  if (!link && un.delayed) {
    for (let i = 0; i < 6 && !link; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = await ad('/v4/link/delayed', { id: un.delayed });
      if (d.status === 2) link = d.link;
      if (d.status === 3) break;
    }
  }
  if (!link) return { status: 'error', message: 'AllDebrid n’a pas pu générer le lien.' };
  unlocked.set(cacheKey, { url: link, filename: file.name, until: Date.now() + 2 * 60 * 60 * 1000 });
  return { status: 'ready', url: link, filename: un.filename || file.name, size: file.size, release: t.title };
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
  const out = { lumio: { ok: true, version: VERSION } };
  if (debridKey()) {
    try {
      const u = await ad('/v4/user', {});
      out.alldebrid = { ok: true, name: u.user && u.user.username, premium: Boolean(u.user && u.user.isPremium) };
    } catch (e) {
      out.alldebrid = { ok: false, error: String(e.message || e) };
    }
  }
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

// ——— HTTP ———
function send(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Jellyfin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  save();
  return msg;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined && o[k] !== '').map((k) => [k, o[k]]));

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health')
    return send(res, 200, {
      ok: true,
      version: VERSION,
      messages: messages.length,
      features: ['chat', 'grab', 'status', ...(debridKey() ? ['debrid'] : [])],
      radarr: Boolean(arrConfig('radarr')),
      sonarr: Boolean(arrConfig('sonarr')),
    });

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'introuvable' });

  const user = await whoAmI(req.headers['x-jellyfin-token']);
  if (!user) return send(res, 401, { error: 'jeton Jellyfin invalide' });

  try {
    // ——— Chat ———
    if (req.method === 'GET' && url.pathname === '/api/messages') {
      const after = url.searchParams.get('after');
      const limit = Math.min(200, Number(url.searchParams.get('limit')) || 100);
      let list = messages;
      if (after) {
        const idx = messages.findIndex((m) => m.id === after);
        list = idx >= 0 ? messages.slice(idx + 1) : messages;
      }
      return send(res, 200, { me: user, messages: list.slice(-limit) });
    }

    if (req.method === 'GET' && url.pathname === '/api/latest') {
      const last = messages[messages.length - 1];
      return send(res, 200, { id: last ? last.id : null, at: last ? last.createdAt : null, from: last ? last.userId : null });
    }

    if (req.method === 'POST' && url.pathname === '/api/messages') {
      const body = await readBody(req);
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      const media = cleanMedia(body.media);
      if (!text && !media) return send(res, 400, { error: 'message vide' });
      return send(res, 201, postMessage(user, text, media));
    }

    const del = url.pathname.match(/^\/api\/messages\/([\w-]+)$/);
    if (req.method === 'DELETE' && del) {
      const idx = messages.findIndex((m) => m.id === del[1]);
      if (idx < 0) return send(res, 404, { error: 'introuvable' });
      if (messages[idx].userId !== user.id && !user.admin) return send(res, 403, { error: 'interdit' });
      messages.splice(idx, 1);
      save();
      return send(res, 204);
    }

    // ——— Téléchargements (tous les comptes Jellyfin) ———
    if (req.method === 'GET' && url.pathname === '/api/arr/folders') {
      const kind = url.searchParams.get('type') === 'tv' ? 'sonarr' : 'radarr';
      return send(res, 200, await folders(kind));
    }

    if (req.method === 'POST' && url.pathname === '/api/grab') {
      const b = await readBody(req);
      const isTv = b.type === 'tv';
      const result = isTv ? await grabSeries(b) : await grabMovie(b);
      const media = cleanMedia({ ...b, type: isTv ? 'tv' : 'movie' });
      if (result.added) {
        history.unshift({
          at: new Date().toISOString(),
          user: user.name,
          type: isTv ? 'tv' : 'movie',
          tmdbId: Number(b.tmdbId) || undefined,
          title: result.title || (media && media.title),
          folder: result.folder,
        });
        history = history.slice(0, 500);
        writeJson(HISTORY_FILE, history);
        if (media && b.announce !== false) postMessage(user, '📥 a lancé le téléchargement', media, 'grab');
      }
      return send(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') return send(res, 200, await queue());

    if (req.method === 'GET' && url.pathname === '/api/history') return send(res, 200, history.slice(0, 100));

    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await status());

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, await debridStream(q));
    }

    // ——— Admin : reçoit la config Radarr / Sonarr depuis l'appli ———
    if (req.method === 'POST' && url.pathname === '/api/admin/arr') {
      if (!user.admin) return send(res, 403, { error: 'réservé aux admins Jellyfin' });
      const b = await readBody(req);
      const next = { ...config };
      if (b.radarr) next.radarr = pick(b.radarr, ['url', 'apiKey', 'qualityProfileId', 'rootFolderPath', 'minimumAvailability', 'searchOnAdd']);
      if (b.sonarr) next.sonarr = pick(b.sonarr, ['url', 'apiKey', 'qualityProfileId', 'languageProfileId', 'rootFolderPath', 'seasonFolder', 'searchOnAdd']);
      if (b.alldebrid && b.alldebrid.apiKey) next.alldebrid = { apiKey: String(b.alldebrid.apiKey).trim() };
      config = next;
      writeJson(CONFIG_FILE, config);
      return send(res, 200, await status());
    }

    return send(res, 404, { error: 'introuvable' });
  } catch (e) {
    const code = (e && e.status) || 400;
    return send(res, code, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log(`Serveur Lumio ${VERSION} sur le port ${PORT} (Jellyfin : ${JELLYFIN_URL})`));
