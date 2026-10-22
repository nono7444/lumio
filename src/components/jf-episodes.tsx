// Choix de l'épisode d'une série présente dans Jellyfin : saisons en puces, puis la liste des épisodes à lancer.
// Rapide : saison suivante préchargée, saisons déjà vues affichées tout de suite (puis mises à jour),
// vignettes sans attendre que Jellyfin extraie une image de la vidéo, longues saisons affichées par 30.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { playJellyfin } from '@/components/jf-cards';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { formatRuntime, jf, jfEpisodeThumb, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

/** Saisons et épisodes d'une série Jellyfin (partagé par la fiche Jellyfin et la fiche TMDB). */
export function useSeriesEpisodes(seriesId: string | undefined) {
  const { settings } = useSettings();
  const [seasons, setSeasons] = useState<JfItem[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<JfItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!seriesId) return;
    jf.seasons(settings, seriesId)
      .then((list) => {
        setSeasons(list);
        // Première saison pas terminée, sinon la première
        const first = list.find((s) => !s.UserData?.Played) ?? list[0];
        if (first) setSeason((cur) => cur ?? first.Id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, settings.jellyfin?.token]);

  useEffect(() => {
    if (!season || !seriesId) return;
    let alive = true;
    const cached = jf.cachedEpisodes(settings, season);
    setEpisodes(cached ?? []);
    setLoading(!cached);
    jf.episodes(settings, seriesId, season)
      .then((list) => {
        if (!alive) return;
        setEpisodes(list);
        // Saison suivante préchargée en arrière-plan : le changement de saison est instantané
        const i = seasons.findIndex((s) => s.Id === season);
        const next = seasons[i + 1];
        if (next && !jf.cachedEpisodes(settings, next.Id)) jf.episodes(settings, seriesId, next.Id).catch(() => {});
      })
      .catch(() => alive && !cached && setEpisodes([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, seriesId, seasons.length, settings.jellyfin?.token]);

  return { seasons, season, setSeason, episodes, loading };
}

/** Puces des saisons + liste des épisodes. */
export function EpisodePicker({
  seasons,
  season,
  setSeason,
  episodes,
  loading,
  title,
}: ReturnType<typeof useSeriesEpisodes> & { title?: string }) {
  const { settings } = useSettings();
  const [limit, setLimit] = useState(30);
  useEffect(() => setLimit(30), [season]);
  if (!seasons.length) return null;
  const shown = episodes.slice(0, limit);
  return (
    <View>
      {title ? <Text style={styles.section}>{title}</Text> : null}
      <FlatList
        horizontal
        data={seasons}
        keyExtractor={(s) => s.Id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        style={{ marginBottom: 14 }}
        renderItem={({ item: s }) => <SegChip label={s.Name} on={s.Id === season} onPress={() => setSeason(s.Id)} />}
      />
      {loading && !episodes.length ? (
        <ActivityIndicator color={C.text} style={{ marginVertical: 20 }} />
      ) : (
        <View style={{ gap: 14 }}>
          {shown.map((e) => {
            const pct = (e.UserData?.PlayedPercentage ?? 0) / 100;
            return (
              <Pressable
                key={e.Id}
                onPress={() => {
                  tap();
                  playJellyfin(e);
                }}
                style={({ pressed }) => [styles.episode, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={styles.thumb}>
                  <Image
                    source={jfEpisodeThumb(settings, e)}
                    recyclingKey={e.Id}
                    cachePolicy="memory-disk"
                    transition={120}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  <View style={styles.play}>
                    <Ionicons name={e.UserData?.Played ? 'checkmark' : 'play'} size={14} color="#000" />
                  </View>
                  {pct > 0 && pct < 1 ? (
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {e.IndexNumber}. {e.Name}
                  </Text>
                  <Text style={styles.dim}>{formatRuntime(e.RunTimeTicks)}</Text>
                  {e.Overview ? (
                    <Text style={styles.overview} numberOfLines={2}>
                      {e.Overview}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {episodes.length > limit ? (
            <Button
              title={`Afficher plus (${episodes.length - limit} épisodes)`}
              icon="chevron-down"
              variant="secondary"
              onPress={() => setLimit((n) => n + 30)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Fiche TMDB d'une série présente dans Jellyfin. */
export function JfEpisodes({ seriesId }: { seriesId: string }) {
  const state = useSeriesEpisodes(seriesId);
  return <EpisodePicker {...state} title="Épisodes" />;
}

const styles = StyleSheet.create({
  section: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  episode: { flexDirection: 'row', gap: 12 },
  thumb: { width: 140, height: 79, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  play: {
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
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  barFill: { height: 3, backgroundColor: C.text },
  title: { color: C.text, fontSize: 14, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 13 },
  overview: { color: C.textDim, fontSize: 12, lineHeight: 17 },
});
