// Accueil : rangée des plateformes (Netflix, Disney+…) ; un appui ouvre la page de la plateforme.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { platformsApi, type Platform } from '@/lib/platforms';
import { useSettings } from '@/lib/settings';

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
            style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.96 }] }]}
            accessibilityLabel={p.name}>
            {p.logo ? <Image source={p.logo} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" /> : <Text style={styles.name}>{p.name}</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2, paddingHorizontal: 16, marginBottom: 12 },
  // Fond clair : les logos des plateformes sont souvent sombres
  tile: { width: 128, height: 72, borderRadius: R.md, backgroundColor: '#F2F2F4', alignItems: 'center', justifyContent: 'center', padding: 14 },
  logo: { width: '100%', height: '100%' },
  name: { color: '#111', fontSize: 15, fontWeight: '800' },
});
