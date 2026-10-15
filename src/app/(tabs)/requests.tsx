import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Chip, SetupPrompt } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { mediaStatusLabel, requestStatusLabel, seerr, tmdbImg, type RequestItem } from '@/lib/seerr';
import { isSeerrConfigured, Settings, useSettings } from '@/lib/settings';

type Info = { title: string; poster?: string; year?: string };
const infoCache = new Map<string, Info>();

async function loadInfo(s: Settings, r: RequestItem): Promise<Info> {
  const key = `${r.type}:${r.media.tmdbId}`;
  const cached = infoCache.get(key);
  if (cached) return cached;
  const info: Info =
    r.type === 'movie'
      ? await seerr.movie(s, r.media.tmdbId).then((m) => ({
          title: m.title,
          poster: tmdbImg(m.posterPath, 'w185'),
          year: m.releaseDate?.slice(0, 4),
        }))
      : await seerr.tv(s, r.media.tmdbId).then((t) => ({
          title: t.name,
          poster: tmdbImg(t.posterPath, 'w185'),
          year: t.firstAirDate?.slice(0, 4),
        }));
  infoCache.set(key, info);
  return info;
}

function RequestRow({ r }: { r: RequestItem }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<Info | null>(infoCache.get(`${r.type}:${r.media.tmdbId}`) ?? null);

  useEffect(() => {
    if (!info) loadInfo(settings, r).then(setInfo).catch(() => {});
  }, [info, r, settings]);

  const req = requestStatusLabel(r.status);
  const media = mediaStatusLabel(r.media.status);
  const seasons = r.seasons?.length ? `Saisons ${r.seasons.map((s) => s.seasonNumber).join(', ')}` : null;
  const date = new Date(r.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  return (
    <Pressable
      onPress={() => openMedia(r.type, r.media.tmdbId)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.thumb}>
        {info?.poster && <Image source={info.poster} style={StyleSheet.absoluteFill} contentFit="cover" />}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={2}>
          {info?.title ?? '…'}
          {info?.year ? <Text style={styles.dim}> ({info.year})</Text> : null}
        </Text>
        <Text style={styles.dim}>
          {r.type === 'movie' ? 'Film' : 'Série'} · {date}
          {r.requestedBy?.displayName ? ` · ${r.requestedBy.displayName}` : ''}
        </Text>
        {seasons ? <Text style={styles.dim}>{seasons}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <Chip label={req.label} color={req.color} />
          {media && <Chip label={media.label} color={media.color} />}
        </View>
      </View>
    </Pressable>
  );
}

export default function Requests() {
  const { settings } = useSettings();
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSeerrConfigured(settings)) return;
    setLoading(true);
    try {
      const res = await seerr.requests(settings, 50);
      setItems(res.results);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!isSeerrConfigured(settings)) return <SetupPrompt />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      data={items}
      keyExtractor={(r) => String(r.id)}
      renderItem={({ item }) => <RequestRow r={item} />}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.accent} />}
      ListEmptyComponent={
        !loading ? (
          <Text style={[styles.dim, { textAlign: 'center', marginTop: 30 }]}>
            {error ? `Erreur : ${error}` : 'Aucune demande pour le moment.'}
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  thumb: { width: 62, height: 93, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12, fontWeight: '400' },
});
