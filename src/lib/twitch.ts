// Lumio → univers « Twitch » (admin) : rediffusions publiques des chaînes suivies, rangées par jeu (chapitres),
// lues directement depuis Twitch ; la position de lecture est gardée sur le serveur Lumio.
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { serverCall } from './chat';
import { useSettings, type Settings } from './settings';

export type TwitchChapter = { game: string; box: string | null; start: number; length: number };
export type TwitchVod = {
  id: string;
  title: string;
  length: number;
  createdAt: string;
  views: number;
  thumb: string | null;
  chapters: TwitchChapter[];
  progress: { pos: number; length: number; done: boolean; at: number } | null;
};
export type TwitchQuality = { id: string; name: string; height: number; fps: number; bandwidth: number; url: string };
export type TwitchJob = { id: string; vodId: string; channel: string; title: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; quality: string; done: number; length: number; bytes: number; error: string | null; file: string | null };
export type TwitchChannel = {
  login: string;
  name: string;
  avatar?: string;
  live?: { title: string; viewers: number; game: string | null } | null;
  vods: TwitchVod[];
  error?: string;
};

export const twitchApi = {
  channels: (s: Settings, refresh = false) => serverCall<{ channels: TwitchChannel[] }>(s, `/api/twitch/channels${refresh ? '?refresh=1' : ''}`),
  setChannels: (s: Settings, channels: string[]) =>
    serverCall<{ channels: string[] }>(s, '/api/twitch/channels', { method: 'PUT', body: JSON.stringify({ channels }) }),
  play: (s: Settings, id: string) => serverCall<{ url: string; qualities: TwitchQuality[] }>(s, `/api/twitch/vod/${id}/play`),
  download: (s: Settings, v: { id: string; title: string; createdAt: string; length: number }, channel: string, quality: string) =>
    serverCall<{ job: TwitchJob }>(s, `/api/twitch/vod/${v.id}/download`, {
      method: 'POST',
      body: JSON.stringify({ channel, title: v.title, createdAt: v.createdAt, length: v.length, quality }),
    }),
  jobs: (s: Settings) => serverCall<{ jobs: TwitchJob[]; saved: string[] }>(s, '/api/twitch/jobs'),
  cancel: (s: Settings, id: string) => serverCall<{ ok: boolean }>(s, `/api/twitch/jobs/${id}`, { method: 'DELETE' }),
  account: (s: Settings) => serverCall<{ account: { login: string; name: string } | null }>(s, '/api/twitch/account'),
  connect: (s: Settings, token: string) =>
    serverCall<{ account: { login: string; name: string } }>(s, '/api/twitch/account', { method: 'PUT', body: JSON.stringify({ token }) }),
  disconnect: (s: Settings) => serverCall<{ account: null }>(s, '/api/twitch/account', { method: 'DELETE' }),
  progress: (s: Settings, id: string, pos: number, length: number) =>
    serverCall<{ ok: boolean }>(s, `/api/twitch/vod/${id}/progress`, { method: 'PUT', body: JSON.stringify({ pos, length }) }),
};

// Chaînes gardées en mémoire (retour du lecteur sans recharger)
let data: TwitchChannel[] | null = null;
let err: string | null = null;
let loading = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let snap: { data: TwitchChannel[] | null; err: string | null; loading: boolean } = { data, err, loading };
const getSnap = () => (snap.data === data && snap.err === err && snap.loading === loading ? snap : (snap = { data, err, loading }));
export async function loadTwitch(s: Settings, refresh = false) {
  if (loading) return;
  loading = true;
  emit();
  try {
    data = (await twitchApi.channels(s, refresh)).channels;
    err = null;
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  } finally {
    loading = false;
    emit();
  }
}
export function useTwitch() {
  const { settings } = useSettings();
  const st = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSnap);
  useEffect(() => {
    if (!data && settings.jellyfin?.isAdmin && settings.chatUrl) loadTwitch(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, settings.chatUrl]);
  const reload = useCallback(() => loadTwitch(settings, true), [settings]);
  return { ...st, reload };
}
/** Position gardée tout de suite en mémoire (la liste montre l'avancement au retour du lecteur). */
export function noteTwitchProgress(id: string, pos: number, length: number) {
  if (!data) return;
  data = data.map((c) => ({ ...c, vods: c.vods.map((v) => (v.id === id ? { ...v, progress: { pos, length, done: length > 0 && pos > length - 120, at: Date.now() } } : v)) }));
  emit();
}

export const fmtLen = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
export const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400e3);
  if (days < 1) return "aujourd'hui";
  if (days < 2) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};
