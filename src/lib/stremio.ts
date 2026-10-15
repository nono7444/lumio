// Client du protocole d'addons Stremio : catalogues + streams.
// Doc protocole : https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/protocol.md

export type StremioExtra = { name: string; isRequired?: boolean; options?: string[] };

export type StremioCatalog = {
  type: string; // 'movie' | 'series' | autre
  id: string;
  name?: string;
  extra?: StremioExtra[];
  extraRequired?: string[];
};

export type StremioResource = string | { name: string; types?: string[]; idPrefixes?: string[] };

export type StremioManifest = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  logo?: string;
  catalogs?: StremioCatalog[];
  resources?: StremioResource[];
  types?: string[];
  idPrefixes?: string[];
};

export type StremioStream = {
  url?: string;
  infoHash?: string;
  ytId?: string;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    filename?: string;
    videoSize?: number;
    bingeGroup?: string;
    proxyHeaders?: { request?: Record<string, string> };
  };
};

export type StremioMeta = {
  id: string; // tt1234567, tmdb:123, kitsu:… selon l'addon
  type: string;
  name: string;
  poster?: string;
  background?: string;
  releaseInfo?: string;
  year?: string | number;
  imdb_id?: string;
  moviedb_id?: number | string;
  description?: string;
};

/** Accepte stremio://, https://…/manifest.json, ou l'URL de base. */
export function normalizeAddonUrl(input: string): string {
  return addonUrlCandidates(input)[0];
}

/**
 * Toutes les URL de base plausibles pour ce que l'utilisateur a collé, dans l'ordre d'essai.
 * Couvre : stremio://, liens web.stremio.com (#/addons?addon=…), pages /configure,
 * URL encodées deux fois, query string après manifest.json, slash final…
 */
export function addonUrlCandidates(input: string): string[] {
  let url = input.trim().replace(/^["'<]+|["'>]+$/g, '');

  // Lien de partage Stremio Web : …#/addons?addon=<url encodée>
  const shared = url.match(/[?&]addon=([^&#]+)/);
  if (shared) {
    try {
      url = decodeURIComponent(shared[1]);
    } catch {}
  }
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const out: string[] = [];
  const push = (u: string) => {
    const clean = u.replace(/\/+$/, '');
    if (clean && !out.includes(clean)) out.push(clean);
  };

  const noManifest = url.replace(/\/manifest\.json(\?.*)?(#.*)?$/i, '');
  const noConfigure = noManifest.replace(/\/configure\/?(\?.*)?(#.*)?$/i, '');
  push(noConfigure);
  push(noManifest);
  // Config encodée deux fois (%257B…) : certains liens copiés la doublent
  if (/%25[0-9A-F]{2}/i.test(noConfigure)) {
    try {
      push(noConfigure.replace(/%25([0-9A-F]{2})/gi, '%$1'));
    } catch {}
  }
  // Dernier recours : l'origine seule
  try {
    push(new URL(noConfigure).origin);
  } catch {}
  return out;
}

/** Essaie chaque candidat et renvoie la première base dont le manifest répond. */
export async function resolveAddon(input: string): Promise<{ base: string; manifest: StremioManifest }> {
  const tried: string[] = [];
  let lastErr = '';
  for (const base of addonUrlCandidates(input)) {
    tried.push(`${base}/manifest.json`);
    try {
      const manifest = await getJson<StremioManifest>(`${base}/manifest.json`);
      if (manifest && typeof manifest === 'object' && (manifest.id || manifest.name)) {
        manifestCache.set(base, Promise.resolve(manifest));
        return { base, manifest };
      }
      lastErr = 'réponse qui n\u2019est pas un manifest';
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  throw new Error(`${lastErr}\n\nURL essayées :\n${tried.join('\n')}`);
}

const resourceName = (r: StremioResource) => (typeof r === 'string' ? r : r.name);

export function hasResource(m: StremioManifest, name: string) {
  return (m.resources ?? []).some((r) => resourceName(r) === name);
}

/** L'addon fournit-il des streams pour ce type et cet identifiant ? */
export function providesStreams(m: StremioManifest, type: string, id: string) {
  const res = (m.resources ?? []).find((r) => resourceName(r) === 'stream');
  if (!res) return false;
  const types = (typeof res === 'object' && res.types) || m.types || [];
  const prefixes = (typeof res === 'object' && res.idPrefixes) || m.idPrefixes;
  if (types.length && !types.includes(type)) return false;
  if (prefixes?.length && !prefixes.some((p) => id.startsWith(p))) return false;
  return true;
}

async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const manifestCache = new Map<string, Promise<StremioManifest>>();

export function fetchManifest(base: string): Promise<StremioManifest> {
  let p = manifestCache.get(base);
  if (!p) {
    p = getJson<StremioManifest>(`${base}/manifest.json`);
    p.catch(() => manifestCache.delete(base));
    manifestCache.set(base, p);
  }
  return p;
}

/** Un catalogue est affichable sur l'accueil s'il n'exige aucun paramètre (recherche, genre…). */
export function isBrowsable(c: StremioCatalog): boolean {
  if (c.extraRequired && c.extraRequired.length > 0) return false;
  if (c.extra?.some((e) => e.isRequired)) return false;
  return true;
}

export function catalogKey(c: Pick<StremioCatalog, 'type' | 'id'>) {
  return `${c.type}:${c.id}`;
}

export async function fetchCatalog(base: string, c: StremioCatalog): Promise<StremioMeta[]> {
  // Certains serveurs refusent l'id encodé (« : » → %3A) : on retente en brut sur 404
  const encoded = `${base}/catalog/${encodeURIComponent(c.type)}/${encodeURIComponent(c.id)}.json`;
  const raw = `${base}/catalog/${c.type}/${c.id}.json`;
  let data: { metas?: StremioMeta[] };
  try {
    data = await getJson(encoded);
  } catch (e) {
    if (raw === encoded) throw e;
    data = await getJson(raw);
  }
  return (data.metas ?? []).filter((m) => m && m.id && m.name);
}

/** Streams d'un addon. id : tt123 pour un film, tt123:1:2 pour S01E02. */
export async function fetchStreams(base: string, type: 'movie' | 'series', id: string): Promise<StremioStream[]> {
  const data = await getJson<{ streams?: StremioStream[] }>(`${base}/stream/${type}/${id}.json`, 25000);
  return data.streams ?? [];
}

export function metaYear(m: StremioMeta): number | undefined {
  const raw = m.year ?? m.releaseInfo;
  const match = raw != null ? String(raw).match(/\d{4}/) : null;
  return match ? Number(match[0]) : undefined;
}
