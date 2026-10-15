// Lumio Chat : petit serveur de discussion familiale, sans dépendance.
// Authentification : le jeton Jellyfin de l'appli, vérifié auprès de ton serveur Jellyfin.
// Stockage : un fichier JSON dans /data (volume Docker).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3456);
const JELLYFIN_URL = (process.env.JELLYFIN_URL || 'http://jellyfin:8096').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'messages.json');
const MAX_MESSAGES = 3000;
const MAX_TEXT = 2000;

fs.mkdirSync(DATA_DIR, { recursive: true });

let messages = [];
try {
  messages = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  messages = [];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(messages));
    fs.renameSync(tmp, FILE);
  }, 300);
}

// ——— Vérification du jeton Jellyfin (mise en cache 10 min) ———
const users = new Map();

async function whoAmI(token) {
  if (!token) return null;
  const hit = users.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const res = await fetch(`${JELLYFIN_URL}/Users/Me`, {
      headers: { Authorization: `MediaBrowser Client="LumioChat", Device="server", DeviceId="lumio-chat", Version="1.0.0", Token="${token}"` },
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

function send(res, status, body) {
  res.writeHead(status, {
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
      if (data.length > 64 * 1024) reject(new Error('trop volumineux'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health') return send(res, 200, { ok: true, messages: messages.length });

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'introuvable' });

  const user = await whoAmI(req.headers['x-jellyfin-token']);
  if (!user) return send(res, 401, { error: 'jeton Jellyfin invalide' });

  try {
    // Liste (avec ?after=<id> pour ne récupérer que les nouveaux)
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
      const msg = {
        id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        userId: user.id,
        userName: user.name,
        admin: user.admin,
        text,
        media,
        createdAt: new Date().toISOString(),
      };
      messages.push(msg);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      save();
      return send(res, 201, msg);
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

    return send(res, 404, { error: 'introuvable' });
  } catch (e) {
    return send(res, 400, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log(`Lumio Chat sur le port ${PORT} (Jellyfin : ${JELLYFIN_URL})`));
