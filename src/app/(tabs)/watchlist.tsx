// Onglet « À voir » : films et séries à ne pas oublier, disponibles ou non sur le serveur.
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PosterCard, ScreenTitle, SegChip } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { badgeFor, MediaStatus } from '@/lib/requests';
import { useSettings } from '@/lib/settings';
import { watchlist, useWatchlist, type WatchItem } from '@/lib/watchlist';

type Filter = 'all' | 'available' | 'missing' | 'movie' | 'tv';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'available', label: 'Disponibles' },
  { id: 'missing', label: 'Pas encore là' },
  { id: 'movie', label: 'Films' },
  { id: 'tv', label: 'Séries' },
];
const isThere = (x: WatchItem) => x.status === MediaStatus.AVAILABLE || x.status === MediaStatus.PARTIALLY_AVAILABLE;

export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const { items, error, reload } = useWatchlist();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const cols = width > 700 ? 5 : 3;
  const cardW = Math.floor((width - 32 - (cols - 1) * 12) / cols);
  const list = useMemo(
    () =>
      (items ?? []).filter((x) =>
        filter === 'all' ? true : filter === 'available' ? isThere(x) : filter === 'missing' ? !isThere(x) : x.type === filter
      ),
    [items, filter]
  );

  const remove = (x: WatchItem) =>
    Alert.alert('Retirer de « À voir » ?', x.title, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => watchlist.remove(settings, x.type, x.tmdbId).catch(() => reload()) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="À voir" />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <SegChip key={f.id} label={f.label} on={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </View>
      {items === null ? (
        error ? (
          <Text style={styles.empty}>{error}</Text>
        ) : (
          <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
        )
      ) : (
        <FlatList
          data={list}
          key={cols}
          numColumns={cols}
          keyExtractor={(x) => `${x.type}:${x.tmdbId}`}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={C.text}
              onRefresh={async () => {
                setRefreshing(true);
                await reload();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: 10, marginTop: 50, paddingHorizontal: 30 }}>
              <Ionicons name="bookmark-outline" size={40} color={C.textFaint} />
              <Text style={styles.empty}>
                {items.length ? 'Rien dans ce filtre.' : 'Ta liste est vide. Sur la fiche d’un film ou d’une série, appuie sur « Ajouter à « À voir » ».'}
              </Text>
            </View>
          }
          renderItem={({ item: x }) => (
            <View style={{ width: cardW }}>
              <PosterCard
                width={cardW}
                item={{
                  key: `${x.type}:${x.tmdbId}`,
                  title: x.title,
                  poster: x.poster,
                  subtitle: [x.type === 'tv' ? 'Série' : 'Film', x.year].filter(Boolean).join(' · '),
                  badge: badgeFor(x.status),
                  onPress: () => openMedia(x.type, x.tmdbId),
                }}
              />
              <Text style={[styles.state, { color: isThere(x) ? C.success : C.textDim }]} numberOfLines={1} onPress={() => remove(x)}>
                {isThere(x) ? '● Disponible' : x.status === MediaStatus.PROCESSING ? '● En cours' : x.status === MediaStatus.PENDING ? '● Demandé' : '○ Pas encore là'}
                {'  '}
                <Text style={{ color: C.textFaint }}>· Retirer</Text>
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
  empty: { color: C.textDim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  state: { fontSize: 12, fontWeight: '700', marginTop: 4 },
});
