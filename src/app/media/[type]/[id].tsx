import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Fade, Pill, SetupPrompt, tap } from '@/components/ui';
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
import { jf, type JfItem } from '@/lib/jellyfin';
import { askFolder } from '@/components/folder-picker';
import { FamilyRating } from '@/components/family-rating';
import { ReportProblemButton } from '@/components/report-problem';
import { RequestSection } from '@/components/request-section';
import { TrailerButton } from '@/components/trailer-button';
import { grab, mediaFlavor } from '@/lib/grab';
import { useServerRequests } from '@/lib/requests';
import { chat } from '@/lib/chat';
import { arrReady, hasTmdb, isManager, useSettings } from '@/lib/settings';
import { pickLogo, tmdb, tmdbImg, upcomingRelease, type TmdbMovie, type TmdbTv } from '@/lib/tmdb';

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
  const { width, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [jfItem, setJfItem] = useState<JfItem | null>(null);

  const tmdbId = Number(id);
  const isTv = type === 'tv';
  const service = isTv ? settings.sonarr : settings.radarr;
  const serviceName = isTv ? 'Sonarr' : 'Radarr';
  const manager = isManager(settings);
  // Serveur Lumio : demandes façon Seerr pour tout le monde (admin compris)
  const serverReq = useServerRequests();
  const configured = manager && serverReq === false && Boolean(service.url && service.apiKey);
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
        jf.findByTmdb(settings, 'tv', tmdbId, data.name, data.external_ids?.imdb_id).then(setJfItem).catch(() => {});
      } else {
        const data = await tmdb.movie(settings, tmdbId);
        let arrError: string | undefined;
        const arrItem = configured
          ? await radarr.byTmdb(settings.radarr, tmdbId).catch((e) => ((arrError = e.message), null))
          : null;
        setDetails({ kind: 'movie', data, arr: arrItem, arrError });
        jf.findByTmdb(settings, 'movie', tmdbId, data.title, data.imdb_id).then(setJfItem).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [isTv, tmdbId, settings, configured]);

  useEffect(() => {
    if (hasTmdb(settings)) load();
  }, [load, settings]);

  // Téléchargement terminé : on recherche le titre dans Jellyfin pour que « Lire » apparaisse
  const refreshJf = useCallback(() => {
    if (!details) return;
    jf.invalidateIndex();
    const name = details.kind === 'movie' ? details.data.title : details.data.name;
    const imdb = details.kind === 'movie' ? details.data.imdb_id : details.data.external_ids?.imdb_id;
    jf.findByTmdb(settings, details.kind, tmdbId, name, imdb).then((i) => i && setJfItem(i)).catch(() => {});
  }, [details, settings, tmdbId]);

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
  // « Disponible le … » si le titre n'est pas encore sorti (et pas déjà sur le serveur)
  const upcoming = jfItem ? null : upcomingRelease(details.kind, details.data);
  const state = details.arr ? (details.kind === 'movie' ? movieState(details.arr) : seriesState(details.arr)) : null;
  const seasonsList = details.kind === 'tv' ? details.data.seasons.filter((s) => s.season_number > 0) : [];


  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      const res = await action();
      // grab() renvoie null quand on a annulé le choix du dossier
      if (res === null) return;
      invalidateLibrary();
      Alert.alert('C’est parti 🚀', typeof res === 'string' ? res : success);
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
      () => grab(settings, { type: 'movie', tmdbId }, { chooseFolder: askFolder }),
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
          : tvdb
            ? grab(settings, { type: 'tv', tmdbId, seasons }, { chooseFolder: askFolder })
            : Promise.reject(new Error('Pas d’identifiant TVDB')),
      `${seasons.length} saison(s) de « ${title} » envoyée(s) à Sonarr.`
    );
  }

  const movieFile = details.kind === 'movie' ? details.arr?.movieFile : undefined;
  const imdbId = details.kind === 'movie' ? details.data.imdb_id : details.data.external_ids?.imdb_id;
  const logo = pickLogo(settings, d.images);
  // Sur TV (paysage), le hero ne dépasse pas l'écran
  const heroH = Math.min(Math.round(width * 1.2), Math.round(screenH * 0.85));
  const cast = (d.credits?.cast ?? []).slice(0, 15);
  const runtime =
    details.kind === 'movie' ? details.data.runtime : details.data.episode_run_time?.[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* ——— Hero ——— */}
        <View style={{ height: heroH }}>
          <Image
            source={tmdbImg(d.backdrop_path ?? d.poster_path, 'w1280')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
          />
          <Fade height={heroH * 0.3} top />
          <Fade height={heroH * 0.7} />
          <View style={styles.heroContent}>
            {logo ? (
              <Image
                source={tmdbImg(logo, 'w500')}
                style={{ width: Math.min(width * 0.7, 460), height: 100 }}
                contentFit="contain"
                contentPosition="bottom"
                transition={250}
              />
            ) : (
              <Text style={styles.title}>{title}</Text>
            )}
            <View style={styles.pills}>
              {date ? <Pill>{date.slice(0, 4)}</Pill> : null}
              {runtime ? <Pill icon="time-outline">{`${runtime} min`}</Pill> : null}
              {details.kind === 'tv' ? <Pill>{`${seasonsList.length} saison${seasonsList.length > 1 ? 's' : ''}`}</Pill> : null}
              {d.vote_average ? <Pill icon="star">{d.vote_average.toFixed(1)}</Pill> : null}
            </View>
            {d.genres?.length ? (
              <Text style={styles.genres}>{d.genres.slice(0, 3).map((g) => g.name).join('  •  ')}</Text>
            ) : null}
            {state && <Chip label={state.label} color={state.color} />}
            {upcoming ? (
              <View style={styles.upcoming}>
                <Ionicons name="calendar-outline" size={15} color="#FFC93C" />
                <Text style={styles.upcomingText}>{upcoming}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 20, marginTop: 4 }}>
          {/* ——— Lecture : uniquement depuis Jellyfin ——— */}
          {jfItem ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="Lire"
                icon="play"
                onPress={() =>
                  router.push({
                    pathname: '/watch',
                    params: { type: details.kind, tmdbId: String(tmdbId), imdb: imdbId ?? '', title },
                  })
                }
                style={{ flex: 1.4 }}
              />
              <Button
                title="Jellyfin"
                icon="albums-outline"
                variant="glass"
                onPress={() => router.push({ pathname: '/jellyfin/[id]', params: { id: jfItem.Id } })}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}

          <TrailerButton type={details.kind} tmdbId={tmdbId} title={title} />

          {/* ——— Demande façon Seerr (serveur Lumio) ——— */}
          {serverReq ? (
            <RequestSection
              inJellyfin={Boolean(jfItem)}
              onAvailable={refreshJf}
              target={{
                type: details.kind,
                tmdbId,
                tvdbId: details.kind === 'tv' ? details.data.external_ids?.tvdb_id : undefined,
                title,
                year: date?.slice(0, 4),
                poster: tmdbImg(d.poster_path, 'w342'),
                backdrop: tmdbImg(d.backdrop_path, 'w780'),
                seasons: details.kind === 'tv' ? details.data.seasons : [],
                flavor: mediaFlavor(details.data),
              }}
            />
          ) : null}

          {/* ——— Notes de la famille + signalement d'un problème ——— */}
          {serverReq ? (
            <View style={{ gap: 6 }}>
              <FamilyRating type={details.kind} tmdbId={tmdbId} title={title} poster={tmdbImg(d.poster_path, 'w342')} />
              {jfItem ? (
                <ReportProblemButton type={details.kind} tmdbId={tmdbId} title={title} poster={tmdbImg(d.poster_path, 'w342')} />
              ) : null}
            </View>
          ) : null}

          {/* ——— Proposer le titre dans le chat famille ——— */}
          {/* Proposer : seulement pour un titre pas encore sur le serveur */}
          {settings.chatUrl && settings.jellyfin && !jfItem ? (
            <Button
              title="Proposer"
              icon="chatbubbles-outline"
              variant="secondary"
              onPress={() =>
                Alert.prompt
                  ? Alert.prompt('Proposer', 'Un petit mot pour la famille (facultatif) ?', async (msg) => {
                      try {
                        await chat.send(settings, msg ?? '', {
                          type: details.kind,
                          tmdbId,
                          title,
                          year: date?.slice(0, 4),
                          poster: tmdbImg(d.poster_path, 'w342'),
                        });
                        Alert.alert('Proposé ✅', 'Ta proposition est dans le chat.');
                      } catch (e: any) {
                        Alert.alert('Envoi impossible', e?.message ?? String(e));
                      }
                    })
                  : chat
                      .send(settings, '', { type: details.kind, tmdbId, title, year: date?.slice(0, 4), poster: tmdbImg(d.poster_path, 'w342') })
                      .then(() => Alert.alert('Proposé ✅', 'Ta proposition est dans le chat.'))
                      .catch((e) => Alert.alert('Envoi impossible', e?.message ?? String(e)))
              }
            />
          ) : null}

          {/* ——— Sans serveur Lumio : demande Seerr pour les non-admins ——— */}

          {/* ——— Action principale (admin) ——— */}
          {!manager || serverReq !== false ? null : !configured ? (
            <Notice icon="information-circle-outline" text={`Connecte ${serviceName} dans les réglages pour l'ajouter.`} />
          ) : details.arrError ? (
            <Notice icon="warning-outline" color={C.danger} text={`${serviceName} : ${details.arrError}`} />
          ) : !ready && !details.arr ? (
            <Notice icon="options-outline" color={C.warning} text={`Choisis un profil de qualité et un dossier racine pour ${serviceName}.`} />
          ) : null}

          {details.kind === 'movie' && configured && !details.arrError && (
            <>
              {!details.arr && ready && <Button title="Ajouter à Radarr" icon="add" onPress={addMovie} loading={busy} />}
              {details.arr && !details.arr.hasFile && (
                <Button title="Relancer la recherche" icon="refresh" variant="glass" onPress={searchMovie} loading={busy} />
              )}
              {details.arr?.hasFile && (
                <Notice
                  icon="checkmark-circle"
                  color={C.success}
                  text={[
                    'Dans ta bibliothèque',
                    movieFile?.quality?.quality?.name,
                    movieFile?.languages?.map((l) => l.name).join(', '),
                    details.arr.sizeOnDisk ? formatBytes(details.arr.sizeOnDisk) : null,
                  ]
                    .filter(Boolean)
                    .join('  •  ')}
                />
              )}
            </>
          )}

          {details.kind === 'tv' && configured && !details.arrError && (ready || details.arr) && requestable.length > 0 && (
            <Button
              title={selected.size ? `Envoyer ${selected.size} saison${selected.size > 1 ? 's' : ''} à Sonarr` : `Tout envoyer à Sonarr (${requestable.length})`}
              icon="add"
              loading={busy}
              onPress={() => requestSeasons(selected.size === 0)}
            />
          )}

          {d.overview ? <Text style={styles.overview}>{d.overview}</Text> : null}

          {/* ——— Saisons ——— */}
          {details.kind === 'tv' && (
            <View>
              <Text style={styles.sectionTitle}>Saisons</Text>
              <View style={styles.card}>
                {seasonsList.map((s, idx) => {
                  const info = seasonInfo(details.arr, s.season_number);
                  const can =
                    requestable.includes(s.season_number) && configured && !details.arrError && (ready || !!details.arr);
                  const on = selected.has(s.season_number);
                  return (
                    <Pressable
                      key={s.id}
                      disabled={!can}
                      onPress={() => {
                        tap();
                        const next = new Set(selected);
                        if (on) next.delete(s.season_number);
                        else next.add(s.season_number);
                        setSelected(next);
                      }}
                      style={[styles.seasonRow, idx === seasonsList.length - 1 && { borderBottomWidth: 0 }]}>
                      <Ionicons
                        name={can ? (on ? 'checkmark-circle' : 'ellipse-outline') : info?.label ? 'checkmark-circle' : 'remove-circle-outline'}
                        size={24}
                        color={can ? (on ? C.text : C.textFaint) : (info?.color ?? C.textFaint)}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.seasonName}>{s.name || `Saison ${s.season_number}`}</Text>
                        <Text style={styles.dim}>
                          {s.episode_count} épisodes{s.air_date ? `  •  ${s.air_date.slice(0, 4)}` : ''}
                        </Text>
                      </View>
                      {info?.label ? <Chip label={info.label} color={info.color} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              {configured && !details.arrError && (ready || details.arr) && requestable.length === 0 ? (
                <Text style={[styles.dim, { marginTop: 10 }]}>Toutes les saisons sont déjà surveillées ou complètes.</Text>
              ) : null}
            </View>
          )}

          {/* ——— Casting ——— */}
          {cast.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Casting</Text>
              <FlatList
                horizontal
                data={cast}
                keyExtractor={(c) => String(c.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14 }}
                style={{ marginHorizontal: -16 }}
                ListHeaderComponent={<View style={{ width: 2 }} />}
                ListFooterComponent={<View style={{ width: 2 }} />}
                renderItem={({ item: c }) => (
                  <View style={styles.castItem}>
                    <View style={styles.castPhoto}>
                      {c.profile_path ? (
                        <Image source={tmdbImg(c.profile_path, 'w185')} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="person" size={28} color={C.textFaint} />
                      )}
                    </View>
                    <Text style={styles.castName} numberOfLines={2}>
                      {c.name}
                    </Text>
                    {c.character ? (
                      <Text style={styles.castRole} numberOfLines={1}>
                        {c.character}
                      </Text>
                    ) : null}
                  </View>
                )}
              />
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bouton retour flottant */}
      <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + 8 }]} hitSlop={10}>
        <Ionicons name="chevron-back" size={24} color={C.text} />
      </Pressable>
    </View>
  );
}

function Notice({ icon, text, color = C.textDim }: { icon: keyof typeof Ionicons.glyphMap; text: string; color?: string }) {
  return (
    <View style={styles.notice}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.dim, { flex: 1, color: color === C.textDim ? C.textDim : C.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  upcoming: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,201,60,0.14)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 4,
  },
  upcomingText: { color: '#FFC93C', fontSize: 13, fontWeight: '700' },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  heroContent: { position: 'absolute', left: 20, right: 20, bottom: 12, alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  genres: { color: C.text, fontSize: 13, fontWeight: '600', opacity: 0.85 },
  dim: { color: C.textDim, fontSize: 13 },
  overview: { color: C.text, fontSize: 15, lineHeight: 23, opacity: 0.88 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: R.md, padding: 14 },
  sectionTitle: { color: C.text, fontSize: 20, fontWeight: '800', marginBottom: 12, letterSpacing: -0.3 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, paddingHorizontal: 14 },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  seasonName: { color: C.text, fontSize: 15, fontWeight: '700' },
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
});
