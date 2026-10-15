import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { tap } from '@/components/ui';
import { C, POSTER_W, R } from '@/constants/theme';
import { useBetterPoster } from '@/lib/better-posters';
import { jfBackdrop, jfPoster, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export function openJellyfin(item: JfItem) {
  // Un épisode à reprendre ou à suivre se lance directement
  if (item.Type === 'Episode') {
    playJellyfin(item);
    return;
  }
  router.push({ pathname: '/jellyfin/[id]', params: { id: item.Id } });
}

export function playJellyfin(item: JfItem, fromStart = false) {
  const title =
    item.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}`
      : item.Name;
  router.push({
    pathname: '/player',
    params: {
      kind: 'jellyfin',
      itemId: item.Id,
      title,
      subtitle: item.Type === 'Episode' ? item.Name : String(item.ProductionYear ?? ''),
      start: fromStart ? '0' : String((item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000),
    },
  });
}

const progressOf = (i: JfItem) => Math.min(1, Math.max(0, (i.UserData?.PlayedPercentage ?? 0) / 100));

export function JfPosterCard({ item, width = POSTER_W }: { item: JfItem; width?: number }) {
  const { settings } = useSettings();
  const pct = progressOf(item);
  const unplayed = item.UserData?.UnplayedItemCount;
  const [failed, setFailed] = useState(false);
  const better = useBetterPoster(
    item.ProviderIds?.Imdb && (item.Type === 'Movie' || item.Type === 'Series')
      ? { imdb: item.ProviderIds.Imdb, type: item.Type === 'Movie' ? 'movie' : 'tv' }
      : undefined
  );
  const poster = better && !failed ? better : jfPoster(settings, item);
  return (
    <Pressable
      onPress={() => {
        tap();
        openJellyfin(item);
      }}
      style={({ pressed }) => [{ width, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View style={[styles.poster, { width, height: Math.round(width * 1.5) }]}>
        {poster ? (
          <Image
            source={poster}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            recyclingKey={item.Id}
            onError={() => better && setFailed(true)}
          />
        ) : (
          <Text style={styles.fallback} numberOfLines={3}>
            {item.Name}
          </Text>
        )}
        {item.UserData?.Played && (
          <View style={styles.played}>
            <Ionicons name="checkmark" size={13} color="#fff" />
          </View>
        )}
        {!!unplayed && !item.UserData?.Played && (
          <View style={styles.count}>
            <Text style={styles.countText}>{unplayed}</Text>
          </View>
        )}
        {pct > 0 && pct < 1 && (
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.Type === 'Episode' ? item.SeriesName : item.Name}
      </Text>
      <Text style={styles.sub} numberOfLines={1}>
        {item.Type === 'Episode' ? `S${item.ParentIndexNumber}E${item.IndexNumber} · ${item.Name}` : (item.ProductionYear ?? '')}
      </Text>
    </Pressable>
  );
}

export function JfWideCard({ item }: { item: JfItem }) {
  const { settings } = useSettings();
  const pct = progressOf(item);
  const w = 250;
  return (
    <Pressable
      onPress={() => {
        tap();
        if (item.Type === 'Movie' || item.Type === 'Episode') playJellyfin(item);
        else openJellyfin(item);
      }}
      style={({ pressed }) => [{ width: w, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={[styles.poster, { width: w, height: Math.round(w * 0.5625) }]}>
        <Image source={jfBackdrop(settings, item, 600)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        <View style={styles.playBadge}>
          <Ionicons name="play" size={16} color="#000" />
        </View>
        {pct > 0 && (
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.Type === 'Episode' ? item.SeriesName : item.Name}
      </Text>
      <Text style={styles.sub} numberOfLines={1}>
        {item.Type === 'Episode' ? `S${item.ParentIndexNumber}E${item.IndexNumber} · ${item.Name}` : (item.ProductionYear ?? '')}
      </Text>
    </Pressable>
  );
}

export function JfRow({
  title,
  items,
  wide,
  onSeeAll,
  accent,
}: {
  title: string;
  items: JfItem[];
  wide?: boolean;
  onSeeAll?: () => void;
  accent?: string;
}) {
  if (!items.length) return null;
  return (
    <View style={{ marginBottom: 28 }}>
      <Pressable style={styles.rowHead} onPress={onSeeAll} disabled={!onSeeAll}>
        <Text style={[styles.rowTitle, accent ? { color: accent } : null]} numberOfLines={1}>
          {title}
        </Text>
        {onSeeAll && (
          <View style={styles.rowMore}>
            <Ionicons name="chevron-forward" size={15} color={C.textDim} />
          </View>
        )}
      </Pressable>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => i.Id}
        renderItem={({ item }) => (wide ? <JfWideCard item={item} /> : <JfPosterCard item={item} />)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  fallback: { color: C.textDim, fontSize: 13, fontWeight: '700', textAlign: 'center', padding: 10 },
  title: { color: C.text, fontSize: 14, fontWeight: '500', marginTop: 8 },
  sub: { color: C.textDim, fontSize: 12, marginTop: 3, letterSpacing: 0.3 },
  barTrack: { position: 'absolute', left: 8, right: 8, bottom: 8, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: C.text },
  played: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    top: 7,
    right: 7,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  playBadge: {
    position: 'absolute',
    left: 10,
    bottom: 18,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  rowTitle: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  rowMore: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
});
