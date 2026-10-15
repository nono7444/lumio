import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JfRow } from '@/components/jf-cards';
import { Button, ScreenTitle } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { jf, JellyfinError, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

type Section = { view: JfItem; latest: JfItem[] };

const VIEW_LABEL: Record<string, string> = { movies: 'Films', tvshows: 'Séries', boxsets: 'Collections' };

export default function Library() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [resume, setResume] = useState<JfItem[]>([]);
  const [nextUp, setNextUp] = useState<JfItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    if (!settings.jellyfin) return;
    setError(null);
    try {
      const [r, n, views] = await Promise.all([jf.resume(settings), jf.nextUp(settings), jf.views(settings)]);
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
          <JfRow title="Reprendre" items={resume} wide />
          <JfRow title="À suivre" items={nextUp} wide />
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
