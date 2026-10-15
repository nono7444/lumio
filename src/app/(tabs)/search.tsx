import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { PosterCard, SetupPrompt } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { hasTmdb, useSettings } from '@/lib/settings';
import { itemTitle, itemYear, tmdb, tmdbImg, type MediaType, type TmdbItem } from '@/lib/tmdb';
import { useLibrary } from '@/lib/use-library';

type Filter = 'all' | MediaType;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'movie', label: 'Films' },
  { value: 'tv', label: 'Séries' },
];

export default function Search() {
  const { settings } = useSettings();
  const badge = useLibrary();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<TmdbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const cols = width > 700 ? 5 : 3;
  const gap = 12;
  const cardW = Math.floor((width - 32 - gap * (cols - 1)) / cols);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res =
          filter === 'all'
            ? await tmdb.search(settings, q)
            : await tmdb.searchType(settings, filter, q).then((r) => ({
                results: r.results.map((i) => ({ ...i, media_type: filter })),
              }));
        if (id === reqId.current) {
          setResults(res.results);
          setError(null);
        }
      } catch (e: any) {
        if (id === reqId.current) setError(e?.message ?? 'Erreur');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, filter, settings]);

  if (!hasTmdb(settings)) return <SetupPrompt />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={C.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Film, série…"
          placeholderTextColor={C.textFaint}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading && <ActivityIndicator color={C.accent} size="small" />}
      </View>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            onPress={() => setFilter(f.value)}
            style={[styles.filter, filter === f.value && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.value && { color: C.text }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.msg}>Erreur : {error}</Text> : null}
      {!error && !loading && query.trim().length >= 2 && results.length === 0 ? (
        <Text style={styles.msg}>Aucun résultat.</Text>
      ) : null}
      <FlatList
        key={cols}
        data={results}
        numColumns={cols}
        keyExtractor={(r) => `${r.media_type}:${r.id}`}
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, gap: 18 }}
        columnWrapperStyle={{ gap }}
        renderItem={({ item: r }) => {
          const type = r.media_type as MediaType;
          return (
            <PosterCard
              width={cardW}
              item={{
                key: `${type}:${r.id}`,
                title: itemTitle(r),
                poster: tmdbImg(r.poster_path),
                subtitle: `${type === 'movie' ? 'Film' : 'Série'}${itemYear(r) ? ` · ${itemYear(r)}` : ''}`,
                badge: badge(type, r.id),
                onPress: () => openMedia(type, r.id),
              }}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    marginBottom: 0,
    paddingHorizontal: 14,
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 12 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  filter: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  filterText: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  msg: { color: C.textDim, textAlign: 'center', marginTop: 24 },
});
