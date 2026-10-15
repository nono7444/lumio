// Client du serveur « Lumio Chat » (discussion familiale, auth par jeton Jellyfin).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { useSettings, type Settings } from './settings';

export type ChatMedia = { type: 'movie' | 'tv'; tmdbId: number; title: string; year?: string; poster?: string };
export type ChatMessage = {
  id: string;
  userId: string;
  userName: string;
  admin?: boolean;
  text: string;
  media?: ChatMedia;
  createdAt: string;
};
export type ChatMe = { id: string; name: string; admin: boolean };

const base = (u: string) => {
  let url = u.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
};

async function call<T>(s: Settings, path: string, init?: RequestInit): Promise<T> {
  if (!s.chatUrl) throw new Error('Chat non configuré');
  if (!s.jellyfin) throw new Error('Connecte-toi à Jellyfin pour utiliser le chat');
  const res = await fetch(`${base(s.chatUrl)}${path}`, {
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
    call<{ me: ChatMe; messages: ChatMessage[] }>(s, `/api/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  latest: (s: Settings) => call<{ id: string | null; from: string | null }>(s, '/api/latest'),
  send: (s: Settings, text: string, media?: ChatMedia) =>
    call<ChatMessage>(s, '/api/messages', { method: 'POST', body: JSON.stringify({ text, media }) }),
  remove: (s: Settings, id: string) => call(s, `/api/messages/${id}`, { method: 'DELETE' }),
  health: (url: string) => fetch(`${base(url)}/health`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
};

// ——— Pastille « non lu » ———

const READ_KEY = 'lumio-chat:last-read';
let lastRead: string | null = null;
const listeners = new Set<() => void>();

AsyncStorage.getItem(READ_KEY)
  .then((v) => {
    lastRead = v;
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function markChatRead(id: string | null) {
  if (!id || id === lastRead) return;
  lastRead = id;
  AsyncStorage.setItem(READ_KEY, id).catch(() => {});
  listeners.forEach((l) => l());
}

/** 1 s'il y a un message non lu d'une autre personne, sinon 0 (vérifié toutes les 45 s). */
export function useUnreadChat() {
  const { settings } = useSettings();
  const [latest, setLatest] = useState<{ id: string | null; from: string | null }>({ id: null, from: null });
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
        .then((r) => alive && setLatest(r))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [settings.chatUrl, settings.jellyfin?.token]);

  if (!latest.id || latest.id === lastRead) return 0;
  if (latest.from && latest.from === settings.jellyfin?.userId) return 0;
  return 1;
}
