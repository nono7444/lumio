import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MpvPlayer } from '@/components/players/mpv-player';
import { NativePlayer } from '@/components/players/native-player';
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
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const target = useRef<PlaybackTarget | null>(null);
  const position = useRef(0);
  const lastReport = useRef(0);
  const startAt = Number(p.start ?? 0) || 0;

  // Rotation libre dans le lecteur, retour en portrait à la sortie
  useEffect(() => {
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
          const t = await getPlayback(settings, p.itemId, Math.max(position.current, startAt), engine);
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
  }, [engine, attempt]);

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

  const resumeFrom = Math.max(position.current, startAt);
  const other = engine === 'mpv' ? 'native' : 'mpv';

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {source && !error ? (
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

      {(!source || error) && (
        <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      )}
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
