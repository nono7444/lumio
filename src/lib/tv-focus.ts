// TV : ce qui est sélectionné à la télécommande, pour l'image de fond de l'accueil (façon Nuvio).
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { jfBackdrop, jfLogo, type JfItem } from './jellyfin';
import type { Settings } from './settings';

export type TvFocusInfo = {
  key: string;
  title: string;
  backdrop?: string;
  logo?: string | null;
  meta?: string;
  overview?: string;
};

let current: TvFocusInfo | null = null;
const listeners = new Set<(i: TvFocusInfo | null) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Annonce l'élément sélectionné (avec un petit délai : on ne change pas l'image à chaque affiche survolée en vitesse). */
export function setTvFocus(info: TvFocusInfo | null, delay = 160) {
  if (!Platform.isTV) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (current?.key === info?.key) return;
    current = info;
    listeners.forEach((l) => l(info));
  }, delay);
}

export function useTvFocus(initial?: TvFocusInfo | null) {
  const [info, setInfo] = useState<TvFocusInfo | null>(current ?? initial ?? null);
  useEffect(() => {
    listeners.add(setInfo);
    return () => {
      listeners.delete(setInfo);
    };
  }, []);
  useEffect(() => {
    if (!current && initial) setInfo(initial);
  }, [initial]);
  return info;
}

/** Infos d'un titre Jellyfin pour le fond TV. */
export function tvInfoFromJf(s: Settings, i: JfItem): TvFocusInfo {
  const kind = i.Type === 'Movie' ? 'Film' : i.Type === 'Series' ? 'Série' : i.Type === 'Episode' ? 'Épisode' : '';
  return {
    key: i.Id,
    title: i.Type === 'Episode' && i.SeriesName ? i.SeriesName : i.Name,
    backdrop: jfBackdrop(s, i),
    logo: jfLogo(s, i),
    meta: [kind, i.ProductionYear, i.CommunityRating ? `★ ${i.CommunityRating.toFixed(1)}` : null, ...(i.Genres ?? []).slice(0, 2)]
      .filter(Boolean)
      .join('  ·  '),
    overview: i.Overview,
  };
}
