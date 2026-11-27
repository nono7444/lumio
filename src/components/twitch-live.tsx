// Univers Twitch → onglet « En direct » : tes chaînes en live, les lives en français, et les lives par jeu.
// Toucher un live le lance (relais sans pub si activé, qualité choisie dans l'univers Twitch).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { SegChip, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { twitchApi, type TwitchChannel, type TwitchGame, type TwitchLive } from '@/lib/twitch';

const TWITCH = '#9146FF';
type Mode = 'mine' | 'fr' | 'game';
const fmtViewers = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} k` : String(n));

export function TwitchLiveTab({ channels, onPlay, busy }: { channels: TwitchChannel[]; onPlay: (l: TwitchLive) => void; busy: string | null }) {
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('mine');
  const [games, setGames] = useState<TwitchGame[] | null>(null);
  const [game, setGame] = useState<string | null>(null);
  const [lives, setLives] = useState<TwitchLive[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mine: TwitchLive[] = channels
    .filter((c) => c.live)
    .map((c) => ({ login: c.login, name: c.name, avatar: c.avatar ?? null, title: c.live!.title, viewers: c.live!.viewers, game: c.live!.game, thumb: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${c.login}-440x248.jpg?t=${Math.floor(Date.now() / 60000)}` }));

  useEffect(() => {
    if (mode === 'game' && !games) twitchApi.games(settings).then((r) => setGames(r.games)).catch(() => setGames([]));
  }, [mode, games, settings]);
  useEffect(() => {
    setErr(null);
    if (mode === 'mine') return;
    if (mode === 'game' && !game) return setLives(null);
    setLives(null);
    twitchApi
      .browse(settings, mode === 'fr' ? { fr: true, game: game ?? undefined } : { game: game ?? undefined })
      .then((r) => setLives(r.lives))
      .catch((e) => (setErr(e instanceof Error ? e.message : String(e)), setLives([])));
  }, [mode, game, settings]);

  const cols = width > 700 ? 3 : 2;
  const w = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 12) / cols);
  const list = mode === 'mine' ? mine : lives;

  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        <SegChip label={`Mes chaînes${mine.length ? ` · ${mine.length}` : ''}`} icon="heart-outline" on={mode === 'mine'} onPress={() => (setMode('mine'), setGame(null))} />
        <SegChip label="En français" icon="flag-outline" on={mode === 'fr'} onPress={() => (setMode('fr'), setGame(null))} />
        <SegChip label="Par jeu" icon="game-controller-outline" on={mode === 'game'} onPress={() => setMode('game')} />
      </ScrollView>

      {mode === 'game' ? (
        games === null ? (
          <ActivityIndicator color={C.text} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            {games.map((g) => {
              const on = game === g.name;
              return (
                <Pressable key={g.name} onPress={() => (tap(), setGame(on ? null : g.name))} style={{ width: 84, gap: 4 }}>
                  <View style={[styles.box, on && { borderColor: TWITCH }]}>{g.box ? <Image source={g.box} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}</View>
                  <Text numberOfLines={2} style={[styles.s, on && { color: C.text, fontWeight: '700' }]}>
                    {g.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )
      ) : null}

      {err ? <Text style={[styles.s, { paddingHorizontal: 16, color: C.danger }]}>{err}</Text> : null}
      {mode === 'game' && !game ? <Text style={[styles.s, { paddingHorizontal: 16 }]}>Choisis un jeu pour voir ses lives du moment.</Text> : null}
      {list === null && !(mode === 'game' && !game) ? <ActivityIndicator color={C.text} style={{ marginTop: 20 }} /> : null}
      {list && !list.length ? (
        <Text style={[styles.s, { paddingHorizontal: 16 }]}>{mode === 'mine' ? 'Aucune de tes chaînes n’est en direct pour le moment.' : 'Aucun live pour le moment.'}</Text>
      ) : null}
      <View style={styles.grid}>
        {(list ?? []).map((l) => (
          <Pressable key={l.login} onPress={() => onPlay(l)} style={{ width: w, gap: 6 }}>
            <View style={[styles.thumb, { width: w, height: Math.round((w * 9) / 16) }]}>
              {l.thumb ? <Image source={l.thumb} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
              <View style={styles.live}>
                <Text style={styles.liveText}>EN DIRECT</Text>
              </View>
              <View style={styles.viewers}>
                <Ionicons name="person" size={11} color="#fff" />
                <Text style={styles.viewersText}>{fmtViewers(l.viewers)}</Text>
              </View>
              {busy === l.login ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              {l.avatar ? <Image source={l.avatar} style={styles.avatar} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.t}>
                  {l.name}
                </Text>
                <Text numberOfLines={2} style={styles.s}>
                  {l.title}
                </Text>
                {l.game ? (
                  <Text numberOfLines={1} style={[styles.s, { color: TWITCH }]}>
                    {l.game}
                  </Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
  thumb: { borderRadius: 10, overflow: 'hidden', backgroundColor: C.surface },
  live: { position: 'absolute', left: 6, top: 6, backgroundColor: '#e91916', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  liveText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },
  viewers: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  viewersText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surface },
  box: { width: 84, height: 112, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 2, borderColor: 'transparent' },
  t: { color: C.text, fontSize: 13, fontWeight: '800' },
  s: { color: C.textDim, fontSize: 12, lineHeight: 16 },
});
