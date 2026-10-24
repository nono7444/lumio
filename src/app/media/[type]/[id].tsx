import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { TvBackdropLayer } from '@/components/tv-backdrop';
import { JfEpisodes } from '@/components/jf-episodes';
import { FamilyRating } from '@/components/family-rating';
import { ReportProblemButton } from '@/components/report-problem';
import { RequestSection } from '@/components/request-section';
import { TvPill, TvRound, TV_GOLD } from '@/components/tv-actions';
import { grab, mediaFlavor } from '@/lib/grab';
import { useServerRequests } from '@/lib/requests';
import { IS_BETA, secourAdminApi } from '@/lib/secour';
import { SeasonRequests } from '@/components/season-requests';
import { WatchlistButton } from '@/components/watchlist-button';
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
  const [showRate, setShowRate] = useState(false);
  // Statut de chaque saison (serveur Lumio) et demande d'une saison en cours d'envoi
  // Une saison demandée depuis la liste : le bloc de demande se recharge (et inversement)
  const [mediaKey, setMediaKey] = useState(0);
  // Retour sur la fiche : statut rechargé (ex. titre supprimé dans Jellyfin → « Demander » réapparaît)
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) setMediaKey((k) => k + 1);
      focusedOnce.current = true;
    }, [])
  );

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
  // Liste « À voir » (signet)
  const wlItem = {
    type: details.kind,
    tmdbId,
    title,
    year: date?.slice(0, 4),
    poster: tmdbImg(d.poster_path, 'w342'),
    backdrop: tmdbImg(d.backdrop_path, 'w780'),
  };
  const imdbId = details.kind === 'movie' ? details.data.imdb_id : details.data.external_ids?.imdb_id;
  const logo = pickLogo(settings, d.images);
  // Sur TV (paysage), le hero ne dépasse pas l'écran
  // Téléphone : l'affiche entière (son titre fait partie de l'image, on n'en rajoute pas par-dessus)
  const heroH = Platform.isTV ? Math.round(screenH * 0.94) : Math.round(width * 1.5);
  const cast = (d.credits?.cast ?? []).slice(0, 15);
  const crew: { job?: string; name: string }[] = (d.credits as any)?.crew ?? [];
  const director =
    details.kind === 'tv'
      ? ((details.data as any).created_by ?? []).slice(0, 2).map((p: { name: string }) => p.name).join(', ')
      : crew.filter((p) => p.job === 'Director').slice(0, 2).map((p) => p.name).join(', ');
  const tvTarget = {
    type: details.kind,
    tmdbId,
    tvdbId: details.kind === 'tv' ? details.data.external_ids?.tvdb_id : undefined,
    title,
    year: date?.slice(0, 4),
    poster: tmdbImg(d.poster_path, 'w342'),
    backdrop: tmdbImg(d.backdrop_path, 'w780'),
    seasons: details.kind === 'tv' ? details.data.seasons : [],
    flavor: mediaFlavor(details.data),
  };
  const runtime =
    details.kind === 'movie' ? details.data.runtime : details.data.episode_run_time?.[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* TV, comme Nuvio : fond fixe en plein écran, la page défile par-dessus */}
      {Platform.isTV ? <TvBackdropLayer info={{ key: String(tmdbId), title, backdrop: tmdbImg(d.backdrop_path ?? d.poster_path, 'w1280') }} /> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.isTV ? 120 : 40) }}>
        {/* ——— Hero ——— */}
        <View style={{ height: heroH }}>
          {Platform.isTV ? null : (
            <>
              <Image
                source={tmdbImg(d.poster_path ?? d.backdrop_path, 'original')}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                contentPosition="center"
                transition={250}
              />
              <Fade height={heroH * 0.3} top />
              <Fade height={heroH * 0.7} />
            </>
          )}
          {Platform.isTV ? (
            // TV, comme Nuvio : logo, boutons (Regarder ou Demander, ovale) + ronds, puis réalisateur, résumé, infos
            <View style={styles.heroContentTv}>
              {logo ? (
                <Image source={tmdbImg(logo, 'w500')} style={{ width: 340, height: 120 }} contentFit="contain" contentPosition="left bottom" />
              ) : (
                <Text style={[styles.title, { textAlign: 'left' }]}>{title}</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 4, marginBottom: 6 }}>
                {jfItem ? (
                  <TvPill
                    hasTVPreferredFocus
                    icon="play"
                    label="Regarder"
                    onPress={() => router.push({ pathname: '/watch', params: { type: details.kind, tmdbId: String(tmdbId), imdb: imdbId ?? '', title } })}
                  />
                ) : serverReq ? (
                  <RequestSection inJellyfin={false} onAvailable={refreshJf} reloadKey={mediaKey} target={tvTarget} />
                ) : null}
                {serverReq ? <TvRound icon="star-outline" iconOn="star" on={showRate} color={TV_GOLD} label="Noter" onPress={() => setShowRate((v) => !v)} /> : null}
              </View>
              {upcoming ? (
                <View style={styles.upcoming}>
                  <Ionicons name="calendar-outline" size={15} color="#FFC93C" />
                  <Text style={styles.upcomingText}>{upcoming}</Text>
                </View>
              ) : null}
              {director ? <Text style={styles.tvLine}>{details.kind === 'tv' ? 'Créée par' : 'Réalisateur'} : {director}</Text> : null}
              {d.overview ? (
                <Text style={styles.overviewTv} numberOfLines={3}>
                  {d.overview}
                </Text>
              ) : null}
              <Text style={styles.tvLine}>
                {[d.genres?.slice(0, 2).map((g) => g.name).join(' • '), date ? new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null, d.vote_average ? `TMDB ${d.vote_average.toFixed(1)}` : null]
                  .filter(Boolean)
                  .join('   •   ')}
              </Text>
              <Text style={styles.tvLine}>
                {[runtime ? `${Math.floor(runtime / 60) ? `${Math.floor(runtime / 60)}h ` : ''}${runtime % 60}m` : null, details.kind === 'tv' ? `${seasonsList.length} saison${seasonsList.length > 1 ? 's' : ''}` : null]
                  .filter(Boolean)
                  .join('   •   ')}
              </Text>
            </View>
          ) : (
          <View style={styles.heroContent}>
            {!Platform.isTV ? null : logo ? (
              <Image
                source={tmdbImg(logo, 'w500')}
                style={Platform.isTV ? { width: 320, height: 120 } : { width: Math.min(width * 0.7, 460), height: 100 }}
                contentFit="contain"
                contentPosition={Platform.isTV ? 'left bottom' : 'bottom'}
                transition={250}
              />
            ) : (
              <Text style={[styles.title, Platform.isTV && { textAlign: 'left' }]}>{title}</Text>
            )}
            <View style={[styles.pills, Platform.isTV && { justifyContent: 'flex-start' }]}>
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
          )}
        </View>

        <View style={[{ paddingHorizontal: 16, gap: 20, marginTop: 4 }, Platform.isTV && { width: '100%', maxWidth: 1100, alignSelf: 'flex-start', paddingLeft: 48 }]}>
          {/* ——— Lecture (depuis Jellyfin) ——— */}
          {jfItem && !Platform.isTV ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="Lire"
                icon="play"
                small
                onPress={() =>
                  router.push({
                    pathname: '/watch',
                    params: { type: details.kind, tmdbId: String(tmdbId), imdb: imdbId ?? '', title },
                  })
                }
                style={{ flex: 1 }}
              />
              <WatchlistButton item={wlItem} variant="icon" />
            </View>
          ) : !Platform.isTV ? (
            <WatchlistButton item={wlItem} variant="pill" />
          ) : null}

          {/* ——— Admin : Lumio Secour (« LS » = téléchargement direct, « Liens » = choisir soi-même) ——— */}
          {settings.chatUrl && settings.jellyfin?.isAdmin === true && !Platform.isTV && (Platform.OS !== 'ios' || IS_BETA) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {IS_BETA ? (
                <LsButton
                  onGrab={(seasons) =>
                    secourAdminApi.grab(settings, {
                      type: details.kind,
                      tmdbId,
                      tvdbId: details.kind === 'tv' ? details.data.external_ids?.tvdb_id ?? undefined : undefined,
                      title,
                      year: date?.slice(0, 4),
                      poster: tmdbImg(d.poster_path, 'w342') ?? undefined,
                      backdrop: tmdbImg(d.backdrop_path, 'w780') ?? undefined,
                      seasons,
                    })
                  }
                  title={title}
                  seasons={seasonsList.map((s) => s.season_number)}
                />
              ) : null}
              <Button
                title="Liens"
                icon="link-outline"
                variant="secondary"
                small
                style={{ flex: 1 }}
                onPress={() =>
                  router.push({
                    pathname: '/secour',
                    params: { type: details.kind, tmdbId: String(tmdbId), imdb: imdbId ?? '', title },
                  })
                }
              />
            </View>
          ) : null}

          {/* ——— Série dans Jellyfin : choix de la saison et de l'épisode ——— */}
          {jfItem && details.kind === 'tv' ? <JfEpisodes seriesId={jfItem.Id} /> : null}

          {/* ——— Demande façon Seerr (serveur Lumio) ——— */}
          {serverReq && !Platform.isTV ? (
            <RequestSection
              inJellyfin={Boolean(jfItem)}
              onAvailable={refreshJf}
              onChange={() => setMediaKey((k) => k + 1)}
              reloadKey={mediaKey}
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
          {serverReq && Platform.isTV ? (
            showRate ? <FamilyRating type={details.kind} tmdbId={tmdbId} title={title} poster={tmdbImg(d.poster_path, 'w342')} /> : null
          ) : serverReq ? (
            <View style={{ gap: 6 }}>
              <FamilyRating type={details.kind} tmdbId={tmdbId} title={title} poster={tmdbImg(d.poster_path, 'w342')} />
              {jfItem ? (
                <ReportProblemButton type={details.kind} tmdbId={tmdbId} title={title} poster={tmdbImg(d.poster_path, 'w342')} />
              ) : null}
            </View>
          ) : null}

          {/* ——— Proposer le titre dans le chat famille ——— */}
          {/* Proposer : seulement pour un titre pas encore sur le serveur */}
          {settings.chatUrl && settings.jellyfin && !jfItem && !Platform.isTV ? (
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

          {d.overview && !Platform.isTV ? <Text style={styles.overview}>{d.overview}</Text> : null}

          {/* ——— Saisons ——— */}
          {/* ——— Saisons (serveur Lumio) : statut de chaque saison + « Demander » à côté de celles qui manquent ——— */}
          {details.kind === 'tv' && serverReq ? (
            <SeasonRequests tmdbId={tmdbId} show={details.data} reloadKey={mediaKey} onChange={() => setMediaKey((k) => k + 1)} />
          ) : null}

          {details.kind === 'tv' && !serverReq && (
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
                  <Pressable focusable={Platform.isTV} tvFocus="card" onPress={() => {}} style={styles.castItem}>
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
                  </Pressable>
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

/** Bouton rond « LS » : télécharge directement avec Lumio Secour (film, ou saisons au choix pour une série). */
function LsButton({ title, seasons, onGrab }: { title: string; seasons: number[]; onGrab: (seasons?: number[]) => Promise<{ already?: boolean }> }) {
  const [busy, setBusy] = useState(false);
  const go = async (s?: number[]) => {
    setBusy(true);
    try {
      const r = await onGrab(s);
      Alert.alert(
        '🛟 Lumio Secour',
        r.already ? `« ${title} » est déjà en cours de téléchargement.` : `« ${title} » part en téléchargement : meilleur lien trouvé, puis rangé sur le disque. Suivi dans Demandes.`
      );
    } catch (e: any) {
      Alert.alert('Lumio Secour', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const press = () => {
    if (!seasons.length)
      return Alert.alert('Télécharger avec Lumio Secour ?', `« ${title} »`, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Télécharger', onPress: () => go() },
      ]);
    Alert.alert('Télécharger avec Lumio Secour', `« ${title} » : quelles saisons ?`, [
      ...seasons.slice(0, 12).map((n) => ({ text: `Saison ${n}`, onPress: () => go([n]) })),
      { text: `Toutes (${seasons.length})`, onPress: () => go(seasons) },
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  };
  return (
    <Pressable onPress={press} disabled={busy} style={styles.ls} accessibilityLabel="Télécharger avec Lumio Secour">
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.lsText}>LS</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ls: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
  lsText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  heroContentTv: { position: 'absolute', left: 48, bottom: 36, width: '48%', alignItems: 'flex-start', gap: 10 },
  tvLine: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  overviewTv: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 22 },
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
  castItem: { width: Platform.isTV ? 130 : 84, alignItems: 'center' },
  castPhoto: {
    width: Platform.isTV ? 112 : 76,
    height: Platform.isTV ? 112 : 76,
    borderRadius: Platform.isTV ? 56 : 38,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castName: { color: C.text, fontSize: Platform.isTV ? 15 : 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  castRole: { color: C.textDim, fontSize: Platform.isTV ? 13 : 11, textAlign: 'center', marginTop: 2 },
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
