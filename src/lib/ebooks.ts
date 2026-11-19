// Livres numériques (appli Lumio Livres) : bibliothèque, position de lecture, recherche et téléchargement
// par le serveur Lumio (/api/books/…). Les fichiers s'ouvrent par des liens signés (/api/books/f/<jeton>/…).
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { serverBase, serverCall } from './chat';
import { useSettings, type Settings } from './settings';

export type BookFormat = 'epub' | 'pdf' | 'bd' | 'audio';
export type BookProgress = { chapter: number; scroll: number; page: number; pct: number; done: boolean; at: number };
export type Ebook = {
  id: string;
  name: string;
  title: string;
  author: string | null;
  folder: string;
  path: string;
  format: BookFormat;
  size: number;
  modified: string;
  token: string;
  progress: BookProgress | null;
};
export type EbookLibrary = { books: Ebook[]; dir: { root: string; folder: string } | null; admin: boolean; downloading: number };
export type EbookKind = 'livres' | 'bd' | 'mangas' | 'comics';
export type EbookResult = {
  id: string;
  title: string;
  source: string;
  size: number;
  seeders: number | null;
  format: string | null;
  close: boolean;
  genre?: 'tome' | 'livre' | 'pack';
  tome?: number | null;
  range?: string;
};
export type EbookSource = { id: string; label: string; state: string; count: number; message?: string };
export type EbookJob = { id: string; name: string; status: string; size: number; done: number; speed: number; error?: string; createdAt: string };

/** Adresse complète d'un lien du serveur */
export const bookUrl = (s: Settings, u: string) => (s.chatUrl ? `${serverBase(s.chatUrl)}${u}` : null);
export const fileUrl = (s: Settings, b: Ebook, what = 'file') => bookUrl(s, `/api/books/f/${b.token}/${what}`);

export const ebookApi = {
  library: (s: Settings) => serverCall<EbookLibrary>(s, '/api/books/library'),
  progress: (s: Settings, id: string, b: Partial<BookProgress>) =>
    serverCall<{ ok: boolean }>(s, `/api/books/progress/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  search: (s: Settings, q: string, kind: EbookKind) =>
    serverCall<{ results: EbookResult[]; sources: EbookSource[] }>(s, `/api/books/search?kind=${kind}&q=${encodeURIComponent(q)}`),
  download: (s: Settings, id: string) => serverCall<{ job: EbookJob }>(s, '/api/books/download', { method: 'POST', body: JSON.stringify({ id }) }),
  jobs: (s: Settings) => serverCall<{ jobs: EbookJob[] }>(s, '/api/books/jobs'),
  remove: (s: Settings, token: string) => serverCall<{ ok: boolean }>(s, '/api/books/delete', { method: 'POST', body: JSON.stringify({ token }) }),
  epub: (s: Settings, b: Ebook) => fetch(fileUrl(s, b, 'epub')!).then((r) => r.json() as Promise<{ title: string; chapters: string[]; error?: string }>),
  pages: (s: Settings, b: Ebook) => fetch(fileUrl(s, b, 'pages')!).then((r) => r.json() as Promise<{ title: string; pages: number; error?: string }>),
};

// ——— Bibliothèque gardée en mémoire (la fiche et la liseuse s'ouvrent sans recharger) ———
let lib: EbookLibrary | null = null;
let libErr: string | null = null;
let loading = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let snap: { lib: EbookLibrary | null; libErr: string | null; loading: boolean } = { lib, libErr, loading };
const getSnap = () => (snap.lib === lib && snap.libErr === libErr && snap.loading === loading ? snap : (snap = { lib, libErr, loading }));

export async function loadEbooks(s: Settings) {
  if (loading) return;
  loading = true;
  emit();
  try {
    const l = await ebookApi.library(s);
    // Les livres audio ont leur appli (Lumio Audio)
    lib = { ...l, books: l.books.filter((b) => b.format !== 'audio') };
    libErr = null;
  } catch (e) {
    libErr = e instanceof Error ? e.message : String(e);
  } finally {
    loading = false;
    emit();
  }
}
export function useEbooks() {
  const { settings } = useSettings();
  const st = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSnap);
  useEffect(() => {
    if (!lib && settings.jellyfin && settings.chatUrl) loadEbooks(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, settings.chatUrl]);
  const reload = useCallback(() => loadEbooks(settings), [settings]);
  return { ...st, reload };
}
export const ebookById = (id: string) => lib?.books.find((b) => b.id === id) ?? null;

/** Position gardée tout de suite dans la bibliothèque en mémoire, puis envoyée au serveur. */
export function saveProgress(s: Settings, b: Ebook, p: Partial<BookProgress>) {
  const next: BookProgress = { chapter: 0, scroll: 0, page: 0, pct: 0, done: false, ...b.progress, ...p, at: Date.now() };
  b.progress = next;
  if (lib) {
    lib = { ...lib, books: lib.books.map((x) => (x.id === b.id ? { ...x, progress: next } : x)) };
    emit();
  }
  return ebookApi.progress(s, b.id, next).catch(() => {});
}

export const FORMAT_LABEL: Record<BookFormat, string> = { epub: 'EPUB', pdf: 'PDF', bd: 'BD', audio: 'Audio' };
export const mo = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : `${Math.max(1, Math.round(n / 1e6))} Mo`);
