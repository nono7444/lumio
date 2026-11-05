// Accueil : rangée des plateformes (Netflix, Disney+…) ; un appui ouvre la page de la plateforme.
// Cartes sombres teintées de la couleur de la marque, avec l'icône officielle en couleur (comme sur l'écran d'accueil du téléphone).
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { platformsApi, type Platform } from '@/lib/platforms';
import { useSettings } from '@/lib/settings';

/** Icône carrée de la plateforme (ou ses initiales si le serveur est trop ancien). */
export function PlatformIcon({ p, size = 44 }: { p: Pick<Platform, 'name' | 'icon' | 'color'>; size?: number }) {
  const r = Math.round(size * 0.26);
  return (
    <View style={[pf.icon, { width: size, height: size, borderRadius: r, backgroundColor: p.color ?? '#222' }]}>
      {p.icon ? (
        <Image source={p.icon} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.34 }} numberOfLines={1}>
          {p.name.replace(/[^A-Za-z0-9+]/g, '').slice(0, 3)}
        </Text>
      )}
    </View>
  );
}

/** Carte d'une plateforme : fond sombre teinté de sa couleur, icône, nom. */
export function PlatformCard({ p, style }: { p: Platform; style?: ViewStyle }) {
  const tint = p.color ?? '#333';
  return (
    <View style={[pf.card, style]}>
      <LinearGradient colors={[`${tint}66`, `${tint}1A`, '#0C0C0E']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { bottom: '55%' }]} pointerEvents="none" />
      <PlatformIcon p={p} size={42} />
      <Text style={pf.name} numberOfLines={1}>
        {p.name}
      </Text>
    </View>
  );
}

export function PlatformsRow() {
  const { settings } = useSettings();
  const [list, setList] = useState<Platform[] | null>(null);
  useEffect(() => {
    if (!settings.chatUrl || !settings.jellyfin) return;
    platformsApi.list(settings).then(setList).catch(() => setList(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
  if (!list?.length) return null;
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={styles.title}>Plateformes</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
        {list.map((p) => (
          <Pressable
            key={p.id}
            tvFocus="card"
            onPress={() => {
              tap();
              router.push({ pathname: '/platform/[id]', params: { id: p.id, name: p.name } });
            }}
            style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 }]}
            accessibilityLabel={p.name}>
            <PlatformCard p={p} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const pf = StyleSheet.create({
  card: {
    width: 158,
    height: 64,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0C0C0E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    gap: 10,
  },
  icon: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  name: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
});

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2, paddingHorizontal: 16, marginBottom: 12 },
});
