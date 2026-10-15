import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PlayerProps } from './types';

/** Lecteur natif du téléphone (AVPlayer / ExoPlayer) avec ses contrôles système. */
export function NativePlayer({ uri, headers, isHls, title, subtitle, startAt, onTime, onReady, onError, onClose }: PlayerProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const seeked = useRef(false);

  const player = useVideoPlayer(null, (pl) => {
    pl.timeUpdateEventInterval = 1;
    pl.staysActiveInBackground = true;
    pl.showNowPlayingNotification = true;
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
      }
    } else if (status === 'loading') setLoading(true);
    else if (status === 'error') onError(error?.message ?? 'Lecture impossible');
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => onTime(currentTime, !player.playing));

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        startsPictureInPictureAutomatically
      />
      {loading && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      <Pressable onPress={onClose} hitSlop={12} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
