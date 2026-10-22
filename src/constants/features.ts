import { Platform } from 'react-native';

// Interrupteurs de fonctionnalités.
/** Addons Stremio : catalogues uniquement (rangées sur l'accueil). Les flux / téléchargements d'addons ne sont pas utilisés. */
// Retirés sur iOS (à la demande de Norman) ; restent sur l'APK Android et le Mac
export const ADDONS_ENABLED = Platform.OS !== 'ios';
