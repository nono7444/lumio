import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PosterCard, ScreenTitle, SegChip, SetupPrompt } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
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

/** Recherche rapide par thème : les mieux notés d'abord */
type Theme = { id: string; label: string; emoji: string; genre?: number; tvGenre?: number; keyword?: string };
const THEMES: Theme[] = [
  { id: 'noel', label: 'Noël', emoji: '🎄', keyword: 'christmas' },
  { id: 'halloween', label: 'Halloween', emoji: '🎃', keyword: 'halloween' },
  { id: 'valentin', label: 'Saint-Valentin', emoji: '💘', keyword: "valentine's day" },
  { id: 'action', label: 'Action', emoji: '💥', genre: 28, tvGenre: 10759 },
  { id: 'comedie', label: 'Comédie', emoji: '😂', genre: 35, tvGenre: 35 },
  { id: 'horreur', label: 'Horreur', emoji: '👻', genre: 27, tvGenre: 9648 },
  { id: 'thriller', label: 'Thriller', emoji: '🔪', genre: 53, tvGenre: 80 },
  { id: 'sf', label: 'Science-fiction', emoji: '🚀', genre: 878, tvGenre: 10765 },
  { id: 'aventure', label: 'Aventure', emoji: '🗺️', genre: 12, tvGenre: 10759 },
  { id: 'animation', label: 'Animation', emoji: '🎨', genre: 16, tvGenre: 16 },
  { id: 'famille', label: 'Famille', emoji: '👨‍👩‍👧', genre: 10751, tvGenre: 10751 },
  { id: 'romance', label: 'Romance', emoji: '❤️', genre: 10749, tvGenre: 18 },
  { id: 'drame', label: 'Drame', emoji: '🎭', genre: 18, tvGenre: 18 },
  { id: 'crime', label: 'Policier', emoji: '🕵️', genre: 80, tvGenre: 80 },
  { id: 'guerre', label: 'Guerre', emoji: '🎖️', genre: 10752, tvGenre: 10768 },
  { id: 'docu', label: 'Documentaire', emoji: '🎥', genre: 99, tvGenre: 99 },
  { id: 'superheros', label: 'Super-héros', emoji: '🦸', keyword: 'superhero' },
];

export default function Search() {
  const { settings } = useSettings();
  const badge = useLibrary();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<TmdbItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);

  const cols = width > 700 ? 5 : 3;
  const gap = 12;
  const cardW = Math.floor((width - 32 - gap * (cols - 1)) / cols);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setError(null);
      // Pas de texte mais un thème choisi : les mieux notés de ce thème
      if (theme) {
        const id = ++reqId.current;
        const type: MediaType = filter === 'tv' ? 'tv' : 'movie';
        const genre = type === 'tv' ? theme.tvGenre : theme.genre;
        if (!genre && !theme.keyword) {
          setResults([]);
          return;
        }
        setLoading(true);
        tmdb
          .best(settings, type, { genre, keyword: theme.keyword })
          .then((r) => id === reqId.current && setResults(r))
          .catch((e) => id === reqId.current && setError(e?.message ?? 'Erreur'))
          .finally(() => id === reqId.current && setLoading(false));
      } else setResults([]);
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
  }, [query, filter, settings, theme]);

  if (!hasTmdb(settings)) return <SetupPrompt />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Recherche" />
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
          <SegChip key={f.value} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
        {/* Menu déroulant des thèmes */}
        <SegChip
          label={theme ? `${theme.emoji} ${theme.label}` : 'Thèmes'}
          icon="chevron-down"
          on={Boolean(theme)}
          onPress={() => setThemeOpen(true)}
        />
      </View>
      {theme && query.trim().length < 2 ? (
        <Text style={styles.themeHint}>
          Les {filter === 'tv' ? 'séries' : 'films'} « {theme.label} » les mieux notés
        </Text>
      ) : null}
      <Modal visible={themeOpen} transparent animationType="fade" onRequestClose={() => setThemeOpen(false)}>
        <Pressable style={styles.menuBg} onPress={() => setThemeOpen(false)}>
          <View style={styles.menu}>
            <ScrollView>
              <Pressable
                onPress={() => {
                  setTheme(null);
                  setThemeOpen(false);
                }}
                style={styles.menuItem}>
                <Text style={styles.menuText}>Aucun thème</Text>
              </Pressable>
              {THEMES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    setTheme(t);
                    setQuery('');
                    setThemeOpen(false);
                  }}
                  style={[styles.menuItem, theme?.id === t.id && { backgroundColor: 'rgba(61,139,255,0.18)' }]}>
                  <Text style={styles.menuText}>
                    {t.emoji}  {t.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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
        contentContainerStyle={{ padding: 16, paddingBottom: TAB_SPACE, gap: 18 }}
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
                ids: { tmdb: r.id, type },
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
    marginHorizontal: 16,
    paddingHorizontal: 14,
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
  },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  filter: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
  filterOn: { backgroundColor: C.text },
  filterText: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  msg: { color: C.textDim, textAlign: 'center', marginTop: 24 },
  themeHint: { color: C.textDim, fontSize: 13, paddingHorizontal: 16, marginTop: 10 },
  menuBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 40 },
  menu: { backgroundColor: C.surface, borderRadius: R.lg, maxHeight: '75%', paddingVertical: 6 },
  menuItem: { paddingVertical: 13, paddingHorizontal: 18 },
  menuText: { color: C.text, fontSize: 16, fontWeight: '600' },
});
