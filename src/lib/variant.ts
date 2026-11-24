// Quelle appli tourne (voir app.config.js). Lumio Auto n'est plus une appli à part : c'est l'univers « Lumio Auto » de Lumio.
import Constants from 'expo-constants';

import { isManager, type Settings } from './settings';

export const IS_AUTO = Constants.expoConfig?.extra?.variant === 'auto';
/** Lumio Audio : l'appli des livres audio (bibliothèque du serveur Lumio, lecteur). */
export const IS_AUDIO = Constants.expoConfig?.extra?.variant === 'audio';
/** Lumio Livres : l'appli des livres numériques (bibliothèque du serveur Lumio, liseuse). */
export const IS_BOOKS = Constants.expoConfig?.extra?.variant === 'books';

/** Dans l'univers « Lumio Auto » (ou l'ancienne appli Lumio Auto). Lu à la demande pour éviter une boucle d'imports. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inAuto = () => IS_AUTO || (require('./universe') as typeof import('./universe')).getUniverse() === 'auto';

/** Outils d'admin (serveur, torrents, validation…) : seulement dans l'univers Lumio Auto. Les films et séries restent épurés. */
export const adminUI = (s: Settings) => inAuto() && s.jellyfin?.isAdmin === true;

/** Gestion des demandes (valider, refuser, relancer) : seulement dans l'univers Lumio Auto. */
export const managerUI = (s: Settings) => inAuto() && isManager(s);

/** Ouvre Lumio Auto depuis Lumio (lien lumioauto://). */
export const LUMIO_AUTO_URL = 'lumioauto://';
