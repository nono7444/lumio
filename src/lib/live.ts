// Live TV : chaînes depuis des listes IPTV (M3U / Xtream Codes) ou des addons Stremio de type « tv ».
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LiveSource } from './settings';
import { getJson, resolveAddon, type StremioManifest } from './stremio';

export type Channel = {
  /** Clé unique « source:id » (favoris) */
  key: string;
  sourceId: string;
  name: string;
  logo?: string;
  group?: string;
  /** Lien direct (M3U) */
  url?: string;
  headers?: Record<string, string>;
  /** Chaîne d'un addon Stremio : le lien est demandé au moment de la lecture */
  stremio?: { base: string; type: string; id: string };
};

export const newSourceId = () => `src-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Lien M3U d'un compte Xtream Codes (serveur + identifiant + mot de passe). */
export function xtreamM3u(server: string, user: string, pass: string) {
  let base = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return `${base}/get.php?username=${encodeURIComponent(user.trim())}&password=${encodeURIComponent(pass.trim())}&type=m3u_plus&output=ts`;
}

const attr = (line: string, name: string) => {
  const m = line.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1].trim() : undefined;
};

/** Lit une liste M3U étendue (#EXTINF + options #EXTVLCOPT pour l'user-agent / referer). */
export function parseM3u(text: string, sourceId: string, max = 30000): Channel[] {
  const out: Channel[] = [];
  let info: { name: string; logo?: string; group?: string; id?: string } | null = null;
  let headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  const used = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const name = (comma >= 0 ? line.slice(comma + 1) : '').trim() || attr(line, 'tvg-name') || 'Chaîne';
      info = { name, logo: attr(line, 'tvg-logo') || undefined, group: attr(line, 'group-title') || undefined, id: attr(line, 'tvg-id') };
      headers = {};
    } else if (line.startsWith('#EXTVLCOPT:')) {
      const [k, ...v] = line.slice(11).split('=');
      const val = v.join('=');
      if (/http-user-agent/i.test(k)) headers['User-Agent'] = val;
      if (/http-referr?er/i.test(k)) headers.Referer = val;
    } else if (line.startsWith('#EXTGRP:') && info && !info.group) {
      info.group = line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      if (info) {
        let key = `${sourceId}:${info.group ?? ''}:${info.name}`;
        for (let n = 2; used.has(key); n++) key = `${sourceId}:${info.group ?? ''}:${info.name}#${n}`;
        used.add(key);
        out.push({
          key,
          sourceId,
          name: info.name,
          logo: info.logo,
          group: info.group,
          url: line,
          headers: Object.keys(headers).length ? headers : undefined,
        });
        if (out.length >= max) break;
      }
      info = null;
      headers = {};
    }
  }
  return out;
}

async function loadM3u(src: LiveSource): Promise<Channel[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(src.url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Liste IPTV : HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('#EXTINF')) throw new Error('Ce lien ne renvoie pas une liste M3U');
    return parseM3u(text, src.id);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Liste IPTV : délai dépassé');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

type Meta = { id: string; name: string; poster?: string; logo?: string; genres?: string[] };

async function loadStremio(src: LiveSource): Promise<Channel[]> {
  const { base, manifest } = await resolveAddon(src.url);
  const cats = (manifest.catalogs ?? []).filter(
    (c) => (c.type === 'tv' || c.type === 'channel') && !(c.extra ?? []).some((e) => e.isRequired) && !(c.extraRequired ?? []).length
  );
  if (!cats.length) throw new Error(`${manifest.name} : aucun catalogue de chaînes (type « tv »)`);
  const lists = await Promise.all(
    cats.map((c) =>
      getJson<{ metas?: Meta[] }>(`${base}/catalog/${c.type}/${encodeURIComponent(c.id)}.json`)
        .then((r) => (r.metas ?? []).map((m) => ({ m, c })))
        .catch(() => [])
    )
  );
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const { m, c } of lists.flat()) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      key: `${src.id}:${m.id}`,
      sourceId: src.id,
      name: m.name,
      logo: m.logo || m.poster,
      group: m.genres?.[0] || c.name || manifest.name,
      stremio: { base, type: c.type, id: m.id },
    });
  }
  return out;
}

const CACHE_MS = 6 * 3600_000;
const cacheKey = (s: LiveSource) => `lumio-live:${s.id}:${s.url}`;
const memory = new Map<string, { at: number; channels: Channel[] }>();

/** Chaînes d'une source (mises en cache 6 h, sur le téléphone). */
export async function loadChannels(src: LiveSource, force = false): Promise<Channel[]> {
  const key = cacheKey(src);
  if (!force) {
    const m = memory.get(key);
    if (m && Date.now() - m.at < CACHE_MS) return m.channels;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const c = JSON.parse(raw) as { at: number; channels: Channel[] };
        if (Date.now() - c.at < CACHE_MS) {
          memory.set(key, c);
          return c.channels;
        }
      }
    } catch {}
  }
  const channels = src.kind === 'stremio' ? await loadStremio(src) : await loadM3u(src);
  const entry = { at: Date.now(), channels };
  memory.set(key, entry);
  AsyncStorage.setItem(key, JSON.stringify(entry)).catch(() => {});
  return channels;
}

export function forgetChannels(src: LiveSource) {
  memory.delete(cacheKey(src));
  AsyncStorage.removeItem(cacheKey(src)).catch(() => {});
}

type Stream = { url?: string; name?: string; title?: string; behaviorHints?: { proxyHeaders?: { request?: Record<string, string> } } };

/** Lien de lecture d'une chaîne (pour un addon Stremio, demandé à l'addon). */
export async function channelStream(ch: Channel): Promise<{ uri: string; headers?: Record<string, string> }> {
  if (ch.url) return { uri: ch.url, headers: ch.headers };
  if (!ch.stremio) throw new Error('Chaîne sans lien');
  const { base, type, id } = ch.stremio;
  const r = await getJson<{ streams?: Stream[] }>(`${base}/stream/${type}/${encodeURIComponent(id)}.json`, 20000);
  const s = (r.streams ?? []).find((x) => x.url);
  if (!s?.url) throw new Error('Aucun flux disponible pour cette chaîne');
  return { uri: s.url, headers: s.behaviorHints?.proxyHeaders?.request };
}

/** Vérifie une source avant de l'ajouter ; renvoie son nom et le nombre de chaînes. */
export async function probeSource(src: LiveSource): Promise<{ name?: string; count: number }> {
  if (src.kind === 'stremio') {
    const { manifest } = await resolveAddon(src.url);
    const ch = await loadStremio(src);
    return { name: (manifest as StremioManifest).name, count: ch.length };
  }
  const ch = await loadChannels(src, true);
  return { count: ch.length };
}
