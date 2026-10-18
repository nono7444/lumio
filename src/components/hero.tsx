import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';

import { Button, Fade, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import type { LibraryEntry } from '@/lib/arr';
import { openMedia } from '@/lib/navigation';
import type { Season } from '@/lib/seasons';
import { useSettings } from '@/lib/settings';
import { GENRES, itemTitle, itemYear, tmdb, tmdbImg, type MediaType, type TmdbItem } from '@/lib/tmdb';

const AUTO_MS = 7000;

/** Élément du hero, quelle que soit sa source (Jellyfin ou TMDB). */
export type HeroItem = {
  key: string;
  title: string;
  posterUrl?: string;
  /** Logo direct (Jellyfin) ou à récupérer sur TMDB */
  logoUrl?: string;
  tmdb?: { type: MediaType; id: number };
  genres: string[];
  meta: string;
  badge?: LibraryEntry | null;
  primary: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
  onOpen: () => void;
};

/** Convertit un résultat TMDB en élément de hero. */
export function heroFromTmdb(item: TmdbItem, badge: LibraryEntry | null): HeroItem {
  const type = item.media_type as MediaType;
  return {
    key: `${type}:${item.id}`,
    title: itemTitle(item),
    posterUrl: tmdbImg(item.poster_path, 'w780'),
    tmdb: { type, id: item.id },
    genres: (item.genre_ids ?? []).map((g) => GENRES[g]).filter(Boolean).slice(0, 3),
    meta: [type === 'movie' ? 'Film' : 'Série', itemYear(item), item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : null]
      .filter(Boolean)
      .join('  •  '),
    badge,
    primary: badge
      ? { label: 'Voir la fiche', icon: 'information-circle', onPress: () => openMedia(type, item.id) }
      : { label: 'Ajouter', icon: 'add', onPress: () => openMedia(type, item.id) },
    onOpen: () => openMedia(type, item.id),
  };
}

function Slide({ item, width, height, season }: { item: HeroItem; width: number; height: number; season: Season | null }) {
  const { settings } = useSettings();
  const [logo, setLogo] = useState<string | null>(item.logoUrl ?? null);

  useEffect(() => {
    if (item.logoUrl || !item.tmdb) return;
    let alive = true;
    tmdb
      .logo(settings, item.tmdb.type, item.tmdb.id)
      .then((l) => alive && l && setLogo(tmdbImg(l, 'w500') ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings, item.logoUrl, item.tmdb]);

  return (
    <Pressable
      onPress={() => {
        tap();
        item.onOpen();
      }}
      style={{ width, height }}>
      <Image
        source={item.posterUrl}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={300}
        placeholder={{ blurhash: 'L03[%0IU00~q00xu00Rj00%M~qIU' }}
      />
      {season && <View style={[StyleSheet.absoluteFill, { backgroundColor: season.tint }]} pointerEvents="none" />}
      <Fade height={height * 0.25} top />
      <Fade height={height * 0.62} />

      <View style={styles.content}>
        {logo ? (
          <Image source={logo} style={{ width: Math.min(width * 0.66, 420), height: 90 }} contentFit="contain" contentPosition="bottom" transition={250} />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        )}
        {item.genres.length > 0 && <Text style={styles.genres}>{item.genres.join('  •  ')}</Text>}
        <Text style={styles.meta}>{item.meta}</Text>
        {item.badge && (
          <View style={styles.badge}>
            <View style={[styles.dot, { backgroundColor: item.badge.color }]} />
            <Text style={styles.badgeText}>{item.badge.label}</Text>
          </View>
        )}
        <View style={styles.actions}>
          <Button title={item.primary.label} icon={item.primary.icon} onPress={item.primary.onPress} style={{ flex: 1 }} />
          <Button title="Infos" icon="information-circle-outline" variant="glass" onPress={item.onOpen} style={{ flex: 1 }} />
        </View>
      </View>
    </Pressable>
  );
}

export function Hero({ items, season }: { items: HeroItem[]; season?: Season | null }) {
  const { width, height: screenH } = useWindowDimensions();
  const height = Math.min(Math.round(width * 1.45), Math.round(screenH * 0.72));
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<HeroItem>>(null);
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
        keyExtractor={(i) => i.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => (touching.current = true)}
        onScrollEndDrag={() => (touching.current = false)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Slide item={item} width={width} height={height} season={season ?? null} />}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((_, i) => (
          <View key={i} style={[styles.pageDot, i === index && { width: 18, backgroundColor: season?.accent ?? C.text }]} />
        ))}
      </View>
    </View>
  );
}

export function HeroTopBar({ title, onCustomize, season, right }: { title: string; onCustomize?: () => void; season?: Season | null; right?: ReactNode }) {
  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <Text style={styles.brand}>
        {title}
        {season ? <Text style={{ fontSize: 22 }}> {season.emoji}</Text> : null}
      </Text>
      {right ??
        (onCustomize ? (
          <Pressable
            onPress={() => {
              tap();
              onCustomize();
            }}
            hitSlop={10}
            accessibilityLabel="Personnaliser l'accueil"
            style={styles.topBtn}>
            <Ionicons name="options-outline" size={20} color={C.text} />
          </Pressable>
        ) : null)}
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  topBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  brand: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
});
