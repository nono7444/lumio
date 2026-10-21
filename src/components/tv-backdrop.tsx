// TV, façon Nuvio : grande image de fond (celle du titre sélectionné), fondue vers la gauche et vers le bas,
// avec le logo, les infos et le résumé en haut à gauche.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { C } from '@/constants/theme';
import { useTvFocus, type TvFocusInfo } from '@/lib/tv-focus';

const BG = C.bg;
const a = (o: number) => {
  // C.bg en hexadécimal → même couleur avec transparence
  const h = BG.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${o})`;
};

/** Fond plein écran + dégradés (à placer en premier, en position absolue). */
export function TvBackdropLayer({ info }: { info: TvFocusInfo | null }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {info?.backdrop ? (
        <Image source={info.backdrop} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="right top" transition={400} />
      ) : null}
      {/* Fondu vers la gauche (lisibilité du texte), comme Nuvio : jusqu'à 45 % de la largeur */}
      <LinearGradient
        colors={[BG, a(0.86), a(0.56), a(0.16), a(0)]}
        locations={[0, 0.22, 0.46, 0.76, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.55, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Fondu vers le bas : les rangées d'affiches se posent sur un fond uni */}
      <LinearGradient
        colors={[a(0), a(0.35), a(0.85), BG]}
        locations={[0, 0.3, 0.62, 1]}
        start={{ x: 0, y: 0.35 }}
        end={{ x: 0, y: 0.72 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Logo (ou titre), infos et résumé du titre sélectionné. */
export function TvInfoBlock({ info, top }: { info: TvFocusInfo | null; top: number }) {
  const { width } = useWindowDimensions();
  if (!info) return null;
  return (
    <View style={[styles.info, { top, width: Math.min(width * 0.42, 620) }]} pointerEvents="none">
      {info.logo ? (
        <Image source={info.logo} style={styles.logo} contentFit="contain" contentPosition="left center" transition={300} />
      ) : (
        <Text style={styles.title} numberOfLines={2}>
          {info.title}
        </Text>
      )}
      {info.meta ? <Text style={styles.meta}>{info.meta}</Text> : null}
      {info.overview ? (
        <Text style={styles.overview} numberOfLines={3}>
          {info.overview}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  info: { position: 'absolute', left: 48, gap: 10 },
  logo: { width: 280, height: 110 },
  title: { color: C.text, fontSize: 38, fontWeight: '900', letterSpacing: -0.8 },
  meta: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '700' },
  overview: { color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 22 },
});

/** Fond + infos qui suivent l'affiche sélectionnée (seul ce bloc se redessine, pas l'accueil). */
export function TvFocusHero({ initial, top }: { initial: TvFocusInfo | null; top: number }) {
  const info = useTvFocus(initial);
  return (
    <>
      <TvBackdropLayer info={info} />
      <TvInfoBlock info={info} top={top} />
    </>
  );
}

/**
 * Accueil TV : bandeau d'infos sur fond uni (pas d'image de fond, plus rapide et plus lisible).
 * Titre, année / durée / note et résumé du titre sélectionné. Seul ce bloc se redessine au focus.
 */
export function TvHomeHeader({ initial, height }: { initial: TvFocusInfo | null; height: number }) {
  const info = useTvFocus(initial);
  const { width } = useWindowDimensions();
  return (
    <View style={[headerStyles.wrap, { height }]} pointerEvents="none">
      {info ? (
        <View style={{ width: Math.min(width * 0.62, 900), gap: 8 }}>
          <Text style={headerStyles.title} numberOfLines={1}>
            {info.title}
          </Text>
          {info.meta ? <Text style={headerStyles.meta}>{info.meta}</Text> : null}
          {info.overview ? (
            <Text style={headerStyles.overview} numberOfLines={2}>
              {info.overview}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={headerStyles.title}>Accueil</Text>
      )}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  wrap: { justifyContent: 'flex-end', paddingLeft: 48, paddingBottom: 14, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 34, fontWeight: '900', letterSpacing: -0.6 },
  meta: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '700' },
  overview: { color: 'rgba(255,255,255,0.62)', fontSize: 15, lineHeight: 22 },
});
