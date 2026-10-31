// Lecteur BD / mangas : planche par planche, zoom au pincement, sens manga, reprise automatique.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/constants/theme';
import { bookUrl } from '@/lib/books';
import { useSettings } from '@/lib/settings';

export default function BookBD() {
  const { token, title, path } = useLocalSearchParams<{ token: string; title: string; path: string }>();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [manga, setManga] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<number>>(null);
  const start = useRef(0);
  const url = (i: number) => bookUrl(settings, token, `page/${i}`);

  useEffect(() => {
    (async () => {
      const [p, dir] = await Promise.all([AsyncStorage.getItem(`book.page.${path}`).catch(() => null), AsyncStorage.getItem('book.dir').catch(() => null)]);
      setManga(dir === 'manga');
      try {
        const r = await fetch(bookUrl(settings, token, 'pages'));
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        start.current = Math.min(Number(p) || 0, j.pages - 1);
        setPage(start.current);
        setTotal(j.pages);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path]);

  useEffect(() => {
    if (total == null) return;
    AsyncStorage.setItem(`book.page.${path}`, String(page)).catch(() => {});
    Image.prefetch([1, 2, 3].map((d) => page + d).filter((i) => i < total).map(url)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, total]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const v = viewableItems[0];
    if (v?.index != null) setPage(v.index);
  }).current;

  const go = useCallback(
    (i: number) => {
      if (total == null) return;
      const k = Math.max(0, Math.min(total - 1, i));
      list.current?.scrollToIndex({ index: k, animated: true });
      setPage(k);
    },
    [total]
  );

  if (error)
    return (
      <View style={[st.center, { backgroundColor: '#000' }]}>
        <Text style={{ color: C.textDim, textAlign: 'center', padding: 30 }}>{error}</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: C.accent, fontWeight: '800' }}>Retour</Text></Pressable>
      </View>
    );
  if (total == null) return <View style={[st.center, { backgroundColor: '#000' }]}><ActivityIndicator color="#fff" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar hidden={!chrome} style="light" />
      <FlatList
        ref={list}
        data={Array.from({ length: total }, (_, i) => i)}
        horizontal
        pagingEnabled
        inverted={manga}
        initialScrollIndex={start.current}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(i) => String(i)}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        windowSize={5}
        renderItem={({ item }) => (
          <ScrollView style={{ width, height }} contentContainerStyle={{ width, height }} maximumZoomScale={4} minimumZoomScale={1} centerContent showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
            <Pressable onPress={() => setChrome((c) => !c)} style={{ width, height }}>
              <Image source={url(item)} style={{ width, height }} contentFit="contain" cachePolicy="disk" transition={100} />
            </Pressable>
          </ScrollView>
        )}
      />
      {chrome ? (
        <>
          <View style={[st.top, { paddingTop: insets.top + 4 }]}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={st.round}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
            <Text style={st.title} numberOfLines={1}>{title}</Text>
            <Pressable
              onPress={() => {
                const v = !manga;
                setManga(v);
                AsyncStorage.setItem('book.dir', v ? 'manga' : 'bd').catch(() => {});
              }}
              style={[st.pill, manga && { backgroundColor: '#fff' }]}>
              <Text style={[st.pillText, manga && { color: '#000' }]}>{manga ? 'Sens manga' : 'Sens BD'}</Text>
            </Pressable>
          </View>
          <View style={[st.bottom, { paddingBottom: insets.bottom + 10 }]}>
            <Pressable onPress={() => go(page - 1)} hitSlop={10}><Ionicons name="chevron-back-circle" size={34} color="#fff" /></Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={st.count}>{page + 1} / {total}</Text>
              <View style={st.bar}><View style={[st.fill, { width: `${((page + 1) / total) * 100}%` }]} /></View>
            </View>
            <Pressable onPress={() => go(page + 1)} hitSlop={10}><Ionicons name="chevron-forward-circle" size={34} color="#fff" /></Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.65)' },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.65)' },
  count: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: C.accent },
});
