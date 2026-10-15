// Google Cast (Chromecast, TV Android / Google TV) : bouton + écran « Lecture sur la TV ».
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import GoogleCast, { CastButton, MediaPlayerState, useCastDevice, useMediaStatus, useRemoteMediaClient, useStreamPosition } from 'react-native-google-cast';

import { Button } from '@/components/ui';
import { C } from '@/constants/theme';

import { formatTime } from './types';

export type CastMedia = { uri: string; contentType: string; title?: string; subtitle?: string; image?: string };

/** Type MIME probable d'un lien vidéo (le Chromecast en a besoin). */
export function guessContentType(uri: string, isHls?: boolean) {
  if (isHls || /\.m3u8(\?|$)/i.test(uri)) return 'application/x-mpegURL';
  if (/\.mkv(\?|$)/i.test(uri)) return 'video/x-matroska';
  if (/\.webm(\?|$)/i.test(uri)) return 'video/webm';
  return 'video/mp4';
}

/** Bouton Cast natif (icône standard Google Cast). */
export function CastIcon() {
  return (
    <View style={styles.btn}>
      <CastButton style={{ width: 26, height: 26, tintColor: '#fff' }} tintColor="#fff" />
    </View>
  );
}

/** Session Cast en cours (null sinon). */
export function useCasting() {
  const client = useRemoteMediaClient();
  const device = useCastDevice();
  return { client, deviceName: device?.friendlyName ?? null };
}

/**
 * Écran affiché pendant la diffusion : charge le média sur la TV à la position donnée,
 * remonte la position (pour Jellyfin) et propose d'arrêter la diffusion.
 */
export function CastingScreen({
  media,
  startAt,
  deviceName,
  onPosition,
  onEnded,
  onClose,
}: {
  media: () => Promise<CastMedia>;
  startAt: number;
  deviceName: string | null;
  onPosition: (seconds: number, paused: boolean) => void;
  onEnded: () => void;
  onClose: () => void;
}) {
  const client = useRemoteMediaClient();
  const status = useMediaStatus();
  const pos = useStreamPosition(1);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | undefined>();
  const loaded = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (!client || loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const m = await media();
        setTitle(m.title);
        await client.loadMedia({
          autoplay: true,
          startTime: startAt > 5 ? startAt : 0,
          mediaInfo: {
            contentUrl: m.uri,
            contentType: m.contentType,
            metadata: {
              type: 'movie',
              title: m.title,
              subtitle: m.subtitle,
              images: m.image ? [{ url: m.image }] : [],
            },
          },
        });
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, [client, media, startAt]);

  const paused = status?.playerState === MediaPlayerState.PAUSED;
  useEffect(() => {
    if (pos != null && pos > 0) onPosition(pos, paused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  // Fin de lecture sur la TV
  useEffect(() => {
    if (status?.playerState === MediaPlayerState.PLAYING) started.current = true;
    if (started.current && status?.playerState === MediaPlayerState.IDLE && status.idleReason === 'finished') onEnded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.playerState, status?.idleReason]);

  const duration = status?.mediaInfo?.streamDuration ?? 0;

  return (
    <View style={styles.root}>
      <Ionicons name="tv-outline" size={64} color={C.text} />
      <Text style={styles.label}>Lecture sur</Text>
      <Text style={styles.device}>{deviceName ?? 'la TV'}</Text>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {error ? (
        <Text style={[styles.dim, { color: C.danger }]}>
          {error}
          {'\n'}Le Chromecast ne sait pas lire ce format : essaie une autre source (MP4 / 1080p).
        </Text>
      ) : (
        <Text style={styles.dim}>
          {pos != null ? formatTime(pos) : '…'}
          {duration ? ` / ${formatTime(duration)}` : ''}
        </Text>
      )}
      <View style={styles.controls}>
        <Pressable onPress={() => client?.seek({ position: Math.max(0, (pos ?? 0) - 10) })} hitSlop={10} style={styles.round}>
          <Ionicons name="play-back" size={24} color="#fff" />
        </Pressable>
        <Pressable onPress={() => (paused ? client?.play() : client?.pause())} hitSlop={10} style={[styles.round, styles.main]}>
          <Ionicons name={paused ? 'play' : 'pause'} size={34} color="#000" style={paused ? { marginLeft: 4 } : undefined} />
        </Pressable>
        <Pressable onPress={() => client?.seek({ position: (pos ?? 0) + 30 })} hitSlop={10} style={styles.round}>
          <Ionicons name="play-forward" size={24} color="#fff" />
        </Pressable>
      </View>
      <View style={{ gap: 10, maxWidth: 380, width: '100%', alignSelf: 'center' }}>
        <Button title="Arrêter la diffusion" icon="stop-circle-outline" variant="glass" onPress={() => GoogleCast.getSessionManager().endCurrentSession(true)} />
        <Button title="Fermer" variant="secondary" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  label: { color: C.textDim, fontSize: 14, marginTop: 10 },
  device: { color: C.text, fontSize: 24, fontWeight: '800' },
  title: { color: C.text, fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  dim: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 28, marginVertical: 22 },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  main: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff' },
});
