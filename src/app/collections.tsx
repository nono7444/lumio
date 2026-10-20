// Collections propres (sagas) : grille des collections, puis les films d'une collection dans l'ordre de sortie.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { fetchCollections, type LumioCollection } from '@/lib/collections';
import { jfImage } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export default function Collections() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<LumioCollection[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (refresh = false) =>
    fetchCollections(settings, refresh)
      .then((r) => {
        setList(r.collections);
        setBuilding(r.building);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!building) return;
    const t = setTimeout(() => load(), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, list]);

  const cols = width >= 900 ? 6 : width >= 600 ? 4 : 3;
  const gap = 12;
  const w = Math.floor((Math.min(width, 1200) - 32 - gap * (cols - 1)) / cols);
  const one = id ? list?.find((c) => String(c.id) === id) : null;

  // ——— Une collection ———
  if (one)
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ height: 260 }}>
          {one.backdrop ? <Image source={one.backdrop} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <LinearGradient colors={['rgba(0,0,0,0.2)', C.bg]} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', top: insets.top + 8, left: 12 }}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: 10 }}>
            <Text style={styles.bigTitle}>{one.name}</Text>
            <Text style={styles.dim}>
              {one.items.length} film{one.items.length > 1 ? 's' : ''} sur ton serveur
              {one.total > one.items.length ? ` · ${one.total} dans la saga` : ''}
            </Text>
          </View>
        </View>
        {one.overview ? <Text style={styles.overview}>{one.overview}</Text> : null}
        <View style={[styles.grid, { gap }]}>
          {one.items.map((m, i) => (
            <Pressable
              key={m.jfId}
              onPress={() => {
                tap();
                router.push({ pathname: '/jellyfin/[id]', params: { id: m.jfId } });
              }}
              style={{ width: w }}>
              <Image source={jfImage(settings, m.jfId, 'Primary', { maxHeight: 450 })} style={[styles.poster, { width: w, height: w * 1.5 }]} contentFit="cover" />
              <Text style={styles.name} numberOfLines={2}>
                {i + 1}. {m.title}
              </Text>
              {m.year ? <Text style={styles.dim}>{m.year}</Text> : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );

  // ——— Toutes les collections ———
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={C.text} />}>
      <ScreenTitle title="Collections" onBack={() => router.back()} />
      {error ? <Text style={[styles.dim, { padding: 16 }]}>{error}</Text> : null}
      {!list ? <ActivityIndicator color={C.text} style={{ marginTop: 40 }} /> : null}
      {list && !list.length ? (
        <View style={{ alignItems: 'center', gap: 10, padding: 32 }}>
          {building ? <ActivityIndicator color={C.text} /> : <Ionicons name="albums-outline" size={36} color={C.textFaint} />}
          <Text style={[styles.dim, { textAlign: 'center' }]}>
            {building ? 'Le serveur Lumio range tes films par saga… (une seule fois, quelques minutes)' : 'Aucune saga trouvée (au moins 2 films d’une même saga).'}
          </Text>
        </View>
      ) : null}
      <View style={[styles.grid, { gap }]}>
        {(list ?? []).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => {
              tap();
              router.push({ pathname: '/collections', params: { id: String(c.id) } });
            }}
            style={{ width: w }}>
            <View style={[styles.poster, { width: w, height: w * 1.5 }]}>
              {c.poster ? <Image source={c.poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : null}
              <View style={styles.count}>
                <Text style={styles.countText}>{c.items.length}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, maxWidth: 1232, alignSelf: 'center', width: '100%' },
  poster: { borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  name: { color: C.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  dim: { color: C.textDim, fontSize: 12 },
  bigTitle: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  overview: { color: C.textDim, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, marginBottom: 16 },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  countText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
