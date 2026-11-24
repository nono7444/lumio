import { Platform } from 'react-native';

import { lookPalette, readLookSync } from '@/lib/look';

// Thème sombre « cinéma », inspiré de l'esthétique de Nuvio :
// noir profond, visuels plein cadre, boutons blancs, chrome minimal.
// Les couleurs, arrondis et la taille des affiches se règlent dans Profil → Apparence (appliqués au lancement).
const LOOK = Platform.isTV ? null : readLookSync();
const PAL = LOOK ? lookPalette(LOOK) : null;

export const C = {
  bg: PAL?.bg ?? '#000000',
  surface: PAL?.surface ?? '#121212',
  surfaceHigh: PAL?.surfaceHigh ?? '#1C1C1E',
  border: PAL?.border ?? '#2A2A2C',
  text: '#FFFFFF',
  textDim: PAL?.textDim ?? '#A1A1A6',
  textFaint: PAL?.textFaint ?? '#5E5E63',
  accent: PAL?.accent ?? '#3D8BFF',
  accentSoft: PAL?.accentSoft ?? 'rgba(61,139,255,0.16)',
  glass: PAL?.glass ?? 'rgba(255,255,255,0.14)',
  success: '#30D158',
  warning: '#FFB340',
  danger: '#FF453A',
  info: '#64D2FF',
};

const RS = (LOOK?.radius ?? 100) / 100;
export const R = { sm: Math.round(8 * RS), md: Math.round(12 * RS), lg: Math.round(18 * RS), xl: Math.round(24 * RS) };

// TV : la taille globale se règle dans Profil → Télévision (tout est réduit d'un coup)
// TV : même taille d'affiche que Nuvio (~7 affiches sur la largeur de l'écran)
export const POSTER_W = Platform.isTV ? 150 : Math.round(120 * ((LOOK?.posterSize ?? 100) / 100));
export const POSTER_H = Math.round(POSTER_W * 1.5);

/** Espace à laisser en bas des écrans : la barre d'onglets flotte au-dessus du contenu. */
export const TAB_SPACE = Platform.isTV ? 40 : 110;
