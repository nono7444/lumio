// Lumio Audio → onglet « Bibliothèque » : « Continuer l'écoute » puis tous les livres (couvertures), tri et filtre.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { SafeAreaView } from 'react-native-safe-area-context';

import { bookProgress, Cover, ProgressLine, useAudioLibrary } from '@/components/audio-ui';
import { UniverseSwitch } from '@/components/universe-switch';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { playBook, useAudio } from '@/lib/audio-player';
import { type AudioBook } from '@/lib/audiobooks';
import { useSettings } from '@/lib/settings';

type Sort = 'recent' | 'title' | 'author';
type Filter = 'all' | 'progress' | 'new' | 'done';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function ListenRoute() {
  return <Listen />;
}

function Listen() {
  const { settings } = useSettings();
  const { lib, libErr, loading, reload } = useAudioLibrary();
  const a = useAudio();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState<Sort>('recent');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const cols = width > 700 ? 5 : width > 500 ? 4 : 3;
  const size = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 14) / cols);

  const books = lib?.books ?? [];
  const going = useMemo(
    () =>
      books
        .filter((b) => b.progress && !b.progress.done)
        .sort((x, y) => (y.progress?.at ?? 0) - (x.progress?.at ?? 0))
        .slice(0, 10),
    // a.file / a.playing : la position change pendant l'écoute
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [books, a.book?.id, a.file, a.playing]
  );
  const shown = useMemo(() => {
    let l = books.filter((b) =>
      filter === 'progress' ? b.progress && !b.progress.done : filter === 'new' ? !b.progress : filter === 'done' ? b.progress?.done : true
    );
    if (q.trim()) {
      const w = norm(q.trim());
      l = l.filter((b) => norm(`${b.title} ${b.author ?? ''} ${b.narrator ?? ''}`).includes(w));
    }
    const by = (f: (b: AudioBook) => string) => [...l].sort((x, y) => f(x).localeCompare(f(y), 'fr', { numeric: true }));
    if (sort === 'title') return by((b) => b.title);
    if (sort === 'author') return by((b) => `${b.author ?? '~'} ${b.title}`);
    return [...l].sort((x, y) => y.added.localeCompare(x.added));
  }, [books, filter, q, sort]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_SPACE + (a.book ? 70 : 0) }}
        refreshControl={<RefreshControl refreshing={loading && !!lib} onRefresh={() => reload(true)} tintColor={C.text} />}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <ScreenTitle title="Livres audio" />
        {!settings.chatUrl ? (
          <Empty icon="cloud-offline-outline" text="Serveur Lumio non configuré (Profil)." />
        ) : !lib && libErr ? (
          <Empty icon="alert-circle-outline" text={libErr} />
        ) : !lib ? (
          <Empty icon="hourglass-outline" text="Chargement de la bibliothèque…" />
        ) : !books.length ? (
          <Empty
            icon="headset-outline"
            text={
              lib.admin
                ? `Aucun livre audio pour l'instant. Cherche-en dans l'onglet Trouver${lib.dir ? ` (dossier « ${lib.dir.folder} »)` : ''}.`
                : "Aucun livre audio pour l'instant."
            }
          />
        ) : (
          <>
            {going.length ? (
              <View style={{ marginBottom: 18 }}>
                <Text style={styles.h}>Continuer l'écoute</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}>
                  {going.map((b) => (
                    <Pressable
                      key={b.id}
                      onPress={() => (tap(), router.push({ pathname: '/audiobook/[id]', params: { id: b.id } }))}
                      style={{ width: 150, gap: 6 }}>
                      <View>
                        <Cover book={b} size={150} />
                        <Pressable
                          onPress={() => (tap(), playBook(settings, b))}
                          style={styles.playOver}
                          accessibilityLabel={`Reprendre ${b.title}`}>
                          <Ionicons name={a.book?.id === b.id && a.playing ? 'pause' : 'play'} size={18} color="#000" />
                        </Pressable>
                      </View>
                      <ProgressLine value={bookProgress(b)} />
                      <Text numberOfLines={1} style={styles.t}>
                        {b.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.s}>
                        {b.files.length > 1 ? `Chapitre ${(b.progress?.file ?? 0) + 1}/${b.files.length}` : `${Math.round(bookProgress(b) * 100)} %`}
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
                placeholder="Titre, auteur, narrateur"
                placeholderTextColor={C.textFaint}
                style={styles.search}
                returnKeyType="search"
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
              <SegChip label="Tous" on={filter === 'all'} onPress={() => setFilter('all')} />
              <SegChip label="En cours" on={filter === 'progress'} onPress={() => setFilter('progress')} />
              <SegChip label="Pas commencés" on={filter === 'new'} onPress={() => setFilter('new')} />
              <SegChip label="Terminés" on={filter === 'done'} onPress={() => setFilter('done')} />
              <View style={{ width: 10 }} />
              <SegChip label="Récents" icon="time-outline" on={sort === 'recent'} onPress={() => setSort('recent')} />
              <SegChip label="Titre" icon="text-outline" on={sort === 'title'} onPress={() => setSort('title')} />
              <SegChip label="Auteur" icon="person-outline" on={sort === 'author'} onPress={() => setSort('author')} />
            </ScrollView>
            <View style={[styles.grid, { gap: 14 }]}>
              {shown.map((b) => {
                const pr = bookProgress(b);
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => (tap(), router.push({ pathname: '/audiobook/[id]', params: { id: b.id } }))}
                    style={{ width: size, gap: 5 }}>
                    <View>
                      <Cover book={b} size={size} />
                      {b.progress?.done ? (
                        <View style={styles.done}>
                          <Ionicons name="checkmark" size={13} color="#000" />
                        </View>
                      ) : null}
                    </View>
                    {pr > 0 && pr < 1 ? <ProgressLine value={pr} /> : null}
                    <Text numberOfLines={2} style={styles.t}>
                      {b.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.s}>
                      {[b.author, b.files.length > 1 ? `${b.files.length} parties` : null].filter(Boolean).join(' · ') || ' '}
                    </Text>
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
  playOver: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.surfaceHigh,
  },
  search: { flex: 1, color: C.text, fontSize: 15 },
});
