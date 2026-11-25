// Lumio Livres : tous les téléchargements de livres, BD et mangas, suivis en direct (toutes les 2 s) :
// étape, progression, vitesse, temps restant ; annuler ce qui tourne, retirer ce qui est fini.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, JOB_ACTIVE, loadEbooks, type EbookJob } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2).replace('.', ',')} Go` : n >= 1e6 ? `${Math.round(n / 1e6)} Mo` : n > 0 ? `${Math.round(n / 1e3)} ko` : '');
const STEP: Record<string, string> = {
  queued: 'En attente',
  debrid: 'AllDebrid prépare le fichier',
  downloading: 'Téléchargement',
  running: 'Téléchargement',
  done: 'Arrivé dans la bibliothèque',
  error: 'Échec',
  cancelled: 'Annulé',
};
const left = (j: EbookJob) => {
  if (!j.speed || !j.size || j.done >= j.size) return null;
  const s = (j.size - j.done) / j.speed;
  return s < 60 ? 'moins d’1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};

export default function BookDownloadsScreen() {
  const { settings } = useSettings();
  const [jobs, setJobs] = useState<EbookJob[] | null>(null);
  const load = useCallback(() => {
    ebookApi
      .jobs(settings)
      .then((r) =>
        setJobs((old) => {
          if (old && r.jobs.some((j) => j.status === 'done' && old.find((o) => o.id === j.id && o.status !== 'done'))) loadEbooks(settings);
          return r.jobs;
        })
      )
      .catch(() => setJobs((x) => x ?? []));
  }, [settings]);
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const cancel = (j: EbookJob) => {
    const run = () => ebookApi.cancelJob(settings, j.id).then(load).catch((e) => Alert.alert('Téléchargements', e?.message ?? String(e)));
    if (!JOB_ACTIVE.includes(j.status)) return void (tap(), run());
    Alert.alert('Annuler ce téléchargement ?', j.name, [
      { text: 'Non', style: 'cancel' },
      { text: 'Annuler le téléchargement', style: 'destructive', onPress: run },
    ]);
  };
  const clearDone = async () => {
    for (const j of (jobs ?? []).filter((x) => !JOB_ACTIVE.includes(x.status))) await ebookApi.cancelJob(settings, j.id).catch(() => {});
    load();
  };

  const active = (jobs ?? []).filter((j) => JOB_ACTIVE.includes(j.status));
  const finished = (jobs ?? []).filter((j) => !JOB_ACTIVE.includes(j.status));
  const speed = active.reduce((n, j) => n + (j.speed || 0), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title="Téléchargements" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <Text style={styles.s}>
          {active.length ? `${active.length} en cours${speed ? ` · ${size(speed)}/s` : ''}` : 'Rien en cours'}
          {finished.length ? ` · ${finished.length} terminé${finished.length > 1 ? 's' : ''}` : ''}
        </Text>
        {jobs && !jobs.length ? (
          <View style={{ alignItems: 'center', padding: 40, gap: 10 }}>
            <Ionicons name="cloud-download-outline" size={40} color={C.textFaint} />
            <Text style={[styles.s, { textAlign: 'center' }]}>Aucun téléchargement. Touche un tome « pas sur le serveur » dans une collection, ou cherche dans Trouver.</Text>
          </View>
        ) : null}
        {active.map((j) => (
          <JobCard key={j.id} j={j} onCancel={() => cancel(j)} />
        ))}
        {finished.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={styles.h}>Terminés</Text>
            <Button title="Tout retirer" variant="secondary" small onPress={clearDone} />
          </View>
        ) : null}
        {finished.map((j) => (
          <JobCard key={j.id} j={j} onCancel={() => cancel(j)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function JobCard({ j, onCancel }: { j: EbookJob; onCancel: () => void }) {
  const live = JOB_ACTIVE.includes(j.status);
  const pct = j.size ? Math.min(100, Math.round((j.done / j.size) * 100)) : 0;
  const color = j.status === 'done' ? C.success : j.status === 'error' ? C.danger : live ? C.info : C.textDim;
  const rest = live ? left(j) : null;
  return (
    <View style={[styles.card, live ? { borderColor: C.info } : null]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name={j.status === 'done' ? 'checkmark-circle' : j.status === 'error' ? 'close-circle' : j.status === 'queued' ? 'time-outline' : 'cloud-download-outline'} size={22} color={color} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={styles.t} numberOfLines={2}>
            {j.name}
          </Text>
          <Text style={[styles.s, { color }]}>
            {[STEP[j.status] ?? j.status, live && j.size ? `${pct} %` : null, live && j.speed ? `${size(j.speed)}/s` : null, rest ? `encore ${rest}` : null].filter(Boolean).join(' · ')}
          </Text>
          {j.error ? <Text style={[styles.s, { color: C.danger }]}>{j.error}</Text> : null}
          <Text style={styles.s}>
            {[j.size ? (live ? `${size(j.done)} sur ${size(j.size)}` : size(j.size)) : null, j.by ? `par ${j.by}` : null, ago(j.finishedAt ?? j.createdAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={8} style={styles.x} accessibilityLabel={live ? 'Annuler' : 'Retirer'}>
          <Ionicons name={live ? 'stop' : 'close'} size={16} color={C.text} />
        </Pressable>
      </View>
      {live ? (
        <View style={styles.bar}>
          <View style={{ width: `${j.status === 'downloading' || j.status === 'running' ? pct : 3}%`, height: '100%', backgroundColor: C.info }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, gap: 10 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)' },
  h: { color: C.text, fontSize: 18, fontWeight: '800' },
  t: { color: C.text, fontWeight: '700', fontSize: 14 },
  s: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  x: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
});
