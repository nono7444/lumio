import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { C } from '@/constants/theme';
import { getPlayback, playback, type PlaybackTarget } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

type Params = {
  kind: 'jellyfin' | 'url';
  itemId?: string;
  uri?: string;
  headers?: string;
  title?: string;
  subtitle?: string;
  start?: string;
};

/** Ouvre un lien direct dans un lecteur externe (MKV, codecs exotiques…). */
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [directUri, setDirectUri] = useState<string | null>(p.kind === 'url' ? (p.uri ?? null) : null);

  const target = useRef<PlaybackTarget | null>(null);
  const startAt = Number(p.start ?? 0) || 0;
  const seekedOnce = useRef(false);
  const lastReport = useRef(0);

  const player = useVideoPlayer(null, (pl) => {
    pl.timeUpdateEventInterval = 1;
    pl.staysActiveInBackground = true;
    pl.showNowPlayingNotification = true;
  });

  // Rotation libre dans le lecteur, retour en portrait à la sortie
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Prépare la source
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metadata = { title: p.title ?? 'Lumio', artist: p.subtitle || undefined };
        let source: VideoSource;
        if (p.kind === 'jellyfin' && p.itemId) {
          const t = await getPlayback(settings, p.itemId, startAt);
          if (cancelled) return;
          target.current = t;
          setDirectUri(t.uri);
          source = { uri: t.uri, contentType: t.isHls ? 'hls' : 'auto', metadata };
        } else if (p.uri) {
          let headers: Record<string, string> | undefined;
          try {
            headers = p.headers ? JSON.parse(p.headers) : undefined;
          } catch {}
          source = { uri: p.uri, headers, metadata, contentType: /\.m3u8(\?|$)/i.test(p.uri) ? 'hls' : 'auto' };
        } else {
          throw new Error('Aucune source à lire');
        }
        await player.replaceAsync(source);
        player.play();
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEventListener(player, 'statusChange', ({ status, error: err }) => {
    if (status === 'readyToPlay') {
      setLoading(false);
      if (!seekedOnce.current) {
        seekedOnce.current = true;
        // Reprise : on se place au bon endroit si la source ne l'a pas déjà fait
        if (startAt > 5 && player.currentTime < startAt - 5) player.currentTime = startAt;
        if (target.current) playback.start(settings, { target: target.current, positionSeconds: player.currentTime });
      }
    } else if (status === 'loading') {
      setLoading(true);
    } else if (status === 'error') {
      setLoading(false);
      setError(err?.message ?? 'Lecture impossible');
    }
  });

  // Progression envoyée à Jellyfin toutes les 10 s (pour « Reprendre »)
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!target.current) return;
    const now = Date.now();
    if (now - lastReport.current < 10_000) return;
    lastReport.current = now;
    playback.progress(settings, { target: target.current, positionSeconds: currentTime, isPaused: !player.playing });
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (target.current)
      playback.progress(settings, { target: target.current, positionSeconds: player.currentTime, isPaused: !isPlaying });
  });

  // Fin de lecture signalée à la fermeture
  useEffect(() => {
    return () => {
      if (target.current) {
        let pos = 0;
        try {
          pos = player.currentTime;
        } catch {}
        playback.stop(settings, { target: target.current, positionSeconds: pos });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        startsPictureInPictureAutomatically
      />

      {loading && !error && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          {p.title ? <Text style={styles.loadingTitle}>{p.title}</Text> : null}
        </View>
      )}

      {error && (
        <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.85)', padding: 28 }]}>
          <Ionicons name="alert-circle-outline" size={42} color={C.text} />
          <Text style={styles.errorTitle}>Lecture impossible</Text>
          <Text style={styles.errorText}>{error}</Text>
          {directUri ? (
            <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 16 }}>
              <Text style={[styles.errorText, { marginBottom: 4 }]}>
                Le format n'est peut-être pas lisible par le lecteur intégré. Essaie un lecteur externe :
              </Text>
              <Button title="Ouvrir dans VLC" icon="open-outline" variant="glass" onPress={() => openExternal('vlc', directUri)} />
              {Platform.OS === 'ios' && (
                <Button title="Ouvrir dans Infuse" icon="open-outline" variant="glass" onPress={() => openExternal('infuse', directUri)} />
              )}
            </View>
          ) : null}
        </View>
      )}

      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  errorText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
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
