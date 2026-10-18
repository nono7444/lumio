// Fiche : note de la famille (moyenne), ma note en étoiles, et les avis des autres.
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

const GOLD = '#FFC93C';

export function FamilyRating({ type, tmdbId, title, poster }: { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<RatingInfo | null>(null);
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
        <Text style={styles.title}>Notes de la famille</Text>
        {info.avg != null ? (
          <View style={styles.avg}>
            <Text style={{ fontSize: 14 }}>🍅</Text>
            <Text style={styles.avgText}>
              {info.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/10 · {info.count} avis
            </Text>
          </View>
        ) : (
          <Text style={styles.dim}>Pas encore noté</Text>
        )}
      </View>

      <View style={styles.mineRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.dim}>Ta note{mine ? ` : ${mine}/10` : ''}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Platform.isTV ? 6 : 2 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <Pressable key={n} hitSlop={4} onPress={() => rate(n === mine ? 0 : n)} style={{ padding: Platform.isTV ? 4 : 1 }}>
                <Text style={{ fontSize: Platform.isTV ? 26 : 21, opacity: n <= mine ? 1 : 0.22 }}>🍅</Text>
              </Pressable>
            ))}
          </View>
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
            <Text style={{ color: GOLD, fontSize: 13 }}>🍅 {v.stars}/10</Text>
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
