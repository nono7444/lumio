// Lumio Audio : fiche d'un livre (couverture, auteur, narrateur, chapitres, Lire / Reprendre, supprimer pour l'admin).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { SafeAreaView } from 'react-native-safe-area-context';

import { bookById, bookProgress, Cover, loadLibrary, ProgressLine, useAudioLibrary } from '@/components/audio-ui';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { playBook, useAudio } from '@/lib/audio-player';
import { audioApi, audioUrl, fmtClock } from '@/lib/audiobooks';
import { useSettings } from '@/lib/settings';

const mo = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : `${Math.max(1, Math.round(n / 1e6))} Mo`);

export default function AudiobookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const { lib } = useAudioLibrary();
  const a = useAudio();
  const book = (a.book?.id === id ? a.book : null) ?? bookById(String(id));
  if (!book) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <ScreenTitle title="Livre" onBack={() => router.back()} />
        <Text style={{ color: C.textDim, padding: 20 }}>{lib ? 'Ce livre n’est plus dans la bibliothèque.' : 'Chargement…'}</Text>
      </SafeAreaView>
    );
  }
  const p = book.progress;
  const here = a.book?.id === book.id;
  const pr = bookProgress(book);
  const cover = audioUrl(settings, book.cover);
  const label = here && a.playing ? 'En lecture' : p && !p.done ? 'Reprendre' : p?.done ? 'Réécouter' : 'Écouter';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Fond : la couverture floutée */}
      {cover ? <Image source={{ uri: cover }} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} blurRadius={40} contentFit="cover" /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenTitle title="" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
            <Cover book={book} size={230} radius={14} />
            <Text style={styles.title}>{book.title}</Text>
            {book.author ? <Text style={styles.author}>{book.author}</Text> : null}
            {book.narrator ? <Text style={styles.s}>Lu par {book.narrator}</Text> : null}
            <Text style={styles.s}>
              {[book.files.length > 1 ? `${book.files.length} parties` : null, mo(book.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ paddingHorizontal: 20, marginTop: 18, gap: 10 }}>
            {pr > 0 && pr < 1 ? (
              <View style={{ gap: 6 }}>
                <ProgressLine value={pr} />
                <Text style={styles.s}>
                  {Math.round(pr * 100)} % écouté{book.files.length > 1 && p ? ` · chapitre ${p.file + 1}` : ''}
                </Text>
              </View>
            ) : null}
            <Button
              title={label}
              icon={here && a.playing ? 'pause' : 'play'}
              onPress={() => {
                playBook(settings, book);
                router.push('/listening');
              }}
            />
            {p && !p.done ? (
              <Button title="Recommencer du début" icon="refresh" variant="glass" onPress={() => (playBook(settings, book, 0), router.push('/listening'))} />
            ) : null}
          </View>

          {book.files.length > 1 ? (
            <View style={{ marginTop: 24 }}>
              <Text style={styles.h}>Chapitres</Text>
              {book.files.map((f, i) => {
                const cur = here ? a.file === i : p?.file === i;
                const seen = p ? p.done || i < p.file : false;
                return (
                  <Pressable
                    key={f.index}
                    onPress={() => (tap(), playBook(settings, book, i), router.push('/listening'))}
                    style={styles.chapter}>
                    <Text style={[styles.num, cur && { color: C.text }]}>{i + 1}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[styles.chapterName, seen && { color: C.textDim }]}>
                        {f.name}
                      </Text>
                      {cur && p && p.pos > 0 && !p.done ? (
                        <Text style={styles.s}>
                          {fmtClock(here ? a.pos : p.pos)}
                          {p.dur ? ` / ${fmtClock(p.dur)}` : ''}
                        </Text>
                      ) : null}
                    </View>
                    {cur && here && a.playing ? (
                      <Ionicons name="volume-high" size={18} color={C.text} />
                    ) : seen ? (
                      <Ionicons name="checkmark" size={18} color={C.textFaint} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {lib?.admin ? (
            <View style={{ paddingHorizontal: 20, marginTop: 28, gap: 10 }}>
              <Button title="Changer la couverture" icon="image-outline" variant="glass" onPress={() => router.push({ pathname: '/audio-cover', params: { id: book.id } })} />
              <Button
                title="Supprimer du serveur"
                icon="trash-outline"
                variant="danger"
                onPress={() =>
                  Alert.alert('Supprimer ce livre ?', `« ${book.title} » sera effacé du disque du serveur.`, [
                    { text: 'Annuler', style: 'cancel' },
                    {
                      text: 'Supprimer',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await audioApi.remove(settings, book.id);
                          await loadLibrary(settings, true);
                          router.back();
                        } catch (e) {
                          Alert.alert('Suppression impossible', e instanceof Error ? e.message : String(e));
                        }
                      },
                    },
                  ])
                }
              />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  author: { color: C.text, fontSize: 16, fontWeight: '600', opacity: 0.85 },
  s: { color: C.textDim, fontSize: 13 },
  h: { color: C.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 20, marginBottom: 6 },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  num: { color: C.textFaint, width: 26, fontVariant: ['tabular-nums'], fontWeight: '700' },
  chapterName: { color: C.text, fontSize: 15 },
});
