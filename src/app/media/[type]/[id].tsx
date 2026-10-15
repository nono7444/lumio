import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  formatBytes,
  invalidateLibrary,
  movieState,
  radarr,
  seriesState,
  sonarr,
  type RadarrMovie,
  type SonarrSeries,
} from '@/lib/arr';
import { arrReady, hasTmdb, useSettings } from '@/lib/settings';
import { tmdb, tmdbImg, type TmdbMovie, type TmdbTv } from '@/lib/tmdb';

type Details =
  | { kind: 'movie'; data: TmdbMovie; arr: RadarrMovie | null; arrError?: string }
  | { kind: 'tv'; data: TmdbTv; arr: SonarrSeries | null; arrError?: string };

type SeasonInfo = { label: string; color: string; monitored: boolean; have: number; total: number };

function seasonInfo(series: SonarrSeries | null, n: number): SeasonInfo | null {
  const s = series?.seasons.find((x) => x.seasonNumber === n);
  if (!s) return null;
  const have = s.statistics?.episodeFileCount ?? 0;
  const total = s.statistics?.episodeCount ?? 0;
  if (total > 0 && have >= total) return { label: 'Complète', color: C.success, monitored: s.monitored, have, total };
  if (have > 0) return { label: `${have}/${total}`, color: C.success, monitored: s.monitored, have, total };
  if (s.monitored) return { label: 'Surveillée', color: C.warning, monitored: true, have, total };
  return { label: '', color: C.textFaint, monitored: false, have, total };
}

export default function MediaScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const tmdbId = Number(id);
  const isTv = type === 'tv';
  const service = isTv ? settings.sonarr : settings.radarr;
  const serviceName = isTv ? 'Sonarr' : 'Radarr';
  const configured = Boolean(service.url && service.apiKey);
  const ready = arrReady(service);

  const load = useCallback(async () => {
    try {
      setError(null);
      if (isTv) {
        const data = await tmdb.tv(settings, tmdbId);
        let arrItem: SonarrSeries | null = null;
        let arrError: string | undefined;
        const tvdb = data.external_ids?.tvdb_id;
        if (configured) {
          if (!tvdb) arrError = 'Pas d’identifiant TVDB sur TMDB : Sonarr ne peut pas l’ajouter.';
          else arrItem = await sonarr.byTvdb(settings.sonarr, tvdb).catch((e) => ((arrError = e.message), null));
        }
        setDetails({ kind: 'tv', data, arr: arrItem, arrError });
      } else {
        const data = await tmdb.movie(settings, tmdbId);
        let arrError: string | undefined;
        const arrItem = configured
          ? await radarr.byTmdb(settings.radarr, tmdbId).catch((e) => ((arrError = e.message), null))
          : null;
        setDetails({ kind: 'movie', data, arr: arrItem, arrError });
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [isTv, tmdbId, settings, configured]);

  useEffect(() => {
    if (hasTmdb(settings)) load();
  }, [load, settings]);

  // Saisons qu'on peut encore demander : pas encore surveillées et incomplètes
  const requestable = useMemo(() => {
    if (details?.kind !== 'tv') return [];
    return details.data.seasons
      .filter((s) => s.season_number > 0)
      .filter((s) => {
        const info = seasonInfo(details.arr, s.season_number);
        return !info || (!info.monitored && (info.total === 0 || info.have < info.total));
      })
      .map((s) => s.season_number);
  }, [details]);

  if (!hasTmdb(settings)) return <SetupPrompt />;
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
  const date = details.kind === 'movie' ? details.data.release_date : details.data.first_air_date;
  const state = details.arr ? (details.kind === 'movie' ? movieState(details.arr) : seriesState(details.arr)) : null;
  const backdropH = Math.round(width * 0.62);
  const seasonsList = details.kind === 'tv' ? details.data.seasons.filter((s) => s.season_number > 0) : [];

  const meta = [
    date?.slice(0, 4),
    details.kind === 'movie' && details.data.runtime ? `${details.data.runtime} min` : null,
    details.kind === 'tv' ? `${seasonsList.length} saison(s)` : null,
    d.vote_average ? `★ ${d.vote_average.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      invalidateLibrary();
      Alert.alert('C’est parti 🚀', success);
      setSelected(new Set());
      await load();
    } catch (e: any) {
      Alert.alert(`${serviceName} a refusé`, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function addMovie() {
    run(
      () => radarr.add(settings.radarr, tmdbId),
      `« ${title} » ajouté à Radarr${settings.radarr.searchOnAdd ? ', recherche lancée.' : '.'}`
    );
  }

  function searchMovie() {
    if (details?.kind !== 'movie' || !details.arr?.id) return;
    const movieId = details.arr.id;
    run(() => radarr.search(settings.radarr, movieId), `Recherche relancée pour « ${title} ».`);
  }

  function requestSeasons(all: boolean) {
    if (details?.kind !== 'tv') return;
    const seasons = all ? requestable : [...selected].sort((a, b) => a - b);
    if (!seasons.length) return;
    const tvdb = details.data.external_ids?.tvdb_id;
    const existing = details.arr;
    run(
      () =>
        existing
          ? sonarr.monitorSeasons(settings.sonarr, existing, seasons)
          : sonarr.add(settings.sonarr, tvdb!, seasons),
      `${seasons.length} saison(s) de « ${title} » envoyée(s) à Sonarr.`
    );
  }

  const movieFile = details.kind === 'movie' ? details.arr?.movieFile : undefined;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
      <View style={{ height: backdropH }}>
        {d.backdrop_path && (
          <Image source={tmdbImg(d.backdrop_path, 'w1280')} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        )}
        <View style={styles.backdropFade} />
      </View>

      <View style={styles.headRow}>
        <View style={styles.poster}>
          {d.poster_path && <Image source={tmdbImg(d.poster_path, 'w342')} style={StyleSheet.absoluteFill} contentFit="cover" />}
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 6 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.dim}>{meta}</Text>
          {state && <Chip label={state.label} color={state.color} />}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 18, marginTop: 18 }}>
        {d.genres?.length ? <Text style={styles.dim}>{d.genres.map((g) => g.name).join(' · ')}</Text> : null}
        {d.overview ? <Text style={styles.overview}>{d.overview}</Text> : null}

        {/* ——— Bloc d'action *arr ——— */}
        {!configured ? (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={C.textDim} />
            <Text style={[styles.dim, { flex: 1 }]}>Connecte {serviceName} dans les réglages pour l'ajouter.</Text>
          </View>
        ) : details.arrError ? (
          <View style={styles.notice}>
            <Ionicons name="warning-outline" size={18} color={C.danger} />
            <Text style={[styles.dim, { flex: 1, color: C.danger }]}>
              {serviceName} : {details.arrError}
            </Text>
          </View>
        ) : !ready && !details.arr ? (
          <View style={styles.notice}>
            <Ionicons name="options-outline" size={18} color={C.warning} />
            <Text style={[styles.dim, { flex: 1 }]}>Choisis un profil de qualité et un dossier racine pour {serviceName}.</Text>
          </View>
        ) : null}

        {details.kind === 'movie' && configured && !details.arrError && (
          <>
            {!details.arr && ready && (
              <Button title="Ajouter à Radarr" icon="add-circle-outline" onPress={addMovie} loading={busy} />
            )}
            {details.arr && !details.arr.hasFile && (
              <Button title="Relancer la recherche" icon="refresh" variant="secondary" onPress={searchMovie} loading={busy} />
            )}
            {details.arr?.hasFile && (
              <View style={styles.notice}>
                <Ionicons name="checkmark-circle" size={18} color={C.success} />
                <Text style={[styles.dim, { flex: 1 }]}>
                  Dans ta bibliothèque
                  {movieFile?.quality?.quality?.name ? ` · ${movieFile.quality.quality.name}` : ''}
                  {movieFile?.languages?.length ? ` · ${movieFile.languages.map((l) => l.name).join(', ')}` : ''}
                  {details.arr.sizeOnDisk ? ` · ${formatBytes(details.arr.sizeOnDisk)}` : ''}
                </Text>
              </View>
            )}
          </>
        )}

        {details.kind === 'tv' && (
          <View style={styles.seasons}>
            <Text style={styles.sectionTitle}>Saisons</Text>
            {seasonsList.map((s) => {
              const info = seasonInfo(details.arr, s.season_number);
              const can = requestable.includes(s.season_number) && configured && !details.arrError && (ready || !!details.arr);
              const on = selected.has(s.season_number);
              return (
                <Pressable
                  key={s.id}
                  disabled={!can}
                  onPress={() => {
                    const next = new Set(selected);
                    if (on) next.delete(s.season_number);
                    else next.add(s.season_number);
                    setSelected(next);
                  }}
                  style={styles.seasonRow}>
                  <Ionicons
                    name={can ? (on ? 'checkbox' : 'square-outline') : info?.label ? 'checkmark-circle' : 'remove-circle-outline'}
                    size={22}
                    color={can ? (on ? C.accent : C.textDim) : (info?.color ?? C.textFaint)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.seasonName}>{s.name || `Saison ${s.season_number}`}</Text>
                    <Text style={styles.dim}>
                      {s.episode_count} épisodes{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ''}
                    </Text>
                  </View>
                  {info?.label ? <Chip label={info.label} color={info.color} /> : null}
                </Pressable>
              );
            })}
            {configured && !details.arrError && (ready || details.arr) ? (
              requestable.length > 0 ? (
                <View style={{ gap: 10, marginTop: 12 }}>
                  <Button
                    title={selected.size ? `Envoyer ${selected.size} saison(s) à Sonarr` : 'Sélectionne des saisons'}
                    icon="add-circle-outline"
                    disabled={selected.size === 0}
                    loading={busy && selected.size > 0}
                    onPress={() => requestSeasons(false)}
                  />
                  <Button
                    title={`Tout envoyer (${requestable.length})`}
                    variant="secondary"
                    onPress={() => requestSeasons(true)}
                    disabled={busy}
                  />
                </View>
              ) : (
                <Text style={[styles.dim, { marginTop: 10 }]}>Toutes les saisons sont déjà surveillées ou complètes.</Text>
              )
            ) : null}
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  seasons: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  seasonName: { color: C.text, fontSize: 15, fontWeight: '600' },
});
