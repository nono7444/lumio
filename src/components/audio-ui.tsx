// Lumio Audio : briques d'interface partagées (couverture, bibliothèque en mémoire, mini-lecteur).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { toggle, seekBy, useAudio } from '@/lib/audio-player';
import { audioApi, audioUrl, type AudioBook, type AudioLibrary } from '@/lib/audiobooks';
import { useSettings, type Settings } from '@/lib/settings';

// ——— Bibliothèque gardée en mémoire (la fiche d'un livre s'ouvre sans recharger) ———
let lib: AudioLibrary | null = null;
let libErr: string | null = null;
let loading = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export async function loadLibrary(s: Settings, refresh = false) {
  if (loading) return;
  loading = true;
  emit();
  try {
    lib = await audioApi.library(s, refresh);
    libErr = null;
  } catch (e) {
    libErr = e instanceof Error ? e.message : String(e);
  } finally {
    loading = false;
    emit();
  }
}
let snap: { lib: AudioLibrary | null; libErr: string | null; loading: boolean } = { lib, libErr, loading };
const getSnap = () => (snap.lib === lib && snap.libErr === libErr && snap.loading === loading ? snap : (snap = { lib, libErr, loading }));
export function useAudioLibrary() {
  const { settings } = useSettings();
  const st = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSnap);
  useEffect(() => {
    if (!lib && settings.jellyfin && settings.chatUrl) loadLibrary(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, settings.chatUrl]);
  const reload = useCallback((refresh = true) => loadLibrary(settings, refresh), [settings]);
  return { ...st, reload };
}
export const bookById = (id: string) => lib?.books.find((b) => b.id === id) ?? null;

/** Avancement d'un livre entre 0 et 1 (en nombre de fichiers + position dans le fichier en cours). */
export function bookProgress(b: AudioBook) {
  const p = b.progress;
  if (!p) return 0;
  if (p.done) return 1;
  const n = Math.max(1, b.files.length);
  const inFile = p.dur > 0 ? Math.min(1, p.pos / p.dur) : 0;
  return Math.min(1, (p.file + inFile) / n);
}

/** Couverture carrée (ou initiales si le livre n'en a pas). */
export function Cover({ book, size, radius = 10 }: { book: AudioBook; size: number; radius?: number }) {
  const { settings } = useSettings();
  const [bad, setBad] = useState(false);
  const uri = audioUrl(settings, book.cover);
  const hue = [...book.title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: `hsl(${hue},35%,22%)` }}>
      {uri && !bad ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} onError={() => setBad(true)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { padding: size * 0.1, justifyContent: 'flex-end' }]}>
          <Ionicons name="headset" size={size * 0.22} color="rgba(255,255,255,0.55)" style={{ position: 'absolute', top: size * 0.1, left: size * 0.1 }} />
          <Text numberOfLines={3} style={{ color: '#fff', fontWeight: '800', fontSize: Math.max(11, size * 0.11) }}>
            {book.title}
          </Text>
          {book.author ? (
            <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)', fontSize: Math.max(9, size * 0.08), marginTop: 2 }}>
              {book.author}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function ProgressLine({ value, color = C.text }: { value: number; color?: string }) {
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(value * 100)}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

/** Mini-lecteur posé au-dessus de la barre d'onglets ; un appui ouvre le lecteur plein écran. */
export function MiniPlayer() {
  const a = useAudio();
  const insets = useSafeAreaInsets();
  if (!a.book) return null;
  const chapter = a.book.files.length > 1 ? `Chapitre ${a.file + 1}/${a.book.files.length}` : (a.book.author ?? '');
  return (
    <View pointerEvents="box-none" style={[styles.miniWrap, { bottom: Math.max(insets.bottom - 6, 10) + 74 }]}>
      <Pressable
        onPress={() => {
          tap();
          router.push('/listening');
        }}
        style={styles.mini}>
        <Cover book={a.book} size={44} radius={8} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.miniTitle}>
            {a.book.title}
          </Text>
          <Text numberOfLines={1} style={styles.miniSub}>
            {chapter}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => (tap(), seekBy(-30))} accessibilityLabel="Reculer de 30 secondes">
          <Ionicons name="play-back" size={22} color={C.text} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => (tap(), toggle())} style={styles.miniPlay} accessibilityLabel={a.playing ? 'Pause' : 'Lecture'}>
          {a.buffering && !a.playing ? <ActivityIndicator color="#000" /> : <Ionicons name={a.playing ? 'pause' : 'play'} size={22} color="#000" />}
        </Pressable>
        <View style={[styles.miniBar, { width: `${a.dur ? Math.min(100, (a.pos / a.dur) * 100) : 0}%` }]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  miniWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 14 },
  mini: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    paddingRight: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(36,36,40,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  miniTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  miniSub: { color: C.textDim, fontSize: 12, marginTop: 1 },
  miniPlay: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
  miniBar: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: C.text },
});
