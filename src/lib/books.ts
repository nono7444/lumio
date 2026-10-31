// Book : recherche de livres (C411, Tr4ker, Wawacity), téléchargements sur le disque et lecture, via le serveur Lumio.
import { router } from 'expo-router';

import { serverBase, serverCall } from './chat';
import type { Settings } from './settings';

export type BookKind = 'mangas' | 'bd' | 'comics' | 'livres' | 'audio';
export type BookResult = {
  id: string;
  title: string;
  source: string;
  size: number;
  seeders: number | null;
  format: string;
  close: boolean;
  genre: 'tome' | 'pack' | 'livre';
  tome?: number;
  range?: string;
};
export type BookSource = { id: string; label: string; state: 'ok' | 'nokey' | 'error' | 'skip'; count: number; message?: string };
export type BookJob = { id: string; name: string; status: string; size: number; done: number; speed: number; current?: string; error?: string; createdAt: string };
export type Book = { name: string; title: string; folder: string; path: string; format: 'bd' | 'epub' | 'pdf' | 'audio'; size: number; modified: string; token: string };
export type BookSettings = { c411: boolean; tr4ker: boolean; alldebrid: boolean; wawacity: string; dir: { root: string; folder: string } | null; disks: string[]; admin: boolean };

export const booksApi = {
  settings: (s: Settings) => serverCall<BookSettings>(s, '/api/books/settings'),
  saveSettings: (s: Settings, b: Partial<{ c411Key: string; tr4kerKey: string; wawacity: string; root: string; folder: string }>) =>
    serverCall(s, '/api/books/settings', { method: 'PUT', body: JSON.stringify(b) }),
  search: (s: Settings, q: string, kind: BookKind) =>
    serverCall<{ results: BookResult[]; sources: BookSource[] }>(s, `/api/books/search?kind=${kind}&q=${encodeURIComponent(q)}`),
  download: (s: Settings, id: string) => serverCall<{ job: BookJob }>(s, '/api/books/download', { method: 'POST', body: JSON.stringify({ id }) }),
  jobs: (s: Settings) => serverCall<{ jobs: BookJob[] }>(s, '/api/books/jobs'),
  cancel: (s: Settings, id: string) => serverCall(s, `/api/books/jobs/${id}`, { method: 'DELETE' }),
  library: (s: Settings) => serverCall<{ dir: { root: string; folder: string } | null; books: Book[] }>(s, '/api/books/library'),
  remove: (s: Settings, token: string) => serverCall(s, '/api/books/delete', { method: 'POST', body: JSON.stringify({ token }) }),
};

/** Adresse d'un fichier de livre (lien signé, sans jeton). */
export const bookUrl = (s: Settings, token: string, what: string) => `${serverBase(s.chatUrl)}/api/books/f/${token}/${what}`;

export function bytes(n?: number) {
  if (!n) return '';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}

/** Ouvre un livre dans le bon lecteur. */
export function openBook(b: Book) {
  const params = { token: b.token, title: b.title, path: b.path };
  const pathname = b.format === 'bd' ? '/books/bd' : b.format === 'epub' ? '/books/epub' : b.format === 'pdf' ? '/books/pdf' : '/books/audio';
  router.push({ pathname, params });
}
