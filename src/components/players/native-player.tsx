import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PlayerProps } from './types';

/** Lecteur natif du téléphone (AVPlayer / ExoPlayer) avec ses contrôles système. */
export function NativePlayer({ uri, headers, isHls, title, subtitle, startAt, onTime, onReady, onError, onClose, onEnded, extra, statsInfo, autoPip }: PlayerProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const seeked = useRef(false);
  const view = useRef<VideoView>(null);
  const [stats, setStats] = useState(false);
  // Remplir l'écran (recadrage) pour supprimer les bandes noires
  const [fill, setFill] = useState(false);

  const player = useVideoPlayer(null, (pl) => {
    pl.timeUpdateEventInterval = 1;
    pl.staysActiveInBackground = true;
    pl.showNowPlayingNotification = true;
    // Plus de réserve d'avance : moins de saccades quand le réseau ou le serveur ralentit
    pl.bufferOptions = {
      preferredForwardBufferDuration: 60,
      minBufferForPlayback: 4,
      prioritizeTimeOverSizeThreshold: true,
      maxBufferBytes: 0,
    };
  });

  useEffect(() => {
    player
      .replaceAsync({
        uri,
        headers,
        contentType: isHls || /\.m3u8(\?|$)/i.test(uri) ? 'hls' : 'auto',
        metadata: { title: title ?? 'Lumio', artist: subtitle || undefined },
      })
      .then(() => player.play())
      .catch((e) => onError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'readyToPlay') {
      setLoading(false);
      if (!seeked.current) {
        seeked.current = true;
        if (startAt > 5 && player.currentTime < startAt - 5) player.currentTime = startAt;
        onReady(player.currentTime);
        // Image dans l'image demandée depuis le lecteur mpv
        if (autoPip) setTimeout(() => view.current?.startPictureInPicture().catch(() => {}), 400);
      }
    } else if (status === 'loading') setLoading(true);
    else if (status === 'error') onError(error?.message ?? 'Lecture impossible');
  });

  useEventListener(player, 'playToEnd', () => onEnded());

  useEventListener(player, 'timeUpdate', ({ currentTime }) => onTime(currentTime, !player.playing));

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        ref={view}
        // TV : le lecteur est affiché sans réduction (voir TvScaleRoot) → SurfaceView, la plus fluide
        surfaceType="surfaceView"
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit={fill ? 'cover' : 'contain'}
        allowsPictureInPicture
        startsPictureInPictureAutomatically
      />
      {loading && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
{Platform.isTV ? null : (
        <>
      <Pressable onPress={onClose} hitSlop={12} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
      <Pressable
        onPress={() => setStats((v) => !v)}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 8, left: insets.left + 60 }]}>
        <Ionicons name={stats ? 'stats-chart' : 'stats-chart-outline'} size={18} color="#fff" />
      </Pressable>
      <Pressable
        onPress={() => setFill((v) => !v)}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 8, left: insets.left + 108 }]}>
        <Ionicons name={fill ? 'contract' : 'expand'} size={18} color="#fff" />
      </Pressable>
        </>
      )}
      {stats ? (
        <View pointerEvents="none" style={[styles.stats, { top: insets.top + 56, left: insets.left + 12 }]}>
          {(statsInfo ?? []).map((l) => (
            <Text key={l} style={styles.statsText}>
              {l}
            </Text>
          ))}
          <Text style={styles.statsText}>Lecteur : natif (AVPlayer)</Text>
          {player.videoTrack ? (
            <Text style={styles.statsText}>
              Vidéo : {player.videoTrack.size ? `${player.videoTrack.size.width}×${player.videoTrack.size.height}` : '?'}
              {player.videoTrack.bitrate ? ` · ${(player.videoTrack.bitrate / 1e6).toFixed(1)} Mb/s` : ''}
              {player.videoTrack.mimeType ? ` · ${player.videoTrack.mimeType}` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
      {extra ? <View style={{ position: 'absolute', top: insets.top + 8, right: insets.right + 12 }}>{extra}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 2, maxWidth: 460 },
  statsText: { color: '#E5E5EA', fontSize: 11.5, fontFamily: 'Menlo', lineHeight: 16 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
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
