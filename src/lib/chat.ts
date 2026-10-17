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

/** Appel authentifié (jeton Jellyfin) au serveur Lumio : chat, téléchargements, état. */
export async function serverCall<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  if (!s.chatUrl) throw new Error('Serveur Lumio non configuré (Profil → Serveur Lumio)');
  if (!s.jellyfin) throw new Error('Connecte-toi à Jellyfin pour utiliser le serveur Lumio');
  const res = await fetch(`${serverBase(s.chatUrl)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Jellyfin-Token': s.jellyfin.token,
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
