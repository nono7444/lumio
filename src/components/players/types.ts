import type { ReactNode } from 'react';

export type PlayerProps = {
  uri: string;
  headers?: Record<string, string>;
  isHls?: boolean;
  title?: string;
  subtitle?: string;
  /** Position de départ en secondes (reprise) */
  startAt: number;
  /** Appelé régulièrement : position courante et état pause */
  onTime: (positionSeconds: number, paused: boolean) => void;
  onReady: (positionSeconds: number) => void;
  onError: (message: string) => void;
  onClose: () => void;
  /** Fin naturelle de la vidéo (pour l'épisode suivant) */
  onEnded: () => void;
  /** Bouton(s) en plus dans la barre du haut (ex. Cast) */
  extra?: ReactNode;
};

export function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
