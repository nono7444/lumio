// Admin : statistiques de visionnage (temps par compte, activité sur 30 jours, tops films et séries).
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Stats = {
  users: { name: string; minutes: number; movies: number; episodes: number; recent: { title: string; at: string }[] }[];
  topMovies: { id: string; title: string; year?: number; viewers: string[]; plays: number }[];
  topSeries: { id: string; title: string; viewers: string[]; episodes: number }[];
  days: { day: string; n: number }[];
};

const COLORS = ['#3D8BFF', '#4ADE80', '#FFB340', '#FF6B9A', '#A78BFA', '#64D2FF', '#FF8A3D'];
const hours = (m: number) => (m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`);

export function WatchStats() {
  const { settings } = useSettings();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serverCall<Stats>(settings, '/api/stats/watch')
      .then(setStats)
      .catch((e) => setError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Text style={styles.dim}>Statistiques indisponibles : {error}</Text>;
  if (!stats) return <ActivityIndicator color={C.text} style={{ margin: 20 }} />;

  const maxMin = Math.max(1, ...stats.users.map((u) => u.minutes));
  // 30 derniers jours, jours sans visionnage compris
  const byDay = new Map(stats.days.map((d) => [d.day, d.n]));
  const days: { day: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day: d, n: byDay.get(d) ?? 0 });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.n));
  const maxTop = Math.max(1, ...stats.topMovies.map((m) => m.viewers.length));
  const maxSeries = Math.max(1, ...stats.topSeries.map((s) => s.episodes));

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.title}>⏱️ Temps de visionnage par compte</Text>
        {stats.users.map((u, i) => (
          <View key={u.name} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Text style={styles.name}>{u.name}</Text>
              <Text style={styles.dim}>
                {hours(u.minutes)} · {u.movies} films · {u.episodes} épisodes
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(u.minutes / maxMin) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }]} />
            </View>
            {u.recent[0] ? (
              <Text style={styles.faint} numberOfLines={1}>
                Dernier : {u.recent[0].title}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>📅 Activité sur 30 jours</Text>
        <View style={styles.chart}>
          {days.map((d) => (
            <View key={d.day} style={{ flex: 1, height: `${Math.max(3, (d.n / maxDay) * 100)}%`, backgroundColor: d.n ? C.accent : '#2C2C30', borderRadius: 2 }} />
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.faint}>il y a 30 j</Text>
          <Text style={styles.faint}>aujourd’hui · {days.reduce((n, d) => n + d.n, 0)} titres vus</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>🎬 Top films</Text>
        {stats.topMovies.map((m, i) => (
          <View key={m.id} style={{ gap: 3 }}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {i + 1}. {m.title}
                {m.year ? <Text style={styles.dim}> ({m.year})</Text> : null}
              </Text>
              <Text style={styles.dim}>{m.viewers.length} 👤</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(m.viewers.length / maxTop) * 100}%`, backgroundColor: '#FFB340' }]} />
            </View>
            <Text style={styles.faint} numberOfLines={1}>
              {m.viewers.join(', ')}
            </Text>
          </View>
        ))}
        {!stats.topMovies.length ? <Text style={styles.dim}>Aucun film vu pour l’instant.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>📺 Top séries</Text>
        {stats.topSeries.map((s, i) => (
          <View key={s.id ?? s.title} style={{ gap: 3 }}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {i + 1}. {s.title}
              </Text>
              <Text style={styles.dim}>{s.episodes} ép.</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(s.episodes / maxSeries) * 100}%`, backgroundColor: '#A78BFA' }]} />
            </View>
            <Text style={styles.faint} numberOfLines={1}>
              {s.viewers.join(', ')}
            </Text>
          </View>
        ))}
        {!stats.topSeries.length ? <Text style={styles.dim}>Aucune série vue pour l’instant.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 12 },
  title: { color: C.text, fontSize: 17, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  name: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  dim: { color: C.textDim, fontSize: 12 },
  faint: { color: C.textFaint, fontSize: 11 },
  track: { height: 7, borderRadius: 4, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 80 },
});
