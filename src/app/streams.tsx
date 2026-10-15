import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { grab } from '@/lib/grab';
import { useSettings } from '@/lib/settings';
import { collectStreams, QUALITY_RANK, type Found } from '@/lib/streams';
import { tmdb, tmdbImg } from '@/lib/tmdb';

type Params = {
  type: 'movie' | 'tv';
  tmdbId: string;
  imdb: string;
  title: string;
  season?: string;
  episode?: string;
  grab?: string;
};

// ——— Choix de l'épisode (séries) ———

function EpisodePicker({ tmdbId, onPick }: { tmdbId: number; onPick: (season: number, episode: number) => void }) {
  const { settings } = useSettings();
  const [seasons, setSeasons] = useState<number[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [eps, setEps] = useState<Awaited<ReturnType<typeof tmdb.season>>['episodes']>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    tmdb.tv(settings, tmdbId).then((t) => {
      const list = t.seasons.filter((x) => x.season_number > 0).map((x) => x.season_number);
      setSeasons(list);
      setSeason(list[0] ?? null);
    });
  }, [settings, tmdbId]);

  useEffect(() => {
    if (season == null) return;
    setLoading(true);
    tmdb
      .season(settings, tmdbId, season)
      .then((r) => setEps(r.episodes))
      .finally(() => setLoading(false));
  }, [settings, tmdbId, season]);

  return (
    <View>
      <FlatList
        horizontal
        data={seasons}
        keyExtractor={(n) => String(n)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        style={{ marginBottom: 14, flexGrow: 0 }}
        renderItem={({ item: n }) => <SegChip label={`Saison ${n}`} on={n === season} onPress={() => setSeason(n)} />}
      />
      {loading ? (
        <ActivityIndicator color={C.text} style={{ margin: 30 }} />
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {eps.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => {
                tap();
                onPick(season!, e.episode_number);
              }}
              style={({ pressed }) => [styles.ep, { opacity: pressed ? 0.7 : 1 }]}>
              <View style={styles.epThumb}>
                {e.still_path && <Image source={tmdbImg(e.still_path, 'w342')} style={StyleSheet.absoluteFill} contentFit="cover" />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.epTitle} numberOfLines={2}>
                  {e.episode_number}. {e.name}
                </Text>
                {e.overview ? (
                  <Text style={styles.dim} numberOfLines={2}>
                    {e.overview}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ——— Écran ———

const FILTERS = ['Tout', 'FR', '4K', '1080p', '720p'] as const;

export default function Streams() {
  const p = useLocalSearchParams<Params>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [season, setSeason] = useState<number | null>(p.season ? Number(p.season) : null);
  const [episode, setEpisode] = useState<number | null>(p.episode ? Number(p.episode) : null);
  const [streams, setStreams] = useState<Found[]>([]);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Tout');
  const [showTorrents, setShowTorrents] = useState(false);
  const [grabNote, setGrabNote] = useState<string | null>(null);

  const isSeries = p.type === 'tv';
  const ready = !isSeries || (season != null && episode != null);
  const stremioType = isSeries ? 'series' : 'movie';
  const stremioId = isSeries ? `${p.imdb}:${season}:${episode}` : p.imdb;

  // Récupère les streams de tous les addons compatibles, en parallèle
  useEffect(() => {
    if (!ready || !p.imdb) return;
    let alive = true;
    setStreams([]);
    setErrors([]);
    setPending(1);
    collectStreams(settings, stremioType, stremioId, { onPartial: (list) => alive && setStreams(list) }).then(
      ({ streams: all, errors: errs }) => {
        if (!alive) return;
        setStreams(all);
        setErrors(errs);
        setPending(0);
      }
    );
    return () => {
      alive = false;
    };
  }, [ready, p.imdb, stremioType, stremioId, settings]);

  // Lance le téléchargement dans Radarr / Sonarr pendant qu'on regarde
  useEffect(() => {
    if (p.grab !== '1' || !ready) return;
    grab(settings, { type: p.type === 'tv' ? 'tv' : 'movie', tmdbId: Number(p.tmdbId), season: season ?? undefined })
      .then(setGrabNote)
      .catch((e) => setGrabNote(`Téléchargement non lancé : ${e?.message ?? e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const visible = useMemo(() => {
    let list = streams.filter((s) => showTorrents || s.playable);
    if (filter === 'FR') list = list.filter((s) => s.fr);
    else if (filter !== 'Tout') list = list.filter((s) => s.quality === filter);
    return [...list].sort((a, b) => QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality]);
  }, [streams, filter, showTorrents]);

  const torrentCount = streams.filter((s) => !s.playable).length;
  const hasStreamAddon = settings.addons.length > 0;

  function play(s: Found) {
    if (!s.url) return;
    tap();
    const subtitle = isSeries ? `S${season}E${episode}` : s.quality;
    router.push({
      pathname: '/player',
      params: {
        kind: 'url',
        uri: s.url,
        title: p.title,
        subtitle,
        headers: s.behaviorHints?.proxyHeaders?.request ? JSON.stringify(s.behaviorHints.proxyHeaders.request) : undefined,
        tmdbId: p.tmdbId,
        imdb: p.imdb,
        series: p.title,
        season: isSeries && season != null ? String(season) : undefined,
        episode: isSeries && episode != null ? String(episode) : undefined,
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {p.title}
          </Text>
          <Text style={styles.dim}>
            {isSeries && ready ? `Saison ${season} · Épisode ${episode}` : isSeries ? 'Choisis un épisode' : 'Regarder maintenant'}
          </Text>
        </View>
        {isSeries && ready && (
          <Pressable
            onPress={() => {
              setEpisode(null);
              setSeason(null);
            }}
            hitSlop={10}
            style={styles.headerBtn}>
            <Ionicons name="list" size={22} color={C.text} />
          </Pressable>
        )}
      </View>

      {!ready ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          <EpisodePicker
            tmdbId={Number(p.tmdbId)}
            onPick={(s, e) => {
              setSeason(s);
              setEpisode(e);
            }}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s, i) => `${s.addon}:${s.url ?? s.infoHash}:${i}`}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 10 }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 6 }}>
              {grabNote && (
                <View style={styles.note}>
                  <Ionicons name="cloud-download-outline" size={18} color={C.success} />
                  <Text style={[styles.dim, { flex: 1, color: C.text }]}>{grabNote}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {FILTERS.map((f) => (
                  <SegChip key={f} label={f} on={f === filter} onPress={() => setFilter(f)} />
                ))}
              </View>
              {pending > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={C.textDim} size="small" />
                  <Text style={styles.dim}>Recherche des sources…</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            pending === 0 ? (
              <View style={{ alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 20 }}>
                <Ionicons name="film-outline" size={36} color={C.textFaint} />
                <Text style={[styles.dim, { textAlign: 'center' }]}>
                  {!hasStreamAddon
                    ? 'Ajoute un addon Stremio qui fournit des streams dans les réglages.'
                    : 'Aucune source lisible trouvée par tes addons pour ce titre.'}
                </Text>
                {errors.map((e) => (
                  <Text key={e} style={[styles.dim, { color: C.danger, textAlign: 'center' }]}>
                    {e}
                  </Text>
                ))}
              </View>
            ) : null
          }
          ListFooterComponent={
            torrentCount > 0 ? (
              <Pressable onPress={() => setShowTorrents((v) => !v)} style={{ padding: 12, alignItems: 'center' }}>
                <Text style={styles.dim}>
                  {showTorrents ? 'Masquer' : 'Afficher'} les {torrentCount} sources torrent (non lisibles dans l'appli)
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item: s }) => (
            <Pressable
              disabled={!s.playable}
              onPress={() => play(s)}
              style={({ pressed }) => [styles.stream, { opacity: !s.playable ? 0.45 : pressed ? 0.7 : 1 }]}>
              <View style={styles.qBadge}>
                <Text style={styles.qText}>{s.quality || '—'}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.streamName} numberOfLines={1}>
                  {(s.name ?? s.addon).replace(/\n/g, ' ')}
                </Text>
                <Text style={styles.streamTitle} numberOfLines={3}>
                  {(s.title ?? s.description ?? s.behaviorHints?.filename ?? '').trim()}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  {s.fr && <Text style={styles.tag}>FR</Text>}
                  {s.sizeLabel && <Text style={styles.tag}>{s.sizeLabel}</Text>}
                  <Text style={styles.tag}>{s.addon}</Text>
                </View>
              </View>
              <Ionicons name={s.playable ? 'play-circle' : 'magnet-outline'} size={30} color={C.text} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
  chipOn: { backgroundColor: C.text },
  chipText: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(48,209,88,0.12)', borderRadius: R.md, padding: 12 },
  stream: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 14 },
  qBadge: { width: 52, height: 52, borderRadius: R.md, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  qText: { color: C.text, fontSize: 13, fontWeight: '800' },
  streamName: { color: C.text, fontSize: 14, fontWeight: '700' },
  streamTitle: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  tag: { color: C.text, fontSize: 11, fontWeight: '700', backgroundColor: C.glass, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  ep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  epThumb: { width: 120, height: 68, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  epTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
});
