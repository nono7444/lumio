// Page d'une plateforme (Netflix, Disney+…) : ses titres sur ton serveur, puis ses dernières sorties
// (celles qui manquent se demandent depuis leur fiche). Tri du plus récent au plus ancien, ou l'inverse.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassLogo } from '@/components/platforms-row';
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
            <View style={[styles.badge, t.available ? styles.badgeOn : styles.badgeOff]}>
              <Ionicons name={t.available ? 'checkmark' : 'download-outline'} size={11} color="#fff" />
              <Text style={styles.badgeTxt}>{t.available ? 'Dispo' : 'À demander'}</Text>
            </View>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {[t.type === 'tv' ? 'Série' : 'Film', t.year].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  // Tout mélangé (dispo ou pas), par date de sortie ; ancien serveur : on fusionne ici
  const items = page
    ? page.items ??
      [...page.latest, ...page.library.filter((l) => !page.latest.some((x) => x.type === l.type && x.tmdbId === l.tmdbId))].sort((a, b) => {
        const d = (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0);
        return sort === 'asc' ? -d : d;
      })
    : [];
  const missing = items.filter((t) => !t.available).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round} accessibilityLabel="Retour">
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        {page ? (
          <GlassLogo logo={page.logo} name={page.name} style={{ width: 150, height: 52 }} logoPad={12} />
        ) : (
          <Text style={styles.h1}>{name ?? ''}</Text>
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
          <Text style={styles.h2}>{sort === 'desc' ? 'Dernières sorties' : 'Plus anciennes sorties'}</Text>
          <Text style={styles.sub}>
            {items.length - missing} sur ton serveur · {missing} à demander (ouvre la fiche pour les demander)
          </Text>
          {items.length ? grid(items) : <Text style={styles.sub}>Rien pour {page.name} pour l’instant.</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeOn: { backgroundColor: 'rgba(30,160,90,0.92)' },
  badgeOff: { backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  h1: { color: C.text, fontSize: 26, fontWeight: '900' },
  h2: { color: C.text, fontSize: 19, fontWeight: '800' },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  poster: { borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  fallback: { color: C.textDim, fontSize: 12, textAlign: 'center', padding: 6 },
  title: { color: C.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
  sub: { color: C.textDim, fontSize: 12, marginTop: 2 },
});
