// Lumio → univers « Twitch » (admin) : rediffusions des chaînes suivies (Altair par défaut), rangées par jeu.
// Choisir un jeu montre les rediffusions où il a été joué, et la lecture démarre au début de ce jeu.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { UniverseSwitch } from '@/components/universe-switch';
import { C, TAB_SPACE } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { fmtDay, fmtLen, loadTwitch, twitchApi, useTwitch, type TwitchChannel, type TwitchVod } from '@/lib/twitch';

const TWITCH = '#9146FF';

export default function TwitchScreen() {
  const { settings } = useSettings();
  const { data, err, loading, reload } = useTwitch();
  const { width } = useWindowDimensions();
  const [sel, setSel] = useState<string | null>(null);
  const [game, setGame] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCh, setNewCh] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const ch: TwitchChannel | null = data?.find((c) => c.login === sel) ?? data?.[0] ?? null;
  // Jeux de la chaîne : du plus joué au moins joué (en temps total)
  const games = useMemo(() => {
    const m = new Map<string, { name: string; box: string | null; time: number; vods: number }>();
    for (const v of ch?.vods ?? []) {
      const seen = new Set<string>();
      for (const c of v.chapters) {
        const g = m.get(c.game) ?? { name: c.game, box: c.box, time: 0, vods: 0 };
        g.time += c.length || 0;
        if (!seen.has(c.game)) g.vods++;
        seen.add(c.game);
        m.set(c.game, g);
      }
    }
    return [...m.values()].sort((a, b) => b.time - a.time);
  }, [ch]);
  const vods = useMemo(() => (ch?.vods ?? []).filter((v) => !game || v.chapters.some((c) => c.game === game)), [ch, game]);
  const going = useMemo(() => (ch?.vods ?? []).filter((v) => v.progress && !v.progress.done && v.progress.pos > 60).slice(0, 8), [ch]);
  const cw = Math.min(width - 32, 640);

  const play = async (v: TwitchVod, from?: number) => {
    tap();
    setOpening(v.id);
    try {
      const { url } = await twitchApi.play(settings, v.id);
      // Reprise là où on s'était arrêté ; sinon début du jeu choisi
      const chap = game ? v.chapters.find((c) => c.game === game) : null;
      const start = from ?? (v.progress && !v.progress.done ? v.progress.pos : chap ? chap.start : 0);
      router.push({
        pathname: '/player',
        params: { kind: 'url', uri: url, hls: '1', title: v.title, subtitle: `${ch?.name ?? ''} · ${fmtDay(v.createdAt)}`, start: String(Math.floor(start)), twitch: v.id, twitchLen: String(v.length) },
      });
    } catch (e) {
      Alert.alert('Lecture impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };
  const saveChannels = async (list: string[]) => {
    try {
      await twitchApi.setChannels(settings, list);
      await loadTwitch(settings, true);
    } catch (e) {
      Alert.alert('Chaîne non ajoutée', e instanceof Error ? e.message : String(e));
    }
  };

  if (!settings.jellyfin?.isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <Text style={[styles.s, { padding: 24 }]}>Réservé à l'administrateur.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={C.text} />}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <ScreenTitle title="Twitch" />

        {/* Chaînes suivies */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 14 }}>
          {(data ?? []).map((c) => {
            const on = c.login === ch?.login;
            return (
              <Pressable
                key={c.login}
                onPress={() => (tap(), setSel(c.login), setGame(null))}
                onLongPress={() =>
                  Alert.alert(`Retirer ${c.name} ?`, 'La chaîne ne sera plus suivie dans Lumio.', [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Retirer', style: 'destructive', onPress: () => saveChannels((data ?? []).map((x) => x.login).filter((l) => l !== c.login)) },
                  ])
                }
                style={{ alignItems: 'center', gap: 6, width: 72 }}>
                <View style={[styles.avatar, on && { borderColor: TWITCH }]}>
                  {c.avatar ? <Image source={{ uri: c.avatar }} style={styles.avatarImg} /> : <Ionicons name="logo-twitch" size={26} color={TWITCH} />}
                  {c.live ? <Text style={styles.liveDot}>DIRECT</Text> : null}
                </View>
                <Text numberOfLines={1} style={[styles.chName, on && { color: C.text }]}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => (tap(), setAdding(true))} style={{ alignItems: 'center', gap: 6, width: 72 }} accessibilityLabel="Ajouter une chaîne">
            <View style={[styles.avatar, { borderStyle: 'dashed' }]}>
              <Ionicons name="add" size={28} color={C.textDim} />
            </View>
            <Text style={styles.chName}>Ajouter</Text>
          </Pressable>
        </ScrollView>
        {adding ? (
          <View style={styles.addBox}>
            <TextInput
              value={newCh}
              onChangeText={setNewCh}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Nom de la chaîne (ex. altair) ou lien twitch.tv/…"
              placeholderTextColor={C.textFaint}
              style={styles.addInput}
              onSubmitEditing={async () => {
                const l = newCh.trim();
                if (l) await saveChannels([...(data ?? []).map((x) => x.login), l]);
                setNewCh('');
                setAdding(false);
              }}
              returnKeyType="done"
            />
            <Pressable onPress={() => (setAdding(false), setNewCh(''))} hitSlop={8}>
              <Ionicons name="close" size={20} color={C.textDim} />
            </Pressable>
          </View>
        ) : null}

        {!data && err ? <Text style={[styles.s, { padding: 24, color: C.danger }]}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={C.text} style={{ marginTop: 40 }} /> : null}
        {ch?.error ? <Text style={[styles.s, { paddingHorizontal: 16, color: C.danger }]}>{ch.error} (appui long sur la chaîne pour la retirer)</Text> : null}

        {ch?.live ? (
          <View style={styles.live}>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>EN DIRECT</Text>
            </View>
            <Text numberOfLines={2} style={styles.t}>
              {ch.live.title}
            </Text>
            <Text style={styles.s}>{[ch.live.game, `${ch.live.viewers.toLocaleString('fr-FR')} spectateurs`].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}

        {going.length ? (
          <View style={{ marginBottom: 16 }}>
            <Text style={styles.h}>Reprendre</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
              {going.map((v) => (
                <Pressable key={v.id} onPress={() => play(v)} style={{ width: 220, gap: 6 }}>
                  <Thumb v={v} w={220} busy={opening === v.id} />
                  <Text numberOfLines={2} style={styles.small}>
                    {v.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Tri par jeu */}
        {games.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
            <SegChip label={`Tous · ${ch?.vods.length ?? 0}`} on={!game} onPress={() => setGame(null)} />
            {games.map((g) => (
              <SegChip key={g.name} label={`${g.name} · ${g.vods}`} on={game === g.name} onPress={() => setGame(game === g.name ? null : g.name)} />
            ))}
          </ScrollView>
        ) : null}

        <View style={{ paddingHorizontal: 16, gap: 18 }}>
          {vods.map((v) => {
            const chap = game ? v.chapters.find((c) => c.game === game) : null;
            return (
              <Pressable key={v.id} onPress={() => play(v)} style={{ gap: 8 }}>
                <Thumb v={v} w={cw} busy={opening === v.id} />
                <Text numberOfLines={2} style={styles.t}>
                  {v.title}
                </Text>
                <Text style={styles.s}>
                  {fmtDay(v.createdAt)} · {fmtLen(v.length)}
                  {chap && chap.start > 0 ? ` · ${game} à ${fmtLen(chap.start)}` : ''}
                </Text>
                {v.chapters.length > 1 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {v.chapters.map((c, i) => (
                      <Pressable key={`${c.game}-${i}`} onPress={() => play(v, c.start)} style={[styles.chap, c.game === game && { borderColor: TWITCH }]}>
                        {c.box ? <Image source={{ uri: c.box }} style={styles.chapBox} /> : null}
                        <Text numberOfLines={1} style={styles.chapText}>
                          {c.game}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
              </Pressable>
            );
          })}
          {ch && !ch.error && !vods.length ? <Text style={styles.s}>Aucune rediffusion publique pour l'instant.</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Thumb({ v, w, busy }: { v: TwitchVod; w: number; busy: boolean }) {
  const h = Math.round((w * 9) / 16);
  const p = v.progress;
  const pct = p && p.length ? Math.min(1, p.pos / p.length) : 0;
  return (
    <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surfaceHigh }}>
      {v.thumb ? <Image source={{ uri: v.thumb }} style={{ width: w, height: h }} contentFit="cover" transition={150} /> : null}
      <View style={styles.len}>
        <Text style={styles.lenText}>{fmtLen(v.length)}</Text>
      </View>
      {p?.done ? (
        <View style={styles.seen}>
          <Ionicons name="checkmark" size={12} color="#000" />
        </View>
      ) : null}
      {pct > 0 && !p?.done ? (
        <View style={styles.bar}>
          <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: TWITCH }} />
        </View>
      ) : null}
      {busy ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }]}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  h: { color: C.text, fontSize: 19, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  t: { color: C.text, fontSize: 15, fontWeight: '700' },
  s: { color: C.textDim, fontSize: 13 },
  small: { color: C.text, fontSize: 12, fontWeight: '600' },
  avatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  avatarImg: { width: 58, height: 58, borderRadius: 29 },
  liveDot: { position: 'absolute', bottom: -6, backgroundColor: '#E91916', color: '#fff', fontSize: 9, fontWeight: '900', paddingHorizontal: 5, borderRadius: 4, overflow: 'hidden' },
  chName: { color: C.textDim, fontSize: 12, fontWeight: '600' },
  addBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: C.surfaceHigh },
  addInput: { flex: 1, color: C.text, fontSize: 15 },
  live: { marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 14, backgroundColor: 'rgba(145,70,255,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: TWITCH, gap: 6 },
  liveBadge: { alignSelf: 'flex-start', backgroundColor: '#E91916', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  liveBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  len: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  lenText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  seen: { position: 'absolute', left: 8, top: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  chap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10, height: 34, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: 'transparent', overflow: 'hidden' },
  chapBox: { width: 24, height: 32 },
  chapText: { color: C.text, fontSize: 12, fontWeight: '600', maxWidth: 160, marginLeft: 4 },
});
