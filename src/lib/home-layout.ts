// Rangées de l'accueil et onglets : ordre et visibilité personnalisables.
import { useEffect, useState } from 'react';

import { jf, type JfItem } from './jellyfin';
import { hasTmdb, useSettings, type Addon, type HomeRow, type Settings, type TabPref } from './settings';
import { catalogKey, fetchManifest, isBrowsable, type StremioCatalog } from './stremio';

export type RowKind = 'hero' | 'continue' | 'nextup' | 'favorites' | 'trending' | 'jf-latest' | 'catalog';

export type RowDef = {
  id: string;
  label: string;
  kind: RowKind;
  addon?: Addon;
  catalog?: StremioCatalog;
  view?: JfItem;
};

const TYPE_LABEL: Record<string, string> = { movie: 'Films', series: 'Séries' };
const VIEW_LABEL: Record<string, string> = { movies: 'Films', tvshows: 'Séries', boxsets: 'Collections' };

/** Rangées masquées tant que l'utilisateur ne les a pas activées. */
const HIDDEN_BY_DEFAULT: RowKind[] = ['favorites', 'jf-latest'];

export function useAvailableRows(nonce = 0) {
  const { settings } = useSettings();
  const [rows, setRows] = useState<RowDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: RowDef[] = [];
      if (hasTmdb(settings)) out.push({ id: 'hero', label: 'À la une (TMDB)', kind: 'hero' });
      if (settings.jellyfin) out.push({ id: 'continue', label: 'Reprendre', kind: 'continue' });

      const manifests = await Promise.all(settings.addons.map((a) => fetchManifest(a.base).catch(() => null)));
      settings.addons.forEach((addon, i) => {
        const m = manifests[i];
        if (!m) return;
        for (const c of (m.catalogs ?? []).filter(isBrowsable)) {
          if (addon.hidden?.includes(catalogKey(c))) continue;
          out.push({
            id: `catalog:${addon.base}|${catalogKey(c)}`,
            label: `${c.name || c.id} · ${TYPE_LABEL[c.type] ?? c.type} (${addon.name})`,
            kind: 'catalog',
            addon,
            catalog: c,
          });
        }
      });

      if (settings.jellyfin) {
        out.push({ id: 'nextup', label: 'À suivre', kind: 'nextup' });
        out.push({ id: 'favorites', label: 'Favoris Jellyfin', kind: 'favorites' });
        const views = await jf.views(settings).catch(() => [] as JfItem[]);
        for (const v of views)
          out.push({
            id: `jf-latest:${v.Id}`,
            label: `Ajouts récents · ${VIEW_LABEL[v.CollectionType ?? ''] ?? v.Name}`,
            kind: 'jf-latest',
            view: v,
          });
      }
      if (hasTmdb(settings)) out.push({ id: 'trending', label: 'Tendances de la semaine', kind: 'trending' });
      if (alive) {
        setRows(out);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.addons, settings.jellyfin?.token, settings.tmdbKey, nonce]);

  return { rows, loading };
}

/** Applique l'ordre et la visibilité choisis ; les nouvelles rangées arrivent à la fin. */
export function orderRows(available: RowDef[], layout: HomeRow[]): (RowDef & { hidden: boolean })[] {
  const pos = new Map(layout.map((r, i) => [r.id, i]));
  const hiddenPref = new Map(layout.map((r) => [r.id, Boolean(r.hidden)]));
  return available
    .map((r, i) => ({
      ...r,
      hidden: hiddenPref.has(r.id) ? hiddenPref.get(r.id)! : HIDDEN_BY_DEFAULT.includes(r.kind),
      order: pos.has(r.id) ? pos.get(r.id)! : 10_000 + i,
    }))
    .sort((a, b) => a.order - b.order);
}

// ——— Onglets ———

export const TAB_LABELS: Record<string, string> = {
  index: 'Accueil',
  search: 'Recherche',
  library: 'Bibliothèque',
  activity: 'Activité',
  settings: 'Profil',
};

/** Onglets déplaçables / masquables (Accueil et Profil restent toujours visibles). */
export const MOVABLE_TABS = ['search', 'library', 'activity'];

export function orderTabs(names: string[], prefs: TabPref[]) {
  const pos = new Map(prefs.map((t, i) => [t.name, i]));
  const hidden = new Set(prefs.filter((t) => t.hidden && MOVABLE_TABS.includes(t.name)).map((t) => t.name));
  const middle = names
    .filter((n) => n !== 'index' && n !== 'settings' && !hidden.has(n))
    .sort((a, b) => (pos.get(a) ?? 100) - (pos.get(b) ?? 100));
  // Accueil toujours en premier, Profil toujours en dernier
  return [...names.filter((n) => n === 'index'), ...middle, ...names.filter((n) => n === 'settings')];
}

export function currentTabPrefs(s: Settings): TabPref[] {
  const known = new Map(s.tabsLayout.map((t) => [t.name, t]));
  const ordered = s.tabsLayout.filter((t) => MOVABLE_TABS.includes(t.name));
  for (const n of MOVABLE_TABS) if (!known.has(n)) ordered.push({ name: n });
  return ordered;
}
