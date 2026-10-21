// Live TV : chaînes depuis des listes IPTV (M3U / Xtream Codes) ou des addons Stremio de type « tv ».
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LiveSource } from './settings';
import { getJson, resolveAddon, type StremioManifest } from './stremio';
import { serverCall } from './chat';
import type { Settings } from './settings';

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
export function parseM3u(text: string, sourceId: string, max = 40000): Channel[] {
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
      // Listes Xtream « m3u_plus » : on ne garde que le direct (pas les films / séries à la demande)
      if (info && /\/(movie|series)\//i.test(line)) {
        info = null;
        headers = {};
        continue;
      }
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

/** Lien « get.php » d'un compte Xtream Codes → serveur + identifiants (pour passer par son API, plus légère). */
function xtreamFrom(url: string): { server: string; user: string; pass: string } | null {
  try {
    const u = new URL(url);
    if (!/get\.php$/i.test(u.pathname)) return null;
    const user = u.searchParams.get('username');
    const pass = u.searchParams.get('password');
    if (!user || !pass) return null;
    return { server: `${u.protocol}//${u.host}`, user, pass };
  } catch {
    return null;
  }
}

async function loadXtream(src: LiveSource, x: { server: string; user: string; pass: string }): Promise<Channel[]> {
  const api = `${x.server}/player_api.php?username=${encodeURIComponent(x.user)}&password=${encodeURIComponent(x.pass)}`;
  const get = async <T,>(action: string): Promise<T> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(`${api}&action=${action}`, { signal: ctrl.signal, headers: { 'User-Agent': IPTV_UA } });
      if (!res.ok) throw new Error(`IPTV : HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('IPTV : délai dépassé');
      throw e;
    } finally {
      clearTimeout(t);
    }
  };
  const [cats, streams] = await Promise.all([
    get<{ category_id: string; category_name: string }[]>('get_live_categories'),
    get<{ name: string; stream_id: number; stream_icon?: string; category_id?: string }[]>('get_live_streams'),
  ]);
  if (!Array.isArray(streams)) throw new Error('Identifiants IPTV refusés (ou abonnement expiré)');
  const catName = new Map((Array.isArray(cats) ? cats : []).map((c) => [String(c.category_id), c.category_name]));
  const used = new Set<string>();
  return streams.map((st) => {
    const group = catName.get(String(st.category_id)) || undefined;
    let key = `${src.id}:${group ?? ''}:${st.name}`;
    for (let n = 2; used.has(key); n++) key = `${src.id}:${group ?? ''}:${st.name}#${n}`;
    used.add(key);
    return {
      key,
      sourceId: src.id,
      name: (st.name ?? '').trim() || 'Chaîne',
      logo: st.stream_icon || undefined,
      group,
      url: `${x.server}/live/${encodeURIComponent(x.user)}/${encodeURIComponent(x.pass)}/${st.stream_id}.ts`,
    };
  });
}

async function loadM3u(src: LiveSource): Promise<Channel[]> {
  // Compte Xtream : l'API ne renvoie que les chaînes en direct, avec leurs catégories
  const x = xtreamFrom(src.url);
  if (x) {
    try {
      const list = await loadXtream(src, x);
      if (list.length) return list;
    } catch {
      // repli sur la liste M3U
    }
  }
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
const cacheKey = (s: LiveSource) => `lumio-live:v2:${s.id}:${s.url}`;
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
// Beaucoup de serveurs IPTV refusent les lecteurs inconnus : on se présente comme VLC si l'addon ne précise rien
const IPTV_UA = 'VLC/3.0.20 LibVLC/3.0.20';
const withUa = (h?: Record<string, string>) =>
  h && Object.keys(h).some((k) => k.toLowerCase() === 'user-agent') ? h : { ...(h ?? {}), 'User-Agent': IPTV_UA };

export type LiveStream = { uri: string; headers?: Record<string, string>; label?: string };

/**
 * Liens de lecture d'une chaîne, du meilleur au moins bon. Pour un addon Stremio, toutes ses sources
 * (le lecteur passe à la suivante si l'une ne marche pas).
 */
export async function channelStreams(ch: Channel): Promise<LiveStream[]> {
  if (ch.url) return [{ uri: ch.url, headers: withUa(ch.headers) }];
  if (!ch.stremio) throw new Error('Chaîne sans lien');
  const { base, type, id } = ch.stremio;
  const encoded = `${base}/stream/${type}/${encodeURIComponent(id)}.json`;
  const raw = `${base}/stream/${type}/${id}.json`;
  let r: { streams?: Stream[] };
  try {
    r = await getJson<{ streams?: Stream[] }>(encoded, 20000);
    if (!r.streams?.length && raw !== encoded) r = await getJson<{ streams?: Stream[] }>(raw, 20000);
  } catch (e) {
    if (raw === encoded) throw e;
    r = await getJson<{ streams?: Stream[] }>(raw, 20000);
  }
  const seen = new Set<string>();
  const out: LiveStream[] = [];
  for (const s of r.streams ?? []) {
    if (!s.url || !/^https?:\/\//i.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    const h = s.behaviorHints?.proxyHeaders?.request;
    out.push({ uri: s.url, headers: withUa(h && Object.keys(h).length ? h : undefined), label: [s.name, s.title].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 80) || undefined });
  }
  if (!out.length) throw new Error('Aucun flux disponible pour cette chaîne');
  return out;
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

// ——— Classement des chaînes : pays / langue et thème, devinés depuis le groupe et le nom ———

export const COUNTRIES: Record<string, { label: string; flag: string }> = {
  FR: { label: 'France', flag: '🇫🇷' },
  BE: { label: 'Belgique', flag: '🇧🇪' },
  CH: { label: 'Suisse', flag: '🇨🇭' },
  CA: { label: 'Canada', flag: '🇨🇦' },
  AF: { label: 'Afrique', flag: '🌍' },
  UK: { label: 'Royaume-Uni', flag: '🇬🇧' },
  US: { label: 'États-Unis', flag: '🇺🇸' },
  DE: { label: 'Allemagne', flag: '🇩🇪' },
  ES: { label: 'Espagne', flag: '🇪🇸' },
  IT: { label: 'Italie', flag: '🇮🇹' },
  PT: { label: 'Portugal', flag: '🇵🇹' },
  NL: { label: 'Pays-Bas', flag: '🇳🇱' },
  TR: { label: 'Turquie', flag: '🇹🇷' },
  AR: { label: 'Arabe', flag: '🌙' },
  MA: { label: 'Maghreb', flag: '🌙' },
  PL: { label: 'Pologne', flag: '🇵🇱' },
  RO: { label: 'Roumanie', flag: '🇷🇴' },
  IN: { label: 'Inde', flag: '🇮🇳' },
  LAT: { label: 'Amérique latine', flag: '🌎' },
};
/** Chaînes en français : France, Belgique, Suisse, Québec, Afrique francophone. */
export const FRENCH = new Set(['FR', 'BE', 'CH', 'CA', 'AF']);

const CODE_ALIASES: Record<string, string> = {
  FR: 'FR', FRA: 'FR', FRANCE: 'FR', VF: 'FR', VOSTFR: 'FR', FRENCH: 'FR',
  BE: 'BE', BEL: 'BE', BELGIQUE: 'BE', BELGIUM: 'BE',
  CH: 'CH', SUI: 'CH', SUISSE: 'CH', SWISS: 'CH',
  CA: 'CA', CAN: 'CA', CANADA: 'CA', QC: 'CA', QUEBEC: 'CA', 'QUÉBEC': 'CA',
  AF: 'AF', AFR: 'AF', AFRIQUE: 'AF', AFRICA: 'AF',
  UK: 'UK', GB: 'UK', ENGLAND: 'UK', EN: 'UK',
  US: 'US', USA: 'US',
  DE: 'DE', GER: 'DE', GERMANY: 'DE', DEUTSCHLAND: 'DE', ALLEMAGNE: 'DE',
  ES: 'ES', SPA: 'ES', SPAIN: 'ES', ESPANA: 'ES', 'ESPAÑA': 'ES', ESPAGNE: 'ES',
  IT: 'IT', ITA: 'IT', ITALY: 'IT', ITALIA: 'IT', ITALIE: 'IT',
  PT: 'PT', POR: 'PT', PORTUGAL: 'PT', BR: 'PT', BRASIL: 'PT', BRAZIL: 'PT',
  NL: 'NL', NETHERLANDS: 'NL', HOLLAND: 'NL',
  TR: 'TR', TUR: 'TR', TURKEY: 'TR', TURKIYE: 'TR',
  AR: 'AR', ARAB: 'AR', ARABIC: 'AR', ARABE: 'AR',
  MA: 'MA', MAROC: 'MA', MAGHREB: 'MA', DZ: 'MA', ALGERIE: 'MA', TN: 'MA', TUNISIE: 'MA',
  PL: 'PL', POLAND: 'PL', RO: 'RO', ROMANIA: 'RO', IN: 'IN', INDIA: 'IN',
  LATINO: 'LAT', LATAM: 'LAT', MX: 'LAT', MEXICO: 'LAT',
};

/** Pays / langue d'une chaîne (« FR| SPORTS », « |FR| BEIN », « FRANCE HD »…), ou undefined. */
export function countryOf(ch: Channel): string | undefined {
  for (const text of [ch.group, ch.name]) {
    if (!text) continue;
    const up = text.toUpperCase();
    // Préfixe « FR| », « |FR| », « [FR] », « FR: », « FR - »
    const m = up.match(/^[\s|\[(*#]*([A-ZÉÑ]{2,10})\s*[|\])\]:\-–]/);
    if (m && CODE_ALIASES[m[1]]) return CODE_ALIASES[m[1]];
    // Premier mot court (« UK SPORTS », « FR CINEMA »)
    const first = up.trim().split(/[^A-ZÉÑ]+/)[0];
    if (first && first.length <= 3 && CODE_ALIASES[first]) return CODE_ALIASES[first];
    // Mot entier n'importe où (« CANAL+ FRANCE », « UK SPORTS »)
    for (const w of up.split(/[^A-ZÉÑ]+/)) if (w.length >= 3 && CODE_ALIASES[w]) return CODE_ALIASES[w];
  }
  return undefined;
}

export type Theme = 'sport' | 'info' | 'cinema' | 'kids' | 'docs' | 'music' | 'general';
export const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'sport', label: 'Sport', icon: 'football' },
  { id: 'info', label: 'Info', icon: 'newspaper' },
  { id: 'cinema', label: 'Cinéma & séries', icon: 'film' },
  { id: 'kids', label: 'Enfants', icon: 'happy' },
  { id: 'docs', label: 'Documentaires', icon: 'earth' },
  { id: 'music', label: 'Musique', icon: 'musical-notes' },
  { id: 'general', label: 'Généralistes', icon: 'tv' },
];

const THEME_RULES: [Theme, RegExp][] = [
  ['general', /g[eé]n[eé]ral|nationales?|\btnt\b|hertzien|chaines? fran/i],
  ['sport', /sport|foot|soccer|bein|rmc ?sport|eurosport|dazn|espn|sky ?sport|golf|tennis|nba|nfl|nhl|\bf1\b|formula|moto ?gp|ufc|boxe|boxing|rugby|ligue ?1|ligue des champions|premier league|equipe|l'équipe|infosport|canal\+ ?(foot|sport)|automoto|ppv|wwe|cyclisme|handball|basket|match/i],
  ['info', /\binfo|news|bfm|cnews|lci|euronews|france ?24|tv5|al ?jazeera|cnn|bbc news|sky news|public sénat|lcp|actualit/i],
  ['kids', /enfant|kids|jeunesse|junior|disney|cartoon|nick|gulli|boomerang|tiji|piwi|canal ?j|baby|toon|teletoon|mangas|manga|anime/i],
  ['docs', /docu|discovery|national geographic|nat ?geo|histoire|history|ushua|planete|planète|animaux|animal|science|voyage|travel|seasons|chasse|pêche|museum|toute l'histoire|rmc d[eé]couverte|investigation|crime/i],
  ['music', /musi|mtv|mezzo|trace|m6 music|nrj ?hits|mcm|clubbing|radio|melody/i],
  ['cinema', /cin[eé]|film|movie|ocs|paramount|tcm|action|polar|thriller|s[eé]ries?|novela|hbo|warner|sundance|frisson|comedie|com[eé]die|tf1 s[eé]ries|syfy|13e ?rue|ab ?1|rtl ?9|serie club|netflix|prime|ciné\+/i],
];

/** Thème d'une chaîne d'après son groupe, puis son nom. Par défaut : généraliste. */
export function themeOf(ch: Channel): Theme {
  for (const text of [ch.group, ch.name]) {
    if (!text) continue;
    for (const [t, re] of THEME_RULES) if (re.test(text)) return t;
  }
  return 'general';
}

// ——— Lumio TV : les sources sont envoyées au serveur Lumio (sur ton compte), la TV les lit de là ———
let lastSynced = '';
export function syncLiveSources(s: Settings) {
  if (!s.chatUrl || !s.jellyfin) return;
  const body = JSON.stringify({ sources: s.liveSources });
  if (body === lastSynced) return;
  serverCall(s, '/api/live/sources', { method: 'PUT', body })
    .then(() => {
      lastSynced = body;
    })
    .catch(() => {});
}
