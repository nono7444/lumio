// Apparence de Lumio (Profil → Apparence) : couleurs, fond, arrondis, verre, taille des affiches et reflet de l'accueil.
// Les couleurs sont lues au lancement (fichier « apparence.json », lu de façon synchrone par constants/theme.ts) :
// elles s'appliquent partout au prochain démarrage. Le reflet, lui, suit les réglages tout de suite.
import { File, Paths } from 'expo-file-system';

export type Look = {
  /** Couleur d'accent : teinte (0-360), saturation et luminosité (%) */
  accentHue: number;
  accentSat: number;
  accentLight: number;
  /** Fond : luminosité (0 = noir pur), teinte et intensité de la teinte */
  bgLight: number;
  bgHue: number;
  bgSat: number;
  /** Texte secondaire : luminosité (%) */
  textDim: number;
  /** Arrondis (% de la valeur d'origine) */
  radius: number;
  /** Boutons « verre » : opacité (%) */
  glass: number;
  /** Taille des affiches (% de la taille d'origine) */
  posterSize: number;
  /** Reflet sous l'image de l'accueil */
  reflection: boolean;
  reflectionLength: number;
  reflectionBlur: number;
};

export const DEFAULT_LOOK: Look = {
  accentHue: 216,
  accentSat: 100,
  accentLight: 62,
  bgLight: 0,
  bgHue: 220,
  bgSat: 0,
  textDim: 64,
  radius: 100,
  glass: 14,
  posterSize: 100,
  reflection: true,
  reflectionLength: 90,
  reflectionBlur: 26,
};

/** Préréglages proposés en haut de l'écran Apparence. */
export const LOOK_PRESETS: { name: string; look: Partial<Look> }[] = [
  { name: 'Lumio', look: {} },
  { name: 'OLED pur', look: { bgLight: 0, bgSat: 0, accentHue: 0, accentSat: 0, accentLight: 96, glass: 12 } },
  { name: 'Nuit bleue', look: { bgLight: 6, bgHue: 222, bgSat: 38, accentHue: 205, accentSat: 95, accentLight: 60 } },
  { name: 'Cinéma', look: { bgLight: 3, bgHue: 0, bgSat: 30, accentHue: 356, accentSat: 85, accentLight: 55 } },
  { name: 'Forêt', look: { bgLight: 5, bgHue: 150, bgSat: 25, accentHue: 145, accentSat: 60, accentLight: 50 } },
  { name: 'Or', look: { bgLight: 4, bgHue: 35, bgSat: 25, accentHue: 42, accentSat: 95, accentLight: 55 } },
  { name: 'Violet', look: { bgLight: 6, bgHue: 265, bgSat: 30, accentHue: 270, accentSat: 85, accentLight: 66 } },
];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function hsl(h: number, s: number, l: number) {
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function normalizeLook(l?: Partial<Look> | null): Look {
  return { ...DEFAULT_LOOK, ...(l ?? {}) };
}

/** Couleurs de l'appli calculées à partir des réglages. */
export function lookPalette(l: Look) {
  const accent = hsl(l.accentHue, l.accentSat, l.accentLight);
  const bg = l.bgLight <= 0 && l.bgSat <= 0 ? '#000000' : hsl(l.bgHue, l.bgSat, l.bgLight);
  return {
    bg,
    surface: hsl(l.bgHue, l.bgSat * 0.8, l.bgLight + 7),
    surfaceHigh: hsl(l.bgHue, l.bgSat * 0.8, l.bgLight + 11),
    border: hsl(l.bgHue, l.bgSat * 0.6, l.bgLight + 16),
    text: '#FFFFFF',
    textDim: hsl(l.bgHue, Math.min(l.bgSat, 12), l.textDim),
    textFaint: hsl(l.bgHue, Math.min(l.bgSat, 10), Math.max(28, l.textDim - 26)),
    accent,
    accentSoft: rgba(accent, 0.16),
    glass: `rgba(255,255,255,${clamp(l.glass, 2, 40) / 100})`,
  };
}

const lookFile = () => new File(Paths.document, 'apparence.json');

/** Lecture au lancement (synchrone : les couleurs doivent être prêtes avant le premier écran). */
export function readLookSync(): Look {
  try {
    const f = lookFile();
    if (f.exists) return normalizeLook(JSON.parse(f.textSync()));
  } catch {}
  return DEFAULT_LOOK;
}

export function writeLook(l: Look) {
  try {
    const f = lookFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(l));
  } catch {}
}
