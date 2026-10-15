// Calendrier des sorties numériques à partir de l'addon « Digital Releases » (Releasio).
// L'addon n'a pas de champ date : la date est encodée dans l'URL de l'affiche (?d=JJ/MM/AA&st=…&n=…)
// et répétée dans la description (« Sortie numérique : disponible … (15 octobre 2026) »).
import { fetchManifest, type StremioMeta } from './stremio';

export const DEFAULT_CALENDAR_ADDON =
  'https://releasio-pearl.vercel.app/%7B%22posterSource%22%3A%22btttr%22%2C%22badge%22%3A%22bar%22%2C%22availability%22%3A%22all%22%2C%22titleMode%22%3A%22title%22%7D';

export type Release = StremioMeta & { date: Date; dayKey: string; kind: 'movie' | 'series' };

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date de sortie : paramètre `d` de l'affiche, sinon la date écrite dans la description. */
export function releaseDate(m: StremioMeta): Date | null {
  const fromPoster = m.poster?.match(/[?&]d=(\d{1,2})(?:%2F|\/)(\d{1,2})(?:%2F|\/)(\d{2,4})/i);
  if (fromPoster) {
    const [, dd, mm, yy] = fromPoster;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(year, Number(mm) - 1, Number(dd));
  }
  const fromText = m.description?.match(/\((\d{1,2})\s+([a-zéû]+)\s+(\d{4})\)/i);
  if (fromText) {
    const month = MONTHS.indexOf(fromText[2].toLowerCase());
    if (month >= 0) return new Date(Number(fromText[3]), month, Number(fromText[1]));
  }
  return null;
}

async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Toutes les sorties (films + séries) de l'addon, en suivant la pagination `skip`. */
export async function fetchReleases(addonBase: string, maxPerCatalog = 200): Promise<Release[]> {
  const base = addonBase.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
  const manifest = await fetchManifest(base);
  const out: Release[] = [];
  const seen = new Set<string>();

  await Promise.all(
    (manifest.catalogs ?? [])
      .filter((c) => c.type === 'movie' || c.type === 'series')
      .map(async (c) => {
        for (let skip = 0; skip < maxPerCatalog; ) {
          const path = skip ? `/catalog/${c.type}/${c.id}/skip=${skip}.json` : `/catalog/${c.type}/${c.id}.json`;
          let metas: StremioMeta[] = [];
          try {
            metas = (await getJson<{ metas?: StremioMeta[] }>(base + path)).metas ?? [];
          } catch {
            break;
          }
          if (!metas.length) break;
          for (const m of metas) {
            const date = releaseDate(m);
            const key = `${c.type}:${m.id}`;
            if (!date || seen.has(key)) continue;
            seen.add(key);
            out.push({ ...m, type: c.type, date, dayKey: dayKeyOf(date), kind: c.type as 'movie' | 'series' });
          }
          skip += metas.length;
          if (metas.length < 20) break;
        }
      })
  );

  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name));
}

export function dayLabel(d: Date) {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
