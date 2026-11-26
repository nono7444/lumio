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
import { Image } from 'expo-image';
import { toast } from '@/components/toast';
import { ebookApi, loadEbooks, groupSeries, JOB_ACTIVE, jobForTome, seriesByKey, tomeOf, useEbooks, type BooksAuto, type Ebook, type EbookJob, type SeriesInfo } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

export default function SeriesScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { lib } = useEbooks();
  const { settings } = useSettings();
  // Tomes manquants de cette série (repérés par le serveur) : cases grisées « Manquant » dans la grille
  const [auto, setAuto] = useState<BooksAuto | null>(null);
  const [info, setInfo] = useState<SeriesInfo | null>(null);
  const [jobs, setJobs] = useState<EbookJob[]>([]);
  const [fetching, setFetching] = useState(false);
  const seriesName = (lib ? groupSeries(lib.books).series.find((x) => x.key === key) : null)?.name ?? seriesByKey(String(key))?.name ?? '';
  useFocusEffect(
    useCallback(() => {
      ebookApi.auto(settings).then(setAuto).catch(() => {});
      // Tous les tomes parus (MangaDex) : ceux qu'on n'a pas s'affichent aussi
      if (seriesName) ebookApi.seriesInfo(settings, seriesName).then(setInfo).catch(() => {});
      // Téléchargements suivis en direct (toutes les 4 s)
      const tick = () => ebookApi.jobs(settings).then((r) => setJobs(r.jobs)).catch(() => {});
      tick();
      const t = setInterval(tick, 4000);
      return () => clearInterval(t);
    }, [settings, seriesName])
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
  // Tomes absents : trous repérés par le serveur + tous les tomes parus (MangaDex) qu'on n'a pas
  const known = new Map((info?.volumes ?? []).map((v) => [v.n, v]));
  const holes = [...new Set([...(miss?.gaps ?? []), ...(info?.volumes ?? []).map((v) => v.n)])].filter((t) => !have.has(t));
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
            {[`${s.books.length} tomes`, info?.total ? `${info.total} parus` : null, holes.length ? `${holes.length} pas sur le serveur` : null, read ? `${read} lus` : null, authors || null].filter(Boolean).join(' · ')}
          </Text>
          <ReadBar value={read / s.books.length} />
          <Button
            title={next.progress && !next.progress.done ? `Continuer${n != null ? ` le tome ${n}` : ''}` : `Lire${n != null ? ` le tome ${n}` : ''}`}
            icon="book-outline"
            onPress={() => router.push({ pathname: '/reader', params: { id: next.id } })}
          />
          {lib?.admin && holes.filter((t) => !jobForTome(jobs, s.name, t)).length ? (
            <Button
              title={`Télécharger les tomes manquants (${holes.filter((t) => !jobForTome(jobs, s.name, t)).length})`}
              icon="cloud-download-outline"
              variant="secondary"
              loading={fetching}
              onPress={() => {
                const want = holes.filter((t) => !jobForTome(jobs, s.name, t));
                setFetching(true);
                ebookApi
                  .fetchTomes(settings, s.name, s.books.some((b) => b.comic === 'bd') ? 'bd' : 'mangas', want)
                  .then(() => toast(`Recherche de ${want.length} tome${want.length > 1 ? 's' : ''} lancée : ils passent « EN COURS » dès qu’une version est trouvée`))
                  .catch((e) => toast(e?.message ?? String(e), 'error'))
                  .finally(() => setTimeout(() => setFetching(false), 4000));
              }}
            />
          ) : null}
          {lib?.admin && s.books.some((b) => b.format === 'bd') ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={styles.s}>Ranger dans :</Text>
              {(['manga', 'bd'] as const).map((k) => {
                const on = (s.books[0]?.comic ?? 'manga') === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => (tap(), ebookApi.setComic(settings, s.name, k, s.books.map((b) => b.title)).then(() => loadEbooks(settings)).catch(() => {}))}
                    style={[styles.kindChip, on ? { backgroundColor: C.text } : null]}>
                    <Text style={[styles.s, { color: on ? '#000' : C.text, fontWeight: '700' }]}>{k === 'manga' ? 'Mangas' : 'BD'}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {lib?.admin ? <Text style={styles.s}>Appui long sur un tome : changer sa couverture</Text> : null}
        </View>
        <View style={styles.grid}>
          {cells.map((c) => {
            if (c.k === 'miss') {
              const job = jobForTome(jobs, s.name, c.t);
              const live = job && JOB_ACTIVE.includes(job.status);
              const dl = live || (coming.has(c.t) && !job);
              const pct = live && job.size ? Math.round((job.done / job.size) * 100) : null;
              const cover = known.get(c.t)?.cover;
              const kind = s.books.some((b) => b.format === 'bd') ? 'mangas' : 'livres';
              return (
                <Pressable
                  key={`miss-${c.t}`}
                  onPress={() => (tap(), router.push({ pathname: '/book-tome', params: { name: s.name, n: String(c.t), kind } }))}
                  style={{ width: w, gap: 5 }}>
                  <View style={[styles.missing, { width: w, height: Math.round(w * 1.5) }]}>
                    {cover ? <Image source={cover} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} contentFit="cover" cachePolicy="memory-disk" /> : null}
                    <Ionicons name={dl ? 'cloud-download-outline' : 'search'} size={24} color={C.text} />
                    <View style={[styles.missTag, dl ? { backgroundColor: C.info } : job?.status === 'error' ? { backgroundColor: C.warning } : null]}>
                      <Text style={styles.missTagText}>{dl ? (pct != null ? `EN COURS ${pct} %` : 'EN COURS') : job?.status === 'error' ? 'ÉCHEC' : 'PAS SUR LE SERVEUR'}</Text>
                    </View>
                    {pct != null ? (
                      <View style={styles.missBar}>
                        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: C.info }} />
                      </View>
                    ) : null}
                    <View style={styles.tome}>
                      <Text style={styles.tomeText}>{c.t}</Text>
                    </View>
                  </View>
                  <Text numberOfLines={2} style={[styles.t, { color: C.textFaint }]}>
                    {s.name} T{String(c.t).padStart(2, '0')}
                  </Text>
                </Pressable>
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
  missing: { overflow: 'hidden', borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', gap: 10 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: C.surface },
  missBar: { position: 'absolute', left: 8, right: 8, bottom: 8, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.2)' },
  missTag: { marginHorizontal: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: C.danger },
  missTagText: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.5, textAlign: 'center' },
  done: { position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center' },
});
