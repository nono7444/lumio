// Thème sombre « cinéma », inspiré de l'esthétique de Nuvio :
// noir profond, visuels plein cadre, boutons blancs, chrome minimal.
export const C = {
  bg: '#000000',
  surface: '#121212',
  surfaceHigh: '#1C1C1E',
  border: '#2A2A2C',
  text: '#FFFFFF',
  textDim: '#A1A1A6',
  textFaint: '#5E5E63',
  accent: '#3D8BFF',
  accentSoft: 'rgba(61,139,255,0.16)',
  glass: 'rgba(255,255,255,0.14)',
  success: '#30D158',
  warning: '#FFB340',
  danger: '#FF453A',
  info: '#64D2FF',
} as const;

export const R = { sm: 8, md: 12, lg: 18, xl: 24 } as const;

export const POSTER_W = 120;
export const POSTER_H = Math.round(POSTER_W * 1.5);

/** Espace à laisser en bas des écrans : la barre d'onglets flotte au-dessus du contenu. */
export const TAB_SPACE = 110;
