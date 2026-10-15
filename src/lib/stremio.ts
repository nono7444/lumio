// Client minimal du protocole d'addons Stremio (catalogues uniquement).
// Doc protocole : https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/protocol.md

export type StremioExtra = { name: string; isRequired?: boolean; options?: string[] };

export type StremioCatalog = {
  type: string; // 'movie' | 'series' | autre
  id: string;
  name?: string;
  extra?: StremioExtra[];
  extraRequired?: string[];
};

export type StremioManifest = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  logo?: string;
  catalogs?: StremioCatalog[];
  types?: string[];
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
  let url = input.trim();
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/\/manifest\.json(\?.*)?$/i, '');
  return url.replace(/\/+$/, '');
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
  const url = `${base}/catalog/${encodeURIComponent(c.type)}/${encodeURIComponent(c.id)}.json`;
  const data = await getJson<{ metas?: StremioMeta[] }>(url);
  return (data.metas ?? []).filter((m) => m && m.id && m.name);
}

export function metaYear(m: StremioMeta): number | undefined {
  const raw = m.year ?? m.releaseInfo;
  const match = raw != null ? String(raw).match(/\d{4}/) : null;
  return match ? Number(match[0]) : undefined;
}
