// Lumio Livres → onglet « Trouver » (admin) : recherche de livres, BD, mangas et comics sur C411, Tr4ker et Wawacity,
// téléchargement par le serveur Lumio (AllDebrid), suivi des téléchargements.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResultThumb } from '@/components/result-thumb';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { ebookApi, loadEbooks, type EbookJob, type EbookKind, type EbookResult, type EbookSource } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 0 ? `${Math.round(n / 1e6)} Mo` : '');
const JOB_LABEL: Record<string, string> = {
  queued: 'En attente',
  running: 'Téléchargement',
  downloading: 'Téléchargement',
  done: 'Prêt',
  error: 'Échec',
  debrid: 'AllDebrid prépare le fichier',
};
const KINDS: { id: EbookKind; label: string }[] = [
  { id: 'livres', label: 'Livres' },
  { id: 'bd', label: 'BD' },
  { id: 'mangas', label: 'Mangas' },
  { id: 'comics', label: 'Comics' },
];

export default function FindBookRoute() {
  return <Find />;
}

function Find() {
  const { settings } = useSettings();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<EbookKind>('livres');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<EbookResult[] | null>(null);
  const [sources, setSources] = useState<EbookSource[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<EbookJob[]>([]);

  const loadJobs = useCallback(() => {
    ebookApi
      .jobs(settings)
      .then((r) => {
        setJobs((old) => {
          // Un livre vient de finir : la bibliothèque est relue
          if (r.jobs.some((j) => j.status === 'done' && old.find((o) => o.id === j.id && o.status !== 'done'))) loadEbooks(settings);
          return r.jobs;
        });
      })
      .catch(() => {});
  }, [settings]);
  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 5000);
    return () => clearInterval(t);
  }, [loadJobs]);

  // Arrivée depuis « Mangas du moment » / « Top livres » : recherche lancée tout de suite
  const params = useLocalSearchParams<{ q?: string; kind?: EbookKind }>();
  useEffect(() => {
    if (params.q) {
      const k = params.kind ?? kind;
      setQ(params.q);
      setKind(k);
      search(k, params.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.kind]);
  const search = async (k: EbookKind = kind, forced?: string) => {
    const query = (forced ?? q).trim();
    if (query.length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await ebookApi.search(settings, query, k);
      setResults(r.results);
      setSources(r.sources);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const get = async (r: EbookResult) => {
    tap();
    setSent((s) => ({ ...s, [r.id]: '…' }));
    try {
      await ebookApi.download(settings, r.id);
      setSent((s) => ({ ...s, [r.id]: 'Téléchargement lancé sur le serveur' }));
      loadJobs();
    } catch (e) {
      setSent((s) => {
        const n = { ...s };
        delete n[r.id];
        return n;
      });
      Alert.alert('Téléchargement impossible', e instanceof Error ? e.message : String(e));
    }
  };

  const active = jobs.filter((j) => j.status !== 'done' && j.status !== 'error');
  const recent = jobs.filter((j) => j.status === 'done' || j.status === 'error').slice(0, 5);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={loadJobs} tintColor={C.text} />}>
        <ScreenTitle title="Trouver" />
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={C.textDim} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => search()}
            placeholder="Titre, auteur ou série"
            placeholderTextColor={C.textFaint}
            style={styles.search}
            returnKeyType="search"
            autoCorrect={false}
          />
          {busy ? <ActivityIndicator color={C.text} /> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingTop: 10 }}>
          {KINDS.map((k) => (
            <SegChip
              key={k.id}
              label={k.label}
              on={kind === k.id}
              onPress={() => {
                setKind(k.id);
                if (q.trim().length >= 2) search(k.id);
              }}
            />
          ))}
        </ScrollView>
        <Text style={styles.hint}>C411, Tr4ker et Wawacity. En français seulement ; les livres arrivent en EPUB ou PDF, les BD en CBZ.</Text>

        {active.length || recent.length ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardTitle}>Téléchargements</Text>
              <Text onPress={() => router.push('/book-downloads')} style={[styles.s, { color: C.info, fontWeight: '700' }]}>
                Tout voir
              </Text>
            </View>
            {[...active, ...recent].map((j) => (
              <View key={j.id} style={styles.job}>
                <Ionicons
                  name={j.status === 'done' ? 'checkmark-circle' : j.status === 'error' ? 'close-circle' : 'cloud-download-outline'}
                  size={20}
                  color={j.status === 'done' ? C.success : j.status === 'error' ? C.danger : C.info}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.t}>
                    {j.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.s}>
                    {j.error ??
                      [JOB_LABEL[j.status] ?? j.status, j.size ? `${Math.round((j.done / j.size) * 100)} %` : null, j.speed ? `${gb(j.speed)}/s` : null]
                        .filter(Boolean)
                        .join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {err ? <Text style={[styles.hint, { color: C.danger }]}>{err}</Text> : null}
        {sources.length ? (
          <View style={styles.sources}>
            {sources.map((s) => (
              <Text key={s.id} style={[styles.src, { color: s.state === 'ok' ? C.textDim : C.warning }]}>
                {s.label} : {s.state === 'ok' ? `${s.count}` : (s.message ?? (s.state === 'nokey' ? 'clé non réglée' : s.state))}
              </Text>
            ))}
          </View>
        ) : null}
        {results && !results.length && !busy ? <Text style={styles.hint}>Rien trouvé. Essaie avec juste le titre, ou l'auteur.</Text> : null}
        {results?.map((r) => {
          const st = sent[r.id];
          return (
            <View key={r.id} style={styles.result}>
              <ResultThumb path="/api/books/cover-find" q={r.title} kind={kind} icon="book" />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text numberOfLines={3} style={styles.t}>
                  {r.title}
                </Text>
                <Text style={styles.s}>
                  {[r.source, r.format?.toUpperCase(), r.genre === 'pack' ? (r.range ?? 'Pack') : r.tome != null ? `Tome ${r.tome}` : null, gb(r.size), r.seeders != null ? `${r.seeders} sources` : null].filter(Boolean).join(' · ')}
                </Text>
                {st && st !== '…' ? <Text style={[styles.s, { color: C.success }]}>{st}</Text> : null}
              </View>
              <Pressable onPress={() => get(r)} disabled={!!st} style={[styles.dl, st ? { opacity: 0.5 } : null]} accessibilityLabel={`Télécharger ${r.title}`}>
                {st === '…' ? <ActivityIndicator color="#000" /> : <Ionicons name={st ? 'checkmark' : 'download-outline'} size={20} color="#000" />}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 46, borderRadius: 14, backgroundColor: C.surfaceHigh },
  search: { flex: 1, color: C.text, fontSize: 16 },
  hint: { color: C.textDim, fontSize: 13, paddingHorizontal: 16, marginTop: 8, marginBottom: 6 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginVertical: 6 },
  src: { fontSize: 12 },
  card: { margin: 16, marginBottom: 6, padding: 14, borderRadius: 16, backgroundColor: C.surface, gap: 10 },
  cardTitle: { color: C.text, fontWeight: '800', fontSize: 16 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  t: { color: C.text, fontWeight: '600', fontSize: 14 },
  s: { color: C.textDim, fontSize: 12 },
  dl: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
});
