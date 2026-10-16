import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CastIcon, CastingScreen, guessContentType, useCasting } from '@/components/players/cast';
import { MpvPlayer } from '@/components/players/mpv-player';
import { NativePlayer } from '@/components/players/native-player';
import { Toasts } from '@/components/toast';
import { Button } from '@/components/ui';
import { C } from '@/constants/theme';
import { getPlayback, jf, jfImage, playback, QUALITIES, type PlaybackTarget } from '@/lib/jellyfin';
import { QualitySheet } from '@/components/players/quality';
import { tmdbNextEpisode } from '@/lib/smart-play';
import { useSettings } from '@/lib/settings';

type Params = {
  kind: 'jellyfin' | 'url';
  itemId?: string;
  uri?: string;
  headers?: string;
  title?: string;
  subtitle?: string;
  start?: string;
  // Contexte d'une série en streaming (pour l'épisode suivant)
  tmdbId?: string;
  imdb?: string;
  series?: string;
  season?: string;
  episode?: string;
};

type NextUp = { label: string; go: () => void };

const NEXT_DELAY = 8;

type Source = { uri: string; headers?: Record<string, string>; isHls: boolean };

/** Ouvre un lien direct dans un lecteur externe. */
function openExternal(app: 'vlc' | 'infuse', uri: string) {
  const enc = encodeURIComponent(uri);
  const url =
    app === 'vlc'
      ? Platform.OS === 'ios'
        ? `vlc-x-callback://x-callback-url/stream?url=${enc}`
        : `vlc://${uri}`
      : `infuse://x-callback-url/play?url=${enc}`;
  Linking.openURL(url).catch(() => Linking.openURL(uri).catch(() => {}));
}

export default function Player() {
  useKeepAwake();
  const p = useLocalSearchParams<Params>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [engine, setEngine] = useState<'mpv' | 'native'>(settings.player ?? 'mpv');
  const [quality, setQuality] = useState(settings.quality || 'original');
  const [qualityOpen, setQualityOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nextUp, setNextUp] = useState<NextUp | null>(null);
  const [countdown, setCountdown] = useState(NEXT_DELAY);

  const target = useRef<PlaybackTarget | null>(null);
  const position = useRef(0);
  const lastReport = useRef(0);
  const startAt = Number(p.start ?? 0) || 0;
  const { client: castClient, deviceName } = useCasting();
  const casting = Boolean(castClient);

  // Rotation libre dans le lecteur, retour en portrait à la sortie
  useEffect(() => {
    if (Platform.isTV) return;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Prépare la source (le profil Jellyfin dépend du moteur choisi)
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    (async () => {
      try {
        if (p.kind === 'jellyfin' && p.itemId) {
          const t = await getPlayback(
            settings,
            p.itemId,
            Math.max(position.current, startAt),
            engine,
            QUALITIES.find((x) => x.id === quality)
          );
          if (cancelled) return;
          target.current = t;
          setSource({ uri: t.uri, isHls: t.isHls });
        } else if (p.uri) {
          let headers: Record<string, string> | undefined;
          try {
            headers = p.headers ? JSON.parse(p.headers) : undefined;
          } catch {}
          setSource({ uri: p.uri, headers, isHls: /\.m3u8(\?|$)/i.test(p.uri) });
        } else {
          throw new Error('Aucune source à lire');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, attempt, quality]);

  // Fin de lecture signalée à Jellyfin à la fermeture
  useEffect(() => {
    return () => {
      if (target.current) playback.stop(settings, { target: target.current, positionSeconds: position.current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTime = (pos: number, paused: boolean) => {
    position.current = pos;
    const now = Date.now();
    if (!target.current || now - lastReport.current < 10_000) return;
    lastReport.current = now;
    playback.progress(settings, { target: target.current, positionSeconds: pos, isPaused: paused });
  };

  const onReady = (pos: number) => {
    position.current = pos;
    if (target.current) playback.start(settings, { target: target.current, positionSeconds: pos });
  };

  // ——— Épisode suivant ———
  async function findNext(): Promise<NextUp | null> {
    if (!settings.autoNext) return null;
    if (p.kind === 'jellyfin' && p.itemId) {
      const cur = await jf.item(settings, p.itemId).catch(() => null);
      if (cur?.Type !== 'Episode') return null;
      const nxt = await jf.nextEpisode(settings, cur).catch(() => null);
      if (!nxt) return null;
      return {
        label: `S${nxt.ParentIndexNumber}E${nxt.IndexNumber} · ${nxt.Name}`,
        go: () =>
          router.replace({
            pathname: '/player',
            params: {
              kind: 'jellyfin',
              itemId: nxt.Id,
              title: `${nxt.SeriesName ?? ''} · S${nxt.ParentIndexNumber}E${nxt.IndexNumber}`,
              subtitle: nxt.Name,
              start: '0',
            },
          }),
      };
    }
    if (p.tmdbId && p.season && p.episode) {
      const nxt = await tmdbNextEpisode(settings, Number(p.tmdbId), Number(p.season), Number(p.episode)).catch(() => null);
      if (!nxt) return null;
      return {
        label: `S${nxt.season}E${nxt.episode}`,
        go: () =>
          router.replace({
            pathname: '/watch',
            params: {
              type: 'tv',
              tmdbId: p.tmdbId!,
              imdb: p.imdb,
              title: p.series ?? p.title ?? '',
              season: String(nxt.season),
              episode: String(nxt.episode),
            },
          }),
      };
    }
    return null;
  }

  const onEnded = async () => {
    const n = await findNext();
    if (n) {
      setCountdown(NEXT_DELAY);
      setNextUp(n);
    } else router.back();
  };

  useEffect(() => {
    if (!nextUp) return;
    if (countdown <= 0) {
      nextUp.go();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextUp, countdown]);

  const resumeFrom = Math.max(position.current, startAt);
  const other = engine === 'mpv' ? 'native' : 'mpv';

  // Média à envoyer au Chromecast : Jellyfin avec un profil compatible (transcodage si besoin), sinon le lien direct
  const castMedia = async () => {
    if (p.kind === 'jellyfin' && p.itemId) {
      const t = await getPlayback(settings, p.itemId, position.current, 'cast');
      if (target.current) playback.stop(settings, { target: target.current, positionSeconds: position.current });
      target.current = t;
      playback.start(settings, { target: t, positionSeconds: position.current });
      return {
        uri: t.uri,
        contentType: guessContentType(t.uri, t.isHls),
        title: p.title,
        subtitle: p.subtitle,
        image: jfImage(settings, p.itemId, 'Primary', { maxWidth: 600 }),
      };
    }
    if (!source) throw new Error('Aucune source');
    return { uri: source.uri, contentType: guessContentType(source.uri, source.isHls), title: p.title, subtitle: p.subtitle };
  };
  const qualityLabel = QUALITIES.find((x) => x.id === quality)?.label.split(' ')[0] ?? 'Auto';
  const castBtn = (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {p.kind === 'jellyfin' ? (
        <Pressable onPress={() => setQualityOpen(true)} hitSlop={8} style={styles.qualityBtn}>
          <Text style={styles.qualityText}>{qualityLabel}</Text>
        </Pressable>
      ) : null}
      {Platform.isTV ? null : <CastIcon />}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {casting && (source || p.kind === 'jellyfin') ? (
        <CastingScreen
          media={castMedia}
          startAt={resumeFrom}
          deviceName={deviceName}
          onPosition={onTime}
          onEnded={onEnded}
          onClose={() => router.back()}
        />
      ) : source && !error ? (
        engine === 'mpv' ? (
          <MpvPlayer
            key={`mpv-${attempt}`}
            uri={source.uri}
            headers={source.headers}
            isHls={source.isHls}
            title={p.title}
            subtitle={p.subtitle}
            startAt={resumeFrom}
            onTime={onTime}
            onReady={onReady}
            onError={setError}
            onClose={() => router.back()}
            onEnded={onEnded}
            extra={castBtn}
          />
        ) : (
          <NativePlayer
            key={`native-${attempt}`}
            uri={source.uri}
            headers={source.headers}
            isHls={source.isHls}
            title={p.title}
            subtitle={p.subtitle}
            startAt={resumeFrom}
            onTime={onTime}
            onReady={onReady}
            onError={setError}
            onClose={() => router.back()}
            onEnded={onEnded}
            extra={castBtn}
          />
        )
      ) : !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#fff" />
          {p.title ? <Text style={styles.loadingTitle}>{p.title}</Text> : null}
        </View>
      ) : null}

      {error && (
        <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.9)', padding: 28 }]}>
          <Ionicons name="alert-circle-outline" size={42} color={C.text} />
          <Text style={styles.errorTitle}>Lecture impossible</Text>
          <Text style={styles.errorText}>{error}</Text>
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 16, maxWidth: 420, width: '100%', alignItems: 'stretch' }}>
            <Button
              title={`Essayer avec le lecteur ${other === 'mpv' ? 'mpv' : 'natif'}`}
              icon="swap-horizontal"
              onPress={() => {
                setError(null);
                setEngine(other);
              }}
            />
            <Button title="Réessayer" icon="refresh" variant="glass" onPress={() => setAttempt((a) => a + 1)} />
            {source?.uri ? (
              <>
                <Button title="Ouvrir dans VLC" icon="open-outline" variant="glass" onPress={() => openExternal('vlc', source.uri)} />
                {Platform.OS === 'ios' && (
                  <Button title="Ouvrir dans Infuse" icon="open-outline" variant="glass" onPress={() => openExternal('infuse', source.uri)} />
                )}
              </>
            ) : null}
          </View>
        </View>
      )}

      {nextUp && (
        <View style={styles.nextWrap}>
          <View style={styles.next}>
            <Text style={styles.nextLabel}>Épisode suivant dans {countdown} s</Text>
            <Text style={styles.nextTitle} numberOfLines={2}>
              {nextUp.label}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title="Lire" icon="play" onPress={nextUp.go} style={{ flex: 1 }} />
              <Button title="Fermer" variant="glass" onPress={() => router.back()} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}

      {(!source || error) && (
        <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      )}
      <QualitySheet
        visible={qualityOpen}
        current={quality}
        onClose={() => setQualityOpen(false)}
        onPick={(id) => {
          setQualityOpen(false);
          if (id !== quality) setQuality(id);
        }}
      />
      <Toasts />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  qualityBtn: { paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  qualityText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  errorText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  nextWrap: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  next: { backgroundColor: '#161618', borderRadius: 20, padding: 20, width: '100%', maxWidth: 420 },
  nextLabel: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  nextTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  close: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
