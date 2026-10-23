// Saisons d'une série avec leur statut sur le serveur Lumio (Disponible, 6/10 épisodes, En téléchargement, Demandée,
// Pas disponible) et un bouton « Demander » à côté de chaque saison manquante : on demande par saison, jamais par épisode.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { Button } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { mediaFlavor, suggestFolder } from '@/lib/grab';
import { MediaStatus, requestsApi, type MediaInfo } from '@/lib/requests';
import { useSettings } from '@/lib/settings';
import { serverCall } from '@/lib/chat';
import { tmdbImg, type TmdbTv } from '@/lib/tmdb';

type SeasonStat = MediaInfo['seasons'][number];

function badge(x: SeasonStat | undefined): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  const st = x?.status ?? MediaStatus.UNKNOWN;
  if (st === MediaStatus.AVAILABLE) return { label: 'Disponible', color: C.success, icon: 'checkmark-circle' };
  if (st === MediaStatus.PARTIALLY_AVAILABLE)
    return { label: x?.total ? `${x.have ?? 0}/${x.total} épisodes` : 'Partielle', color: C.warning, icon: 'contrast' };
  if (st === MediaStatus.PROCESSING) return { label: 'En téléchargement', color: C.accent, icon: 'arrow-down-circle' };
  if (st === MediaStatus.PENDING) return { label: 'Demandée', color: '#FFC93C', icon: 'time' };
  return { label: 'Pas disponible', color: C.textFaint, icon: 'remove-circle-outline' };
}

export function SeasonRequests({
  tmdbId,
  show,
  onlyMissing = false,
  title = 'Saisons',
  reloadKey = 0,
  onChange,
}: {
  tmdbId: number;
  show: TmdbTv;
  /** Fiche Jellyfin : seulement les saisons qui ne sont pas complètes (rien si tout est là) */
  onlyMissing?: boolean;
  title?: string;
  reloadKey?: number;
  onChange?: () => void;
}) {
  const { settings } = useSettings();
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const tvdb = show.external_ids?.tvdb_id ?? undefined;
  // Saisons selon Sonarr (TheTVDB) : c'est elles qu'on demande. Certaines séries sont découpées autrement sur TMDB
  // (ex. Lupin : 2 saisons TMDB, 3 « parties » TheTVDB) : sans ça, les statuts et les demandes se mélangeaient.
  const [arrList, setArrList] = useState<{ seasonNumber: number; episodes: number | null }[] | null>(null);
  useEffect(() => {
    if (!tvdb || !settings.chatUrl) return;
    serverCall<{ seasons: { seasonNumber: number; episodes: number | null }[] | null }>(settings, `/api/tv/seasons?tvdbId=${tvdb}`)
      .then((r) => setArrList(r.seasons?.length ? r.seasons : null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvdb, settings.chatUrl]);
  const tmdbSeasons = (show.seasons ?? []).filter((s) => s.season_number > 0);
  const sameSplit = !arrList || (arrList.length === tmdbSeasons.length && arrList.every((x, i) => x.seasonNumber === tmdbSeasons[i]?.season_number));
  const seasons = sameSplit
    ? tmdbSeasons
    : arrList!.map((x) => ({
        id: -x.seasonNumber,
        season_number: x.seasonNumber,
        name: `Saison ${x.seasonNumber}`,
        episode_count: x.episodes ?? 0,
        air_date: undefined as string | undefined,
      }));

  const load = useCallback(() => {
    requestsApi
      .media(settings, 'tv', tmdbId, tvdb, seasons.map((s) => s.season_number))
      .then(setMedia)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, tmdbId, tvdb, seasons.length]);

  useEffect(load, [load, reloadKey]);

  const stat = (n: number) => media?.seasons.find((x) => x.seasonNumber === n);

  function request(n: number) {
    const send = async () => {
      setBusy(n);
      try {
        // Série pas encore sur le serveur : dossier choisi selon le genre (animés, jeunesse…)
        let folder: string | undefined;
        if (!media || media.status === MediaStatus.UNKNOWN) {
          const o = await requestsApi.options(settings, 'tv').catch(() => null);
          if (o) folder = suggestFolder(o.folders, mediaFlavor(show), o.default) ?? undefined;
        }
        const r = await requestsApi.create(settings, {
          type: 'tv',
          tmdbId,
          tvdbId: tvdb,
          seasons: [n],
          title: show.name,
          year: show.first_air_date?.slice(0, 4),
          poster: tmdbImg(show.poster_path, 'w342'),
          backdrop: tmdbImg(show.backdrop_path, 'w780'),
          rootFolderPath: folder,
        });
        toast(
          r.status === 1
            ? `Saison ${n} demandée : elle attend la validation de l’admin.`
            : r.status === 4
              ? `Demande enregistrée, mais l’envoi a échoué : ${r.error ?? 'erreur'}`
              : `Saison ${n} : téléchargement lancé.`
        );
        load();
        onChange?.();
      } catch (e: any) {
        Alert.alert('Demande impossible', e?.message ?? String(e));
      } finally {
        setBusy(null);
      }
    };
    Alert.alert(`Demander la saison ${n} ?`, `« ${show.name} »`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Demander', onPress: send },
    ]);
  }

  const list = onlyMissing ? seasons.filter((s) => media && stat(s.season_number)?.status !== MediaStatus.AVAILABLE) : seasons;
  if (!seasons.length || (onlyMissing && !list.length)) return null;
  const availableCount = seasons.filter((s) => stat(s.season_number)?.status === MediaStatus.AVAILABLE).length;

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {media ? (
          <Text style={styles.dim}>
            {availableCount}/{seasons.length} disponible{seasons.length > 1 ? 's' : ''}
          </Text>
        ) : null}
      </View>
      <View style={styles.card}>
        {list.map((s, idx) => {
          const x = stat(s.season_number);
          const b = badge(x);
          const missing = Boolean(media) && (x?.status ?? MediaStatus.UNKNOWN) === MediaStatus.UNKNOWN;
          const pct = x?.status === MediaStatus.AVAILABLE ? 1 : x?.status === MediaStatus.PARTIALLY_AVAILABLE && x.total ? (x.have ?? 0) / x.total : 0;
          return (
            <View key={s.id} style={[styles.row, idx === list.length - 1 && { borderBottomWidth: 0 }]}>
              <Ionicons name={media ? b.icon : 'ellipse-outline'} size={24} color={media ? b.color : C.textFaint} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, missing && { color: C.textDim }]}>{s.name || `Saison ${s.season_number}`}</Text>
                {s.episode_count || s.air_date ? (
                  <Text style={styles.dim}>
                    {[s.episode_count ? `${s.episode_count} épisodes` : null, s.air_date ? s.air_date.slice(0, 4) : null].filter(Boolean).join('  •  ')}
                  </Text>
                ) : null}
                {media ? <Text style={[styles.status, { color: b.color }]}>{b.label}</Text> : null}
                {pct > 0 && pct < 1 ? (
                  <View style={styles.bar}>
                    <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: b.color }]} />
                  </View>
                ) : null}
              </View>
              {missing ? (
                <Button title="Demander" icon="paper-plane-outline" small loading={busy === s.season_number} onPress={() => request(s.season_number)} />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: C.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  dim: { color: C.textDim, fontSize: 13 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, paddingHorizontal: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  bar: { height: 4, borderRadius: 2, backgroundColor: C.surfaceHigh, overflow: 'hidden', marginTop: 4, maxWidth: 160 },
  fill: { height: 4, borderRadius: 2 },
});
