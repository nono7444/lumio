// Calendrier : radar des sorties VOD d'amtVOD (amtvod.fr), lu par le serveur Lumio (GET /api/radar).
import { serverCall } from './chat';
import type { Settings } from './settings';

export type RadarStatus = 'available' | 'confirmed' | 'cinema' | 'other';
export type RadarItem = {
  id: string;
  type: 'movie' | 'tv';
  tmdbId: number | null;
  name: string;
  poster: string | null;
  background: string | null;
  releaseInfo: string | null;
  description: string | null;
  genres: string[];
  badges: string[];
};
export type RadarSection = { id: string; name: string; status: RadarStatus; items: RadarItem[]; error?: string };
export type Radar = { at: string; source: string; sections: RadarSection[]; error: string | null };

export const radarApi = {
  get: (s: Settings, refresh = false) => serverCall<Radar>(s, `/api/radar${refresh ? '?refresh=1' : ''}`),
};

export const RADAR_STATUS: Record<RadarStatus, { label: string; color: string }> = {
  available: { label: 'Disponible en VOD', color: '#30D158' },
  confirmed: { label: 'Sortie VOD confirmée', color: '#FF9F0A' },
  cinema: { label: 'Au cinéma', color: '#FF453A' },
  other: { label: 'Autres', color: '#8E8E93' },
};
