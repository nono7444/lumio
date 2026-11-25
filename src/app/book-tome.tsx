// Lumio Livres : un tome qui n'est pas sur le serveur. Recherche lancée tout de suite (« Série T05 » sur C411, Tr4ker
// et Wawacity), les résultats de ce tome en premier, téléchargement en un appui et suivi en direct.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, JOB_ACTIVE, jobForTome, loadEbooks, type EbookJob, type EbookKind, type EbookResult, type EbookSource } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 0 ? `${Math.round(n / 1e6)} Mo` : '');

export default function BookTomeScreen() {
  const { name, n, kind } = useLocalSearchParams<{ name: string; n: string; kind?: EbookKind }>();
  const tome = Number(n);
  const { settings } = useSettings();
  const [results, setResults] = useState<EbookResult[] | null>(null);
  const [sources, setSources] = useState<EbookSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [jobs, setJobs] = useState<EbookJob[]>([]);

  const search = useCallback(
    async (q: string) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await ebookApi.search(settings, q, kind ?? 'mangas');
        setSources(r.sources);
        return r.results;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        return [];
      } finally {
        setBusy(false);
      }
    },
    [settings, kind]
  );
  useEffect(() => {
    (async () => {
      // « One Piece T101 », sinon « One Piece tome 101 », sinon la série entière
      let r = await search(`${name} T${String(tome).padStart(2, '0')}`);
      if (!r.some((x) => x.tome === tome)) {
        const more = await search(`${name} tome ${tome}`);
        r = [...r, ...more.filter((m) => !r.some((x) => x.title === m.title))];
      }
      if (!r.length) r = await search(String(name));
      setResults(r);
    })();
  }, [name, tome, search]);
  useEffect(() => {
    const tick = () =>
      ebookApi
        .jobs(settings)
        .then((r) => {
          setJobs(r.jobs);
          const j = jobForTome(r.jobs, String(name), tome);
          if (j?.status === 'done') loadEbooks(settings);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [settings, name, tome]);

  const get = async (r: EbookResult) => {
    tap();
    setSent(r.id);
    try {
      await ebookApi.download(settings, r.id);
    } catch (e) {
      setSent(null);
      Alert.alert('Téléchargement impossible', e instanceof Error ? e.message : String(e));
    }
  };

  const job = jobForTome(jobs, String(name), tome);
  const live = job && JOB_ACTIVE.includes(job.status);
  const pct = job?.size ? Math.round((job.done / job.size) * 100) : 0;
  const exact = (results ?? []).filter((r) => r.tome === tome);
  const others = (results ?? []).filter((r) => r.tome !== tome);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title={`${name} · T${tome}`} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 12 }}>
        <View style={styles.status}>
          <Ionicons name={live ? 'cloud-download-outline' : job?.status === 'done' ? 'checkmark-circle' : 'alert-circle-outline'} size={22} color={live ? C.info : job?.status === 'done' ? C.success : C.warning} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.t}>
              {live ? `Téléchargement en cours${job.size ? ` · ${pct} %` : ''}` : job?.status === 'done' ? 'Arrivé sur le serveur' : job?.status === 'error' ? 'Le téléchargement a échoué' : 'Ce tome n’est pas sur le serveur'}
            </Text>
            {live && job.size ? (
              <View style={styles.bar}>
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: C.info }} />
              </View>
            ) : null}
            {job?.error ? <Text style={styles.s}>{job.error}</Text> : null}
            {!job ? <Text style={styles.s}>Choisis une version ci-dessous : le serveur la télécharge et la range dans ta collection.</Text> : null}
          </View>
        </View>
        {job ? <Button title="Voir tous les téléchargements" icon="list" variant="secondary" small onPress={() => router.push('/book-downloads')} /> : null}

        {busy && !results ? (
          <View style={{ alignItems: 'center', padding: 30, gap: 10 }}>
            <ActivityIndicator color={C.text} />
            <Text style={styles.s}>Recherche du tome {tome}…</Text>
          </View>
        ) : null}
        {err ? <Text style={[styles.s, { color: C.danger }]}>{err}</Text> : null}
        {sources.length ? (
          <Text style={styles.s}>{sources.map((x) => `${x.label} : ${x.state === 'ok' ? x.count : (x.message ?? x.state)}`).join(' · ')}</Text>
        ) : null}

        {results ? <Text style={styles.h}>Tome {tome}</Text> : null}
        {results && !exact.length ? <Text style={styles.s}>Aucune version de ce tome trouvée pour le moment (pas encore sorti en français, ou pas encore partagé). Le serveur réessaiera tout seul si « Compléter mes séries » est activé.</Text> : null}
        {exact.map((r) => (
          <Result key={r.id} r={r} sent={sent === r.id} onGet={() => get(r)} />
        ))}
        {others.length ? <Text style={styles.h}>Autres résultats</Text> : null}
        {others.slice(0, 30).map((r) => (
          <Result key={r.id} r={r} sent={sent === r.id} onGet={() => get(r)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Result({ r, sent, onGet }: { r: EbookResult; sent: boolean; onGet: () => void }) {
  return (
    <View style={styles.result}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={3} style={styles.t}>
          {r.title}
        </Text>
        <Text style={styles.s}>
          {[r.source, r.format?.toUpperCase(), r.genre === 'pack' ? (r.range ?? 'Pack') : r.tome != null ? `Tome ${r.tome}` : null, size(r.size), r.seeders != null ? `${r.seeders} sources` : null].filter(Boolean).join(' · ')}
        </Text>
        {sent ? <Text style={[styles.s, { color: C.success }]}>Téléchargement lancé sur le serveur</Text> : null}
      </View>
      <Pressable onPress={onGet} disabled={sent} style={[styles.dl, sent ? { opacity: 0.5 } : null]} accessibilityLabel={`Télécharger ${r.title}`}>
        <Ionicons name={sent ? 'checkmark' : 'download-outline'} size={20} color="#000" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.surface, alignItems: 'center' },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)' },
  h: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  t: { color: C.text, fontWeight: '700', fontSize: 14 },
  s: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  dl: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
});
