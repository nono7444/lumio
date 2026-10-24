// Onglet Demandes : blocs repliables (+ / −) en plus des demandes de la famille :
// - téléchargements lancés sur les disques (AllDebrid, écran Téléchargements) avec leur progression ;
// - films et séries surveillés dans Radarr / Sonarr mais pas encore téléchargés.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { filesApi, formatSize, type DownloadJob } from '@/lib/files';
import { openMedia } from '@/lib/navigation';
import { useSettings } from '@/lib/settings';

function Block({ title, count, open, onToggle, children }: { title: string; count?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Pressable
        onPress={() => {
          tap();
          onToggle();
        }}
        style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
          {count ? <Text style={styles.count}>  {count}</Text> : null}
        </Text>
        <View style={styles.toggle}>
          <Ionicons name={open ? 'remove' : 'add'} size={18} color={C.text} />
        </View>
      </Pressable>
      {open ? <View style={{ gap: 10, marginTop: 10 }}>{children}</View> : null}
    </View>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(3, Math.min(100, pct))}%`, backgroundColor: color }]} />
    </View>
  );
}

const JOB_LABEL: Record<DownloadJob['status'], string> = {
  queued: 'En file',
  debrid: 'AllDebrid récupère',
  downloading: 'Téléchargement',
  done: 'Terminé',
  error: 'Erreur',
  cancelled: 'Annulé',
};

/** Téléchargements sur les disques (admin). */
export function DiskDownloadsBlock() {
  const { settings } = useSettings();
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [open, setOpen] = useState(true);
  const admin = settings.jellyfin?.isAdmin === true;
  const load = useCallback(() => {
    if (!admin) return;
    filesApi.downloads(settings).then(setJobs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, settings.chatUrl, settings.jellyfin?.token]);
  useFocusEffect(load);
  const active = jobs.filter((j) => ['queued', 'debrid', 'downloading'].includes(j.status));
  useEffect(() => {
    if (!active.length || !open) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active.length, open, load]);
  const shown = [...active, ...jobs.filter((j) => !active.includes(j)).slice(0, 5)];
  if (!admin || !jobs.length) return null;
  return (
    <Block title="Téléchargements sur les disques" count={active.length ? `${active.length} en cours` : undefined} open={open} onToggle={() => setOpen((o) => !o)}>
      {shown.map((j) => {
        const pct = j.size ? (j.done / j.size) * 100 : 0;
        const color = j.status === 'error' ? C.danger : j.status === 'done' ? C.success : C.accent;
        return (
          <View key={j.id} style={styles.row}>
            <Ionicons name={j.status === 'done' ? 'checkmark-circle' : j.status === 'error' ? 'alert-circle' : 'cloud-download-outline'} size={22} color={color} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name} numberOfLines={1}>
                {j.name || j.link}
              </Text>
              <Text style={styles.dim} numberOfLines={1}>
                {JOB_LABEL[j.status]}
                {j.size ? ` · ${formatSize(j.done)} / ${formatSize(j.size)}` : ''}
                {j.status === 'downloading' && j.speed ? ` · ${formatSize(j.speed)}/s` : ''}
                {` · ${j.root}${j.folder ? `/${j.folder}` : ''}`}
                {j.error ? ` · ${j.error}` : ''}
              </Text>
              {['debrid', 'downloading'].includes(j.status) ? <Bar pct={pct} color={color} /> : null}
            </View>
          </View>
        );
      })}
    </Block>
  );
}

type Wanted = {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: number;
  poster: string | null;
  state: 'downloading' | 'importing' | 'warning' | 'searching' | 'upcoming';
  progress: number | null;
  release?: string | null;
  missing?: number;
  seasons?: number[];
};

const WANTED_LABEL: Record<Wanted['state'], [string, string]> = {
  downloading: ['Téléchargement', C.accent],
  importing: ['Ajout au serveur', C.success],
  warning: ['Bloqué', C.warning],
  searching: ['Recherche d’une source', C.textDim],
  upcoming: ['Pas encore sorti', C.textFaint],
};

/** Films et séries surveillés dans Radarr / Sonarr mais pas encore téléchargés. */
export function ArrWantedBlock() {
  const { settings } = useSettings();
  const [items, setItems] = useState<Wanted[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    serverCall<{ items: Wanted[] }>(settings, '/api/arr/wanted')
      .then((r) => setItems(r.items))
      .catch(() => setItems(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
  useFocusEffect(load);
  useEffect(() => {
    if (!open || !items?.some((x) => x.state === 'downloading')) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open, items, load]);
  if (!items?.length) return null;
  const downloading = items.filter((x) => x.state === 'downloading').length;
  return (
    <Block
      title="En attente dans Radarr / Sonarr"
      count={`${items.length}${downloading ? ` · ${downloading} en cours` : ''}`}
      open={open}
      onToggle={() => setOpen((o) => !o)}>
      {items.map((x) => {
        const [label, color] = WANTED_LABEL[x.state] ?? WANTED_LABEL.searching;
        return (
          <Pressable key={`${x.type}:${x.tmdbId}`} onPress={() => x.tmdbId && openMedia(x.type, x.tmdbId)} style={styles.row}>
            <View style={styles.poster}>{x.poster ? <Image source={x.poster} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}</View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name} numberOfLines={1}>
                {x.title}
                {x.year ? ` (${x.year})` : ''}
              </Text>
              <Text style={styles.dim} numberOfLines={1}>
                {x.type === 'tv' ? `Série · ${x.missing} épisode${(x.missing ?? 0) > 1 ? 's' : ''} manquant${(x.missing ?? 0) > 1 ? 's' : ''}${x.seasons?.length ? ` (S${x.seasons.join(', S')})` : ''}` : 'Film'}
                {x.state === 'upcoming' && x.release ? ` · sortie le ${new Date(x.release).toLocaleDateString('fr-FR')}` : ''}
              </Text>
              <Text style={[styles.state, { color }]}>
                {label}
                {x.progress != null ? ` ${x.progress} %` : ''}
              </Text>
              {x.progress != null ? <Bar pct={x.progress} color={color} /> : null}
            </View>
          </Pressable>
        );
      })}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, marginHorizontal: 16, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 16, fontWeight: '800', flex: 1 },
  count: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  toggle: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  poster: { width: 40, height: 60, borderRadius: 6, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  name: { color: C.text, fontSize: 14, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12 },
  state: { fontSize: 12, fontWeight: '800' },
  track: { height: 5, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
});
