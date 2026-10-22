// Client du serveur Lumio : file d'attente, état des services (les demandes sont dans requests.ts).
import type { QueueItem } from './arr';
import { serverBase, serverCall } from './chat';
import { useEffect, useState } from 'react';

import { useSettings, type Settings } from './settings';

export type ServerFolder = { path: string; freeSpace?: number; accessible?: boolean };
export type ServiceStatus = {
  ok: boolean;
  ms?: number;
  error?: string;
  version?: string;
  name?: string;
  configured?: boolean;
  queue?: number;
  disks?: ServerFolder[];
};
export type ServerStatus = {
  lumio: ServiceStatus;
  jellyfin?: ServiceStatus;
  radarr?: ServiceStatus;
  sonarr?: ServiceStatus;
};
export type ServerHealth = { ok: boolean; version?: string; features?: string[]; radarr?: boolean; sonarr?: boolean };

// Le /health est public : on le garde en cache pour savoir si le serveur gère les téléchargements
let healthCache: { url: string; at: number; value: ServerHealth | null } | null = null;
export const invalidateHealth = () => {
  healthCache = null;
};

// Dernière réponse valide : gardée en cas de coupure brève (sinon l'appli affichait « serveur injoignable / redémarrage »
// et la fiche basculait sur l'ancien mode sans serveur, où la demande ne partait pas)
let lastGood: { url: string; at: number; value: ServerHealth } | null = null;

async function fetchHealth(url: string, timeoutMs: number): Promise<ServerHealth | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverBase(url)}/health`, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function serverHealth(s: Settings, force = false): Promise<ServerHealth | null> {
  if (!s.chatUrl) return null;
  // Réponse gardée 60 s ; un échec seulement 5 s, pour réessayer vite après une coupure
  if (!force && healthCache && healthCache.url === s.chatUrl && Date.now() - healthCache.at < (healthCache.value ? 60_000 : 5_000))
    return healthCache.value;
  // Deux essais (le tunnel met parfois plusieurs secondes à répondre)
  let value = await fetchHealth(s.chatUrl, 12000);
  if (!value) value = await fetchHealth(s.chatUrl, 15000);
  if (value) lastGood = { url: s.chatUrl, at: Date.now(), value };
  else if (lastGood && lastGood.url === s.chatUrl && Date.now() - lastGood.at < 15 * 60_000) value = lastGood.value;
  healthCache = { url: s.chatUrl, at: Date.now(), value };
  return value;
}

export const lumio = {
  status: (s: Settings) => serverCall<ServerStatus>(s, '/api/status'),
  folders: (s: Settings, type: 'movie' | 'tv') =>
    serverCall<{ folders: ServerFolder[]; default: string | null }>(s, `/api/arr/folders?type=${type}`),
  queue: (s: Settings) =>
    serverCall<{ records: (QueueItem & { source: 'radarr' | 'sonarr' })[]; errors: string[] }>(s, '/api/queue'),
  /** Admin : envoie la config Radarr / Sonarr au serveur (les clés restent sur le serveur). */
  pushArr: (s: Settings) =>
    serverCall<ServerStatus>(s, '/api/admin/arr', {
      method: 'POST',
      body: JSON.stringify({
        radarr: s.radarr.url && s.radarr.apiKey ? s.radarr : undefined,
        sonarr: s.sonarr.url && s.sonarr.apiKey ? s.sonarr : undefined,
      }),
    }).finally(() => {
      healthCache = null;
    }),
};

/** true quand Radarr ET Sonarr sont configurés sur le serveur Lumio (les clés n'ont alors plus rien à faire dans l'appli). */
export function useServerArr() {
  const { settings } = useSettings();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    serverHealth(settings).then((h) => alive && setOk(Boolean(h?.radarr && h?.sonarr)));
    return () => {
      alive = false;
    };
  }, [settings.chatUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  return ok;
}
