// Fiche : note de la famille (moyenne), ma note en étoiles, et les avis des autres.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { refreshRatingSummary, ratingsApi, type RatingInfo } from '@/lib/ratings';
import { timeAgo } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

const GOLD = '#FFC93C';

export function FamilyRating({ type, tmdbId, title, poster }: { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<RatingInfo | null>(null);

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

  const review = () =>
    Alert.prompt?.(
      'Ton avis',
      'Quelques mots pour la famille (facultatif)',
      (text) => rate(mine || 4, text ?? ''),
      'plain-text',
      info.mine?.comment ?? ''
    );

  const others = info.list.filter((v) => !v.mine);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Notes de la famille</Text>
        {info.avg != null ? (
          <View style={styles.avg}>
            <Ionicons name="star" size={14} color={GOLD} />
            <Text style={styles.avgText}>
              {info.avg.toLocaleString('fr-FR')} · {info.count} avis
            </Text>
          </View>
        ) : (
          <Text style={styles.dim}>Pas encore noté</Text>
        )}
      </View>

      <View style={styles.mineRow}>
        <Text style={styles.dim}>Ta note</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} hitSlop={6} onPress={() => rate(n === mine ? 0 : n)}>
              <Ionicons name={n <= mine ? 'star' : 'star-outline'} size={26} color={n <= mine ? GOLD : C.textFaint} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={review} hitSlop={8} style={styles.reviewBtn}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={C.text} />
        </Pressable>
      </View>
      {info.mine?.comment ? <Text style={[styles.comment, { color: C.text }]}>« {info.mine.comment} »</Text> : null}

      {others.map((v, i) => (
        <View key={i} style={styles.other}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.name}>{v.name}</Text>
            <Text style={{ color: GOLD, fontSize: 13 }}>{'★'.repeat(v.stars)}</Text>
            <Text style={styles.dim}>{timeAgo(v.at)}</Text>
          </View>
          {v.comment ? <Text style={styles.comment}>{v.comment}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 16, fontWeight: '800' },
  avg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  avgText: { color: C.text, fontSize: 14, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 13 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewBtn: { marginLeft: 'auto', width: 34, height: 34, borderRadius: 17, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  other: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 8, gap: 3 },
  name: { color: C.text, fontSize: 14, fontWeight: '700' },
  comment: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
