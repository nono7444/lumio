import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, SetupPrompt } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  MEDIA_STATUS,
  mediaStatusLabel,
  seerr,
  tmdbImg,
  type MediaInfo,
  type MovieDetails,
  type TvDetails,
} from '@/lib/seerr';
import { isSeerrConfigured, useSettings } from '@/lib/settings';

type Details = { kind: 'movie'; data: MovieDetails } | { kind: 'tv'; data: TvDetails };

function seasonStatus(info: MediaInfo | undefined, n: number) {
  return info?.seasons?.find((s) => s.seasonNumber === n)?.status ?? MEDIA_STATUS.UNKNOWN;
}

export default function MediaScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [requesting, setRequesting] = useState(false);

  const tmdbId = Number(id);

  const load = useCallback(async () => {
    try {
      setError(null);
      if (type === 'tv') setDetails({ kind: 'tv', data: await seerr.tv(settings, tmdbId) });
      else setDetails({ kind: 'movie', data: await seerr.movie(settings, tmdbId) });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [type, tmdbId, settings]);

  useEffect(() => {
    if (isSeerrConfigured(settings)) load();
  }, [load, settings]);

  const requestableSeasons = useMemo(() => {
    if (details?.kind !== 'tv') return [];
    return details.data.seasons
      .filter((s) => s.seasonNumber > 0)
      .filter((s) => seasonStatus(details.data.mediaInfo, s.seasonNumber) === MEDIA_STATUS.UNKNOWN)
      .map((s) => s.seasonNumber);
  }, [details]);

  if (!isSeerrConfigured(settings)) return <SetupPrompt />;
  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>Erreur : {error}</Text>
        <Button title="Réessayer" onPress={load} variant="secondary" style={{ marginTop: 14 }} />
      </View>
    );
  if (!details)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );

  const d = details.data;
  const title = details.kind === 'movie' ? details.data.title : details.data.name;
  const date = details.kind === 'movie' ? details.data.releaseDate : details.data.firstAirDate;
  const status = mediaStatusLabel(d.mediaInfo?.status);
  const backdropH = Math.round(width * 0.62);
  const jellyfinUrl = d.mediaInfo?.mediaUrl;

  const meta = [
    date?.slice(0, 4),
    details.kind === 'movie' && details.data.runtime ? `${details.data.runtime} min` : null,
    details.kind === 'tv' ? `${details.data.seasons.filter((s) => s.seasonNumber > 0).length} saison(s)` : null,
    d.voteAverage ? `★ ${d.voteAverage.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function requestMovie() {
    setRequesting(true);
    try {
      await seerr.requestMovie(settings, tmdbId);
      Alert.alert('Demande envoyée', `« ${title} » a été demandé.`);
      await load();
    } catch (e: any) {
      Alert.alert('Échec', e?.message ?? String(e));
    } finally {
      setRequesting(false);
    }
  }

  async function requestSeasons(all: boolean) {
    const seasons = all ? requestableSeasons : [...selected].sort((a, b) => a - b);
    if (seasons.length === 0) return;
    setRequesting(true);
    try {
      await seerr.requestTv(settings, tmdbId, seasons);
      Alert.alert('Demande envoyée', `${seasons.length} saison(s) de « ${title} » demandée(s).`);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      Alert.alert('Échec', e?.message ?? String(e));
    } finally {
      setRequesting(false);
    }
  }

  const movieRequestable = details.kind === 'movie' && (d.mediaInfo?.status ?? MEDIA_STATUS.UNKNOWN) === MEDIA_STATUS.UNKNOWN;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
      <View style={{ height: backdropH }}>
        {d.backdropPath && (
          <Image source={tmdbImg(d.backdropPath, 'w1280')} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        )}
        <View style={styles.backdropFade} />
      </View>

      <View style={styles.headRow}>
        <View style={styles.poster}>
          {d.posterPath && <Image source={tmdbImg(d.posterPath, 'w342')} style={StyleSheet.absoluteFill} contentFit="cover" />}
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 6 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.dim}>{meta}</Text>
          {status && <Chip label={status.label} color={status.color} />}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 18, marginTop: 18 }}>
        {d.genres?.length ? <Text style={styles.dim}>{d.genres.map((g) => g.name).join(' · ')}</Text> : null}
        {d.overview ? <Text style={styles.overview}>{d.overview}</Text> : null}

        {jellyfinUrl ? (
          <Button title="Ouvrir dans Jellyfin" icon="play" variant="secondary" onPress={() => Linking.openURL(jellyfinUrl)} />
        ) : null}

        {details.kind === 'movie' && movieRequestable && (
          <Button title="Demander" icon="add-circle-outline" onPress={requestMovie} loading={requesting} />
        )}

        {details.kind === 'tv' && (
          <View style={styles.seasons}>
            <Text style={styles.sectionTitle}>Saisons</Text>
            {details.data.seasons
              .filter((s) => s.seasonNumber > 0)
              .map((s) => {
                const st = seasonStatus(details.data.mediaInfo, s.seasonNumber);
                const label = mediaStatusLabel(st);
                const can = st === MEDIA_STATUS.UNKNOWN;
                const on = selected.has(s.seasonNumber);
                return (
                  <Pressable
                    key={s.id}
                    disabled={!can}
                    onPress={() => {
                      const next = new Set(selected);
                      if (on) next.delete(s.seasonNumber);
                      else next.add(s.seasonNumber);
                      setSelected(next);
                    }}
                    style={styles.seasonRow}>
                    <Ionicons
                      name={can ? (on ? 'checkbox' : 'square-outline') : 'checkmark-circle'}
                      size={22}
                      color={can ? (on ? C.accent : C.textDim) : (label?.color ?? C.textFaint)}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.seasonName}>{s.name || `Saison ${s.seasonNumber}`}</Text>
                      <Text style={styles.dim}>{s.episodeCount} épisodes</Text>
                    </View>
                    {label && <Chip label={label.label} color={label.color} />}
                  </Pressable>
                );
              })}
            {requestableSeasons.length > 0 ? (
              <View style={{ gap: 10, marginTop: 12 }}>
                <Button
                  title={selected.size ? `Demander ${selected.size} saison(s)` : 'Sélectionne des saisons'}
                  icon="add-circle-outline"
                  disabled={selected.size === 0}
                  loading={requesting && selected.size > 0}
                  onPress={() => requestSeasons(false)}
                />
                <Button
                  title={`Tout demander (${requestableSeasons.length})`}
                  variant="secondary"
                  onPress={() => requestSeasons(true)}
                  disabled={requesting}
                />
              </View>
            ) : (
              <Text style={[styles.dim, { marginTop: 10 }]}>Toutes les saisons sont déjà demandées ou disponibles.</Text>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdropFade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,13,18,0.45)' },
  headRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, marginTop: -70 },
  poster: {
    width: 110,
    height: 165,
    borderRadius: R.md,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  title: { color: C.text, fontSize: 24, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13 },
  overview: { color: C.text, fontSize: 15, lineHeight: 22, opacity: 0.9 },
  seasons: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  seasonName: { color: C.text, fontSize: 15, fontWeight: '600' },
});
