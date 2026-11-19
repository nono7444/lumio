// Lumio Livres → onglet « Bibliothèque » : « Continuer la lecture », puis tous les livres (couvertures), recherche,
// filtres (en cours, non lus, terminés), type (livres, BD / mangas, PDF) et tri.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover, ReadBar } from '@/components/ebook-ui';
import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { useEbooks, type Ebook } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';
import { IS_BOOKS } from '@/lib/variant';

type Sort = 'recent' | 'title' | 'author';
type Filter = 'all' | 'progress' | 'new' | 'done';
type Kind = 'all' | 'epub' | 'bd' | 'pdf';
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const open = (b: Ebook) => (tap(), router.push({ pathname: '/ebook/[id]', params: { id: b.id } }));
const read = (b: Ebook) => (tap(), router.push({ pathname: '/reader', params: { id: b.id } }));

export default function ShelfRoute() {
  return IS_BOOKS ? <Shelf /> : null;
}

function Shelf() {
  const { settings } = useSettings();
  const { lib, libErr, loading, reload } = useEbooks();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState<Sort>('recent');
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const cols = width > 700 ? 5 : width > 500 ? 4 : 3;
  const w = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 14) / cols);

  const books = useMemo(() => lib?.books ?? [], [lib]);
  const kinds = useMemo(() => new Set(books.map((b) => b.format)), [books]);
  const going = useMemo(
    () =>
      books
        .filter((b) => b.progress && !b.progress.done)
        .sort((x, y) => (y.progress?.at ?? 0) - (x.progress?.at ?? 0))
        .slice(0, 10),
    [books]
  );
  const shown = useMemo(() => {
    let l = books.filter(
      (b) =>
        (kind === 'all' || b.format === kind) &&
        (filter === 'progress' ? b.progress && !b.progress.done : filter === 'new' ? !b.progress : filter === 'done' ? b.progress?.done : true)
    );
    if (q.trim()) {
      const w2 = norm(q.trim());
      l = l.filter((b) => norm(`${b.title} ${b.author ?? ''} ${b.folder}`).includes(w2));
    }
    const by = (f: (b: Ebook) => string) => [...l].sort((x, y) => f(x).localeCompare(f(y), 'fr', { numeric: true }));
    if (sort === 'title') return by((b) => b.title);
    if (sort === 'author') return by((b) => `${b.author ?? '~'} ${b.title}`);
    return l;
  }, [books, filter, kind, q, sort]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        refreshControl={<RefreshControl refreshing={loading && !!lib} onRefresh={reload} tintColor={C.text} />}>
        <ScreenTitle title="Bibliothèque" />
        {!settings.chatUrl ? (
          <Empty icon="cloud-offline-outline" text="Serveur Lumio non configuré (Profil)." />
        ) : !lib && libErr ? (
          <Empty icon="alert-circle-outline" text={libErr} />
        ) : !lib ? (
          <Empty icon="hourglass-outline" text="Chargement de la bibliothèque…" />
        ) : !books.length ? (
          <Empty
            icon="library-outline"
            text={lib.admin ? `Aucun livre pour l'instant. Cherche-en dans l'onglet Trouver${lib.dir ? ` (dossier « ${lib.dir.folder} »)` : ''}.` : "Aucun livre pour l'instant."}
          />
        ) : (
          <>
            {going.length ? (
              <View style={{ marginBottom: 18 }}>
                <Text style={styles.h}>Continuer la lecture</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}>
                  {going.map((b) => (
                    <Pressable key={b.id} onPress={() => read(b)} onLongPress={() => open(b)} style={{ width: 120, gap: 6 }}>
                      <BookCover book={b} width={120} />
                      <ReadBar value={b.progress?.pct ?? 0} />
                      <Text numberOfLines={1} style={styles.t}>
                        {b.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.s}>
                        {Math.round((b.progress?.pct ?? 0) * 100)} %
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={styles.h}>
              Tous les livres <Text style={{ color: C.textFaint }}>· {books.length}</Text>
            </Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={C.textDim} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Titre, auteur, série"
                placeholderTextColor={C.textFaint}
                style={styles.search}
                returnKeyType="search"
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <SegChip label="Tous" on={filter === 'all'} onPress={() => setFilter('all')} />
              <SegChip label="En cours" on={filter === 'progress'} onPress={() => setFilter('progress')} />
              <SegChip label="Non lus" on={filter === 'new'} onPress={() => setFilter('new')} />
              <SegChip label="Terminés" on={filter === 'done'} onPress={() => setFilter('done')} />
              <View style={{ width: 10 }} />
              <SegChip label="Récents" icon="time-outline" on={sort === 'recent'} onPress={() => setSort('recent')} />
              <SegChip label="Titre" icon="text-outline" on={sort === 'title'} onPress={() => setSort('title')} />
              <SegChip label="Auteur" icon="person-outline" on={sort === 'author'} onPress={() => setSort('author')} />
            </ScrollView>
            {kinds.size > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <SegChip label="Tout" on={kind === 'all'} onPress={() => setKind('all')} />
                {kinds.has('epub') ? <SegChip label="Livres" icon="book-outline" on={kind === 'epub'} onPress={() => setKind('epub')} /> : null}
                {kinds.has('bd') ? <SegChip label="BD / Mangas" icon="images-outline" on={kind === 'bd'} onPress={() => setKind('bd')} /> : null}
                {kinds.has('pdf') ? <SegChip label="PDF" icon="document-text-outline" on={kind === 'pdf'} onPress={() => setKind('pdf')} /> : null}
              </ScrollView>
            ) : null}
            <View style={[styles.grid, { gap: 14 }]}>
              {shown.map((b) => {
                const pr = b.progress?.pct ?? 0;
                return (
                  <Pressable key={b.id} onPress={() => open(b)} style={{ width: w, gap: 5 }}>
                    <View>
                      <BookCover book={b} width={w} />
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
                    {b.author ? (
                      <Text numberOfLines={1} style={styles.s}>
                        {b.author}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {!shown.length ? <Empty icon="filter-outline" text="Aucun livre ne correspond." /> : null}
            {lib.downloading ? (
              <Text style={[styles.s, { textAlign: 'center', marginTop: 18 }]}>
                {lib.downloading} livre{lib.downloading > 1 ? 's' : ''} en cours de téléchargement…
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 40, gap: 12 }}>
      <Ionicons name={icon} size={40} color={C.textFaint} />
      <Text style={{ color: C.textDim, textAlign: 'center', fontSize: 15 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { color: C.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  t: { color: C.text, fontWeight: '700', fontSize: 13 },
  s: { color: C.textDim, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  chips: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  done: { position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, height: 40, borderRadius: 12, backgroundColor: C.surfaceHigh },
  search: { flex: 1, color: C.text, fontSize: 15 },
});
