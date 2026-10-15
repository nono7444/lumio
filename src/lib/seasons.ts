// Périodes de l'année : sélections spéciales sur l'accueil + thème visuel (couleur, emoji).
import { useSettings } from './settings';

export type Season = {
  id: string;
  name: string;
  emoji: string;
  /** [mois, jour] inclusifs (mois 1-12) ; une période peut chevaucher le nouvel an */
  start: [number, number];
  end: [number, number];
  accent: string;
  tint: string;
  tagline: string;
  /** Genres TMDB pour « À découvrir » */
  tmdbGenres?: number[];
  /** Mot-clé TMDB (ex. Noël) */
  tmdbKeyword?: number;
  /** Repère les genres correspondants dans Jellyfin (noms selon la langue du serveur) */
  jfGenre?: RegExp;
  /** Ou une recherche par titre dans Jellyfin */
  jfSearch?: string[];
};

export const SEASONS: Season[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    emoji: '🎃',
    start: [10, 1],
    end: [11, 2],
    accent: '#FF7A1A',
    tint: 'rgba(255,122,26,0.16)',
    tagline: 'Frissons garantis',
    tmdbGenres: [27],
    jfGenre: /horr/i,
  },
  {
    id: 'noel',
    name: 'Noël',
    emoji: '🎄',
    start: [12, 1],
    end: [1, 6],
    accent: '#E5484D',
    tint: 'rgba(229,72,77,0.15)',
    tagline: 'La magie des fêtes',
    tmdbKeyword: 207317,
    jfSearch: ['Noël', 'Christmas', 'Santa', 'Grinch'],
  },
  {
    id: 'valentin',
    name: 'Saint-Valentin',
    emoji: '💘',
    start: [2, 1],
    end: [2, 15],
    accent: '#FF4D8D',
    tint: 'rgba(255,77,141,0.15)',
    tagline: 'Histoires d’amour',
    tmdbGenres: [10749],
    jfGenre: /romance/i,
  },
  {
    id: 'paques',
    name: 'Vacances de printemps',
    emoji: '🐣',
    start: [4, 1],
    end: [4, 30],
    accent: '#8BD450',
    tint: 'rgba(139,212,80,0.14)',
    tagline: 'À voir en famille',
    tmdbGenres: [10751],
    jfGenre: /famil/i,
  },
  {
    id: 'ete',
    name: 'Été',
    emoji: '☀️',
    start: [7, 1],
    end: [8, 31],
    accent: '#FFC53D',
    tint: 'rgba(255,197,61,0.14)',
    tagline: 'Aventures d’été',
    tmdbGenres: [12],
    jfGenre: /aventure|adventure/i,
  },
];

const md = (m: number, d: number) => m * 100 + d;

export function seasonAt(date = new Date()): Season | null {
  const now = md(date.getMonth() + 1, date.getDate());
  return (
    SEASONS.find((s) => {
      const a = md(...s.start);
      const b = md(...s.end);
      return a <= b ? now >= a && now <= b : now >= a || now <= b;
    }) ?? null
  );
}

/** Période active selon le réglage : 'auto' (date du jour), 'off', ou un thème forcé. */
export function useSeason(): Season | null {
  const { settings } = useSettings();
  const pref = settings.seasonTheme ?? 'auto';
  if (pref === 'off') return null;
  if (pref !== 'auto') return SEASONS.find((s) => s.id === pref) ?? null;
  return seasonAt();
}
