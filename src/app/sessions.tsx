// Admin : qui regarde quoi en ce moment sur Jellyfin (titre, avancement, appareil, lecture directe ou conversion).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { C, R } from '@/constants/theme';
import { jf, jfImage, type JfSession } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { WatchStats } from '@/components/watch-stats';

const ticks = (t?: number) => (t ?? 0) / 10_000_000;
const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const REASONS: Record<string, string> = {
  ContainerNotSupported: 'conteneur',
  VideoCodecNotSupported: 'codec vidéo',
  AudioCodecNotSupported: 'codec audio',
  SubtitleCodecNotSupported: 'sous-titres',
  AudioChannelsNotSupported: 'canaux audio',
  VideoBitrateNotSupported: 'débit',
  ContainerBitrateExceedsLimit: 'débit limité',
  VideoResolutionNotSupported: 'résolution',
  VideoLevelNotSupported: 'niveau vidéo',
  VideoProfileNotSupported: 'profil vidéo',
  VideoRangeTypeNotSupported: 'HDR',
};

function method(s: JfSession): { label: string; color: string; detail?: string } {
  const pm = s.PlayState?.PlayMethod;
  const t = s.TranscodingInfo;
  if (pm === 'Transcode' && t) {
    const what = t.IsVideoDirect ? 'audio seulement' : `${t.VideoCodec?.toUpperCase() ?? 'vidéo'}${t.Height ? ` ${t.Height}p` : ''}`;
    const why = (t.TranscodeReasons ?? []).map((r) => REASONS[r] ?? r).join(', ');
    const hw = t.HardwareAccelerationType && t.HardwareAccelerationType !== 'none' ? ` · accélération ${t.HardwareAccelerationType}` : ' · processeur';
    return {
      label: 'Conversion',
      color: C.warning,
      detail: `${what}${t.Bitrate ? ` · ${(t.Bitrate / 1e6).toFixed(1)} Mb/s` : ''}${t.IsVideoDirect ? '' : hw}${why ? ` · raison : ${why}` : ''}`,
    };
  }
  if (pm === 'DirectStream') return { label: 'Flux direct', color: C.info };
  return { label: 'Lecture directe', color: C.success };
}

function SessionCard({ s }: { s: JfSession }) {
  const { settings } = useSettings();
  const it = s.NowPlayingItem!;
  const isEp = it.Type === 'Episode';
  const poster = isEp && it.SeriesId
    ? jfImage(settings, it.SeriesId, 'Primary', { tag: it.SeriesPrimaryImageTag, maxHeight: 300 })
    : jfImage(settings, it.Id, 'Primary', { tag: it.ImageTags?.Primary, maxHeight: 300 });
  const pos = ticks(s.PlayState?.PositionTicks);
  const dur = ticks(it.RunTimeTicks);
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  const m = method(s);
  const paused = s.PlayState?.IsPaused;

  return (
    <View style={styles.card}>
      <Image source={poster} style={styles.poster} contentFit="cover" transition={200} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(s.UserName ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.user} numberOfLines={1}>
            {s.UserName ?? 'Inconnu'}
          </Text>
          <Ionicons name={paused ? 'pause' : 'play'} size={14} color={paused ? C.textDim : C.success} />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {isEp ? it.SeriesName : it.Name}
        </Text>
        <Text style={styles.dim} numberOfLines={1}>
          {isEp ? `S${it.ParentIndexNumber ?? '?'} É${it.IndexNumber ?? '?'} · ${it.Name}` : it.ProductionYear ?? ''}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: paused ? C.textDim : C.accent }]} />
        </View>
        <Text style={styles.dim}>
          {clock(pos)} / {dur ? clock(dur) : '—'}
          {paused ? ' · en pause' : ''}
        </Text>
        <Text style={styles.dim} numberOfLines={1}>
          {s.DeviceName ?? 'Appareil'} · {s.Client ?? ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View style={[styles.badge, { backgroundColor: m.color + '26' }]}>
            <Text style={[styles.badgeText, { color: m.color }]}>{m.label}</Text>
          </View>
        </View>
        {m.detail ? <Text style={[styles.dim, { color: C.warning }]}>{m.detail}</Text> : null}
      </View>
    </View>
  );
}

export default function Sessions() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<JfSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    jf.sessions(settings)
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings]);

  // Rafraîchi toutes les 5 s tant que l'écran est ouvert
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }, [load])
  );

  const playing = (list ?? []).filter((s) => s.NowPlayingItem);
  const idle = (list ?? []).filter((s) => !s.NowPlayingItem && s.UserName);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.h1}>En cours de lecture</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
        refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        {error ? (
          <Text style={[styles.dim, { textAlign: 'center', marginTop: 20 }]}>{error}</Text>
        ) : !list ? (
          <ActivityIndicator color={C.text} style={{ marginTop: 30 }} />
        ) : (
          <>
            <Text style={styles.section}>
              {playing.length ? `${playing.length} lecture${playing.length > 1 ? 's' : ''} en cours` : 'Personne ne regarde en ce moment'}
            </Text>
            {playing.map((s) => (
              <SessionCard key={s.Id} s={s} />
            ))}
            {idle.length ? (
              <>
                <Text style={[styles.section, { marginTop: 10 }]}>Connectés récemment</Text>
                <View style={[styles.card, { flexDirection: 'column', gap: 8 }]}>
                  {idle.map((s) => (
                    <Text key={s.Id} style={styles.dim}>
                      <Text style={{ color: C.text, fontWeight: '700' }}>{s.UserName}</Text> · {s.DeviceName} · {s.Client}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
        <Text style={styles.statsTitle}>Statistiques</Text>
        <WatchStats />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  statsTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 18, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  h1: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  section: { color: C.text, fontSize: 17, fontWeight: '800' },
  card: { flexDirection: 'row', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 12 },
  poster: { width: 84, height: 126, borderRadius: 8, backgroundColor: C.surfaceHigh },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#3D6BFF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  user: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  title: { color: C.text, fontSize: 16, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 12, lineHeight: 16 },
  bar: { height: 4, borderRadius: 2, backgroundColor: C.surfaceHigh, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
