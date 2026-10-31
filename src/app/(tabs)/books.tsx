// Book : chercher un manga, une BD, un livre ou un livre audio (C411, Tr4ker, Wawacity), le télécharger
// sur le disque, puis le lire dans l'appli.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenTitle, SegChip } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { bookUrl, booksApi, bytes, openBook, type Book, type BookJob, type BookKind, type BookResult, type BookSource } from '@/lib/books';
import { useSettings } from '@/lib/settings';

const KINDS: [BookKind, string][] = [['mangas', 'Mangas'], ['bd', 'BD'], ['comics', 'Comics'], ['livres', 'Livres'], ['audio', 'Audio']];
const ACTIVE = ['queued', 'debrid', 'downloading'];
const ICON: Record<Book['format'], keyof typeof Ionicons.glyphMap> = { bd: 'images', epub: 'book', pdf: 'document-text', audio: 'headset' };

export default function Books() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<'search' | 'library'>('search');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<BookKind>('mangas');
  const [filter, setFilter] = useState<'all' | 'tomes' | 'packs'>('all');
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [sources, setSources] = useState<BookSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [books, setBooks] = useState<Book[] | null>(null);
  const [jobs, setJobs] = useState<BookJob[]>([]);
  const [admin, setAdmin] = useState(false);
  const n = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLibrary = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const [l, j] = await Promise.all([booksApi.library(settings), booksApi.jobs(settings)]);
      setBooks(l.books);
      setJobs(j.jobs);
      if (j.jobs.some((x) => ACTIVE.includes(x.status))) timer.current = setTimeout(loadLibrary, 3000);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
      booksApi.settings(settings).then((s) => setAdmin(s.admin)).catch(() => {});
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLibrary])
  );

  const search = async (k = kind) => {
    const text = q.trim();
    if (text.length < 2) return;
    Keyboard.dismiss();
    const id = ++n.current;
    setLoading(true);
    setError(null);
    setResults(null);
    setOpen(new Set());
    try {
      const r = await booksApi.search(settings, text, k);
      if (id !== n.current) return;
      setResults(r.results);
      setSources(r.sources);
    } catch (e: any) {
      if (id === n.current) setError(e?.message ?? String(e));
    } finally {
      if (id === n.current) setLoading(false);
    }
  };

  const download = async (r: BookResult) => {
    try {
      await booksApi.download(settings, r.id);
      setAdded((s) => new Set(s).add(r.id));
      loadLibrary();
    } catch (e: any) {
      Alert.alert('Téléchargement impossible', e?.message ?? String(e));
    }
  };

  const groups = useMemo(() => {
    const close = (results ?? []).filter((x) => x.close);
    const byTome = new Map<number, BookResult[]>();
    for (const x of close.filter((y) => y.genre === 'tome')) {
      if (!byTome.has(x.tome!)) byTome.set(x.tome!, []);
      byTome.get(x.tome!)!.push(x);
    }
    return {
      tomes: [...byTome.entries()].sort((a, b) => a[0] - b[0]).map(([t, l]) => [t, [...l].sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))] as const),
      packs: close.filter((x) => x.genre === 'pack'),
      others: close.filter((x) => x.genre === 'livre'),
      far: (results ?? []).filter((x) => !x.close),
    };
  }, [results]);

  const series = useMemo(() => {
    const m = new Map<string, Book[]>();
    for (const b of books ?? []) {
      const k = b.folder || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    for (const l of m.values()) l.sort((a, b) => a.title.localeCompare(b.title, 'fr', { numeric: true }));
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'fr')));
  }, [books]);

  const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  const card = (r: BookResult) => <ResultCard key={r.id} r={r} added={added.has(r.id)} onDownload={() => download(r)} />;

  const bookMenu = (b: Book) => {
    const remove = () =>
      Alert.alert('Supprimer ce livre ?', `${b.name}\nLe fichier sera effacé du disque.`, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => booksApi.remove(settings, b.token).then(loadLibrary).catch((e) => Alert.alert('Erreur', e.message)) },
      ]);
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions({ title: b.title, options: ['Lire', 'Supprimer du disque', 'Annuler'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (i) => {
        if (i === 0) openBook(b);
        if (i === 1) remove();
      });
    else Alert.alert(b.title, '', [{ text: 'Lire', onPress: () => openBook(b) }, { text: 'Supprimer', style: 'destructive', onPress: remove }, { text: 'Annuler', style: 'cancel' }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle
        title="Book"
        right={
          admin ? (
            <Pressable onPress={() => router.push('/books/settings')} hitSlop={10} style={st.headerBtn}>
              <Ionicons name="options-outline" size={20} color={C.text} />
            </Pressable>
          ) : undefined
        }
      />
      <View style={st.row}>
        <SegChip label="Chercher" on={view === 'search'} onPress={() => setView('search')} />
        <SegChip label={`Mes livres${active ? ` · ${active} ⬇︎` : ''}`} on={view === 'library'} onPress={() => setView('library')} />
      </View>

      {view === 'search' ? (
        <>
          <View style={st.field}>
            <Ionicons name="search" size={20} color={C.textDim} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Titre ou série : One Piece, Astérix…"
              placeholderTextColor={C.textFaint}
              style={st.input}
              returnKeyType="search"
              autoCorrect={false}
              onSubmitEditing={() => search()}
              clearButtonMode="while-editing"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.chips}>
            {KINDS.map(([k, l]) => (
              <SegChip
                key={k}
                label={l}
                on={kind === k}
                onPress={() => {
                  setKind(k);
                  if (q.trim().length >= 2) search(k);
                }}
              />
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE + 30 }} keyboardShouldPersistTaps="handled">
            {results?.length ? (
              <View style={[st.row, { paddingHorizontal: 0 }]}>
                <SegChip label="Tout" on={filter === 'all'} onPress={() => setFilter('all')} />
                <SegChip label="Tomes" on={filter === 'tomes'} onPress={() => setFilter('tomes')} />
                <SegChip label="Collections" on={filter === 'packs'} onPress={() => setFilter('packs')} />
              </View>
            ) : null}
            {results && sources.length ? (
              <View style={st.sources}>
                {sources
                  .filter((s) => s.state !== 'skip')
                  .map((s) => (
                    <Text key={s.id} style={[st.source, s.state !== 'ok' && { color: C.warning }]}>
                      {s.label} : {s.state === 'nokey' ? 'clé à régler' : s.state === 'error' ? s.message || 'pas de réponse' : s.count}
                    </Text>
                  ))}
              </View>
            ) : null}
            {loading ? <ActivityIndicator color={C.text} style={{ marginTop: 40 }} /> : null}
            {error ? <Text style={st.empty}>{error}</Text> : null}
            {results && !results.length ? <Text style={st.empty}>Aucun résultat en français.</Text> : null}
            {!results && !loading && !error ? <Text style={st.empty}>Cherche un manga, une BD, un livre ou un livre audio : il sera téléchargé sur ton serveur, puis lisible ici.</Text> : null}

            {filter !== 'packs' && groups.tomes.length ? (
              <>
                <Text style={st.h2}>Tomes <Text style={st.count}>{groups.tomes.length}</Text></Text>
                {groups.tomes.map(([t, versions]) => (
                  <View key={t} style={{ marginBottom: 8 }}>
                    {card(versions[0])}
                    {versions.length > 1 ? (
                      <>
                        <Pressable
                          onPress={() => setOpen((o) => { const s = new Set(o); if (s.has(t)) s.delete(t); else s.add(t); return s; })}
                          hitSlop={6}
                          style={{ paddingLeft: 78, paddingVertical: 6 }}>
                          <Text style={{ color: C.accent, fontWeight: '700', fontSize: 13 }}>
                            {open.has(t) ? 'Masquer' : `+ ${versions.length - 1} autre${versions.length > 2 ? 's' : ''} version${versions.length > 2 ? 's' : ''}`}
                          </Text>
                        </Pressable>
                        {open.has(t) ? versions.slice(1).map((v) => <View key={v.id} style={{ marginBottom: 8 }}>{card(v)}</View>) : null}
                      </>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
            {filter !== 'tomes' && groups.packs.length ? (
              <>
                <Text style={st.h2}>Collections et intégrales <Text style={st.count}>{groups.packs.length}</Text></Text>
                {groups.packs.map((r) => <View key={r.id} style={{ marginBottom: 8 }}>{card(r)}</View>)}
              </>
            ) : null}
            {filter === 'all' && groups.others.length ? (
              <>
                <Text style={st.h2}>{groups.tomes.length || groups.packs.length ? 'Autres' : 'Résultats'} <Text style={st.count}>{groups.others.length}</Text></Text>
                {groups.others.map((r) => <View key={r.id} style={{ marginBottom: 8 }}>{card(r)}</View>)}
              </>
            ) : null}
            {filter === 'all' && groups.far.length ? <Far list={groups.far} render={card} /> : null}
          </ScrollView>
        </>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_SPACE + 30 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadLibrary} tintColor={C.text} />}>
          {jobs.length ? (
            <>
              <Text style={st.h2}>Téléchargements</Text>
              {jobs.slice(0, 8).map((j) => <JobRow key={j.id} j={j} onChange={loadLibrary} />)}
            </>
          ) : null}
          {!books ? <ActivityIndicator color={C.text} style={{ marginTop: 40 }} /> : null}
          {books && !books.length ? <Text style={st.empty}>Aucun livre pour l’instant. Cherche un titre et touche la flèche pour le télécharger.</Text> : null}
          {series.map(([folder, list]) => (
            <View key={folder || '_'} style={{ marginTop: 16 }}>
              <Text style={st.h2}>{folder ? folder.split('/').pop() : 'Livres'}</Text>
              {list.map((b) => (
                <Pressable key={b.path} onPress={() => openBook(b)} onLongPress={() => bookMenu(b)} style={({ pressed }) => [st.book, pressed && { opacity: 0.7 }]}>
                  {b.format === 'bd' ? (
                    <Image source={bookUrl(settings, b.token, 'page/0')} style={st.cover} contentFit="cover" cachePolicy="disk" transition={150} />
                  ) : (
                    <View style={[st.cover, { alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name={ICON[b.format]} size={22} color={C.text} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={st.title} numberOfLines={2}>{b.title}</Text>
                    <Text style={st.sub}>{[b.format.toUpperCase(), bytes(b.size)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Far({ list, render }: { list: BookResult[]; render: (r: BookResult) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(!open)} style={{ paddingVertical: 14 }} hitSlop={6}>
        <Text style={{ color: C.textDim, fontWeight: '700' }}>{open ? '▾' : '▸'} Résultats moins proches ({list.length})</Text>
      </Pressable>
      {open ? list.map((r) => <View key={r.id} style={{ marginBottom: 8 }}>{render(r)}</View>) : null}
    </>
  );
}

function ResultCard({ r, added, onDownload }: { r: BookResult; added: boolean; onDownload: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={st.card}>
      <View style={st.num}>
        {r.genre === 'tome' ? (
          <>
            <Text style={st.numSmall}>TOME</Text>
            <Text style={st.numBig}>{r.tome}</Text>
          </>
        ) : r.genre === 'pack' ? (
          <>
            <Text style={st.numSmall}>{r.range === 'Intégrale' ? 'SÉRIE' : 'PACK'}</Text>
            <Text style={[st.numBig, { fontSize: 14 }]}>{r.range === 'Intégrale' ? 'Tout' : r.range!.replace(' à ', '–')}</Text>
          </>
        ) : (
          <Ionicons name="book" size={22} color={C.text} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.cardTitle} numberOfLines={2}>{r.title}</Text>
        <Text style={st.sub}>{[r.source, bytes(r.size), r.seeders != null ? `${r.seeders} seeds` : null, r.format || null].filter(Boolean).join(' · ')}</Text>
      </View>
      <Pressable
        onPress={async () => {
          setBusy(true);
          await onDownload();
          setBusy(false);
        }}
        disabled={added || busy}
        style={[st.dl, added && { backgroundColor: 'rgba(48,209,88,0.18)' }]}
        hitSlop={6}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name={added ? 'checkmark' : 'arrow-down'} size={20} color={added ? C.success : '#fff'} />}
      </Pressable>
    </View>
  );
}

function JobRow({ j, onChange }: { j: BookJob; onChange: () => void }) {
  const { settings } = useSettings();
  const active = ACTIVE.includes(j.status);
  const pct = j.status === 'done' ? 100 : j.size ? Math.min(100, Math.floor((j.done / j.size) * 100)) : 0;
  const label = { queued: 'En attente', debrid: 'AllDebrid', downloading: 'Téléchargement', done: 'Terminé', error: 'Échec', cancelled: 'Annulé' }[j.status] ?? j.status;
  return (
    <View style={st.job}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Text style={[st.title, { flex: 1 }]} numberOfLines={2}>{j.name || 'Livre'}</Text>
        <Pressable hitSlop={8} onPress={() => booksApi.cancel(settings, j.id).then(onChange).catch(() => {})}>
          <Ionicons name={active ? 'close-circle' : 'trash-outline'} size={22} color={C.textDim} />
        </Pressable>
      </View>
      <Text style={[st.sub, j.status === 'error' && { color: C.danger }]}>
        {label}
        {active && j.size ? ` · ${pct} % · ${bytes(j.done)} sur ${bytes(j.size)}` : ''}
        {j.error ? ` — ${j.error}` : ''}
      </Text>
      {active || j.status === 'done' ? (
        <View style={st.bar}>
          <View style={[st.fill, { width: `${pct}%` }, j.status === 'done' && { backgroundColor: C.success }]} />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  headerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, backgroundColor: C.surfaceHigh, borderRadius: 999, paddingHorizontal: 16 },
  input: { flex: 1, color: C.text, fontSize: 17, paddingVertical: 12 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 6 },
  source: { color: C.textFaint, fontSize: 13 },
  empty: { color: C.textDim, textAlign: 'center', marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
  h2: { color: C.text, fontSize: 19, fontWeight: '800', marginTop: 16, marginBottom: 10 },
  count: { color: C.textDim, fontSize: 14, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 16, padding: 12 },
  num: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  numSmall: { color: C.textDim, fontSize: 8, fontWeight: '800' },
  numBig: { color: C.text, fontSize: 19, fontWeight: '900' },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '600' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 4 },
  dl: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  book: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 14, padding: 10, marginBottom: 8 },
  cover: { width: 46, height: 66, borderRadius: 8, backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '600' },
  job: { backgroundColor: C.surface, borderRadius: 16, padding: 14, marginBottom: 8 },
  bar: { height: 6, backgroundColor: C.surfaceHigh, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
});
