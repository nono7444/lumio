// Lumio Livres → onglet « Bibliothèque » : « Continuer la lecture », puis tous les livres (couvertures), recherche,
// filtres (en cours, non lus, terminés), type (livres, BD / mangas, PDF) et tri.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookCover, ReadBar } from '@/components/ebook-ui';
import { FocusPressable as Pressable } from '@/components/tv';
import { UniverseSwitch } from '@/components/universe-switch';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { groupSeries, mo, rememberSeries, useEbooks, type Ebook, type Series } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

type Sort = 'recent' | 'title' | 'author';
type Filter = 'all' | 'progress' | 'new' | 'done';
type Kind = 'all' | 'epub' | 'bd' | 'pdf';
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const open = (b: Ebook) => (tap(), router.push({ pathname: '/ebook/[id]', params: { id: b.id } }));
const read = (b: Ebook) => (tap(), router.push({ pathname: '/reader', params: { id: b.id } }));

export default function ShelfRoute() {
  return <Shelf />;
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
  // Collections : une seule carte par série, à la place de son premier tome dans la liste
  const items = useMemo(() => {
    const { series } = groupSeries(shown);
    rememberSeries(groupSeries(books).series);
    const of = new Map<string, Series>();
    for (const sr of series) for (const b of sr.books) of.set(b.id, sr);
    const out: ({ t: 'book'; b: Ebook } | { t: 'series'; s: Series })[] = [];
    const seen = new Set<string>();
    for (const b of shown) {
      const sr = of.get(b.id);
      if (!sr) out.push({ t: 'book', b });
      else if (!seen.has(sr.key)) {
        seen.add(sr.key);
        out.push({ t: 'series', s: sr });
      }
    }
    return out;
  }, [shown, books]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        refreshControl={<RefreshControl refreshing={loading && !!lib} onRefresh={reload} tintColor={C.text} />}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <ScreenTitle title="Livres" />
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
              {items.map((it) =>
                it.t === 'series' ? (
                  <SeriesCard key={`s-${it.s.key}`} s={it.s} w={w} />
                ) : (
                  <BookCard key={it.b.id} b={it.b} w={w} />
                )
              )}
            </View>
            {!shown.length ? <Empty icon="filter-outline" text="Aucun livre ne correspond." /> : null}
            {lib.tidying ? (
              <Text style={[styles.s, { textAlign: 'center', marginTop: 18 }]}>Rangement des derniers téléchargements (packs, BD)… tire vers le bas dans un moment.</Text>
            ) : null}
            {lib.admin && lib.unread?.length ? (
              <View style={styles.unread}>
                <Text style={styles.t}>Fichiers que la liseuse ne sait pas ouvrir</Text>
                <Text style={styles.s}>Ils sont dans le dossier « {lib.dir?.folder} » mais ne sont ni EPUB, ni PDF, ni CBZ (archive protégée par mot de passe, format inconnu…).</Text>
                {lib.unread.map((u) => (
                  <Text key={u.name} numberOfLines={2} style={styles.s}>
                    • {u.name} · {mo(u.size)}
                  </Text>
                ))}
              </View>
            ) : null}
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

function BookCard({ b, w }: { b: Ebook; w: number }) {
  const pr = b.progress?.pct ?? 0;
  return (
    <Pressable onPress={() => open(b)} style={{ width: w, gap: 5 }}>
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
}

/** Collection : couverture du 1er tome, posée sur une pile, avec le nombre de tomes. */
function SeriesCard({ s, w }: { s: Series; w: number }) {
  const read = s.books.filter((b) => b.progress?.done).length;
  const going = s.books.some((b) => b.progress && !b.progress.done);
  const cw = w - 8;
  return (
    <Pressable onPress={() => (tap(), router.push({ pathname: '/series/[key]', params: { key: s.key } }))} style={{ width: w, gap: 5 }}>
      <View style={{ width: w, height: Math.round(cw * 1.5) + 8 }}>
        <View style={[styles.stack, { left: 8, top: 0, width: cw, height: Math.round(cw * 1.5) }]} />
        <View style={[styles.stack, { left: 4, top: 4, width: cw, height: Math.round(cw * 1.5), opacity: 0.8 }]} />
        <View style={{ position: 'absolute', left: 0, top: 8 }}>
          <BookCover book={s.books[0]} width={cw} />
        </View>
        <View style={styles.count}>
          <Ionicons name="albums" size={11} color="#000" />
          <Text style={styles.countText}>{s.books.length}</Text>
        </View>
      </View>
      {going || read ? <ReadBar value={read / s.books.length} /> : null}
      <Text numberOfLines={2} style={styles.t}>
        {s.name}
      </Text>
      <Text numberOfLines={1} style={styles.s}>
        {read ? `${read}/${s.books.length} lus` : `${s.books.length} tomes`}
      </Text>
    </Pressable>
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
  unread: { margin: 16, marginTop: 20, padding: 14, borderRadius: 14, backgroundColor: C.surface, gap: 6 },
  stack: { position: 'absolute', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  count: { position: 'absolute', right: 12, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  countText: { color: '#000', fontWeight: '800', fontSize: 12 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, height: 40, borderRadius: 12, backgroundColor: C.surfaceHigh },
  search: { flex: 1, color: C.text, fontSize: 15 },
});
