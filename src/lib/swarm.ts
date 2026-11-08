// Admin : sources (seeders) et téléchargeurs (leechers) de chaque titre, pour la petite pastille des affiches.
// Chiffres de qBittorrent pour ce qui est en partage, sinon ceux de la dernière recherche de Lumio Auto.
// Une seule requête pour toutes les affiches, rafraîchie toutes les 2 minutes au plus.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { serverCall } from './chat';
import type { Settings } from './settings';
import { adminUI } from './variant';

export type Swarm = { s: number | null; l: number | null; src: 'qbit' | 'recherche'; seeding?: boolean };

let map: Record<string, Swarm> = {};
let loadedAt = 0;
let inflight = false;
const listeners = new Set<() => void>();

async function refresh(s: Settings) {
  inflight = true;
  try {
    const r = await serverCall<{ swarm: Record<string, Swarm> }>(s, '/api/auto/swarm');
    map = r.swarm || {};
  } catch {
    // Serveur trop ancien ou Lumio Auto pas configuré : pas de pastille
    map = {};
  } finally {
    loadedAt = Date.now();
    inflight = false;
    listeners.forEach((l) => l());
  }
}

/** Sources / téléchargeurs d'un titre (admin seulement, jamais sur la TV). */
export function useSwarm(s: Settings, type: 'movie' | 'tv' | undefined, tmdbId: number | undefined): Swarm | null {
  const [, force] = useState(0);
  const admin = adminUI(s) && !Platform.isTV && Boolean(s.chatUrl);
  useEffect(() => {
    if (!admin) return;
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!inflight && Date.now() - loadedAt > 2 * 60_000) refresh(s);
    return () => {
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, s.chatUrl, s.jellyfin?.token]);
  if (!admin || !type || !tmdbId) return null;
  return map[`${type}:${tmdbId}`] ?? null;
}
