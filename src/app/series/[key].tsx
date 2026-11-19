// Lumio Livres : une collection (tous les tomes d'une série, dans l'ordre), avec « Continuer » sur le tome en cours
// ou le premier tome pas encore lu.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover, ReadBar } from '@/components/ebook-ui';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { groupSeries, seriesByKey, tomeOf, useEbooks } from '@/lib/ebooks';

export default function SeriesScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { lib } = useEbooks();
  const { width } = useWindowDimensions();
  // Relue depuis la bibliothèque (positions à jour), sinon celle gardée par l'onglet
  const s = useMemo(() => (lib ? groupSeries(lib.books).series.find((x) => x.key === key) : null) ?? seriesByKey(String(key)), [lib, key]);
  const cols = width > 700 ? 5 : width > 500 ? 4 : 3;
  const w = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 14) / cols);

  if (!s) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <ScreenTitle title="Collection" onBack={() => router.back()} />
        <Text style={{ color: C.textDim, padding: 20 }}>Collection introuvable.</Text>
      </SafeAreaView>
    );
  }
  const read = s.books.filter((b) => b.progress?.done).length;
  const next = s.books.find((b) => b.progress && !b.progress.done) ?? s.books.find((b) => !b.progress?.done) ?? s.books[0];
  const authors = [...new Set(s.books.map((b) => b.author).filter(Boolean))].slice(0, 2).join(', ');
  const n = tomeOf(next);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title={s.name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 18 }}>
          <Text style={styles.s}>
            {[`${s.books.length} tomes`, read ? `${read} lus` : null, authors || null].filter(Boolean).join(' · ')}
          </Text>
          <ReadBar value={read / s.books.length} />
          <Button
            title={next.progress && !next.progress.done ? `Continuer${n != null ? ` le tome ${n}` : ''}` : `Lire${n != null ? ` le tome ${n}` : ''}`}
            icon="book-outline"
            onPress={() => router.push({ pathname: '/reader', params: { id: next.id } })}
          />
        </View>
        <View style={styles.grid}>
          {s.books.map((b) => {
            const t = tomeOf(b);
            const pr = b.progress?.pct ?? 0;
            return (
              <Pressable key={b.id} onPress={() => (tap(), router.push({ pathname: '/ebook/[id]', params: { id: b.id } }))} style={{ width: w, gap: 5 }}>
                <View>
                  <BookCover book={b} width={w} />
                  {t != null ? (
                    <View style={styles.tome}>
                      <Text style={styles.tomeText}>{t}</Text>
                    </View>
                  ) : null}
                  {b.progress?.done ? (
                    <View style={styles.done}>
                      <Ionicons name="checkmark" size={13} color="#000" />
                    </View>
                  ) : null}
                </View>
                {pr > 0 && !b.progress?.done ? <ReadBar value={pr} /> : null}
                <Text numberOfLines={2} style={styles.t}>
                  {b.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  s: { color: C.textDim, fontSize: 13 },
  t: { color: C.text, fontWeight: '600', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 14 },
  tome: { position: 'absolute', left: 6, top: 6, minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
  tomeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  done: { position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
});
