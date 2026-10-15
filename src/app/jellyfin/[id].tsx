import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JfPosterCard, playJellyfin } from '@/components/jf-cards';
import { Button, Fade, Pill, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  formatRuntime,
  jf,
  jfBackdrop,
  jfImage,
  jfLogo,
  ticksToSeconds,
  type JfItem,
} from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

const FOLDER_TYPES = ['CollectionFolder', 'UserView', 'Folder', 'BoxSet'];

function BackButton() {
  const insets = useSafeAreaInsets();
  return (
    <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + 8 }]} hitSlop={10}>
      <Ionicons name="chevron-back" size={24} color={C.text} />
    </Pressable>
  );
}

// ——— Grille d'une bibliothèque ———

const SORTS = [
  { label: 'Récents', sort: 'DateCreated', order: 'Descending' as const },
  { label: 'A-Z', sort: 'SortName', order: 'Ascending' as const },
  { label: 'Note', sort: 'CommunityRating', order: 'Descending' as const },
  { label: 'Année', sort: 'ProductionYear,SortName', order: 'Descending' as const },
];

function FolderGrid({ folder }: { folder: JfItem }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sortIdx, setSortIdx] = useState(0);
  const [items, setItems] = useState<JfItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const cols = width > 700 ? 5 : 3;
  const gap = 12;
  const cardW = Math.floor((width - 32 - gap * (cols - 1)) / cols);
  const types =
    folder.CollectionType === 'movies' ? 'Movie' : folder.CollectionType === 'tvshows' ? 'Series' : 'Movie,Series,BoxSet';

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (loading) return;
      setLoading(true);
      try {
        const s = SORTS[sortIdx];
        const res = await jf.items(settings, {
          parentId: folder.Id,
          types,
          sort: s.sort,
          order: s.order,
          start: reset ? 0 : items.length,
          limit: 60,
        });
        setTotal(res.TotalRecordCount);
        setItems((prev) => (reset ? res.Items : [...prev, ...res.Items]));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, folder.Id, sortIdx, items.length, types]
  );

  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortIdx]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        key={cols}
        data={items}
        numColumns={cols}
        keyExtractor={(i) => i.Id}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 18 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => items.length < total && loadPage(false)}
        ListHeaderComponent={
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.screenTitle}>{folder.Name}</Text>
            <Text style={styles.dim}>{total} titres</Text>
            <View style={styles.sorts}>
              {SORTS.map((s, i) => (
                <SegChip key={s.label} label={s.label} on={i === sortIdx} onPress={() => setSortIdx(i)} />
              ))}
            </View>
          </View>
        }
        ListFooterComponent={loading ? <ActivityIndicator color={C.text} style={{ margin: 20 }} /> : null}
        renderItem={({ item }) => <JfPosterCard item={item} width={cardW} />}
      />
      <BackButton />
    </View>
  );
}

// ——— Fiche film / série ———

function ItemDetail({ item, reload }: { item: JfItem; reload: () => void }) {
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [seasons, setSeasons] = useState<JfItem[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<JfItem[]>([]);
  const [loadingEps, setLoadingEps] = useState(false);

  const isSeries = item.Type === 'Series';
  const heroH = Math.round(width * 1.2);
  const logo = jfLogo(settings, item);
  const resumeAt = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const cast = (item.People ?? []).filter((p) => p.Type === 'Actor').slice(0, 15);

  useEffect(() => {
    if (!isSeries) return;
    jf.seasons(settings, item.Id).then((list) => {
      setSeasons(list);
      // Première saison non terminée, sinon la première
      const firstUnwatched = list.find((s) => !s.UserData?.Played) ?? list[0];
      if (firstUnwatched) setSeason((cur) => cur ?? firstUnwatched.Id);
    });
  }, [isSeries, item.Id, settings]);

  useEffect(() => {
    if (!season) return;
    setLoadingEps(true);
    jf.episodes(settings, item.Id, season)
      .then(setEpisodes)
      .finally(() => setLoadingEps(false));
  }, [season, item.Id, settings]);

  const nextEpisode = episodes.find((e) => !e.UserData?.Played) ?? episodes[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ height: heroH }}>
          <Image source={jfBackdrop(settings, item)} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
          <Fade height={heroH * 0.3} top />
          <Fade height={heroH * 0.7} />
          <View style={styles.heroContent}>
            {logo ? (
              <Image source={logo} style={{ width: width * 0.7, height: 100 }} contentFit="contain" contentPosition="bottom" />
            ) : (
              <Text style={styles.title}>{item.Name}</Text>
            )}
            <View style={styles.pills}>
              {item.ProductionYear ? <Pill>{String(item.ProductionYear)}</Pill> : null}
              {item.RunTimeTicks && !isSeries ? <Pill icon="time-outline">{formatRuntime(item.RunTimeTicks)}</Pill> : null}
              {item.OfficialRating ? <Pill>{item.OfficialRating}</Pill> : null}
              {item.CommunityRating ? <Pill icon="star">{item.CommunityRating.toFixed(1)}</Pill> : null}
              {isSeries && item.ChildCount ? <Pill>{`${item.ChildCount} saisons`}</Pill> : null}
            </View>
            {item.Genres?.length ? <Text style={styles.genres}>{item.Genres.slice(0, 3).join('  •  ')}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 18 }}>
          {!isSeries ? (
            <View style={{ gap: 10 }}>
              <Button
                title={resumeAt > 30 ? `Reprendre à ${formatRuntime(item.UserData?.PlaybackPositionTicks)}` : 'Lire'}
                icon="play"
                onPress={() => playJellyfin(item)}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {resumeAt > 30 && (
                  <Button title="Depuis le début" icon="refresh" variant="glass" onPress={() => playJellyfin(item, true)} style={{ flex: 1 }} />
                )}
                <Button
                  title={item.UserData?.Played ? 'Vu' : 'Marquer vu'}
                  icon={item.UserData?.Played ? 'checkmark-circle' : 'checkmark-circle-outline'}
                  variant="glass"
                  onPress={async () => {
                    await jf.setPlayed(settings, item.Id, !item.UserData?.Played).catch(() => {});
                    reload();
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : nextEpisode ? (
            <Button
              title={`Lire S${nextEpisode.ParentIndexNumber}E${nextEpisode.IndexNumber}`}
              icon="play"
              onPress={() => playJellyfin(nextEpisode)}
            />
          ) : null}

          {item.Overview ? <Text style={styles.overview}>{item.Overview}</Text> : null}

          {isSeries && (
            <View>
              <FlatList
                horizontal
                data={seasons}
                keyExtractor={(s) => s.Id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                style={{ marginBottom: 14 }}
                renderItem={({ item: s }) => <SegChip label={s.Name} on={s.Id === season} onPress={() => setSeason(s.Id)} />}
              />
              {loadingEps ? (
                <ActivityIndicator color={C.text} style={{ marginVertical: 20 }} />
              ) : (
                <View style={{ gap: 14 }}>
                  {episodes.map((e) => {
                    const pct = (e.UserData?.PlayedPercentage ?? 0) / 100;
                    return (
                      <Pressable
                        key={e.Id}
                        onPress={() => {
                          tap();
                          playJellyfin(e);
                        }}
                        style={({ pressed }) => [styles.episode, { opacity: pressed ? 0.7 : 1 }]}>
                        <View style={styles.epThumb}>
                          <Image
                            source={jfImage(settings, e.Id, 'Primary', { tag: e.ImageTags?.Primary, maxWidth: 400 })}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                          />
                          <View style={styles.epPlay}>
                            <Ionicons name={e.UserData?.Played ? 'checkmark' : 'play'} size={14} color="#000" />
                          </View>
                          {pct > 0 && pct < 1 && (
                            <View style={styles.epBar}>
                              <View style={[styles.epBarFill, { width: `${pct * 100}%` }]} />
                            </View>
                          )}
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={styles.epTitle} numberOfLines={2}>
                            {e.IndexNumber}. {e.Name}
                          </Text>
                          <Text style={styles.dim}>{formatRuntime(e.RunTimeTicks)}</Text>
                          {e.Overview ? (
                            <Text style={styles.epOverview} numberOfLines={2}>
                              {e.Overview}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {cast.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Casting</Text>
              <FlatList
                horizontal
                data={cast}
                keyExtractor={(c) => c.Id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14 }}
                renderItem={({ item: c }) => (
                  <View style={styles.castItem}>
                    <View style={styles.castPhoto}>
                      {c.PrimaryImageTag ? (
                        <Image
                          source={jfImage(settings, c.Id, 'Primary', { tag: c.PrimaryImageTag, maxHeight: 200 })}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                        />
                      ) : (
                        <Ionicons name="person" size={28} color={C.textFaint} />
                      )}
                    </View>
                    <Text style={styles.castName} numberOfLines={2}>
                      {c.Name}
                    </Text>
                    {c.Role ? (
                      <Text style={styles.castRole} numberOfLines={1}>
                        {c.Role}
                      </Text>
                    ) : null}
                  </View>
                )}
              />
            </View>
          )}
        </View>
      </ScrollView>
      <BackButton />
    </View>
  );
}

export default function JellyfinItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const [item, setItem] = useState<JfItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    jf.item(settings, id)
      .then(setItem)
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings, id]);

  // Recharge au retour du lecteur pour mettre à jour la progression
  useFocusEffect(load);

  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>{error}</Text>
        <BackButton />
      </View>
    );
  if (!item)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.text} size="large" />
      </View>
    );
  if (FOLDER_TYPES.includes(item.Type)) return <FolderGrid folder={item} />;
  return <ItemDetail item={item} reload={load} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  back: {
    position: 'absolute',
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  dim: { color: C.textDim, fontSize: 13 },
  sorts: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 6, flexWrap: 'wrap' },
  sort: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
  sortText: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  heroContent: { position: 'absolute', left: 20, right: 20, bottom: 12, alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  genres: { color: C.text, fontSize: 13, fontWeight: '600', opacity: 0.85 },
  overview: { color: C.text, fontSize: 15, lineHeight: 23, opacity: 0.88 },
  sectionTitle: { color: C.text, fontSize: 20, fontWeight: '800', marginBottom: 12, letterSpacing: -0.3 },
  episode: { flexDirection: 'row', gap: 12 },
  epThumb: { width: 140, height: 79, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  epPlay: {
    position: 'absolute',
    left: 6,
    bottom: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  epBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  epBarFill: { height: 3, backgroundColor: C.text },
  epTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  epOverview: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  castItem: { width: 84, alignItems: 'center' },
  castPhoto: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castName: { color: C.text, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  castRole: { color: C.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 },
});
