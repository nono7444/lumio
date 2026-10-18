// Bandes-annonces de l'iTunes Store (France) : liens vidéo directs d'Apple, souvent en français,
// lus tout de suite par mpv sans passer par YouTube.
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'et')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Hit = { trackName?: string; collectionName?: string; releaseDate?: string; previewUrl?: string };

const cache = new Map<string, string | null>();

export async function itunesTrailer(type: 'movie' | 'tv', title: string, year?: number | string | null): Promise<string | null> {
  if (!title) return null;
  const y = year ? Number(String(year).slice(0, 4)) : null;
  const ck = `${type}:${title}:${y ?? ''}`;
  if (cache.has(ck)) return cache.get(ck) ?? null;
  const q = new URLSearchParams({
    term: title,
    country: 'FR',
    lang: 'fr_fr',
    limit: '15',
    ...(type === 'movie' ? { media: 'movie', entity: 'movie' } : { media: 'tvShow', entity: 'tvSeason' }),
  });
  let found: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://itunes.apple.com/search?${q}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const hits: Hit[] = ((await res.json())?.results ?? []).filter((h: Hit) => h.previewUrl);
      const want = norm(title);
      const nameOf = (h: Hit) => norm(type === 'movie' ? (h.trackName ?? '') : (h.collectionName ?? '').replace(/,?\s*(saison|season)\s*\d+.*$/i, ''));
      const yearOf = (h: Hit) => (h.releaseDate ? Number(h.releaseDate.slice(0, 4)) : null);
      const score = (h: Hit) => {
        const n = nameOf(h);
        const yy = yearOf(h);
        let sc = n === want ? 10 : n.startsWith(want) || want.startsWith(n) ? 5 : 0;
        if (!sc) return 0;
        // Film : l'année doit coller (remakes) ; série : la première saison d'abord
        if (y && yy) sc += Math.abs(yy - y) <= 1 ? 5 : type === 'movie' ? -20 : 0;
        if (type === 'tv' && /(saison|season)\s*1\b/i.test(h.collectionName ?? '')) sc += 2;
        return sc;
      };
      const best = hits.map((h) => ({ h, s: score(h) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
      found = best?.h.previewUrl ?? null;
    }
  } catch {
    found = null;
  }
  cache.set(ck, found);
  return found;
}
