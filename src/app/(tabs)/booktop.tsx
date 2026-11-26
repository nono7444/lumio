// Lumio Livres → onglet « Top » : les nouvelles séries de mangas (2026 et après, AniList), les derniers tomes de
// mangas parus en France (Google Books) et le top des BD (Apple Books France). Une seule liste à la fois.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openDiscover } from '@/components/discover-row';
import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip } from '@/components/ui';
import { UniverseSwitch } from '@/components/universe-switch';
import { C, TAB_SPACE } from '@/constants/theme';
import { ebookApi, useEbooks, type DiscoverItem, type DiscoverKind } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const LISTS: { id: DiscoverKind; label: string; help: string }[] = [
  { id: 'manga', label: 'Nouveaux mangas 2026+', help: 'Séries commencées en 2026 ou après, les plus suivies d’abord (AniList).' },
  { id: 'manga-fr', label: 'Sorties en France', help: 'Les derniers tomes de mangas parus en français (une ligne par série).' },
  { id: 'bd', label: 'Top BD', help: 'Les BD les plus achetées sur Apple Books France.' },
];
const memo: Partial<Record<DiscoverKind, DiscoverItem[]>> = {};

export default function BookTopRoute() {
  const { settings } = useSettings();
  const { lib } = useEbooks();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<DiscoverKind>('manga');
  const [items, setItems] = useState<DiscoverItem[] | null>(memo.manga ?? null);
  const [err, setErr] = useState(false);
  const load = (k: DiscoverKind) => {
    setErr(false);
    setItems(memo[k] ?? null);
    ebookApi
      .discover(settings, k)
      .then((r) => ((memo[k] = r.items), setItems(r.items)))
      .catch(() => (setErr(true), setItems((x) => x ?? [])));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(list), [list, settings]);
  const cols = width > 700 ? 5 : width > 500 ? 4 : 3;
  const w = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 14) / cols);
  const cur = LISTS.find((l) => l.id === list)!;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(list)} tintColor={C.text} />}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <ScreenTitle title="Top" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {LISTS.map((l) => (
            <SegChip key={l.id} label={l.label} on={list === l.id} onPress={() => setList(l.id)} />
          ))}
        </ScrollView>
        <Text style={styles.help}>
          {cur.help}
          {lib?.admin ? ' Touche une couverture pour la chercher et la télécharger.' : ''}
        </Text>
        {!items ? (
          <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
        ) : !items.length ? (
          <Text style={[styles.help, { textAlign: 'center', marginTop: 30 }]}>{err ? 'Liste indisponible pour le moment.' : 'Rien pour le moment.'}</Text>
        ) : (
          <View style={styles.grid}>
            {items.map((it) => (
              <Pressable key={`${it.rank}-${it.title}`} onPress={() => openDiscover(list, it, Boolean(lib?.admin))} style={{ width: w, gap: 5 }}>
                <View style={{ width: w, height: Math.round(w * 1.5), borderRadius: 8, overflow: 'hidden', backgroundColor: C.surface }}>
                  {it.cover ? <Image source={it.cover} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : null}
                  <View style={styles.rank}>
                    <Text style={styles.rankText}>{it.rank}</Text>
                  </View>
                </View>
                <Text numberOfLines={2} style={styles.t}>
                  {it.title}
                </Text>
                <Text numberOfLines={1} style={styles.s}>
                  {[it.author, it.year].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, marginTop: 10, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 16 },
  t: { color: C.text, fontSize: 13, fontWeight: '700' },
  s: { color: C.textDim, fontSize: 12 },
  rank: { position: 'absolute', left: 6, top: 6, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontWeight: '800', fontSize: 12 },
});
