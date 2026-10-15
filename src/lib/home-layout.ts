// Rangées de l'accueil et onglets : ordre et visibilité personnalisables.
import { useEffect, useState } from 'react';

import { jf, type JfItem } from './jellyfin';
import { useSeason } from './seasons';
import { hasTmdb, useSettings, type Addon, type HomeRow, type Settings, type TabPref } from './settings';
import { catalogKey, fetchManifest, isBrowsable, type StremioCatalog } from './stremio';

export type RowKind = 'hero' | 'season-jf' | 'season-tmdb' | 'continue' | 'nextup' | 'favorites' | 'trending' | 'jf-latest' | 'catalog';

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

/** Par défaut, l'accueil montre le hero, les sélections de saison et les derniers ajouts Jellyfin. */
const HIDDEN_BY_DEFAULT: RowKind[] = ['continue', 'nextup', 'favorites', 'catalog', 'trending'];

export function useAvailableRows(nonce = 0) {
  const { settings } = useSettings();
  const season = useSeason();
  const [rows, setRows] = useState<RowDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: RowDef[] = [];
      if (hasTmdb(settings) || settings.jellyfin) out.push({ id: 'hero', label: 'À la une', kind: 'hero' });

      // Sélections de la période en cours (Halloween, Noël…)
      if (season) {
        if (settings.jellyfin) out.push({ id: 'season-jf', label: `${season.emoji} ${season.name} · Sur ton serveur`, kind: 'season-jf' });
        if (hasTmdb(settings)) out.push({ id: 'season-tmdb', label: `${season.emoji} ${season.name} · À découvrir`, kind: 'season-tmdb' });
      }

      if (settings.jellyfin) {
        const views = await jf.views(settings).catch(() => [] as JfItem[]);
        for (const v of views)
          out.push({
            id: `jf-latest:${v.Id}`,
            label: `Derniers ajouts · ${v.Name || VIEW_LABEL[v.CollectionType ?? '']}`,
            kind: 'jf-latest',
            view: v,
          });
        out.push({ id: 'continue', label: 'Reprendre', kind: 'continue' });
        out.push({ id: 'nextup', label: 'À suivre', kind: 'nextup' });
        out.push({ id: 'favorites', label: 'Favoris Jellyfin', kind: 'favorites' });
      }

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
  }, [settings.addons, settings.jellyfin?.token, settings.tmdbKey, season?.id, nonce]);

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
  calendar: 'Calendrier',
  chat: 'Chat',
  activity: 'Activité',
  settings: 'Profil',
};

/** Onglets déplaçables / masquables (Accueil et Profil restent toujours visibles). */
export const MOVABLE_TABS = ['search', 'library', 'calendar', 'chat', 'activity'];

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

// ——— Rangées de l'onglet Bibliothèque ———

export type LibraryRowDef = { id: string; label: string; view?: JfItem };

export function libraryRowDefs(views: JfItem[]): LibraryRowDef[] {
  return [
    { id: 'libs', label: 'Mes bibliothèques (raccourcis)' },
    { id: 'continue', label: 'Reprendre' },
    { id: 'nextup', label: 'À suivre' },
    { id: 'favorites', label: 'Favoris' },
    ...views.map((v) => ({
      id: `latest:${v.Id}`,
      label: `Ajouts récents · ${VIEW_LABEL[v.CollectionType ?? ''] ?? v.Name}`,
      view: v,
    })),
  ];
}

/** Ordre et visibilité de la Bibliothèque (tout est visible par défaut). */
export function orderLibraryRows<T extends { id: string }>(defs: T[], layout: HomeRow[]): (T & { hidden: boolean })[] {
  const pos = new Map(layout.map((r, i) => [r.id, i]));
  const hidden = new Map(layout.map((r) => [r.id, Boolean(r.hidden)]));
  return defs
    .map((d, i) => ({ ...d, hidden: hidden.get(d.id) ?? false, order: pos.has(d.id) ? pos.get(d.id)! : 10_000 + i }))
    .sort((a, b) => a.order - b.order);
}
