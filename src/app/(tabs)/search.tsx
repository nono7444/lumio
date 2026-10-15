import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { PosterCard, SetupPrompt } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { mediaStatusLabel, seerr, tmdbImg, type SearchResult } from '@/lib/seerr';
import { isSeerrConfigured, useSettings } from '@/lib/settings';

export default function Search() {
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
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
        const res = await seerr.search(settings, q);
        if (id === reqId.current) {
          setResults(res.results.filter((r) => r.mediaType === 'movie' || r.mediaType === 'tv'));
          setError(null);
        }
      } catch (e: any) {
        if (id === reqId.current) setError(e?.message ?? 'Erreur');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, settings]);

  if (!isSeerrConfigured(settings)) return <SetupPrompt />;

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
      {error ? <Text style={styles.msg}>Erreur : {error}</Text> : null}
      {!error && !loading && query.trim().length >= 2 && results.length === 0 ? (
        <Text style={styles.msg}>Aucun résultat.</Text>
      ) : null}
      <FlatList
        key={cols}
        data={results}
        numColumns={cols}
        keyExtractor={(r) => `${r.mediaType}:${r.id}`}
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, gap: 18 }}
        columnWrapperStyle={{ gap }}
        renderItem={({ item: r }) => (
          <PosterCard
            width={cardW}
            item={{
              key: `${r.mediaType}:${r.id}`,
              title: r.title ?? r.name ?? '',
              poster: tmdbImg(r.posterPath),
              subtitle: `${r.mediaType === 'movie' ? 'Film' : 'Série'} · ${(r.releaseDate || r.firstAirDate || '').slice(0, 4)}`,
              badge: mediaStatusLabel(r.mediaInfo?.status),
              onPress: () => openMedia(r.mediaType as 'movie' | 'tv', r.id),
            }}
          />
        )}
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
  msg: { color: C.textDim, textAlign: 'center', marginTop: 24 },
});
