// Vibrations : coupées par défaut, activables dans Profil → Personnalisation (réglage « Vibrations »).
import * as Haptics from 'expo-haptics';

let enabled = false;

/** Appelé par les réglages au démarrage et à chaque changement. */
export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

/** Petit retour au toucher (sélection). */
export const hapticTap = () => {
  if (enabled) Haptics.selectionAsync().catch(() => {});
};

/** Retour plus marqué (appui long). */
export const hapticImpact = () => {
  if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};
