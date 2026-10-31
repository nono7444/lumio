// Livres audio : lecture en arrière-plan, ±30 s, vitesse, reprise au bon moment.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/constants/theme';
import { bookUrl } from '@/lib/books';
import { useSettings } from '@/lib/settings';

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.8];
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

export default function BookAudio() {
  const { token, title, path } = useLocalSearchParams<{ token: string; title: string; path: string }>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer({ uri: bookUrl(settings, token, 'file') });
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState(1);
  const resumed = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!status.isLoaded || resumed.current) return;
    resumed.current = true;
    AsyncStorage.getItem(`book.audio.${path}`)
      .then((v) => {
        const s = Number(v) || 0;
        if (s > 5) player.seekTo(s).catch(() => {});
        player.play();
      })
      .catch(() => player.play());
  }, [status.isLoaded, path, player]);

  const tick = Math.floor((status.currentTime || 0) / 10);
  useEffect(() => {
    if (status.isLoaded && status.currentTime) AsyncStorage.setItem(`book.audio.${path}`, String(Math.floor(status.currentTime))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const pct = status.duration ? status.currentTime / status.duration : 0;
  return (
    <View style={[st.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={{ alignSelf: 'flex-start' }}>
        <Ionicons name="chevron-down" size={28} color={C.text} />
      </Pressable>
      <View style={st.cover}>
        <Ionicons name="headset" size={90} color={C.text} />
      </View>
      <Text style={st.title} numberOfLines={3}>{title}</Text>
      <View style={st.bar}><View style={[st.fill, { width: `${pct * 100}%` }]} /></View>
      <View style={st.times}>
        <Text style={st.time}>{fmt(status.currentTime)}</Text>
        <Text style={st.time}>-{fmt((status.duration || 0) - (status.currentTime || 0))}</Text>
      </View>
      <View style={st.controls}>
        <Pressable onPress={() => player.seekTo(Math.max(0, status.currentTime - 30))} hitSlop={10}>
          <Ionicons name="play-back" size={34} color={C.text} />
          <Text style={st.skip}>30 s</Text>
        </Pressable>
        <Pressable onPress={() => (status.playing ? player.pause() : player.play())} style={st.play}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={40} color="#000" />
        </Pressable>
        <Pressable onPress={() => player.seekTo(Math.min(status.duration || 0, status.currentTime + 30))} hitSlop={10}>
          <Ionicons name="play-forward" size={34} color={C.text} />
          <Text style={st.skip}>30 s</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => {
          const v = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
          setSpeed(v);
          player.setPlaybackRate(v);
        }}
        style={st.speed}>
        <Text style={{ color: C.text, fontWeight: '800' }}>Vitesse ×{String(speed).replace('.', ',')}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#121214', paddingHorizontal: 24 },
  cover: { alignSelf: 'center', width: 200, height: 200, borderRadius: 100, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', marginVertical: 30 },
  title: { color: C.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 34, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  time: { color: C.textDim, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 34 },
  skip: { color: C.textDim, fontSize: 11, textAlign: 'center' },
  play: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  speed: { alignSelf: 'center', marginTop: 34, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
});
