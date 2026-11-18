// Calendrier : radar des sorties VOD d'amtVOD (disponible en VOD, sortie confirmée, au cinéma avec prédiction).
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View, Platform as RNPlatform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { useTabInBar } from '@/lib/home-layout';
import { openMedia } from '@/lib/navigation';
import { RADAR_STATUS, radarApi, type Radar, type RadarItem, type RadarStatus } from '@/lib/radar';
import { useSettings } from '@/lib/settings';

function RadarRow({ r, status }: { r: RadarItem; status: RadarStatus }) {
  const st = RADAR_STATUS[status];
  const desc = (r.description ?? '').trim();
  return (
    <Pressable
      disabled={!r.tmdbId}
      onPress={() => {
        if (!r.tmdbId) return;
        tap();
        openMedia(r.type, r.tmdbId);
      }}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={styles.poster}>{r.poster ? <Image source={r.poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}</View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={styles.title} numberOfLines={2}>
          {r.name}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <View style={[styles.badge, { borderColor: st.color }]}>
            <Text style={[styles.badgeTxt, { color: st.color }]}>{r.releaseInfo || st.label}</Text>
          </View>
          {r.badges.map((b) => (
            <View key={b} style={styles.badge}>
              <Text style={styles.badgeTxt}>{b}</Text>
            </View>
          ))}
        </View>
        {desc ? (
          <Text style={styles.desc} numberOfLines={4}>
            {desc}
          </Text>
        ) : null}
      </View>
      {r.tmdbId ? <Ionicons name="chevron-forward" size={18} color={C.textFaint} /> : null}
    </Pressable>
  );
}

export default function Calendar() {
  const { settings } = useSettings();
  const inBar = useTabInBar('calendar');
  const insets = useSafeAreaInsets();
  const [radar, setRadar] = useState<Radar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const r = await radarApi.get(settings, force);
        setRadar(r);
        setError(r.error);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [settings]
  );
  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => (radar?.sections ?? []).filter((s) => s.items.length || s.error), [radar]);
  const cur = sections.find((s) => s.id === tab) ?? sections[0] ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Calendrier" onBack={inBar ? undefined : () => router.navigate('/')} />
      <Text style={styles.subtitle}>Radar des sorties VOD · amtVOD</Text>
      {sections.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
          {sections.map((s) => (
            <SegChip key={s.id} label={`${RADAR_STATUS[s.status].label} · ${s.items.length}`} on={cur?.id === s.id} onPress={() => setTab(s.id)} />
          ))}
        </View>
      ) : null}
      {loading && !radar ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={cur?.items ?? []}
          keyExtractor={(r) => r.id || r.name}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE, gap: 10 }}
          refreshControl={RNPlatform.isTV ? undefined : <RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={C.text} />}
          renderItem={({ item }) => <RadarRow r={item} status={cur!.status} />}
          ListEmptyComponent={
            <Text style={[styles.desc, { textAlign: 'center', marginTop: 40 }]}>
              {error || cur?.error ? `Calendrier indisponible : ${error || cur?.error}` : 'Rien pour le moment.'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: C.textDim, fontSize: 13, marginTop: -8, marginBottom: 14, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 10 },
  poster: { width: 70, height: 105, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  badge: { borderWidth: 1, borderColor: C.textFaint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { color: C.textDim, fontSize: 11, fontWeight: '800' },
  desc: { color: C.textDim, fontSize: 12, lineHeight: 17 },
});
