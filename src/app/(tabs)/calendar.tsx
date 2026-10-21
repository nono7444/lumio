import { router } from 'expo-router';
import { useTabInBar } from '@/lib/home-layout';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, SectionList, StyleSheet, Text, View, Platform as RNPlatform } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { dayLabel, fetchReleases, type Platform, type Release } from '@/lib/releases';
import { useSettings } from '@/lib/settings';

type Filter = 'all' | 'movie' | 'series';

function ReleaseRow({ r }: { r: Release }) {
  const busy = false;
  const desc = (r.description ?? '').trim();
  return (
    <Pressable
      onPress={() => {
        tap();
        openMedia(r.kind === 'movie' ? 'movie' : 'tv', r.tmdbId);
      }}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={styles.poster}>
        {r.poster ? <Image source={r.poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
        {busy && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={2}>
          {r.name}
        </Text>
        <Text style={styles.meta}>
          {r.kind === 'movie' ? 'Film' : 'Série'} · {r.info}
        </Text>
        {r.providers?.length ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {r.providers.slice(0, 4).map((p) =>
              p.logo ? <Image key={p.key} source={p.logo} style={styles.rowLogo} contentFit="cover" /> : null
            )}
          </View>
        ) : null}
        {desc ? (
          <Text style={styles.desc} numberOfLines={3}>
            {desc}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
    </Pressable>
  );
}

/** Calendrier des sorties numériques (films et séries). */
export default function Calendar() {
  const { settings } = useSettings();
  const inBar = useTabInBar('calendar');
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // Plateforme choisie (null = toutes) ; « rent » = achat / location uniquement
  const [platform, setPlatform] = useState<string | null>(null);
  const list = useRef<SectionList<Release>>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setItems(await fetchReleases(settings, force));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    load();
  }, [load]);

  // Plateformes présentes, de la plus fournie à la moins fournie
  const platforms = useMemo(() => {
    const m = new Map<string, { p: Platform; n: number }>();
    let rentOnly = 0;
    for (const r of items) {
      if (filter !== 'all' && r.kind !== filter) continue;
      const subs = (r.providers ?? []).filter((x) => x.kind === 'flatrate');
      if (!subs.length) rentOnly++;
      for (const p of subs) m.set(p.key, { p, n: (m.get(p.key)?.n ?? 0) + 1 });
    }
    const list = [...m.values()].sort((a, b) => b.n - a.n);
    return { list, rentOnly };
  }, [items, filter]);

  const visible = useMemo(
    () =>
      items.filter((r) => {
        if (filter !== 'all' && r.kind !== filter) return false;
        if (!platform) return true;
        const subs = (r.providers ?? []).filter((x) => x.kind === 'flatrate');
        return platform === 'rent' ? subs.length === 0 : subs.some((x) => x.key === platform);
      }),
    [items, filter, platform]
  );

  const sections = useMemo(() => {
    const map = new Map<string, Release[]>();
    for (const r of visible) map.set(r.dayKey, [...(map.get(r.dayKey) ?? []), r]);
    return [...map.entries()].map(([key, data]) => ({ key, title: dayLabel(data[0].date), data }));
  }, [visible]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Calendrier" onBack={inBar ? undefined : () => router.navigate('/')} />
      <Text style={styles.subtitle}>Sorties numériques (VOD, plateformes) et nouvelles saisons · dates TMDB</Text>

      {/* Plateformes */}
      <FlatList
        horizontal
        data={[null, ...platforms.list.map((x) => x.p.key), ...(platforms.rentOnly ? ['rent'] : [])]}
        keyExtractor={(k) => k ?? 'all'}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
        // Hauteur fixe : sinon la rangée des plateformes peut être coupée de moitié
        style={{ flexGrow: 0, flexShrink: 0, height: 48, minHeight: 48, marginBottom: 8 }}
        renderItem={({ item: k }) => {
          const on = platform === k;
          const entry = platforms.list.find((x) => x.p.key === k);
          return (
            <Pressable
              onPress={() => {
                tap();
                setPlatform(k);
              }}
              style={[styles.platform, on && styles.platformOn]}>
              {entry?.p.logo ? <Image source={entry.p.logo} style={styles.platformLogo} contentFit="cover" /> : null}
              {!entry ? <Ionicons name={k === 'rent' ? 'cart-outline' : 'apps'} size={16} color={on ? '#000' : C.text} /> : null}
              <Text style={[styles.platformText, on && { color: '#000' }]}>
                {k === null ? 'Toutes' : k === 'rent' ? 'Achat / location' : entry?.p.name}
                {entry ? ` · ${entry.n}` : k === 'rent' ? ` · ${platforms.rentOnly}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
        <SegChip label="Tout" on={filter === 'all'} onPress={() => setFilter('all')} />
        <SegChip label="Films" on={filter === 'movie'} onPress={() => setFilter('movie')} />
        <SegChip label="Séries" on={filter === 'series'} onPress={() => setFilter('series')} />
      </View>

      {loading && !items.length ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
      ) : (
        <SectionList
          ref={list}
          sections={sections}
          keyExtractor={(r) => r.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE }}
          refreshControl={RNPlatform.isTV ? undefined : <RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={C.text} />}
          onScrollToIndexFailed={() => {}}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => <ReleaseRow r={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <Text style={[styles.meta, { textAlign: 'center', marginTop: 40 }]}>
              {error ? `Calendrier indisponible : ${error}` : 'Aucune sortie annoncée.'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  platform: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 12, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh },
  platformOn: { backgroundColor: C.text },
  platformLogo: { width: 24, height: 24, borderRadius: 6 },
  platformText: { color: C.text, fontSize: 13, fontWeight: '700' },
  rowLogo: { width: 22, height: 22, borderRadius: 5 },
  subtitle: { color: C.textDim, fontSize: 13, marginTop: -8, marginBottom: 14, paddingHorizontal: 16 },
  day: { width: 52, paddingVertical: 8, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: 'center', gap: 2 },
  dayOn: { backgroundColor: C.text },
  dayWeek: { color: C.textDim, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  dayNum: { color: C.text, fontSize: 18, fontWeight: '800' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bg, paddingTop: 16, paddingBottom: 10 },
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: '800', textTransform: 'capitalize' },
  sectionCount: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 10 },
  poster: { width: 70, height: 105, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  meta: { color: C.textDim, fontSize: 12 },
  desc: { color: C.textDim, fontSize: 12, lineHeight: 17 },
});
