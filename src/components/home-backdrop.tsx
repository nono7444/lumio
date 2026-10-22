// Fond du haut de l'accueil choisi dans Profil → Personnalisation : illustration d'Halloween, de Noël ou photo perso.
// « Selon la saison » : Halloween en octobre, Noël en décembre, sinon les titres du serveur (carrousel).
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { C } from '@/constants/theme';
import type { HomeBackground, Settings } from '@/lib/settings';
import type { Season } from '@/lib/seasons';

export const HOME_BACKGROUNDS: { value: HomeBackground; label: string }[] = [
  { value: 'titles', label: 'Titres du serveur' },
  { value: 'auto', label: 'Selon la saison' },
  { value: 'halloween', label: 'Halloween' },
  { value: 'christmas', label: 'Noël' },
  { value: 'photo', label: 'Ma photo' },
];

const IMAGES = {
  halloween: require('@/assets/images/backgrounds/halloween.jpg'),
  christmas: require('@/assets/images/backgrounds/christmas.jpg'),
};

/** Image à afficher en haut de l'accueil, ou null pour le carrousel des titres. */
export function homeBackdropSource(s: Settings, season: Season | null): number | { uri: string } | null {
  const choice = s.homeBackground ?? 'titles';
  if (choice === 'halloween') return IMAGES.halloween;
  if (choice === 'christmas') return IMAGES.christmas;
  if (choice === 'photo') return s.homeBackgroundPhoto ? { uri: s.homeBackgroundPhoto } : null;
  if (choice === 'auto') {
    if (season?.id === 'halloween') return IMAGES.halloween;
    if (season?.id === 'noel') return IMAGES.christmas;
  }
  return null;
}

export function HomeBackdrop({ source }: { source: number | { uri: string } }) {
  const { width } = useWindowDimensions();
  const height = Math.round(width * 1.05);
  return (
    <View style={{ width, height }}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} cachePolicy="memory-disk" />
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={[StyleSheet.absoluteFill, { bottom: '70%' }]} pointerEvents="none" />
      <LinearGradient colors={['transparent', C.bg]} style={[StyleSheet.absoluteFill, { top: '55%' }]} pointerEvents="none" />
    </View>
  );
}

/** Choix d'une photo dans la galerie, copiée dans les fichiers de l'appli (elle reste même si la galerie change). */
export async function pickHomePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Autorise l’accès aux photos dans les réglages du téléphone.');
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const src = r.assets[0].uri;
  const ext = (src.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
  const dest = `${FileSystem.documentDirectory}home-background-${Date.now()}.${ext.length <= 4 ? ext : 'jpg'}`;
  await FileSystem.copyAsync({ from: src, to: dest });
  return dest;
}
