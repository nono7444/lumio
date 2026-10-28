// Fiche : « Notes » (moyenne de la famille), ma note en étoiles (1 à 10) sur une ligne, et les avis des autres.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { usePrompt } from '@/components/prompt-modal';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { refreshRatingSummary, ratingsApi, type RatingInfo } from '@/lib/ratings';
import { timeAgo } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

/** Couleur d'une note : rouge (bas), orange (moyen), vert (haut) */
export const GOLD = '#FFC93C';

export { verdict } from '@/lib/ratings';

export const scoreColor = (n: number) => (n >= 7 ? '#34C759' : n >= 4 ? '#FF9F0A' : '#FF453A');

export function FamilyRating({ type, tmdbId, title, poster }: { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<RatingInfo | null>(null);
  const [allReviews, setAllReviews] = useState(false);
  const { prompt, element } = usePrompt();

  const load = useCallback(() => {
    ratingsApi.get(settings, type, tmdbId).then(setInfo).catch(() => setInfo(null));
  }, [settings, type, tmdbId]);
  useEffect(load, [load]);

  if (!info) return null;
  const mine = info.mine?.stars ?? 0;

  const rate = async (stars: number, comment?: string) => {
    tap();
    try {
      await ratingsApi.set(settings, { type, tmdbId, stars, comment: comment ?? info.mine?.comment, title, poster });
      load();
      refreshRatingSummary(settings);
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  // Fenêtre de saisie maison : marche aussi sur Android et la TV (Alert.prompt n'existe que sur iPhone)
  const review = async () => {
    const text = await prompt({ title: 'Ton avis', message: 'Quelques mots pour la famille (facultatif)', value: info.mine?.comment ?? '', ok: 'Enregistrer' });
    if (text !== null) rate(mine || 7, text);
  };

  const others = info.list.filter((v) => !v.mine);

  return (
    <View style={styles.card}>
      {element}
      <View style={styles.head}>
        <Text style={styles.title}>Notes</Text>
        {info.avg != null ? (
          <View style={styles.avg}>
            <Ionicons name="star" size={15} color={GOLD} />
            <Text style={styles.avgText}>{info.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</Text>
            <Text style={styles.dim}>/10 · {info.count} avis</Text>
          </View>
        ) : (
          <Text style={styles.dim}>Pas encore noté</Text>
        )}
      </View>

      {/* Ma note : 10 puces sur une seule ligne + bouton d'avis */}
      <View style={styles.mineRow}>
        <View style={styles.chips}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
            const on = mine > 0 && n <= mine;
            return (
              <Pressable key={n} hitSlop={3} onPress={() => rate(n === mine ? 0 : n)} accessibilityLabel={`Noter ${n} sur 10`} style={styles.chip}>
                <Ionicons name={on ? 'star' : 'star-outline'} size={22} color={on ? GOLD : 'rgba(255,255,255,0.28)'} />
              </Pressable>
            );
          })}
        </View>
        {mine ? <Text style={styles.mineNum}>{mine}</Text> : null}
        <Pressable onPress={review} hitSlop={8} style={styles.reviewBtn} accessibilityLabel="Laisser un avis">
          <Ionicons name={info.mine?.comment ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={16} color={C.text} />
        </Pressable>
      </View>
      {info.mine?.comment ? <Text style={[styles.comment, { color: C.text }]}>« {info.mine.comment} »</Text> : null}

      {(allReviews ? others : others.slice(0, 2)).map((v, i) => (
        <View key={i} style={styles.other}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.name}>{v.name}</Text>
            <View style={styles.avg}>
              <Ionicons name="star" size={12} color={GOLD} />
              <Text style={[styles.miniChipText, { color: scoreColor(v.stars) }]}>{v.stars}/10</Text>
            </View>
            <Text style={styles.dim}>{timeAgo(v.at)}</Text>
          </View>
          {v.comment ? <Text style={styles.comment} numberOfLines={allReviews ? undefined : 2}>{v.comment}</Text> : null}
        </View>
      ))}
      {others.length > 2 ? (
        <Pressable onPress={() => setAllReviews((x) => !x)} hitSlop={8}>
          <Text style={[styles.dim, { color: C.accent, fontWeight: '700' }]}>{allReviews ? 'Moins d’avis' : `Voir les ${others.length} avis`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 15, fontWeight: '800' },
  avg: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avgChip: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  avgChipText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chips: { flex: 1, flexDirection: 'row', gap: Platform.isTV ? 8 : 4 },
  chip: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  chipImg: { width: 24, height: 24 },
  avgText: { color: C.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mineNum: { color: C.text, fontSize: 14, fontWeight: '800', minWidth: 20, textAlign: 'center' },
  chipCurrent: { transform: [{ scale: 1.08 }] },
  chipText: { color: C.textDim, fontSize: Platform.isTV ? 17 : 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  miniChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1 },
  miniChipText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  other: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 8, gap: 3 },
  name: { color: C.text, fontSize: 14, fontWeight: '700' },
  comment: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
