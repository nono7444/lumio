// Recherche tolérante aux fautes : si TMDB ne trouve rien de proche (« intersteler », « harri poter »), d'autres recherches
// sont lancées avec le début des mots, puis les titres sont classés par ressemblance avec ce qui a été tapé.
import { tmdb, type MediaType, type TmdbItem } from './tmdb';
import type { Settings } from './settings';

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** Ressemblance de deux textes (0 à 1) : paires de lettres en commun (indice de Dice), insensible aux accents et aux espaces. */
function similar(a: string, b: string) {
  const x = norm(a).replace(/ /g, '');
  const y = norm(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.startsWith(x) || x.startsWith(y)) return 0.9 * Math.min(x.length, y.length) / Math.max(x.length, y.length) + 0.1;
  const pairs = (t: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const px = pairs(x);
  const py = pairs(y);
  let inter = 0;
  for (const [k, n] of px) inter += Math.min(n, py.get(k) ?? 0);
  return (2 * inter) / (x.length - 1 + y.length - 1 || 1);
}
/** Ressemblance avec le titre entier, ou avec ses premiers mots (« harri poter » ≈ « Harry Potter à l'école des sorciers »). */
function titleScore(q: string, i: TmdbItem) {
  const n = norm(q).split(' ').length;
  const head = (t: string) => norm(t).split(' ').slice(0, n).join(' ');
  return Math.max(...[i.title ?? i.name ?? '', i.original_title ?? i.original_name ?? ''].flatMap((t) => [similar(q, t), similar(q, head(t)) * 0.95]));
}

/** Recherches de secours : début de chaque mot (TMDB complète les mots), mots longs un par un. */
function variants(q: string) {
  const words = norm(q).split(' ').filter(Boolean);
  const cut = (w: string) => (w.length <= 3 ? w : w.slice(0, Math.max(3, Math.ceil(w.length * 0.55))));
  const out = new Set<string>();
  out.add(words.map(cut).join(' '));
  for (const w of words.filter((w) => w.length >= 5).sort((a, b) => b.length - a.length).slice(0, 2)) out.add(cut(w));
  // Lettre doublée ou oubliée : « harri » → « hari », « poter » → « potter » couvert par le début du mot
  out.add(words.map((w) => w.replace(/(.)\1+/g, '$1')).join(' '));
  out.delete(norm(q));
  return [...out].filter((v) => v.length >= 3).slice(0, 4);
}

export type SmartResult = { results: TmdbItem[]; corrected: string | null };

/** Recherche TMDB, avec correction des fautes quand rien de proche n'est trouvé. */
export async function smartSearch(s: Settings, q: string, filter: 'all' | MediaType): Promise<SmartResult> {
  const run = (query: string) =>
    filter === 'all'
      ? tmdb.search(s, query).then((r) => r.results)
      : tmdb.searchType(s, filter, query).then((r) => r.results.map((i) => ({ ...i, media_type: filter })));
  const first = await run(q);
  const best = first.reduce((m, i) => Math.max(m, titleScore(q, i)), 0);
  if (norm(q).length < 4 || (first.length >= 3 && best >= 0.7)) return { results: first, corrected: null };
  const more = (await Promise.all(variants(q).map((v) => run(v).catch(() => [] as TmdbItem[])))).flat();
  const seen = new Set<string>();
  const all: { i: TmdbItem; score: number }[] = [];
  for (const i of [...first, ...more]) {
    const k = `${i.media_type}:${i.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const score = titleScore(q, i) + Math.min(0.15, Math.log10(1 + (i.popularity ?? 0)) / 20);
    all.push({ i, score });
  }
  const kept = all.filter((x) => x.score >= 0.4 || first.includes(x.i)).sort((a, b) => b.score - a.score);
  const top = kept[0];
  const topTitle = top ? top.i.title ?? top.i.name ?? '' : '';
  const corrected = top && !first.slice(0, 3).includes(top.i) && norm(topTitle) !== norm(q) ? topTitle : null;
  return { results: kept.map((x) => x.i), corrected };
}
