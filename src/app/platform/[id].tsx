// Page d'une plateforme (Netflix, Disney+…) : ses titres sur ton serveur, puis ses dernières sorties
// (celles qui manquent se demandent depuis leur fiche). Tri du plus récent au plus ancien, ou l'inverse.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { platformsApi, type PlatformPage, type PlatformTitle } from '@/lib/platforms';
import { useSettings } from '@/lib/settings';

export default function PlatformScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState<PlatformPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPage(await platformsApi.page(settings, String(id), sort));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sort, settings.chatUrl]);
  useEffect(() => {
    setPage(null);
    load();
  }, [load]);

  // 3 affiches par ligne sur téléphone, plus sur tablette
  const cols = width > 700 ? 5 : 3;
  const gap = 10;
  const posterW = Math.floor((width - 32 - gap * (cols - 1)) / cols);

  const grid = (list: PlatformTitle[]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {list.map((t) => (
        <Pressable
          key={`${t.type}:${t.tmdbId}`}
          onPress={() => {
            tap();
            openMedia(t.type, t.tmdbId);
          }}
          style={({ pressed }) => [{ width: posterW }, pressed && { transform: [{ scale: 0.96 }] }]}>
          <View style={[styles.poster, { width: posterW, height: Math.round(posterW * 1.5) }]}>
            {t.poster ? (
              <Image source={t.poster} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} />
            ) : (
              <Text style={styles.fallback} numberOfLines={3}>
                {t.title}
              </Text>
            )}
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {[t.type === 'tv' ? 'Série' : 'Film', t.year].filter(Boolean).join(' · ')}
            {!t.available ? <Text style={{ color: C.accent }}> · à demander</Text> : null}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const missing = page?.latest.filter((t) => !t.available) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round} accessibilityLabel="Retour">
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        {page?.logo ? (
          <View style={styles.logoBox}>
            <Image source={page.logo} style={{ width: '100%', height: '100%' }} contentFit="contain" />
          </View>
        ) : (
          <Text style={styles.h1}>{page?.name ?? name ?? ''}</Text>
        )}
      </View>
      <View style={styles.sortRow}>
        <SegChip label="Plus récents" on={sort === 'desc'} onPress={() => setSort('desc')} />
        <SegChip label="Plus anciens" on={sort === 'asc'} onPress={() => setSort('asc')} />
      </View>
      {!page ? (
        error ? (
          <Text style={[styles.sub, { padding: 20, color: C.danger }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={C.text} style={{ marginTop: 50 }} />
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={C.text}
            />
          }>
          <Text style={styles.h2}>Sur ton serveur ({page.library.length})</Text>
          {page.library.length ? grid(page.library) : <Text style={styles.sub}>Aucun titre de {page.name} sur ton serveur pour l’instant.</Text>}
          <Text style={[styles.h2, { marginTop: 10 }]}>Dernières sorties</Text>
          <Text style={styles.sub}>
            {missing.length
              ? `${missing.length} pas encore sur ton serveur : ouvre la fiche pour les demander.`
              : 'Tu as déjà tout ce qui est sorti récemment.'}
          </Text>
          {grid(page.latest)}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  logoBox: { height: 44, width: 150, borderRadius: R.md, backgroundColor: '#F2F2F4', padding: 8 },
  h1: { color: C.text, fontSize: 26, fontWeight: '900' },
  h2: { color: C.text, fontSize: 19, fontWeight: '800' },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  poster: { borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  fallback: { color: C.textDim, fontSize: 12, textAlign: 'center', padding: 6 },
  title: { color: C.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
  sub: { color: C.textDim, fontSize: 12, marginTop: 2 },
});
