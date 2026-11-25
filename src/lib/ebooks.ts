// Livres numériques (appli Lumio Livres) : bibliothèque, position de lecture, recherche et téléchargement
// par le serveur Lumio (/api/books/…). Les fichiers s'ouvrent par des liens signés (/api/books/f/<jeton>/…).
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { serverBase, serverCall } from './chat';
import { useSettings, type Settings } from './settings';

export type BookFormat = 'epub' | 'pdf' | 'bd' | 'audio';
export type BookProgress = { chapter: number; scroll: number; page: number; pct: number; done: boolean; at: number };
export type BooksAuto = {
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  missing: { name: string; gaps: number[]; max: number }[];
  log: { at: string; series?: string; tome?: number; status: 'started' | 'error' | 'none'; title?: string; source?: string; message?: string }[];
};

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
  /** Version de la couverture sur le serveur (0 = pas encore prête) */
  coverV?: number;
  progress: BookProgress | null;
};
export type EbookLibrary = {
  books: Ebook[];
  dir: { root: string; folder: string } | null;
  admin: boolean;
  downloading: number;
  /** Rangement en cours (packs décompressés, CBR convertis) */
  tidying?: boolean;
  /** Admin : fichiers du dossier que la liseuse ne sait pas ouvrir */
  unread?: { name: string; size: number }[];
};
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
  /** Compléter les séries tout seul (tomes manquants et tome suivant) */
  auto: (s: Settings) => serverCall<BooksAuto>(s, '/api/books/auto'),
  setAuto: (s: Settings, enabled: boolean) => serverCall<BooksAuto>(s, '/api/books/auto', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  autoRun: (s: Settings) => serverCall<BooksAuto>(s, '/api/books/auto/run', { method: 'POST', body: '{}' }),
  /** Admin : recharge titre et couverture (refait la recherche) */
  refresh: (s: Settings, tokens: string[]) =>
    serverCall<{ ok: boolean; count: number; left: number }>(s, '/api/books/refresh', { method: 'POST', body: JSON.stringify({ tokens }) }),
  coverChoices: (s: Settings, token: string, q?: string) =>
    serverCall<{ query: string; covers: string[] }>(s, '/api/books/cover-choices', { method: 'POST', body: JSON.stringify({ token, q }) }),
  /** Admin : couverture à la main, lien d'image ou image en base64 */
  setCover: (s: Settings, token: string, body: { url: string } | { data: string }) =>
    serverCall<{ ok: boolean; coverV: number }>(s, '/api/books/cover', { method: 'POST', body: JSON.stringify({ token, ...body }) }),
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

// ——— Collections : les tomes d'une même série rassemblés ———
export type Series = { key: string; name: string; books: Ebook[] };
const nkey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** « Kaamelott, 07 Contre-attaque », « Jujutsu Kaisen T30 Akutami », « One Piece - Tome 12 », « Naruto Vol. 3 » → série + numéro. */
export function seriesOf(b: Ebook): { name: string; index: number } | null {
  const t = b.title.replace(/\s+/g, ' ').trim();
  const pats = [
    /^(.+?)[\s,:-]+(?:t(?:ome)?|vol(?:ume)?\.?|#|n°|no\.?)\s*(\d{1,4})(?:\D|$)/i,
    /^(.+?),\s*(\d{1,4})(?:\D|$)/,
    /^(.+?)\s+-\s+(\d{1,4})(?:\D|$)/,
    // BD et mangas : « Naruto 12 »
    ...(b.format === 'bd' ? [/^(.+?)\s+(\d{1,4})(?:\s|$)/] : []),
  ];
  for (const re of pats) {
    const m = t.match(re);
    // Une année (« Black Clover 2016 ») n'est pas un numéro de tome
    if (m && m[1].trim().length >= 2 && !/^(19|20)\d{2}$/.test(m[2])) return { name: m[1].replace(/[\s,:-]+$/, '').trim(), index: Number(m[2]) };
  }
  return null;
}
/** Livres seuls et collections (au moins deux tomes de la même série, ou trois livres d'un même sous-dossier). */
export function groupSeries(books: Ebook[]): { singles: Ebook[]; series: Series[] } {
  const by = new Map<string, Series>();
  const idx = new Map<string, number>();
  for (const b of books) {
    const s = seriesOf(b);
    if (!s) continue;
    const key = nkey(s.name);
    if (!key) continue;
    if (!by.has(key)) by.set(key, { key, name: s.name, books: [] });
    by.get(key)!.books.push(b);
    idx.set(b.id, s.index);
  }
  // Sous-dossier avec plusieurs livres sans numéro reconnu : la collection prend le nom du dossier
  const byFolder = new Map<string, Ebook[]>();
  for (const b of books) {
    if (idx.has(b.id) || !b.folder) continue;
    const f = b.folder.split('/').pop()!;
    byFolder.set(f, [...(byFolder.get(f) ?? []), b]);
  }
  for (const [f, list] of byFolder) {
    if (list.length < 3) continue;
    const key = nkey(f);
    if (!by.has(key)) by.set(key, { key, name: f, books: [] });
    by.get(key)!.books.push(...list);
  }
  const series: Series[] = [];
  const grouped = new Set<string>();
  for (const s of by.values()) {
    if (s.books.length < 2) continue;
    s.books.sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9) || a.title.localeCompare(b.title, 'fr', { numeric: true }));
    series.push(s);
    s.books.forEach((b) => grouped.add(b.id));
  }
  return { singles: books.filter((b) => !grouped.has(b.id)), series };
}
export const tomeOf = (b: Ebook) => seriesOf(b)?.index ?? null;
let seriesCache: Series[] = [];
export const rememberSeries = (s: Series[]) => (seriesCache = s);
export const seriesByKey = (k: string) => seriesCache.find((s) => s.key === k) ?? null;

// ——— Vignettes des résultats de recherche ———
const thumbCache = new Map<string, Promise<string | null>>();
export function coverFind(s: Settings, path: string, q: string, kind?: string) {
  const key = `${path}|${kind ?? ''}|${q}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(
      key,
      serverCall<{ url: string | null }>(s, `${path}?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`)
        .then((r) => r.url)
        .catch(() => null)
    );
  }
  return thumbCache.get(key)!;
}

// ——— Dossier sur le serveur (disque) ———
export type FolderDisk = { name: string; free: number | null; total: number | null };
export type FolderInfo = {
  dir: { root: string; folder: string } | null;
  size: number | null;
  disks: FolderDisk[];
  move: { status: 'running' | 'done' | 'error'; from: string; to: string; size: number; done?: number; pct?: number; current?: string | null; error: string | null } | null;
};
export const folderApi = {
  get: (s: Settings, kind: 'audio' | 'books' | 'twitch') => serverCall<FolderInfo>(s, `/api/${kind}/folder`),
  move: (s: Settings, kind: 'audio' | 'books' | 'twitch', root: string) => serverCall<FolderInfo>(s, `/api/${kind}/folder`, { method: 'POST', body: JSON.stringify({ root }) }),
};
