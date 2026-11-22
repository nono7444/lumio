// Client du serveur « Lumio Chat » (discussion familiale, auth par jeton Jellyfin).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { useSettings, type Settings } from './settings';

export type ChatMedia = { type: 'movie' | 'tv'; tmdbId: number; title: string; year?: string; poster?: string };
export type ChatMessage = {
  id: string;
  /** 'grab' : annonce automatique d'un téléchargement */
  kind?: string;
  userId: string;
  userName: string;
  admin?: boolean;
  text: string;
  media?: ChatMedia;
  createdAt: string;
};
export type ChatMe = { id: string; name: string; admin: boolean };

export const serverBase = (u: string) => {
  let url = u.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
};

// ——— Lecture en local (même réseau que le serveur) ———
// Par le tunnel Cloudflare, une vidéo lourde fait travailler cloudflared à fond (un cœur entier).
// À la maison, on lit directement sur l'adresse locale du serveur Lumio si elle répond et que c'est bien le même.
const LUMIO_LAN = ['http://192.168.1.71:3456'];
let lumioLan: { key: string; at: number; base: string | null } | null = null;

async function health(base: string, ms: number): Promise<{ version?: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Adresse à utiliser pour lire un fichier du serveur Lumio : locale si on est à la maison, sinon l'adresse publique. */
export async function lumioPlayBase(s: Settings): Promise<string> {
  const remote = serverBase(s.chatUrl ?? '');
  if (/^http:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.)/.test(remote)) return remote;
  if (lumioLan && lumioLan.key === remote && Date.now() - lumioLan.at < 5 * 60_000) return lumioLan.base ?? remote;
  let candidates = [...LUMIO_LAN];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${remote}/tv/setup`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    const cfg = r.ok ? ((await r.json()) as { localLumioUrl?: string | null }) : null;
    if (cfg?.localLumioUrl) candidates = [serverBase(cfg.localLumioUrl), ...candidates];
  } catch {}
  const ref = await health(remote, 4000);
  let found: string | null = null;
  for (const c of candidates) {
    const h = await health(c, 1500);
    if (h && (!ref?.version || h.version === ref.version)) {
      found = c;
      break;
    }
  }
  lumioLan = { key: remote, at: Date.now(), base: found };
  return found ?? remote;
}

/** Appel authentifié (jeton Jellyfin) au serveur Lumio : chat, téléchargements, état. */
export async function serverCall<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  if (!s.chatUrl) throw new Error('Serveur Lumio non configuré (Profil → Serveur Lumio)');
  if (!s.jellyfin) throw new Error('Connecte-toi à Jellyfin pour utiliser le serveur Lumio');
  const res = await fetch(`${serverBase(s.chatUrl)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Jellyfin-Token': s.jellyfin.token,
      // Adresse de Jellyfin vue par l'appli : le serveur la donne aux TV à configurer
      'X-Jellyfin-Url': s.jellyfin.url,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {}
    throw new Error(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const chat = {
  list: (s: Settings, after?: string) =>
    serverCall<{ me: ChatMe; messages: ChatMessage[] }>(s, `/api/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  latest: (s: Settings) => serverCall<{ id: string | null; at: string | null; from: string | null }>(s, '/api/latest'),
  send: (s: Settings, text: string, media?: ChatMedia) =>
    serverCall<ChatMessage>(s, '/api/messages', { method: 'POST', body: JSON.stringify({ text, media }) }),
  remove: (s: Settings, id: string) => serverCall(s, `/api/messages/${id}`, { method: 'DELETE' }),
  health: (url: string) => fetch(`${serverBase(url)}/health`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
};

// ——— Pastille « non lu » ———
// On retient la date du dernier message lu (et plus seulement son identifiant) : un message supprimé
// ou une lecture faite avant le chargement du stockage ne laissent plus la pastille allumée.

const READ_KEY = 'lumio-chat:last-read-at';
let lastReadAt = '';
let touched = false;
const listeners = new Set<() => void>();
let latestCache: { id: string | null; at: string | null; from: string | null } = { id: null, at: null, from: null };

AsyncStorage.getItem(READ_KEY)
  .then((v) => {
    if (touched || !v) return;
    lastReadAt = v;
    listeners.forEach((l) => l());
  })
  .catch(() => {});

/** Marque la discussion comme lue jusqu'au message donné (sa date), ou jusqu'au dernier connu. */
export function markChatRead(at?: string | null) {
  const v = at || latestCache.at;
  if (!v) return;
  touched = true;
  if (v <= lastReadAt) return;
  lastReadAt = v;
  AsyncStorage.setItem(READ_KEY, v).catch(() => {});
  listeners.forEach((l) => l());
}

/** 1 s'il y a un message non lu d'une autre personne, sinon 0 (vérifié toutes les 45 s). */
export function useUnreadChat() {
  const { settings } = useSettings();
  const [latest, setLatest] = useState(latestCache);
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!settings.chatUrl || !settings.jellyfin) return;
    let alive = true;
    const tick = () =>
      chat
        .latest(settings)
        .then((r) => {
          latestCache = r;
          if (alive) setLatest(r);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [settings.chatUrl, settings.jellyfin?.token]);

  if (!latest.id || !latest.at) return 0;
  if (latest.from && latest.from === settings.jellyfin?.userId) return 0;
  return latest.at > lastReadAt ? 1 : 0;
}
