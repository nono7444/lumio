// « Prochaine soirée cinéma » : recommandations calculées sur le téléphone, à partir de ce que tu as regardé.
// Rien ne part sur Internet : on lit l'historique Jellyfin, on en déduit tes genres préférés,
// puis on note les films pas encore vus de la bibliothèque (genres, note, récence).
import { jf, type JfItem } from './jellyfin';
import type { Settings } from './settings';

export type Reco = { items: JfItem[]; because: string[] };

let cache: { key: string; at: number; value: Reco } | null = null;

/** Petit générateur pseudo-aléatoire stable sur la journée : la sélection change chaque jour, pas à chaque ouverture. */
function seeded(seed: number) {
  let x = seed % 2147483647 || 1;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
}

export async function nextMovieNight(s: Settings): Promise<Reco> {
  const key = `${s.jellyfin?.url}|${s.jellyfin?.userId}`;
  if (cache && cache.key === key && Date.now() - cache.at < 30 * 60_000) return cache.value;

  const [played, resume, favorites, candidates] = await Promise.all([
    jf.items(s, { types: 'Movie,Series', filters: 'IsPlayed', sort: 'DatePlayed', order: 'Descending', limit: 80 }).then((r) => r.Items).catch(() => []),
    jf.resume(s).catch(() => [] as JfItem[]),
    jf.favorites(s).catch(() => [] as JfItem[]),
    jf.items(s, { types: 'Movie', filters: 'IsUnplayed', sort: 'Random', order: 'Ascending', limit: 500 }).then((r) => r.Items).catch(() => []),
  ]);

  // Goûts : chaque genre regardé compte, les plus récents davantage, les favoris double
  const taste = new Map<string, number>();
  const add = (items: JfItem[], weight: (i: number) => number) =>
    items.forEach((it, i) => (it.Genres ?? []).forEach((g) => taste.set(g, (taste.get(g) ?? 0) + weight(i))));
  add(played, (i) => 1 / (1 + i / 15));
  add(resume, () => 0.8);
  add(favorites, () => 2);
  const total = [...taste.values()].reduce((a, b) => a + b, 0) || 1;

  const year = new Date().getFullYear();
  const inProgress = new Set(resume.map((r) => r.Id));
  const scored = candidates
    .filter((c) => !inProgress.has(c.Id))
    .map((c) => {
      const genres = c.Genres ?? [];
      const affinity = genres.reduce((n, g) => n + (taste.get(g) ?? 0), 0) / total;
      const rating = (c.CommunityRating ?? 6) / 10;
      const recent = c.ProductionYear && c.ProductionYear >= year - 3 ? 0.15 : 0;
      return { c, score: affinity * 3 + rating * 0.8 + recent };
    })
    .sort((a, b) => b.score - a.score);

  // On garde les 40 meilleurs puis on en tire 15, différents chaque jour
  const today = Math.floor(Date.now() / 86_400_000);
  const rnd = seeded(today);
  const pool = scored.slice(0, 40).map((x) => ({ ...x, r: x.score + rnd() * 0.35 }));
  const items = pool.sort((a, b) => b.r - a.r).slice(0, 15).map((x) => x.c);

  const because = [...taste.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
  const value = { items, because };
  cache = { key, at: Date.now(), value };
  return value;
}
