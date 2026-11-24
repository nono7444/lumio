// Accueil : « reflet » sous l'image du haut. L'image est reprise à l'envers, floutée et assombrie, pour que ses couleurs
// coulent doucement vers le bas de la page au lieu d'un passage brutal au noir (façon reflet sur un sol brillant).
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { C } from '@/constants/theme';
import { SEAM_DARK, useAmbient } from '@/lib/ambient';
import { useSettings } from '@/lib/settings';

export function AmbientReflection() {
  const a = useAmbient();
  const { width } = useWindowDimensions();
  const { settings } = useSettings();
  const look = settings.look;
  if (!a || look?.reflection === false) return null;
  // Longueur du reflet : réglable dans Profil → Apparence (100 % = la hauteur de l'image)
  const h = Math.round(a.height * ((look?.reflectionLength ?? 90) / 100));
  const blur = look?.reflectionBlur ?? 26;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: a.height, width, height: h }]}>
      <Image
        source={a.source}
        style={{ position: 'absolute', top: 0, left: 0, width, height: a.height, transform: [{ scaleY: -1 }] }}
        contentFit="cover"
        blurRadius={blur}
        transition={700}
        cachePolicy="memory-disk"
      />
      {/* Même noir qu'en bas de la photo au point de jonction, puis le fond de l'appli */}
      <LinearGradient
        colors={[`rgba(0,0,0,${SEAM_DARK})`, 'rgba(0,0,0,0.8)', C.bg]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, overflow: 'hidden' },
});
