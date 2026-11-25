// Lumio Livres : fiche d'un livre (couverture, auteur, format, chapitres d'un EPUB, Lire / Reprendre, supprimer pour l'admin).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover, ReadBar } from '@/components/ebook-ui';
import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, ebookById, fileUrl, FORMAT_LABEL, loadEbooks, mo, saveProgress, useEbooks } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

export default function EbookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const { lib } = useEbooks();
  const book = ebookById(String(id));
  const [chapters, setChapters] = useState<string[] | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!book) return;
    if (book.format === 'epub') ebookApi.epub(settings, book).then((r) => setChapters(r.chapters ?? [])).catch(() => {});
    if (book.format === 'bd') ebookApi.pages(settings, book).then((r) => setPages(r.pages ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  if (!book) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <ScreenTitle title="Livre" onBack={() => router.back()} />
        <Text style={{ color: C.textDim, padding: 20 }}>{lib ? 'Ce livre n’est plus dans la bibliothèque.' : 'Chargement…'}</Text>
      </SafeAreaView>
    );
  }
  const p = book.progress;
  const pct = p?.pct ?? 0;
  const label = p?.done ? 'Relire' : p && pct > 0 ? 'Reprendre' : 'Lire';
  const cover = fileUrl(settings, book, 'cover');
  const go = (chapter?: number) => router.push({ pathname: '/reader', params: { id: book.id, ...(chapter != null ? { chapter: String(chapter) } : {}) } });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {cover ? <Image source={{ uri: cover }} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} blurRadius={40} contentFit="cover" /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScreenTitle title="" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24 }}>
            <View style={styles.shadow}>
              <BookCover book={book} width={170} radius={10} />
            </View>
            <Text style={styles.title}>{book.title}</Text>
            {book.author ? <Text style={styles.author}>{book.author}</Text> : null}
            <Text style={styles.s}>
              {[FORMAT_LABEL[book.format], pages ? `${pages} pages` : chapters?.length ? `${chapters.length} chapitres` : null, mo(book.size), book.folder || null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View style={{ paddingHorizontal: 20, marginTop: 18, gap: 10 }}>
            {pct > 0 && !p?.done ? (
              <View style={{ gap: 6 }}>
                <ReadBar value={pct} />
                <Text style={styles.s}>{Math.round(pct * 100)} % lu</Text>
              </View>
            ) : null}
            <Button title={label} icon="book-outline" onPress={() => go(p?.done ? 0 : undefined)} />
            {p && pct > 0 && !p.done ? <Button title="Reprendre au début" icon="refresh" variant="glass" onPress={() => go(0)} /> : null}
            {p ? (
              <Button
                title={p.done ? 'Marquer comme non lu' : 'Marquer comme lu'}
                icon={p.done ? 'arrow-undo-outline' : 'checkmark-done-outline'}
                variant="glass"
                onPress={() => saveProgress(settings, book, p.done ? { done: false, pct: 0, chapter: 0, scroll: 0, page: 0 } : { done: true, pct: 1 })}
              />
            ) : (
              <Button title="Marquer comme lu" icon="checkmark-done-outline" variant="glass" onPress={() => saveProgress(settings, book, { done: true, pct: 1 })} />
            )}
          </View>

          {chapters && chapters.length > 1 ? (
            <View style={{ marginTop: 24 }}>
              <Text style={styles.h}>Chapitres</Text>
              {chapters.map((c, i) => {
                const cur = p?.chapter === i && !p.done && pct > 0;
                return (
                  <Pressable key={i} onPress={() => (tap(), go(i))} style={styles.chapter}>
                    <Text style={[styles.num, cur && { color: C.text }]}>{i + 1}</Text>
                    <Text numberOfLines={1} style={[styles.chapterName, p && (p.done || i < p.chapter) && { color: C.textDim }]}>
                      {c}
                    </Text>
                    {cur ? <Ionicons name="bookmark" size={16} color={C.text} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {lib?.admin ? (
            <View style={{ paddingHorizontal: 20, marginTop: 28, gap: 10 }}>
              <Button
                title="Recharger les infos"
                icon="refresh"
                variant="secondary"
                loading={refreshing}
                onPress={async () => {
                  setRefreshing(true);
                  try {
                    await ebookApi.refresh(settings, [book.token]);
                    await loadEbooks(settings);
                    toast('Infos et couverture rechargées');
                  } catch (e) {
                    toast(e instanceof Error ? e.message : String(e), 'error');
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />
              <Button title="Changer la couverture" icon="image-outline" variant="secondary" onPress={() => router.push({ pathname: '/ebook-cover', params: { id: book.id } })} />
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
                          await ebookApi.remove(settings, book.token);
                          await loadEbooks(settings);
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
  shadow: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 10, borderRadius: 10 },
  title: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  author: { color: C.text, fontSize: 16, fontWeight: '600', opacity: 0.85, textAlign: 'center' },
  s: { color: C.textDim, fontSize: 13, textAlign: 'center' },
  h: { color: C.text, fontSize: 18, fontWeight: '800', paddingHorizontal: 20, marginBottom: 6 },
  chapter: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  num: { color: C.textFaint, width: 26, fontVariant: ['tabular-nums'], fontWeight: '700' },
  chapterName: { color: C.text, fontSize: 15, flex: 1 },
});
