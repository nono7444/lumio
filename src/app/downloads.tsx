// Admin : téléchargements AllDebrid (liens d'hébergeurs, magnets ou fichiers .torrent) directement sur les disques du serveur.
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { filesApi, formatSize, joinPath, parentPath, type Disk, type DownloadJob, type FileEntry } from '@/lib/files';
import { useSettings } from '@/lib/settings';

const STATUS: Record<DownloadJob['status'], { label: string; color: string }> = {
  queued: { label: 'En attente', color: C.textDim },
  debrid: { label: 'AllDebrid récupère le fichier…', color: '#FFB340' },
  downloading: { label: 'Téléchargement', color: C.accent },
  done: { label: 'Terminé', color: C.success },
  error: { label: 'Erreur', color: C.danger },
  cancelled: { label: 'Annulé', color: C.textDim },
};

/** Temps restant lisible : « 3 min », « 1 h 12 » */
function eta(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)} s restantes`;
  if (sec < 3600) return `${Math.round(sec / 60)} min restantes`;
  return `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')} restantes`;
}

export default function Downloads() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [disks, setDisks] = useState<Disk[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [subdirs, setSubdirs] = useState<FileEntry[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    filesApi
      .alldebrid(settings)
      .then((r) => setConfigured(r.configured))
      .catch((e) => setError(e?.message ?? String(e)));
    filesApi
      .disks(settings)
      .then((d) => {
        setDisks(d);
        if (d[0]) setRoot((r) => r ?? d[0].name);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sous-dossiers du dossier de destination
  useEffect(() => {
    if (!root) return;
    filesApi
      .list(settings, root, folder)
      .then((l) => setSubdirs(l.filter((e) => e.dir)))
      .catch(() => setSubdirs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, folder]);

  const loadJobs = useCallback(() => {
    filesApi.downloads(settings).then(setJobs).catch(() => {});
  }, [settings]);

  // Toutes les secondes tant qu'un téléchargement tourne (pourcentage en direct), sinon toutes les 5 s
  const anyActive = jobs.some((j) => ['queued', 'debrid', 'downloading'].includes(j.status));
  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, anyActive ? 1000 : 5000);
    return () => clearInterval(t);
  }, [loadJobs, anyActive]);

  const saveKey = async () => {
    try {
      const r = await filesApi.setAlldebridKey(settings, key);
      setConfigured(r.configured);
      setKey('');
      toast('Clé AllDebrid enregistrée sur le serveur');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  const start = async () => {
    if (!root || !link.trim()) return;
    setBusy(true);
    try {
      await filesApi.startDownload(settings, link.trim(), root, folder);
      setLink('');
      toast('Téléchargement lancé');
      loadJobs();
    } catch (e: any) {
      Alert.alert('Téléchargement impossible', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Fichier .torrent choisi sur le téléphone (Fichiers, iCloud, Téléchargements…)
  const pickTorrent = async () => {
    if (!root) return Alert.alert('Disque', 'Choisis d’abord le disque où télécharger.');
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/x-bittorrent', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const f = r.assets[0];
      if (!/\.torrent$/i.test(f.name)) return Alert.alert('Fichier .torrent', 'Choisis un fichier qui se termine par .torrent.');
      setBusy(true);
      const data = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
      await filesApi.startTorrent(settings, f.name, data, root, folder);
      toast('Téléchargement lancé');
      loadJobs();
    } catch (e: any) {
      Alert.alert('Téléchargement impossible', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Téléchargements</Text>
        <Pressable onPress={() => router.push('/files')} hitSlop={10} style={styles.round} accessibilityLabel="Disques">
          <Ionicons name="server-outline" size={19} color={C.text} />
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}

        {configured === false ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Clé AllDebrid</Text>
            <Text style={styles.dim}>
              Sur alldebrid.com → Mon compte → Clés API, crée une clé et colle-la ici. Elle reste sur ton serveur Lumio, jamais sur le téléphone.
            </Text>
            <TextInput value={key} onChangeText={setKey} placeholder="Clé API AllDebrid" placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} />
            <Button title="Enregistrer" icon="key-outline" onPress={saveKey} />
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nouveau téléchargement</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Lien d'hébergeur, lien AllDebrid ou magnet (un par ligne)"
              placeholderTextColor={C.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={[styles.input, { flex: 1, minHeight: 70 }]}
            />
            <Pressable
              onPress={async () => setLink(((await Clipboard.getStringAsync()) || '').trim())}
              style={[styles.round, { alignSelf: 'flex-start', marginTop: 4 }]}
              accessibilityLabel="Coller">
              <Ionicons name="clipboard-outline" size={18} color={C.text} />
            </Pressable>
          </View>

          <Text style={styles.label}>Disque</Text>
          {disks.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {disks.map((d) => (
                <SegChip
                  key={d.name}
                  label={`${d.name} · ${formatSize(d.free)} libres`}
                  on={root === d.name}
                  onPress={() => {
                    setRoot(d.name);
                    setFolder('');
                  }}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.dim}>Aucun disque configuré sur le serveur Lumio (LUMIO_DISKS).</Text>
          )}

          {root ? (
            <>
              <Text style={styles.label}>Dossier</Text>
              <View style={styles.folderBar}>
                {folder ? (
                  <Pressable onPress={() => setFolder(parentPath(folder))} hitSlop={8}>
                    <Ionicons name="arrow-up" size={18} color={C.text} />
                  </Pressable>
                ) : null}
                <Text style={[styles.dim, { flex: 1, color: C.text }]} numberOfLines={1}>
                  {[root, ...(folder ? folder.split('/') : [])].join(' › ')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {subdirs.slice(0, 40).map((d) => (
                  <Pressable
                    key={d.name}
                    onPress={() => {
                      tap();
                      setFolder(joinPath(folder, d.name));
                    }}
                    style={styles.sub}>
                    <Ionicons name="folder" size={14} color="#FFC93C" />
                    <Text style={styles.subText} numberOfLines={1}>
                      {d.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Button title="Télécharger ici" icon="cloud-download-outline" onPress={start} loading={busy} disabled={!root || !link.trim() || configured === false} />
          <Button title="Envoyer un fichier .torrent" icon="document-attach-outline" variant="secondary" onPress={pickTorrent} loading={busy} disabled={!root || configured === false} />
        </View>

        <Text style={styles.cardTitle}>En cours et récents</Text>
        {configured === null && !jobs.length ? <ActivityIndicator color={C.text} /> : null}
        {jobs.length === 0 && configured !== null ? <Text style={styles.dim}>Aucun téléchargement pour l'instant.</Text> : null}
        {jobs.map((j) => {
          const st = STATUS[j.status];
          const pct = j.size ? Math.min(1, j.done / j.size) : 0;
          const active = ['queued', 'debrid', 'downloading'].includes(j.status);
          return (
            <View key={j.id} style={styles.job}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={styles.jobName} numberOfLines={2}>
                  {j.name || j.link}
                </Text>
                <Pressable
                  onPress={() =>
                    filesApi
                      .cancelDownload(settings, j.id)
                      .then(loadJobs)
                      .catch((e) => toast(e?.message ?? String(e), 'error'))
                  }
                  hitSlop={10}>
                  <Ionicons name={active ? 'stop-circle-outline' : 'close'} size={20} color={C.textDim} />
                </Pressable>
              </View>
              {active ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                  <Text style={[styles.bigPct, { color: st.color }]}>{j.size ? `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)} %` : '…'}</Text>
                  <View style={{ flex: 1, paddingBottom: 3 }}>
                    <Text style={[styles.dim, { color: st.color }]}>{st.label}</Text>
                    <Text style={styles.dim}>
                      {formatSize(j.done)} / {formatSize(j.size)}
                      {j.speed ? ` · ${formatSize(j.speed)}/s` : ''}
                      {j.speed && j.size ? ` · ${eta((j.size - j.done) / j.speed)}` : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.dim, { color: st.color }]}>
                  {st.label}
                  {j.status === 'done' ? ` · ${formatSize(j.size || j.done)}` : ''}
                </Text>
              )}
              {active ? (
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: st.color }]} />
                </View>
              ) : null}
              {j.error ? <Text style={[styles.dim, { color: C.danger }]}>{j.error}</Text> : null}
              <Text style={styles.faint} numberOfLines={1}>
                {[j.root, ...(j.folder ? j.folder.split('/') : [])].join(' › ')}
                {j.current && j.status === 'downloading' ? ` · ${j.current}` : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bigPct: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  title: { flex: 1, color: C.text, fontSize: 26, fontWeight: '800' },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 4 },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  faint: { color: C.textFaint, fontSize: 11 },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  folderBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 10 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '48%' },
  subText: { color: C.text, fontSize: 13 },
  job: { backgroundColor: C.surface, borderRadius: R.md, padding: 12, gap: 6 },
  jobName: { flex: 1, color: C.text, fontSize: 14, fontWeight: '700' },
  track: { height: 5, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
});
