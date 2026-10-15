import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JfRow } from '@/components/jf-cards';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { jf, jfImage, JellyfinError, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

type Section = { view: JfItem; latest: JfItem[] };

const LIB_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  movies: 'film-outline',
  tvshows: 'tv-outline',
  boxsets: 'albums-outline',
  homevideos: 'videocam-outline',
  mixed: 'folder-open-outline',
};

const VIEW_LABEL: Record<string, string> = { movies: 'Films', tvshows: 'Séries', boxsets: 'Collections' };

export default function Library() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [resume, setResume] = useState<JfItem[]>([]);
  const [nextUp, setNextUp] = useState<JfItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [favorites, setFavorites] = useState<JfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    if (!settings.jellyfin) return;
    setError(null);
    try {
      const [r, n, views, favs] = await Promise.all([
        jf.resume(settings),
        jf.nextUp(settings),
        jf.views(settings),
        jf.favorites(settings).catch(() => [] as JfItem[]),
      ]);
      setFavorites(favs);
      const latest = await Promise.all(views.map((v) => jf.latest(settings, v.Id).catch(() => [] as JfItem[])));
      setResume(r);
      setNextUp(n);
      setSections(views.map((v, i) => ({ view: v, latest: latest[i] })));
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setExpired(e instanceof JellyfinError && e.status === 401);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: TAB_SPACE }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
      <ScreenTitle title="Bibliothèque" />
      {settings.jellyfin?.serverName ? (
        <Text style={{ color: C.textDim, fontSize: 13, marginTop: -8, marginBottom: 16, paddingHorizontal: 16 }}>
          {settings.jellyfin.serverName} · {settings.jellyfin.userName}
        </Text>
      ) : null}

      {loading ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 60 }} />
      ) : error ? (
        <View style={{ padding: 24, gap: 14, alignItems: 'center' }}>
          <Text style={{ color: C.textDim, textAlign: 'center' }}>{error}</Text>
          {expired ? (
            <Button
              title="Se reconnecter"
              onPress={async () => {
                await update({ jellyfin: null, skipJellyfin: false });
                router.replace('/login');
              }}
            />
          ) : (
            <Button title="Réessayer" variant="secondary" onPress={load} />
          )}
        </View>
      ) : (
        <>
          {/* Toutes les bibliothèques du serveur */}
          {sections.length > 0 && (
            <FlatList
              horizontal
              data={sections.map((x) => x.view)}
              keyExtractor={(v) => v.Id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              style={{ marginBottom: 26, flexGrow: 0 }}
              renderItem={({ item: v }) => (
                <Pressable
                  onPress={() => {
                    tap();
                    router.push({ pathname: '/jellyfin/[id]', params: { id: v.Id } });
                  }}
                  style={({ pressed }) => [styles.lib, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
                  {v.ImageTags?.Primary ? (
                    <Image
                      source={jfImage(settings, v.Id, 'Primary', { tag: v.ImageTags.Primary, maxWidth: 500 })}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : null}
                  <View style={styles.libShade} />
                  <Ionicons name={LIB_ICON[v.CollectionType ?? ''] ?? 'folder-outline'} size={20} color="#fff" />
                  <Text style={styles.libName} numberOfLines={1}>
                    {v.Name}
                  </Text>
                </Pressable>
              )}
            />
          )}
          <JfRow title="Reprendre" items={resume} wide />
          <JfRow title="À suivre" items={nextUp} wide />
          <JfRow title="Favoris" items={favorites} />
          {sections.map(({ view, latest }) => (
            <JfRow
              key={view.Id}
              title={`Ajouts récents · ${VIEW_LABEL[view.CollectionType ?? ''] ?? view.Name}`}
              items={latest}
              onSeeAll={() => router.push({ pathname: '/jellyfin/[id]', params: { id: view.Id } })}
            />
          ))}
          {!resume.length && !nextUp.length && !sections.some((s) => s.latest.length) && (
            <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 40 }}>Ta bibliothèque est vide.</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  lib: {
    width: 170,
    height: 96,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    justifyContent: 'flex-end',
    padding: 12,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  libShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  libName: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
