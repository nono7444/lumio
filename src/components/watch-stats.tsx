// Admin : statistiques de visionnage (temps par compte, activité sur 30 jours, tops films et séries).
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { SizeStepper, useCardSize, type SizeLevel } from '@/components/size-stepper';
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

/** Carte avec son titre et ses boutons − / + (le niveau choisi est mémorisé). */
function StatCard({ id, title, summary, children }: { id: string; title: string; summary?: string; children: (level: SizeLevel) => ReactNode }) {
  const [level, setLevel] = useCardSize(`stats-${id}`);
  // Réduit : juste le titre et un résumé, sur une ligne
  if (level === 0)
    return (
      <View style={[styles.card, styles.mini]}>
        <Text style={[styles.title, { fontSize: 14, flexShrink: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        {summary ? (
          <Text style={[styles.dim, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
            {summary}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <SizeStepper level={level} onChange={setLevel} />
      </View>
    );
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.title, level === 2 && { fontSize: 19 }]}>{title}</Text>
        <SizeStepper level={level} onChange={setLevel} />
      </View>
      {children(level)}
    </View>
  );
}

/** Nombre d'éléments affichés selon la taille de la carte */
const LIMIT = [3, 6, 20];

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
      <StatCard id="users" title="⏱️ Temps par compte" summary={stats.users[0] ? `${stats.users[0].name} · ${hours(stats.users[0].minutes)}` : undefined}>
        {(lv) =>
          stats.users.slice(0, lv === 0 ? 4 : 50).map((u, i) => (
            <View key={u.name} style={{ gap: 4 }}>
              <View style={styles.row}>
                <Text style={styles.name}>{u.name}</Text>
                <Text style={styles.dim}>
                  {hours(u.minutes)}
                  {lv > 0 ? ` · ${u.movies} films · ${u.episodes} épisodes` : ''}
                </Text>
              </View>
              <View style={[styles.track, lv === 2 && styles.trackBig]}>
                <View style={[styles.fill, lv === 2 && styles.trackBig, { width: `${(u.minutes / maxMin) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }]} />
              </View>
              {lv > 0
                ? u.recent.slice(0, lv === 2 ? 5 : 1).map((r, k) => (
                    <Text key={k} style={styles.faint} numberOfLines={1}>
                      {k === 0 ? 'Dernier : ' : '· '}
                      {r.title}
                    </Text>
                  ))
                : null}
            </View>
          ))
        }
      </StatCard>

      <StatCard id="days" title="📅 30 jours" summary={`${days.reduce((n, d) => n + d.n, 0)} titres vus`}>
        {(lv) => (
          <>
            <View style={[styles.chart, { height: [40, 80, 170][lv] }]}>
              {days.map((d) => (
                <View key={d.day} style={{ flex: 1, height: `${Math.max(3, (d.n / maxDay) * 100)}%`, backgroundColor: d.n ? C.accent : '#2C2C30', borderRadius: 2 }} />
              ))}
            </View>
            <View style={styles.row}>
              <Text style={styles.faint}>il y a 30 j</Text>
              <Text style={styles.faint}>aujourd’hui · {days.reduce((n, d) => n + d.n, 0)} titres vus</Text>
            </View>
          </>
        )}
      </StatCard>

      <StatCard id="movies" title="🎬 Top films" summary={stats.topMovies[0]?.title}>
        {(lv) => (
          <>
            {stats.topMovies.slice(0, LIMIT[lv]).map((m, i) => (
              <View key={m.id} style={{ gap: 3 }}>
                <View style={styles.row}>
                  <Text style={styles.name} numberOfLines={1}>
                    {i + 1}. {m.title}
                    {m.year ? <Text style={styles.dim}> ({m.year})</Text> : null}
                  </Text>
                  <Text style={styles.dim}>{m.viewers.length} 👤</Text>
                </View>
                <View style={[styles.track, lv === 2 && styles.trackBig]}>
                  <View style={[styles.fill, lv === 2 && styles.trackBig, { width: `${(m.viewers.length / maxTop) * 100}%`, backgroundColor: '#FFB340' }]} />
                </View>
                {lv > 0 ? (
                  <Text style={styles.faint} numberOfLines={lv === 2 ? 3 : 1}>
                    {m.viewers.join(', ')}
                  </Text>
                ) : null}
              </View>
            ))}
            {!stats.topMovies.length ? <Text style={styles.dim}>Aucun film vu pour l’instant.</Text> : null}
          </>
        )}
      </StatCard>

      <StatCard id="series" title="📺 Top séries" summary={stats.topSeries[0]?.title}>
        {(lv) => (
          <>
            {stats.topSeries.slice(0, LIMIT[lv]).map((s, i) => (
              <View key={s.id ?? s.title} style={{ gap: 3 }}>
                <View style={styles.row}>
                  <Text style={styles.name} numberOfLines={1}>
                    {i + 1}. {s.title}
                  </Text>
                  <Text style={styles.dim}>{s.episodes} ép.</Text>
                </View>
                <View style={[styles.track, lv === 2 && styles.trackBig]}>
                  <View style={[styles.fill, lv === 2 && styles.trackBig, { width: `${(s.episodes / maxSeries) * 100}%`, backgroundColor: '#A78BFA' }]} />
                </View>
                {lv > 0 ? (
                  <Text style={styles.faint} numberOfLines={lv === 2 ? 3 : 1}>
                    {s.viewers.join(', ')}
                  </Text>
                ) : null}
              </View>
            ))}
            {!stats.topSeries.length ? <Text style={styles.dim}>Aucune série vue pour l’instant.</Text> : null}
          </>
        )}
      </StatCard>
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
  trackBig: { height: 11, borderRadius: 6 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingLeft: 14, paddingRight: 6 },
});
