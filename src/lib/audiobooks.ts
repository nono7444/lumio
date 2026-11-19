// Livres audio (appli Lumio Audio) : bibliothèque, recherche et téléchargement du serveur Lumio (/api/audio/…).
import { serverBase, serverCall } from './chat';
import type { Settings } from './settings';

export type AudioFile = { index: number; name: string; size: number; url: string };
export type AudioProgress = { file: number; pos: number; dur: number; total: number; done: boolean; at: number };
export type AudioBook = {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  size: number;
  added: string;
  cover: string | null;
  files: AudioFile[];
  progress: AudioProgress | null;
};
export type AudioLibrary = { books: AudioBook[]; dir: { root: string; folder: string } | null; admin: boolean; downloading: number };
export type AudioResult = { id: string; title: string; source: string; size: number; seeders: number | null; format: string; close: boolean };
export type AudioSource = { id: string; label: string; state: string; count: number; message?: string };
export type AudioJob = { id: string; name: string; status: string; size: number; done: number; speed: number; error?: string; createdAt: string };

/** Adresse complète d'un lien du serveur (lecture, couverture) ; les couvertures Open Library sont déjà complètes. */
export const audioUrl = (s: Settings, u: string | null) => (!u ? null : /^https?:\/\//.test(u) ? u : s.chatUrl ? `${serverBase(s.chatUrl)}${u}` : null);

export const audioApi = {
  library: (s: Settings, refresh = false) => serverCall<AudioLibrary>(s, `/api/audio/library${refresh ? '?refresh=1' : ''}`),
  progress: (s: Settings, id: string, b: { file: number; pos: number; dur: number; total?: number; done?: boolean }) =>
    serverCall<{ ok: boolean }>(s, `/api/audio/progress/${id}`, { method: 'POST', body: JSON.stringify(b) }),
  search: (s: Settings, q: string) => serverCall<{ results: AudioResult[]; sources: AudioSource[] }>(s, `/api/audio/search?q=${encodeURIComponent(q)}`),
  download: (s: Settings, id: string) => serverCall<{ ok: boolean; via: string; message: string }>(s, '/api/audio/download', { method: 'POST', body: JSON.stringify({ id }) }),
  jobs: (s: Settings) => serverCall<{ jobs: AudioJob[] }>(s, '/api/audio/jobs'),
  remove: (s: Settings, id: string) => serverCall<{ ok: boolean }>(s, `/api/audio/books/${id}`, { method: 'DELETE' }),
};

/** « 3 h 12 », « 47 min » */
export function fmtDur(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
/** « 1:02:03 » / « 12:03 » */
export function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}` : `${m}:${String(s2).padStart(2, '0')}`;
}
