// Accueil : rangée des plateformes (Netflix, Disney+…) ; un appui ouvre la page de la plateforme.
// Vignettes noires en verre (Liquid Glass d'iOS 26 quand il existe), logos en blanc, comme sur l'Apple TV.
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform as RNPlatform, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { platformsApi, type Platform } from '@/lib/platforms';
import { useSettings } from '@/lib/settings';

const liquid = RNPlatform.OS === 'ios' && isLiquidGlassAvailable();

/** Vignette noire en verre avec le logo de la plateforme en blanc. */
export function GlassLogo({ logo, name, style, logoPad = 16 }: { logo: string | null; name: string; style?: ViewStyle; logoPad?: number }) {
  return (
    <View style={[glass.tile, style]}>
      {/* Fond noir profond */}
      <LinearGradient colors={['#1C1C1F', '#050506']} style={StyleSheet.absoluteFill} />
      {liquid ? <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(0,0,0,0.55)" style={StyleSheet.absoluteFill} /> : null}
      {/* Reflet du verre en haut */}
      <LinearGradient
        colors={['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 1]}
        style={[StyleSheet.absoluteFill, { bottom: '45%' }]}
        pointerEvents="none"
      />
      <View style={[StyleSheet.absoluteFill, { padding: logoPad, alignItems: 'center', justifyContent: 'center' }]}>
        {logo ? (
          <Image source={logo} style={{ width: '100%', height: '100%' }} contentFit="contain" tintColor="#FFFFFF" cachePolicy="memory-disk" />
        ) : (
          <Text style={glass.name} numberOfLines={1}>
            {name}
          </Text>
        )}
      </View>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {list.map((p) => (
          <Pressable
            key={p.id}
            tvFocus="card"
            onPress={() => {
              tap();
              router.push({ pathname: '/platform/[id]', params: { id: p.id, name: p.name } });
            }}
            style={({ pressed }) => [pressed && { transform: [{ scale: 0.96 }] }]}
            accessibilityLabel={p.name}>
            <GlassLogo logo={p.logo} name={p.name} style={{ width: 150, height: 84 }} logoPad={22} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const glass = StyleSheet.create({
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0A0A0B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  name: { color: '#fff', fontSize: 16, fontWeight: '800' },
});

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2, paddingHorizontal: 16, marginBottom: 12 },
});
