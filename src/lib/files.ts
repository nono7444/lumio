// Admin : disques du serveur (parcourir, créer, renommer, déplacer, supprimer) et téléchargements AllDebrid.
import { useEffect, useState } from 'react';

import { serverCall } from './chat';
import { useSettings, type Settings } from './settings';

export type Disk = { name: string; free: number | null; total: number | null };
export type FileEntry = { name: string; dir: boolean; size: number; mtime: string | null };
export type MoveJob = { id: string; name: string; dest: string; total: number; done: number; status: 'moving' | 'done' | 'error'; error?: string };
export type DownloadJob = {
  id: string;
  name: string;
  link: string;
  root: string;
  folder: string;
  status: 'queued' | 'debrid' | 'downloading' | 'done' | 'error' | 'cancelled';
  size: number;
  done: number;
  speed: number;
  current?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

const post = (s: Settings, path: string, body: unknown) => serverCall<any>(s, path, { method: 'POST', body: JSON.stringify(body) });

export const filesApi = {
  alldebrid: (s: Settings) => serverCall<{ configured: boolean; disks: number }>(s, '/api/alldebrid'),
  setAlldebridKey: (s: Settings, key: string) =>
    serverCall<{ configured: boolean }>(s, '/api/alldebrid', { method: 'PUT', body: JSON.stringify({ key }) }),
  disks: (s: Settings) => serverCall<{ disks: Disk[] }>(s, '/api/files/disks').then((r) => r.disks),
  list: (s: Settings, root: string, path: string) =>
    serverCall<{ entries: FileEntry[] }>(s, `/api/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`).then((r) => r.entries),
  mkdir: (s: Settings, root: string, path: string) => post(s, '/api/files/mkdir', { root, path }),
  move: (s: Settings, root: string, from: string, to: string, toRoot?: string) => post(s, '/api/files/move', { root, from, to, toRoot }),
  remove: (s: Settings, root: string, path: string) => post(s, '/api/files/delete', { root, path }),
  moveJobs: (s: Settings) => serverCall<{ jobs: MoveJob[] }>(s, '/api/files/jobs').then((r) => r.jobs),
  downloads: (s: Settings) => serverCall<{ downloads: DownloadJob[] }>(s, '/api/downloads').then((r) => r.downloads),
  startDownload: (s: Settings, link: string, root: string, folder: string) => post(s, '/api/downloads', { link, root, folder }),
  cancelDownload: (s: Settings, id: string) => serverCall(s, `/api/downloads/${id}`, { method: 'DELETE' }),
};

export const joinPath = (a: string, b: string) => [a, b].filter(Boolean).join('/');
export const parentPath = (p: string) => p.split('/').slice(0, -1).join('/');

export function formatSize(n?: number | null) {
  if (n == null) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

/** Admin : nombre de téléchargements en cours (pastille de l'accueil), vérifié toutes les 20 s. */
export function useActiveDownloads() {
  const { settings } = useSettings();
  const [n, setN] = useState(0);
  const admin = settings.jellyfin?.isAdmin === true;
  useEffect(() => {
    if (!admin || !settings.chatUrl) return;
    let alive = true;
    const tick = () =>
      filesApi
        .downloads(settings)
        .then((l) => alive && setN(l.filter((d) => ['queued', 'debrid', 'downloading'].includes(d.status)).length))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [admin, settings.chatUrl, settings.jellyfin?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}
