import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Button, Fade, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import type { LibraryEntry } from '@/lib/arr';
import { openMedia } from '@/lib/navigation';
import { useSettings } from '@/lib/settings';
import { GENRES, itemTitle, itemYear, tmdb, tmdbImg, type MediaType, type TmdbItem } from '@/lib/tmdb';

const AUTO_MS = 7000;

function Slide({
  item,
  width,
  height,
  badge,
}: {
  item: TmdbItem;
  width: number;
  height: number;
  badge: LibraryEntry | null;
}) {
  const { settings } = useSettings();
  const type = item.media_type as MediaType;
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    tmdb
      .logo(settings, type, item.id)
      .then((l) => alive && setLogo(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings, type, item.id]);

  const genres = (item.genre_ids ?? [])
    .map((g) => GENRES[g])
    .filter(Boolean)
    .slice(0, 3);
  const meta = [type === 'movie' ? 'Film' : 'Série', itemYear(item), item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : null]
    .filter(Boolean)
    .join('  •  ');

  return (
    <Pressable
      onPress={() => {
        tap();
        openMedia(type, item.id);
      }}
      style={{ width, height }}>
      <Image
        source={tmdbImg(item.poster_path, 'w780')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={300}
        placeholder={{ blurhash: 'L03[%0IU00~q00xu00Rj00%M~qIU' }}
      />
      <Fade height={height * 0.25} top />
      <Fade height={height * 0.62} />

      <View style={styles.content}>
        {logo ? (
          <Image
            source={tmdbImg(logo, 'w500')}
            style={{ width: width * 0.66, height: 90 }}
            contentFit="contain"
            contentPosition="bottom"
            transition={250}
          />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {itemTitle(item)}
          </Text>
        )}
        {genres.length > 0 && <Text style={styles.genres}>{genres.join('  •  ')}</Text>}
        <Text style={styles.meta}>{meta}</Text>
        {badge && (
          <View style={styles.badge}>
            <View style={[styles.dot, { backgroundColor: badge.color }]} />
            <Text style={styles.badgeText}>{badge.label}</Text>
          </View>
        )}
        <View style={styles.actions}>
          <Button
            title={badge ? 'Voir la fiche' : 'Ajouter'}
            icon={badge ? 'information-circle' : 'add'}
            onPress={() => openMedia(type, item.id)}
            style={{ flex: 1 }}
          />
          <Button title="Infos" icon="information-circle-outline" variant="glass" onPress={() => openMedia(type, item.id)} style={{ flex: 1 }} />
        </View>
      </View>
    </Pressable>
  );
}

export function Hero({ items, badge }: { items: TmdbItem[]; badge: (t: MediaType, id: number) => LibraryEntry | null }) {
  const { width, height: screenH } = useWindowDimensions();
  const height = Math.min(Math.round(width * 1.45), Math.round(screenH * 0.72));
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<TmdbItem>>(null);
  const touching = useRef(false);

  // Défilement automatique, suspendu pendant que l'utilisateur touche
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      if (touching.current) return;
      const next = (index + 1) % items.length;
      list.current?.scrollToIndex({ index: next, animated: true });
      setIndex(next);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [index, items.length]);

  if (!items.length) return <View style={{ height: height * 0.6 }} />;

  return (
    <View style={{ height }}>
      <FlatList
        ref={list}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => `${i.media_type}:${i.id}`}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => (touching.current = true)}
        onScrollEndDrag={() => (touching.current = false)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <Slide item={item} width={width} height={height} badge={badge(item.media_type as MediaType, item.id)} />
        )}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((_, i) => (
          <View key={i} style={[styles.pageDot, i === index && styles.pageDotOn]} />
        ))}
      </View>
    </View>
  );
}

export function HeroTopBar({ title }: { title: string }) {
  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <Text style={styles.brand}>{title}</Text>
      <Ionicons name="sparkles" size={18} color={C.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', left: 20, right: 20, bottom: 30, alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.8 },
  genres: { color: C.text, fontSize: 13, fontWeight: '600', opacity: 0.9, marginTop: 6 },
  meta: { color: C.textDim, fontSize: 12, fontWeight: '600' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.glass, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { color: C.text, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 8 },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  pageDotOn: { width: 18, backgroundColor: C.text },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  brand: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
});
