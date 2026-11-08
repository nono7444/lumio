// Quelle appli tourne : Lumio (famille) ou Lumio Auto (admin). Voir app.config.js.
import Constants from 'expo-constants';

import { isManager, type Settings } from './settings';

export const IS_AUTO = Constants.expoConfig?.extra?.variant === 'auto';

/** Outils d'admin (serveur, torrents, validation…) : seulement dans Lumio Auto. Lumio reste l'appli de la famille. */
export const adminUI = (s: Settings) => IS_AUTO && s.jellyfin?.isAdmin === true;

/** Gestion des demandes (valider, refuser, relancer) : seulement dans Lumio Auto. */
export const managerUI = (s: Settings) => IS_AUTO && isManager(s);

/** Ouvre Lumio Auto depuis Lumio (lien lumioauto://). */
export const LUMIO_AUTO_URL = 'lumioauto://';
