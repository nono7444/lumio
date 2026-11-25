// Lumio Livres : une collection (tous les tomes d'une série, dans l'ordre), avec « Continuer » sur le tome en cours
// ou le premier tome pas encore lu.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover, ReadBar } from '@/components/ebook-ui';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, groupSeries, seriesByKey, tomeOf, useEbooks, type BooksAuto, type Ebook } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

export default function SeriesScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { lib } = useEbooks();
  const { settings } = useSettings();
  // Tomes manquants de cette série (repérés par le serveur) : cases grisées « Manquant » dans la grille
  const [auto, setAuto] = useState<BooksAuto | null>(null);
  useFocusEffect(
    useCallback(() => {
      ebookApi.auto(settings).then(setAuto).catch(() => {});
    }, [settings])
  );
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
  const have = new Set(s.books.map((b) => tomeOf(b)).filter((x): x is number => x != null));
  const miss = auto?.missing.find((m) => m.key === s.key);
  const coming = new Set((auto?.downloading ?? []).filter((d) => d.key === s.key).map((d) => d.tome));
  const holes = (miss?.gaps ?? []).filter((t) => !have.has(t));
  // Livres et cases manquantes, dans l'ordre des tomes
  const cells: ({ k: 'book'; b: Ebook; t: number | null } | { k: 'miss'; t: number })[] = [
    ...s.books.map((b) => ({ k: 'book' as const, b, t: tomeOf(b) })),
    ...holes.map((t) => ({ k: 'miss' as const, t })),
  ].sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title={s.name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 18 }}>
          <Text style={styles.s}>
            {[`${s.books.length} tomes`, holes.length ? `${holes.length} manquant${holes.length > 1 ? 's' : ''}` : null, read ? `${read} lus` : null, authors || null].filter(Boolean).join(' · ')}
          </Text>
          <ReadBar value={read / s.books.length} />
          <Button
            title={next.progress && !next.progress.done ? `Continuer${n != null ? ` le tome ${n}` : ''}` : `Lire${n != null ? ` le tome ${n}` : ''}`}
            icon="book-outline"
            onPress={() => router.push({ pathname: '/reader', params: { id: next.id } })}
          />
          {lib?.admin ? <Text style={styles.s}>Appui long sur un tome : changer sa couverture</Text> : null}
        </View>
        <View style={styles.grid}>
          {cells.map((c) => {
            if (c.k === 'miss') {
              const dl = coming.has(c.t);
              return (
                <View key={`miss-${c.t}`} style={{ width: w, gap: 5 }}>
                  <View style={[styles.missing, { width: w, height: Math.round(w * 1.5) }]}>
                    <Ionicons name={dl ? 'cloud-download-outline' : 'help-outline'} size={26} color={C.textFaint} />
                    <View style={[styles.missTag, dl ? { backgroundColor: C.info } : null]}>
                      <Text style={styles.missTagText}>{dl ? 'EN COURS' : 'MANQUANT'}</Text>
                    </View>
                    <View style={styles.tome}>
                      <Text style={styles.tomeText}>{c.t}</Text>
                    </View>
                  </View>
                  <Text numberOfLines={2} style={[styles.t, { color: C.textFaint }]}>
                    {s.name} T{String(c.t).padStart(2, '0')}
                  </Text>
                </View>
              );
            }
            const b = c.b;
            const t = c.t;
            const pr = b.progress?.pct ?? 0;
            return (
              <Pressable
                key={b.id}
                onPress={() => (tap(), router.push({ pathname: '/ebook/[id]', params: { id: b.id } }))}
                onLongPress={lib?.admin ? () => (tap(), router.push({ pathname: '/ebook-cover', params: { id: b.id } })) : undefined} style={{ width: w, gap: 5 }}>
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
  missing: { borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: C.danger },
  missTagText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },
  done: { position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
});
