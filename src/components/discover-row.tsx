// Rangée « Découvrir » (Livres et Livres audio) : mangas du moment (AniList), top livres et top livres audio
// (classements Apple Books France). L'admin touche une couverture → recherche du titre pour le télécharger.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, type DiscoverItem, type DiscoverKind } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const cache: Partial<Record<string, DiscoverItem[]>> = {};

/** Toucher une couverture : l'admin part chercher le titre (Trouver), la famille est invitée à demander. */
export function openDiscover(kind: DiscoverKind, it: DiscoverItem, admin: boolean) {
  tap();
  if (!admin) return toast('Demande-le à l’admin pour qu’il l’ajoute à la bibliothèque', 'info');
  if (kind === 'audio') router.push({ pathname: '/(tabs)/find', params: { q: it.search } });
  else router.push({ pathname: '/(tabs)/findbook', params: { q: it.search, kind: kind === 'bd' ? 'bd' : 'mangas' } });
}

export function DiscoverRow({ kind, title, admin }: { kind: DiscoverKind; title: string; admin: boolean }) {
  const { settings } = useSettings();
  const [items, setItems] = useState<DiscoverItem[] | null>(cache[kind] ?? null);
  useEffect(() => {
    ebookApi
      .discover(settings, kind)
      .then((r) => ((cache[kind] = r.items), setItems(r.items)))
      .catch(() => setItems((x) => x ?? []));
  }, [settings, kind]);
  if (!items?.length) return null;
  const go = (it: DiscoverItem) => openDiscover(kind, it, admin);
  const w = kind === 'audio' ? 130 : 110;
  const h = kind === 'audio' ? 130 : 165;
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.h}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {items.map((it) => (
          <Pressable key={`${it.rank}-${it.title}`} onPress={() => go(it)} style={{ width: w, gap: 5 }}>
            <View style={{ width: w, height: h, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surface }}>
              {it.cover ? <Image source={it.cover} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} /> : null}
              <View style={styles.rank}>
                <Text style={styles.rankText}>{it.rank}</Text>
              </View>
            </View>
            <Text numberOfLines={2} style={styles.t}>
              {it.title}
            </Text>
            {it.author ? (
              <Text numberOfLines={1} style={styles.s}>
                {it.author}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { color: C.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  t: { color: C.text, fontSize: 13, fontWeight: '700' },
  s: { color: C.textDim, fontSize: 12 },
  rank: { position: 'absolute', left: 6, top: 6, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontWeight: '800', fontSize: 12 },
});
