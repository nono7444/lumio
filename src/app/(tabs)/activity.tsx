import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Requests } from '@/components/requests-list';
import { Button, ScreenTitle, SegChip, SetupPrompt } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { formatBytes, radarr, refreshDownloads, sonarr, type QueueItem } from '@/lib/arr';
import { ServerRequests } from '@/components/server-requests';
import { invalidateHealth, lumio } from '@/lib/lumio-server';
import { useServerRequests } from '@/lib/requests';
import { openMedia } from '@/lib/navigation';
import { isManager, useSettings } from '@/lib/settings';

type Row = QueueItem & { source: 'radarr' | 'sonarr' };

const pad = (n: number) => String(n).padStart(2, '0');

function stateOf(q: Row): { label: string; color: string } {
  if (q.trackedDownloadStatus === 'warning' || q.trackedDownloadStatus === 'error' || q.errorMessage)
    return { label: 'Problème', color: C.danger };
  switch (q.trackedDownloadState ?? q.status) {
    case 'importPending':
    case 'importing':
      return { label: 'Import', color: C.info };
    case 'downloading':
      return { label: 'Téléchargement', color: C.accent };
    case 'paused':
      return { label: 'En pause', color: C.textDim };
    case 'queued':
    case 'delay':
      return { label: 'En file', color: C.warning };
    case 'completed':
      return { label: 'Terminé', color: C.success };
    default:
      return { label: q.status, color: C.textDim };
  }
}

function QueueRow({ q }: { q: Row }) {
  const done = q.size > 0 ? Math.max(0, Math.min(1, 1 - q.sizeleft / q.size)) : 0;
  const st = stateOf(q);
  const title = q.movie?.title ?? q.series?.title ?? q.title;
  const sub = q.episode
    ? `S${pad(q.episode.seasonNumber)}E${pad(q.episode.episodeNumber)}${q.episode.title ? ` · ${q.episode.title}` : ''}`
    : q.movie?.year
      ? String(q.movie.year)
      : '';
  const tmdbId = q.movie?.tmdbId ?? q.series?.tmdbId;
  const problem = q.errorMessage ?? q.statusMessages?.flatMap((m) => m.messages)[0];

  return (
    <Pressable
      disabled={!tmdbId}
      onPress={() => tmdbId && openMedia(q.source === 'radarr' ? 'movie' : 'tv', tmdbId)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.rowHead}>
        <Ionicons name={q.source === 'radarr' ? 'film-outline' : 'tv-outline'} size={18} color={C.textDim} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {sub ? (
            <Text style={styles.dim} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.state, { color: st.color }]}>{st.label}</Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${done * 100}%`, backgroundColor: st.color }]} />
      </View>
      <View style={styles.rowFoot}>
        <Text style={styles.dim}>
          {(done * 100).toFixed(done < 1 ? 1 : 0)} % · {formatBytes(q.size - q.sizeleft)} / {formatBytes(q.size)}
        </Text>
        <Text style={styles.dim}>{q.timeleft ? q.timeleft.replace(/\.\d+$/, '') : (q.downloadClient ?? '')}</Text>
      </View>
      {problem ? (
        <Text style={[styles.dim, { color: C.danger }]} numberOfLines={2}>
          {problem}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Downloads({ header, viaServer }: { header: React.ReactNode; viaServer?: boolean }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const first = useRef(true);

  const configured =
    viaServer ||
    Boolean((settings.radarr.url && settings.radarr.apiKey) || (settings.sonarr.url && settings.sonarr.apiKey));

  const load = useCallback(
    async (spinner = false) => {
      if (!configured) return;
      if (spinner) setLoading(true);
      // Compte non-admin : la file vient du serveur Lumio
      if (viaServer) {
        try {
          const q = await lumio.queue(settings);
          setRows(q.records);
          setErrors(q.errors);
        } catch (e: any) {
          setErrors([e?.message ?? String(e)]);
        }
        setLoading(false);
        return;
      }
      const errs: string[] = [];
      if (settings.radarr.url && settings.radarr.apiKey) refreshDownloads(settings.radarr);
      if (settings.sonarr.url && settings.sonarr.apiKey) refreshDownloads(settings.sonarr);
      const [r, s] = await Promise.all([
        settings.radarr.url && settings.radarr.apiKey
          ? radarr.queue(settings.radarr).catch((e) => (errs.push(`Radarr : ${e.message}`), { records: [] }))
          : { records: [] },
        settings.sonarr.url && settings.sonarr.apiKey
          ? sonarr.queue(settings.sonarr).catch((e) => (errs.push(`Sonarr : ${e.message}`), { records: [] }))
          : { records: [] },
      ]);
      setRows([
        ...r.records.map((q) => ({ ...q, source: 'radarr' as const })),
        ...s.records.map((q) => ({ ...q, source: 'sonarr' as const })),
      ]);
      setErrors(errs);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configured, viaServer, settings.radarr, settings.sonarr, settings.chatUrl, settings.jellyfin?.token]
  );

  // Pourcentage en direct : rafraîchit toutes les 3 s tant que l'onglet est affiché
  // (Radarr / Sonarr sont relancés toutes les 10 s pour relire le client de téléchargement)
  useFocusEffect(
    useCallback(() => {
      load(first.current);
      first.current = false;
      const t = setInterval(() => load(false), 3000);
      return () => clearInterval(t);
    }, [load])
  );

  if (!configured)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        {header}
        <SetupPrompt
          title="Connecte Radarr et Sonarr"
          text="Renseigne l'URL et la clé API de Radarr et/ou Sonarr pour suivre les téléchargements ici."
        />
      </View>
    );

  // TV : liste défilante simple (la FlatList avec « tirer pour actualiser » s'affichait toute noire)
  if (Platform.isTV)
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 80 }}>
        {header}
        {errors.map((e) => (
          <Text key={e} style={[styles.dim, { color: C.danger, marginHorizontal: 16, marginBottom: 4 }]}>
            {e}
          </Text>
        ))}
        {loading && !rows.length ? (
          <ActivityIndicator color={C.textDim} style={{ marginTop: 40 }} />
        ) : !rows.length ? (
          <View style={{ alignItems: 'center', marginTop: 50, gap: 10 }}>
            <Ionicons name="checkmark-done-outline" size={36} color={C.textFaint} />
            <Text style={styles.dim}>Rien en cours de téléchargement.</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 }}>
            {rows.map((q) => (
              <View key={`${q.source}:${q.id}`} style={{ width: '48.5%' }}>
                <QueueRow q={q} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      data={rows}
      keyExtractor={(q) => `${q.source}:${q.id}`}
      renderItem={({ item }) => <QueueRow q={item} />}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE, gap: 12 }}
      refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={C.accent} />}
      ListHeaderComponent={
        <View style={{ marginHorizontal: -16 }}>
          {header}
          {errors.map((e) => (
            <Text key={e} style={[styles.dim, { color: C.danger, marginHorizontal: 16, marginBottom: 4 }]}>
              {e}
            </Text>
          ))}
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <View style={{ alignItems: 'center', marginTop: 50, gap: 10 }}>
            <Ionicons name="checkmark-done-outline" size={36} color={C.textFaint} />
            <Text style={styles.dim}>Rien en cours de téléchargement.</Text>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    gap: 10,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12 },
  state: { fontSize: 12, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
});

export default function Activity() {
  const { settings } = useSettings();
  const [nonce, setNonce] = useState(0);
  const serverReq = useServerRequests(nonce);
  const [tab, setTab] = useState<'downloads' | 'requests'>('requests');
  const insets = useSafeAreaInsets();

  // Serveur injoignable : on réessaie tout seul à chaque retour sur l'onglet
  useFocusEffect(
    useCallback(() => {
      if (serverReq === false) {
        invalidateHealth();
        setNonce((n) => n + 1);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // ——— Serveur Lumio : page Demandes + file de téléchargement ———
  if (serverReq) {
    const header = (
      <View>
        <ScreenTitle title="Demandes" />
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
          <SegChip label="Demandes" on={tab === 'requests'} onPress={() => setTab('requests')} />
          <SegChip label="Téléchargements" on={tab === 'downloads'} onPress={() => setTab('downloads')} />
        </View>
      </View>
    );
    if (tab === 'downloads') return <Downloads header={header} viaServer />;
    return <ServerRequests header={header} />;
  }

  // Vérification du serveur en cours, ou serveur injoignable / pas configuré
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Demandes" />
      {serverReq === null ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 60 }} />
      ) : (
        <View style={{ alignItems: 'center', gap: 14, padding: 32, marginTop: 40 }}>
          <Ionicons name={settings.chatUrl ? 'cloud-offline-outline' : 'server-outline'} size={44} color={C.textFaint} />
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
            {settings.chatUrl ? 'Serveur Lumio injoignable' : 'Serveur Lumio non configuré'}
          </Text>
          <Text style={{ color: C.textDim, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
            {settings.chatUrl
              ? 'Le serveur ne répond pas pour le moment (redémarrage, coupure internet…). Réessaie dans un instant.'
              : 'Renseigne l’adresse du serveur Lumio dans Profil → Serveur Lumio pour faire des demandes.'}
          </Text>
          {settings.chatUrl ? (
            <Button title="Réessayer" icon="refresh" variant="secondary" onPress={() => {
                invalidateHealth();
                setNonce((n) => n + 1);
              }} />
          ) : (
            <Button title="Ouvrir le Profil" icon="person-circle-outline" onPress={() => router.push('/settings')} />
          )}
        </View>
      )}
    </View>
  );
}
