import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { openStremioMeta } from '@/lib/navigation';
import { dayKeyOf, dayLabel, fetchReleases, type Release } from '@/lib/releases';
import { useSettings } from '@/lib/settings';

type Filter = 'all' | 'movie' | 'series';

function DayChip({ date, count, on, onPress }: { date: Date; count: number; on: boolean; onPress: () => void }) {
  const today = dayKeyOf(new Date()) === dayKeyOf(date);
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.day, on && styles.dayOn]}>
      <Text style={[styles.dayWeek, on && { color: '#000' }]}>
        {date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}
      </Text>
      <Text style={[styles.dayNum, on && { color: '#000' }, today && !on && { color: C.accent }]}>{date.getDate()}</Text>
      <View style={[styles.dot, { opacity: count ? 1 : 0, backgroundColor: on ? '#000' : C.text }]} />
    </Pressable>
  );
}

function ReleaseRow({ r }: { r: Release }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const desc = (r.description ?? '').split('\n').slice(1).join(' ').trim();
  return (
    <Pressable
      onPress={async () => {
        if (busy) return;
        tap();
        setBusy(true);
        await openStremioMeta(settings, r).finally(() => setBusy(false));
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
          {r.kind === 'movie' ? 'Film' : 'Série'}
          {r.releaseInfo ? ` · ${r.releaseInfo}` : ''}
        </Text>
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
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<SectionList<Release>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchReleases(settings.calendarAddon));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [settings.calendarAddon]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => items.filter((r) => filter === 'all' || r.kind === filter), [items, filter]);

  const sections = useMemo(() => {
    const map = new Map<string, Release[]>();
    for (const r of visible) map.set(r.dayKey, [...(map.get(r.dayKey) ?? []), r]);
    return [...map.entries()].map(([key, data]) => ({ key, title: dayLabel(data[0].date), data }));
  }, [visible]);

  // Bande des jours : de aujourd'hui à la dernière sortie connue
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const last = visible.length ? visible[visible.length - 1].date : start;
    const out: Date[] = [];
    for (let d = new Date(start); d <= last && out.length < 90; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [visible]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of visible) m.set(r.dayKey, (m.get(r.dayKey) ?? 0) + 1);
    return m;
  }, [visible]);

  function jumpTo(key: string) {
    setSelected(key);
    const idx = sections.findIndex((s) => s.key >= key);
    if (idx >= 0) list.current?.scrollToLocation({ sectionIndex: idx, itemIndex: 0, viewOffset: 0, animated: true });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Calendrier" />
      <Text style={styles.subtitle}>Sorties numériques à venir</Text>

      <FlatList
        horizontal
        data={days}
        keyExtractor={(d) => dayKeyOf(d)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        style={{ flexGrow: 0, marginBottom: 12 }}
        renderItem={({ item: d }) => (
          <DayChip
            date={d}
            count={counts.get(dayKeyOf(d)) ?? 0}
            on={selected === dayKeyOf(d)}
            onPress={() => jumpTo(dayKeyOf(d))}
          />
        )}
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
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.text} />}
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
