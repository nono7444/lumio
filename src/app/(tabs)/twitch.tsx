// Lumio → univers « Twitch » (admin) : rediffusions des chaînes suivies (Altair par défaut), rangées par jeu.
// Choisir un jeu montre les rediffusions où il a été joué, et la lecture démarre au début de ce jeu.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { UniverseSwitch } from '@/components/universe-switch';
import { C, TAB_SPACE } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { FolderCard } from '@/components/folder-card';
import { lumioPlayBase } from '@/lib/chat';
import { folderApi } from '@/lib/ebooks';
import { fmtDay, fmtLen, loadTwitch, twitchApi, useTwitch, type TwitchChannel, type TwitchJob, type TwitchQuality, type TwitchSaved, type TwitchVod } from '@/lib/twitch';

const TWITCH = '#9146FF';
const QKEY = 'lumio:twitch-qualite';
// Qualités connues avant d'ouvrir une rediffusion (le choix exact vient de Twitch au moment de la lecture)
const QUALITY_PREFS = [
  { id: 'auto', name: 'Auto' },
  { id: 'chunked', name: 'Source' },
  { id: '1080p60', name: '1080p60' },
  { id: '720p60', name: '720p60' },
  { id: '720p30', name: '720p' },
  { id: '480p30', name: '480p' },
  { id: '360p30', name: '360p' },
  { id: '160p30', name: '160p' },
  { id: 'audio_only', name: 'Audio seul' },
];
/** Qualité voulue → la plus proche que la rediffusion propose (même hauteur ou en dessous). */
function pickQuality(list: TwitchQuality[], want: string): TwitchQuality | null {
  if (want === 'auto' || !list.length) return null;
  const exact = list.find((q) => q.id === want);
  if (exact) return exact;
  if (want === 'chunked') return list.find((q) => q.id === 'chunked') ?? list[0];
  const h = Number(want.match(/^(\d+)/)?.[1] ?? 0);
  return list.filter((q) => q.id !== 'audio_only' && q.height <= h).sort((a, b) => b.height - a.height || b.fps - a.fps)[0] ?? list[list.length - 1];
}

export default function TwitchScreen() {
  const { settings } = useSettings();
  const { data, err, loading, reload } = useTwitch();
  const { width } = useWindowDimensions();
  const [sel, setSel] = useState<string | null>(null);
  const [game, setGame] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCh, setNewCh] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [account, setAccount] = useState<{ login: string; name: string } | null | undefined>(undefined);
  const [quality, setQuality] = useState('auto');
  const [qSheet, setQSheet] = useState(false);
  const [menu, setMenu] = useState<{ v: TwitchVod; qualities: TwitchQuality[] | null } | null>(null);
  const [jobs, setJobs] = useState<TwitchJob[]>([]);
  const [tab, setTab] = useState<'vods' | 'mine'>('vods');
  const [mine, setMine] = useState<TwitchSaved[] | null>(null);
  const [diskSheet, setDiskSheet] = useState(false);
  const [disk, setDisk] = useState<string | null>(null);
  const loadMine = () =>
    twitchApi
      .saved(settings)
      .then((r) => setMine(r.saved))
      .catch(() => setMine([]));
  const loadDisk = () =>
    folderApi
      .get(settings, 'twitch')
      .then((r) => setDisk(r.dir?.root ?? null))
      .catch(() => {});
  useEffect(() => {
    loadMine();
    loadDisk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(QKEY)
      .then((v) => v && setQuality(v))
      .catch(() => {});
  }, []);
  const chooseQuality = (id: string) => {
    setQuality(id);
    AsyncStorage.setItem(QKEY, id).catch(() => {});
  };
  // Téléchargements sur le serveur : suivis toutes les 3 s tant qu'il y en a un en cours
  const loadJobs = () =>
    twitchApi
      .jobs(settings)
      .then((r) => {
        setJobs((old) => {
          if (r.jobs.some((j) => j.status === 'done' && old.find((o) => o.id === j.id && o.status !== 'done'))) loadMine();
          return r.jobs;
        });
        setSaved(r.saved);
      })
      .catch(() => {});
  const running = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    loadJobs();
    if (!running) return;
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const jobOf = (id: string) => jobs.find((j) => j.vodId === id && j.status !== 'cancelled');
  const download = async (v: TwitchVod, q: string) => {
    tap();
    try {
      await twitchApi.download(settings, v, ch?.name ?? 'Twitch', q === 'auto' ? 'chunked' : q);
      setTab('vods');
      loadJobs();
    } catch (e) {
      Alert.alert('Téléchargement impossible', e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    twitchApi
      .account(settings)
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null));
    // Relu au retour de l'écran de connexion (la liste des chaînes est rechargée à ce moment-là)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  const play = async (v: TwitchVod, from?: number, want?: string) => {
    tap();
    setOpening(v.id);
    try {
      const r = await twitchApi.play(settings, v.id);
      // Qualité choisie (comme sur Twitch) ; Auto = le lecteur s'adapte au débit
      const q = pickQuality(r.qualities ?? [], want ?? quality);
      const url = q?.url ?? r.url;
      // Reprise là où on s'était arrêté ; sinon début du jeu choisi
      const chap = game ? v.chapters.find((c) => c.game === game) : null;
      const start = from ?? (v.progress && !v.progress.done ? v.progress.pos : chap ? chap.start : 0);
      router.push({
        pathname: '/player',
        params: { kind: 'url', uri: url, hls: '1', title: v.title, subtitle: `${ch?.name ?? ''} · ${fmtDay(v.createdAt)}${q ? ` · ${q.name}` : ''}`, start: String(Math.floor(start)), twitch: v.id, twitchLen: String(v.length) },
      });
    } catch (e) {
      Alert.alert('Lecture impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };
  const playSaved = async (m: TwitchSaved) => {
    tap();
    if (!settings.chatUrl) return;
    // À la maison : lecture directe sur le serveur, sans passer par le tunnel Cloudflare
    const base = await lumioPlayBase(settings);
    const start = m.progress && !m.progress.done ? m.progress.pos : 0;
    router.push({
      pathname: '/player',
      params: {
        kind: 'url',
        uri: `${base}${m.url}`,
        title: m.title,
        subtitle: `${m.channel} · ${base.startsWith('http://') ? 'en local' : 'sur le serveur'}`,
        start: String(Math.floor(start)),
        twitch: m.vodId,
        twitchLen: String(m.length),
      },
    });
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

        {/* Compte Twitch abonné : rediffusions réservées aux abonnés */}
        <View style={styles.account}>
          <Ionicons name="logo-twitch" size={20} color={TWITCH} />
          <Text style={[styles.s, { flex: 1 }]}>
            {account === undefined ? '…' : account ? `Compte : ${account.name} (rediffusions d'abonnés lisibles)` : 'Rediffusions pour abonnés : connecte ton compte Twitch'}
          </Text>
          {account ? (
            <Pressable
              onPress={() =>
                Alert.alert('Déconnecter le compte Twitch ?', 'Les rediffusions réservées aux abonnés ne seront plus lisibles.', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Déconnecter', style: 'destructive', onPress: () => twitchApi.disconnect(settings).then(() => setAccount(null)).catch(() => {}) },
                ])
              }
              hitSlop={8}>
              <Text style={styles.link}>Déconnecter</Text>
            </Pressable>
          ) : account === null ? (
            <Pressable onPress={() => (tap(), router.push('/twitch-login'))} hitSlop={8}>
              <Text style={[styles.link, { color: TWITCH }]}>Se connecter</Text>
            </Pressable>
          ) : null}
        </View>

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

        <View style={styles.tabs}>
          <SegChip label={`Rediffusions${ch ? ` · ${ch.vods.length}` : ''}`} icon="logo-twitch" on={tab === 'vods'} onPress={() => setTab('vods')} />
          <SegChip label={`Mes rediffusions${mine ? ` · ${mine.length}` : ''}`} icon="server-outline" on={tab === 'mine'} onPress={() => (setTab('mine'), loadMine())} />
        </View>

        <View style={styles.tools}>
          <Pressable onPress={() => (tap(), setDiskSheet(true))} style={styles.tool}>
            <Ionicons name="server-outline" size={16} color={C.text} />
            <Text style={styles.toolText}>Disque : {disk ?? '…'}</Text>
            <Ionicons name="chevron-down" size={14} color={C.textDim} />
          </Pressable>
          <Pressable onPress={() => (tap(), setQSheet(true))} style={styles.tool}>
            <Ionicons name="options-outline" size={16} color={C.text} />
            <Text style={styles.toolText}>Qualité : {QUALITY_PREFS.find((x) => x.id === quality)?.name ?? quality}</Text>
            <Ionicons name="chevron-down" size={14} color={C.textDim} />
          </Pressable>
        </View>
        {tab === 'vods' ? <Text style={[styles.s, { paddingHorizontal: 16, marginBottom: 12 }]}>Appui long sur une rediffusion : autre qualité ou téléchargement sur le serveur.</Text> : null}
        {jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'error').slice(0, 5).map((j) => (
          <View key={j.id} style={styles.job}>
            <Ionicons name={j.status === 'error' ? 'alert-circle' : 'cloud-download-outline'} size={18} color={j.status === 'error' ? C.danger : TWITCH} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={1} style={styles.small}>
                {j.title}
              </Text>
              <Text style={styles.s}>
                {j.status === 'error'
                  ? j.error
                  : j.status === 'queued'
                    ? 'En attente'
                    : `${j.quality} · ${j.length ? Math.round((j.done / j.length) * 100) : 0} % · ${fmtLen(j.done)} / ${fmtLen(j.length)}${j.bytes ? ` · ${(j.bytes / 1e9).toFixed(1)} Go` : ''}`}
              </Text>
              {j.status === 'running' && j.length ? (
                <View style={styles.jobBar}>
                  <View style={{ width: `${Math.min(100, (j.done / j.length) * 100)}%`, height: '100%', backgroundColor: TWITCH }} />
                </View>
              ) : null}
            </View>
            {j.status !== 'error' ? (
              <Pressable onPress={() => twitchApi.cancel(settings, j.id).then(loadJobs)} hitSlop={8} accessibilityLabel="Annuler">
                <Ionicons name="close" size={18} color={C.textDim} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {tab === 'mine' ? (
          <View style={{ paddingHorizontal: 16, gap: 18 }}>
            {mine === null ? <ActivityIndicator color={C.text} /> : null}
            {mine && !mine.length ? (
              <Text style={styles.s}>Aucune rediffusion téléchargée. Appui long sur une rediffusion → « Télécharger sur le serveur ».</Text>
            ) : null}
            {mine?.map((m) => (
              <Pressable
                key={m.vodId}
                onPress={() => playSaved(m)}
                onLongPress={() =>
                  Alert.alert(m.title, `${m.channel} · ${m.quality} · ${(m.size / 1e9).toFixed(1)} Go`, [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Regarder', onPress: () => playSaved(m) },
                    {
                      text: 'Supprimer du disque',
                      style: 'destructive',
                      onPress: () => twitchApi.removeSaved(settings, m.vodId).then(() => (loadMine(), loadJobs())),
                    },
                  ])
                }
                style={{ gap: 8 }}>
                <Thumb
                  v={{ id: m.vodId, title: m.title, length: m.length, createdAt: m.createdAt, views: 0, thumb: m.thumb, chapters: [], progress: m.progress }}
                  w={cw}
                  busy={false}
                  saved
                />
                <Text numberOfLines={2} style={styles.t}>
                  {m.title}
                </Text>
                <Text style={styles.s}>
                  {[m.channel, m.createdAt ? fmtDay(m.createdAt) : null, fmtLen(m.length), m.quality, `${(m.size / 1e9).toFixed(1)} Go`].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Tri par jeu */}
        {tab === 'vods' && games.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
            <SegChip label={`Tous · ${ch?.vods.length ?? 0}`} on={!game} onPress={() => setGame(null)} />
            {games.map((g) => (
              <SegChip key={g.name} label={`${g.name} · ${g.vods}`} on={game === g.name} onPress={() => setGame(game === g.name ? null : g.name)} />
            ))}
          </ScrollView>
        ) : null}

        <View style={{ paddingHorizontal: 16, gap: 18, display: tab === 'vods' ? 'flex' : 'none' }}>
          {vods.map((v) => {
            const chap = game ? v.chapters.find((c) => c.game === game) : null;
            return (
              <Pressable
                key={v.id}
                onPress={() => play(v)}
                onLongPress={() => {
                  tap();
                  setMenu({ v, qualities: null });
                  twitchApi
                    .play(settings, v.id)
                    .then((r) => setMenu((m) => (m && m.v.id === v.id ? { v, qualities: r.qualities ?? [] } : m)))
                    .catch((e) => (setMenu(null), Alert.alert('Rediffusion indisponible', e instanceof Error ? e.message : String(e))));
                }}
                style={{ gap: 8 }}>
                <Thumb v={v} w={cw} busy={opening === v.id} saved={saved.includes(v.id)} job={jobOf(v.id)} />
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

      {/* Disque des rediffusions téléchargées */}
      <Modal visible={diskSheet} transparent animationType="slide" onRequestClose={() => (setDiskSheet(false), loadDisk())}>
        <Pressable style={styles.backdrop} onPress={() => (setDiskSheet(false), loadDisk(), loadMine())} />
        <View style={styles.sheet}>
          <FolderCard kind="twitch" title="Disque des rediffusions" flat onMoved={() => (loadDisk(), loadMine())} />
          <Text style={[styles.s, { marginTop: 12 }]}>
            Les prochains téléchargements vont sur ce disque, dans le dossier « Twitch ». Choisir un autre disque y déplace aussi celles déjà téléchargées.
          </Text>
        </View>
      </Modal>

      {/* Qualité par défaut */}
      <Modal visible={qSheet} transparent animationType="slide" onRequestClose={() => setQSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setQSheet(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Qualité de lecture</Text>
          {QUALITY_PREFS.map((x) => (
            <Pressable key={x.id} onPress={() => (tap(), chooseQuality(x.id), setQSheet(false))} style={styles.opt}>
              <Text style={[styles.optText, quality === x.id && { fontWeight: '800' }]}>{x.name}</Text>
              {quality === x.id ? <Ionicons name="checkmark" size={20} color={TWITCH} /> : null}
            </Pressable>
          ))}
          <Text style={[styles.s, { marginTop: 10 }]}>Si une rediffusion n'a pas cette qualité, la plus proche en dessous est prise.</Text>
        </View>
      </Modal>

      {/* Une rediffusion : regarder dans une autre qualité, ou télécharger sur le serveur */}
      <Modal visible={!!menu} transparent animationType="slide" onRequestClose={() => setMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={styles.sheet}>
          <Text numberOfLines={2} style={styles.sheetTitle}>
            {menu?.v.title}
          </Text>
          {!menu?.qualities ? (
            <ActivityIndicator color={C.text} style={{ margin: 20 }} />
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.sheetSub}>Regarder en</Text>
              {menu.qualities.map((x) => (
                <Pressable key={`p-${x.id}`} onPress={() => (setMenu(null), play(menu.v, undefined, x.id))} style={styles.opt}>
                  <Text style={styles.optText}>{x.name}</Text>
                  <Ionicons name="play" size={16} color={C.textDim} />
                </Pressable>
              ))}
              <Text style={[styles.sheetSub, { marginTop: 14 }]}>Télécharger sur le serveur en</Text>
              {saved.includes(menu.v.id) ? <Text style={styles.s}>Déjà téléchargée (retélécharger la remplace).</Text> : null}
              {menu.qualities.map((x) => (
                <Pressable key={`d-${x.id}`} onPress={() => (setMenu(null), download(menu.v, x.id))} style={styles.opt}>
                  <Text style={styles.optText}>{x.name}</Text>
                  <Ionicons name="download-outline" size={18} color={C.textDim} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Thumb({ v, w, busy, saved, job }: { v: TwitchVod; w: number; busy: boolean; saved?: boolean; job?: TwitchJob }) {
  const h = Math.round((w * 9) / 16);
  const p = v.progress;
  const pct = p && p.length ? Math.min(1, p.pos / p.length) : 0;
  return (
    <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surfaceHigh }}>
      {v.thumb ? <Image source={{ uri: v.thumb }} style={{ width: w, height: h }} contentFit="cover" transition={150} /> : null}
      <View style={styles.len}>
        <Text style={styles.lenText}>{fmtLen(v.length)}</Text>
      </View>
      {saved || job?.status === 'running' || job?.status === 'queued' ? (
        <View style={styles.dl}>
          <Ionicons name={saved && job?.status !== 'running' ? 'server' : 'cloud-download'} size={12} color="#fff" />
          {job?.status === 'running' && job.length ? <Text style={styles.dlText}>{Math.round((job.done / job.length) * 100)} %</Text> : null}
        </View>
      ) : null}
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
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 12, flexWrap: 'wrap' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: C.surfaceHigh },
  toolText: { color: C.text, fontSize: 13, fontWeight: '700' },
  job: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: C.surface },
  jobBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  dl: { position: 'absolute', right: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 22, borderRadius: 11, backgroundColor: TWITCH },
  dlText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.surfaceHigh, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, paddingBottom: 34, paddingHorizontal: 18 },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 10 },
  sheetSub: { color: C.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  optText: { color: C.text, fontSize: 16 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 14, padding: 12, borderRadius: 12, backgroundColor: C.surface },
  link: { color: C.text, fontSize: 13, fontWeight: '800' },
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
