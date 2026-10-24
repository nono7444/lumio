// Récompenses de la famille : points, grade, badges et classement (heures regardées, notes, J'aime, demandes…).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Grade = { name: string; emoji: string; min: number };
type Badge = { id: string; emoji: string; name: string; desc: string };
type Member = {
  id: string;
  name: string;
  points: number;
  rank: number;
  hours: number;
  movies: number;
  episodes: number;
  likes: number;
  ratings: number;
  requests: number;
  messages: number;
  watchlist: number;
  grade: Grade;
  next: Grade | null;
  badges: Badge[];
};
type Board = { users: Member[]; badges: Badge[]; me: string };

const MEDAL = ['🥇', '🥈', '🥉'];

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serverCall<Board>(settings, '/api/rewards')
      .then(setBoard)
      .catch((e) => setError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = board?.users.find((u) => u.id === board.me);
  const pct = me?.next ? Math.round(((me.points - me.grade.min) / (me.next.min - me.grade.min)) * 100) : 100;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.h1}>Récompenses</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>
      {!board ? (
        error ? (
          <Text style={[styles.dim, { padding: 20 }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={C.text} style={{ marginTop: 60 }} />
        )
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40 }}>
          {me ? (
            <View style={styles.hero}>
              <Text style={styles.gradeEmoji}>{me.grade.emoji}</Text>
              <Text style={styles.gradeName}>{me.grade.name}</Text>
              <Text style={styles.points}>
                {me.points} points · {me.rank === 1 ? '1er' : `${me.rank}e`} de la famille
              </Text>
              {me.next ? (
                <>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.max(3, pct)}%` }]} />
                  </View>
                  <Text style={styles.dim}>
                    Encore {me.next.min - me.points} points pour devenir {me.next.emoji} {me.next.name}
                  </Text>
                </>
              ) : (
                <Text style={styles.dim}>Grade maximum atteint 🎉</Text>
              )}
            </View>
          ) : null}

          {me ? (
            <View style={styles.grid}>
              {[
                ['⏱️', `${me.hours} h`, 'regardées'],
                ['🎞️', String(me.movies), 'films vus'],
                ['📺', String(me.episodes), 'épisodes vus'],
                ['❤️', String(me.likes), 'J’aime'],
                ['⭐', String(me.ratings), 'notes données'],
                ['📥', String(me.requests), 'demandes'],
                ['💬', String(me.messages), 'messages'],
                ['🔖', String(me.watchlist), 'à voir'],
              ].map(([e, v, l]) => (
                <View key={l} style={styles.stat}>
                  <Text style={{ fontSize: 20 }}>{e}</Text>
                  <Text style={styles.statValue}>{v}</Text>
                  <Text style={styles.statLabel}>{l}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.h2}>Badges</Text>
          <View style={styles.badges}>
            {board.badges.map((b) => {
              const got = me?.badges.some((x) => x.id === b.id);
              return (
                <View key={b.id} style={[styles.badge, !got && { opacity: 0.35 }]}>
                  <Text style={{ fontSize: 26 }}>{b.emoji}</Text>
                  <Text style={styles.badgeName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={styles.badgeDesc} numberOfLines={2}>
                    {b.desc}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.h2}>Classement de la famille</Text>
          <View style={styles.card}>
            {board.users.map((u, i) => (
              <View key={u.id} style={[styles.rankRow, i === board.users.length - 1 && { borderBottomWidth: 0 }, u.id === board.me && styles.rankMe]}>
                <Text style={styles.rankNum}>{MEDAL[i] ?? `${u.rank}.`}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rankName}>
                    {u.name} {u.grade.emoji}
                  </Text>
                  <Text style={styles.dim}>
                    {u.grade.name} · {u.hours} h · {u.badges.map((b) => b.emoji).join(' ')}
                  </Text>
                </View>
                <Text style={styles.rankPts}>{u.points}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.dim, { textAlign: 'center' }]}>
            Points : 10 par heure regardée, 15 par note, 5 par demande, 3 par J’aime, 2 par titre « À voir », 1 par message.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  h1: { color: C.text, fontSize: 28, fontWeight: '900', flex: 1 },
  h2: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 6 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: C.surface, borderRadius: R.lg, padding: 20, alignItems: 'center', gap: 6 },
  gradeEmoji: { fontSize: 54 },
  gradeName: { color: C.text, fontSize: 26, fontWeight: '900' },
  points: { color: C.textDim, fontSize: 14, fontWeight: '700' },
  track: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: C.surfaceHigh, overflow: 'hidden', marginTop: 8 },
  fill: { height: 10, borderRadius: 5, backgroundColor: '#FFC93C' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '23%', flexGrow: 1, backgroundColor: C.surface, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', gap: 2 },
  statValue: { color: C.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: C.textDim, fontSize: 11, fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { width: '31%', flexGrow: 1, backgroundColor: C.surface, borderRadius: R.md, padding: 10, alignItems: 'center', gap: 3 },
  badgeName: { color: C.text, fontSize: 12, fontWeight: '800' },
  badgeDesc: { color: C.textDim, fontSize: 10, textAlign: 'center' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, paddingHorizontal: 14 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rankMe: { backgroundColor: 'rgba(255,201,60,0.08)', marginHorizontal: -14, paddingHorizontal: 14 },
  rankNum: { width: 30, fontSize: 18, textAlign: 'center', color: C.text, fontWeight: '800' },
  rankName: { color: C.text, fontSize: 15, fontWeight: '800' },
  rankPts: { color: '#FFC93C', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
