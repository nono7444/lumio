// Page « Demandes » façon Seerr : filtres, cartes avec affiche, demandeur, statuts, actions admin.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { RecheckButton } from '@/components/recheck-button';
import { Button, SegChip, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import {
  partialText,
  RequestStatus,
  requestsApi,
  timeAgo,
  type Req,
  type RequestFilter,
} from '@/lib/requests';
import { secourAdminApi } from '@/lib/secour';
import { useSettings } from '@/lib/settings';
import { managerUI } from '@/lib/variant';

const FILTERS: { id: RequestFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'processing', label: 'En cours' },
  { id: 'available', label: 'Disponibles' },
  { id: 'declined', label: 'Refusées' },
  { id: 'failed', label: 'Échecs' },
];

const PAGE = 20;

/** Statut en une ligne : un point de couleur + un texte court. */
function statusOf(r: Req): { text: string; color: string; progress?: number } {
  if (r.status === RequestStatus.PENDING) return { text: 'En attente de validation', color: '#FF9F0A' };
  if (r.status === RequestStatus.DECLINED) return { text: r.reason ? `Refusée · ${r.reason}` : 'Refusée', color: '#FF453A' };
  if (r.status === RequestStatus.FAILED) return { text: r.error ? `Échec · ${r.error}` : 'Échec', color: '#FF453A' };
  if (r.status === RequestStatus.COMPLETED || r.mediaStatus === 5) return { text: 'Disponible', color: '#30D158' };
  const d = r.download;
  if (d?.progress != null) return { text: `Téléchargement ${d.progress} %`, color: '#3D8BFF', progress: d.progress };
  if (d?.state === 'partial') return { text: `Partiel · ${partialText(d)}`, color: '#FF9F0A' };
  if (d?.state === 'importing') return { text: 'Rangement…', color: '#64D2FF' };
  if (d?.state === 'warning') return { text: 'À vérifier', color: '#FF9F0A' };
  if (d?.title) return { text: d.title.replace(/^(Lumio Auto|Lumio Secour) · /, '').replace(/^./, (c) => c.toUpperCase()), color: /choisir/.test(d.title) ? '#FF9F0A' : C.textDim };
  return { text: 'Recherche…', color: C.textDim };
}

function RequestCard({ r, admin, meId, onChanged }: { r: Req; admin: boolean; meId?: string; onChanged: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const mine = r.requestedBy.id === meId;
  const st = statusOf(r);

  async function act(kind: 'approve' | 'retry' | 'decline' | 'delete' | 'search' | 'secour', reason?: string, arr?: 'keep' | 'files') {
    setBusy(kind);
    try {
      let msg: string | undefined;
      if (kind === 'approve') await requestsApi.approve(settings, r.id);
      else if (kind === 'retry') await requestsApi.retry(settings, r.id);
      else if (kind === 'decline') await requestsApi.decline(settings, r.id, reason);
      else if (kind === 'search') msg = (await requestsApi.search(settings, r.id)).message;
      else if (kind === 'secour') {
        await secourAdminApi.viaRequest(settings, r.id);
        msg = `« ${r.title} » part avec Lumio Secour`;
      } else msg = (await requestsApi.remove(settings, r.id, arr))?.message;
      toast(
        msg ??
          (kind === 'approve' || kind === 'retry'
            ? `« ${r.title} » validé.`
            : kind === 'decline'
              ? `Demande de ${r.requestedBy.name} refusée.`
              : 'Demande supprimée.'),
        'info',
        kind === 'search' ? 8000 : undefined
      );
      onChanged();
    } catch (e: any) {
      Alert.alert('Action impossible', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  const decline = () =>
    Alert.prompt ? Alert.prompt('Refuser la demande', 'Raison (facultatif)', (reason) => act('decline', reason || undefined)) : act('decline');

  const sent = r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED || r.status === RequestStatus.FAILED;
  const canSearch = r.status === RequestStatus.APPROVED && st.progress == null && r.mediaStatus !== 5 && (admin || mine);

  // Toutes les actions dans un seul menu (« … »)
  const menu = () => {
    tap();
    const opts: { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }[] = [];
    if (canSearch) opts.push({ text: 'Relancer la recherche', onPress: () => act('search') });
    if (admin && r.status === RequestStatus.FAILED) opts.push({ text: 'Réessayer', onPress: () => act('retry') });
    if (admin && (canSearch || r.status === RequestStatus.FAILED)) opts.push({ text: 'Télécharger avec Lumio Secour', onPress: () => act('secour') });
    if (admin && sent) {
      opts.push({ text: 'Arrêter le suivi (garder les fichiers)', onPress: () => act('delete', undefined, 'keep') });
      opts.push({ text: 'Tout supprimer, fichiers compris', style: 'destructive', onPress: () => act('delete', undefined, 'files') });
      opts.push({ text: 'Retirer de la liste', onPress: () => act('delete') });
    } else if (admin || (mine && r.status === RequestStatus.PENDING)) {
      opts.push({ text: mine && !admin ? 'Annuler ma demande' : 'Supprimer', style: 'destructive', onPress: () => act('delete') });
    }
    opts.push({ text: 'Fermer', style: 'cancel' });
    Alert.alert(r.title, undefined, opts);
  };
  const hasMenu = canSearch || admin || (mine && r.status === RequestStatus.PENDING);
  const seasons = r.type === 'tv' && r.seasons?.length ? (r.seasons.length > 3 ? `S${Math.min(...r.seasons)}–S${Math.max(...r.seasons)}` : r.seasons.map((n) => `S${n}`).join(' ')) : null;

  return (
    <Pressable onPress={() => openMedia(r.type, r.tmdbId)} onLongPress={hasMenu ? menu : undefined} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={styles.poster}>{r.poster ? <Image source={r.poster} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.title} numberOfLines={1}>
          {r.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[r.type === 'movie' ? 'Film' : 'Série', r.year, seasons, mine ? 'toi' : r.requestedBy.name, timeAgo(r.createdAt)].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: st.color }]} />
          <Text style={[styles.status, { color: st.color === C.textDim ? C.textDim : st.color }]} numberOfLines={1}>
            {busy ? '…' : st.text}
          </Text>
        </View>
        {st.progress != null ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(2, st.progress)}%` }]} />
          </View>
        ) : null}
      </View>
      {admin && r.status === RequestStatus.PENDING ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable onPress={decline} hitSlop={6} style={[styles.round, { backgroundColor: 'rgba(255,69,58,0.16)' }]} accessibilityLabel="Refuser">
            <Ionicons name="close" size={18} color="#FF453A" />
          </Pressable>
          <Pressable onPress={() => act('approve')} hitSlop={6} style={[styles.round, { backgroundColor: 'rgba(48,209,88,0.18)' }]} accessibilityLabel="Valider">
            {busy === 'approve' ? <ActivityIndicator size="small" color="#30D158" /> : <Ionicons name="checkmark" size={18} color="#30D158" />}
          </Pressable>
        </View>
      ) : hasMenu ? (
        <Pressable onPress={menu} hitSlop={10} style={styles.more} accessibilityLabel="Actions">
          <Ionicons name="ellipsis-horizontal" size={18} color={C.textDim} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function ServerRequests({ header }: { header: React.ReactNode }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const admin = managerUI(settings);
  // TV : tout afficher d'emblée (« À valider » restait souvent vide)
  const [filter, setFilter] = useState<RequestFilter>(admin && !Platform.isTV ? 'pending' : 'all');
  const [rows, setRows] = useState<Req[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  const load = useCallback(
    async (f: RequestFilter = filter) => {
      setLoading(true);
      try {
        const r = await requestsApi.list(settings, f, { take: PAGE });
        setRows(r.results);
        setTotal(r.total);
        setPendingCount(r.counts.pending);
        setError(null);
        // L'admin n'a rien en attente : on montre tout
        if (first.current && admin && f === 'pending' && r.total === 0) {
          first.current = false;
          setFilter('all');
          return load('all');
        }
        first.current = false;
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, filter, admin]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function more() {
    if (rows.length >= total || loading) return;
    try {
      const r = await requestsApi.list(settings, filter, { take: PAGE, skip: rows.length });
      setRows((x) => [...x, ...r.results]);
    } catch {}
  }


  const filtersBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} style={{ marginBottom: 14 }}>
      {FILTERS.map((f) => (
        <SegChip
          key={f.id}
          label={f.id === 'pending' && pendingCount ? `${f.label} (${pendingCount})` : f.label}
          on={filter === f.id}
          onPress={() => {
            tap();
            setFilter(f.id);
            load(f.id);
          }}
        />
      ))}
    </ScrollView>
  );

  // TV : simple liste défilante (pas de FlatList ni de « tirer pour actualiser », qui restaient vides sur certaines box)
  if (Platform.isTV)
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 80 }}>
        {header}
        {filtersBar}
        <Text style={[styles.meta, { marginHorizontal: 16, marginBottom: 10 }]}>
          {settings.jellyfin?.userName ?? ''}
          {admin ? ' · admin : toutes les demandes' : ' · tes demandes (et celles de la famille si l’option est activée)'}
          {total ? ` · ${total} demande${total > 1 ? 's' : ''}` : ''}
        </Text>
        {error ? <Text style={[styles.meta, { color: C.danger, marginHorizontal: 16, marginBottom: 10 }]}>Erreur : {error}</Text> : null}
        {loading && !rows.length ? (
          <ActivityIndicator color={C.textDim} style={{ marginTop: 40 }} />
        ) : !rows.length ? (
          <View style={{ alignItems: 'center', marginTop: 40, gap: 10, paddingHorizontal: 40 }}>
            <Ionicons name="paper-plane-outline" size={36} color={C.textFaint} />
            <Text style={[styles.meta, { textAlign: 'center' }]}>
              {admin
                ? 'Aucune demande ici.'
                : 'Aucune demande faite depuis ce compte. Pour voir celles de toute la famille : sur le téléphone admin, Profil → Utilisateurs → « Les utilisateurs voient toutes les demandes ».'}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 16 }}>
            {rows.map((r) => (
              <View key={r.id} style={{ width: '48.5%' }}>
                <RequestCard r={r} admin={admin} meId={settings.jellyfin?.userId} onChanged={() => load()} />
              </View>
            ))}
          </View>
        )}
        {rows.length < total ? <Button title="Voir plus" variant="secondary" onPress={more} style={{ margin: 16, alignSelf: 'center' }} /> : null}
      </ScrollView>
    );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => <RequestCard r={item} admin={admin} meId={settings.jellyfin?.userId} onChanged={() => load()} />}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE }}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={() => load()} tintColor={C.text} />}
      onEndReached={more}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <View style={{ marginHorizontal: -16 }}>
          {header}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} style={{ marginBottom: 14 }}>
            {FILTERS.map((f) => (
              <SegChip
                key={f.id}
                label={f.id === 'pending' && pendingCount ? `${f.label} (${pendingCount})` : f.label}
                on={filter === f.id}
                onPress={() => {
                  tap();
                  setFilter(f.id);
                  load(f.id);
                }}
              />
            ))}
          </ScrollView>
          {!admin ? <Text style={[styles.meta, { marginHorizontal: 16, marginBottom: 8 }]}>Tes demandes</Text> : null}
          {error ? <Text style={[styles.meta, { color: C.danger, marginHorizontal: 16 }]}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={C.textDim} style={{ marginTop: 40 }} />
        ) : (
          <View style={{ alignItems: 'center', marginTop: 50, gap: 10 }}>
            <Ionicons name="paper-plane-outline" size={36} color={C.textFaint} />
            <Text style={styles.meta}>Aucune demande ici.</Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 56 },
  poster: { width: 44, height: 66, borderRadius: 8, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  meta: { color: C.textDim, fontSize: 12, lineHeight: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  bar: { height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 3 },
  barFill: { height: 2, backgroundColor: '#3D8BFF' },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  more: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
