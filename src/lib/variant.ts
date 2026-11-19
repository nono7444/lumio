// Quelle appli tourne : Lumio (famille) ou Lumio Auto (admin). Voir app.config.js.
import Constants from 'expo-constants';

import { isManager, type Settings } from './settings';

export const IS_AUTO = Constants.expoConfig?.extra?.variant === 'auto';
/** Lumio Audio : l'appli des livres audio (bibliothèque du serveur Lumio, lecteur). */
export const IS_AUDIO = Constants.expoConfig?.extra?.variant === 'audio';
/** Lumio Livres : l'appli des livres numériques (bibliothèque du serveur Lumio, liseuse). */
export const IS_BOOKS = Constants.expoConfig?.extra?.variant === 'books';

/** Outils d'admin (serveur, torrents, validation…) : seulement dans Lumio Auto. Lumio reste l'appli de la famille. */
export const adminUI = (s: Settings) => IS_AUTO && s.jellyfin?.isAdmin === true;

/** Gestion des demandes (valider, refuser, relancer) : seulement dans Lumio Auto. */
export const managerUI = (s: Settings) => IS_AUTO && isManager(s);

/** Ouvre Lumio Auto depuis Lumio (lien lumioauto://). */
export const LUMIO_AUTO_URL = 'lumioauto://';
