// Page « Demandes » façon Seerr : filtres, cartes avec affiche, demandeur, statuts, actions admin.
import { ArrWantedBlock, DiskDownloadsBlock } from '@/components/requests-extra';
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
  downloadLabel,
  mediaStatusLabel,
  RequestStatus,
  requestStatusLabel,
  requestsApi,
  timeAgo,
  type Req,
  type RequestFilter,
} from '@/lib/requests';
import { IS_BETA, secourAdminApi } from '@/lib/secour';
import { useSettings } from '@/lib/settings';

const FILTERS: { id: RequestFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'processing', label: 'En cours' },
  { id: 'available', label: 'Disponibles' },
  { id: 'declined', label: 'Refusées' },
  { id: 'failed', label: 'Échecs' },
];

const PAGE = 20;

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}26`, borderColor: `${color}66` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/** Saisons d'une demande : repliées sur une ligne (− / + pour les afficher toutes). */
function SeasonChips({ r }: { r: Req }) {
  const seasons = r.seasons ?? [];
  const [open, setOpen] = useState(seasons.length <= 4);
  const avail = seasons.filter((n) => r.seasonStatuses.find((x) => x.seasonNumber === n)?.status === 5).length;
  const toggle = (
    <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} style={styles.seasonToggle} accessibilityLabel={open ? 'Réduire' : 'Voir les saisons'}>
      <Ionicons name={open ? 'remove' : 'add'} size={14} color={C.text} />
    </Pressable>
  );
  if (!open)
    return (
      <View style={[styles.seasons, { alignItems: 'center' }]}>
        <Text style={styles.meta}>
          {seasons.length} saison{seasons.length > 1 ? 's' : ''} (S{Math.min(...seasons)}–S{Math.max(...seasons)}){avail ? ` · ${avail} dispo` : ''}
        </Text>
        {toggle}
      </View>
    );
  return (
    <View style={[styles.seasons, { alignItems: 'center' }]}>
      {seasons.map((n) => {
        const ss = r.seasonStatuses.find((x) => x.seasonNumber === n);
        const l = ss ? mediaStatusLabel(ss.status) : null;
        return (
          <View key={n} style={[styles.season, l && { borderColor: l.color }]}>
            <Text style={[styles.seasonText, l && { color: l.color }]}>S{n}</Text>
          </View>
        );
      })}
      {seasons.length > 4 ? toggle : null}
    </View>
  );
}

function RequestCard({ r, admin, meId, onChanged }: { r: Req; admin: boolean; meId?: string; onChanged: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const st = requestStatusLabel(r.status);
  const media = r.status === RequestStatus.APPROVED ? mediaStatusLabel(r.mediaStatus) : null;
  const mine = r.requestedBy.id === meId;

  async function act(kind: 'approve' | 'retry' | 'decline' | 'delete', reason?: string, arr?: 'keep' | 'files') {
    setBusy(kind);
    try {
      let msg: string | undefined;
      if (kind === 'approve') await requestsApi.approve(settings, r.id);
      else if (kind === 'retry') await requestsApi.retry(settings, r.id);
      else if (kind === 'decline') await requestsApi.decline(settings, r.id, reason);
      else msg = (await requestsApi.remove(settings, r.id, arr))?.message;
      toast(
        kind === 'approve' || kind === 'retry'
          ? `« ${r.title} » approuvé : téléchargement lancé.`
          : kind === 'decline'
            ? `Demande de ${r.requestedBy.name} refusée.`
            : (msg ?? 'Demande supprimée.')
      );
      onChanged();
    } catch (e: any) {
      Alert.alert('Action impossible', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  const decline = () =>
    Alert.prompt
      ? Alert.prompt('Refuser la demande', 'Raison (facultatif)', (reason) => act('decline', reason || undefined))
      : act('decline');

  // Demande déjà partie vers Radarr / Sonarr : l'admin choisit ce qu'il advient du film ou de la série
  const sent = r.status === RequestStatus.APPROVED || r.status === RequestStatus.COMPLETED || r.status === RequestStatus.FAILED;
  const app = r.type === 'movie' ? 'Radarr' : 'Sonarr';
  const remove = () =>
    admin && sent
      ? Alert.alert('Supprimer cette demande ?', `${r.title}${r.seasons?.length ? ` (saison${r.seasons.length > 1 ? 's' : ''} ${r.seasons.join(', ')})` : ''}`, [
          { text: `Arrêter et retirer de ${app} (garder les fichiers)`, onPress: () => act('delete', undefined, 'keep') },
          { text: 'Tout supprimer, fichiers compris', style: 'destructive', onPress: () => act('delete', undefined, 'files') },
          { text: 'Retirer de la liste seulement', onPress: () => act('delete') },
          { text: 'Annuler', style: 'cancel' },
        ])
      : Alert.alert(mine && !admin ? 'Annuler ta demande ?' : 'Supprimer cette demande ?', r.title, [
          { text: 'Non', style: 'cancel' },
          { text: 'Oui', style: 'destructive', onPress: () => act('delete') },
        ]);

  return (
    <Pressable onPress={() => openMedia(r.type, r.tmdbId)} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}>
      {r.backdrop ? <Image source={r.backdrop} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={2} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(18,18,20,0.86)' }]} />
      <View style={styles.cardBody}>
        <View style={styles.poster}>{r.poster ? <Image source={r.poster} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.kind}>
            {r.type === 'movie' ? 'Film' : 'Série'}
            {r.year ? ` · ${r.year}` : ''}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {r.title}
          </Text>
          {r.type === 'tv' && r.seasons?.length ? <SeasonChips r={r} /> : null}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={st.label} color={st.color} />
            {media ? <Badge label={media.label} color={media.color} /> : null}
          </View>
          <Text style={styles.meta}>
            Demandé par <Text style={styles.metaStrong}>{mine ? 'toi' : r.requestedBy.name}</Text> {timeAgo(r.createdAt)}
          </Text>
          {r.modifiedBy && r.modifiedBy.id !== r.requestedBy.id ? (
            <Text style={styles.meta}>
              {r.status === RequestStatus.DECLINED ? 'Refusé' : 'Validé'} par <Text style={styles.metaStrong}>{r.modifiedBy.name}</Text>
              {r.modifiedAt ? ` ${timeAgo(r.modifiedAt)}` : ''}
            </Text>
          ) : null}
          {downloadLabel(r) ? (
            <Text style={[styles.meta, { color: downloadLabel(r)!.color, fontWeight: '700' }]} numberOfLines={3}>
              {downloadLabel(r)!.text}
            </Text>
          ) : null}
          {r.reason ? <Text style={[styles.meta, { color: C.danger }]}>Raison : {r.reason}</Text> : null}
          {r.error ? <Text style={[styles.meta, { color: C.danger }]}>{r.error}</Text> : null}
        </View>
      </View>

      {/* Recherche en attente : relancer pour voir s'il y a enfin une version dispo ; « LS » (admin) : Lumio Secour prend le relais */}
      {(r.status === RequestStatus.APPROVED && (!r.download || ['searching', 'partial', 'warning'].includes(r.download.state)) && r.download?.via !== 'secour' && (admin || mine)) ||
      (IS_BETA && admin && r.status === RequestStatus.FAILED) ? (
        <View style={styles.actions}>
          {r.status === RequestStatus.APPROVED && r.download?.state !== 'warning' ? <RecheckButton r={r} onDone={onChanged} style={styles.actBtn} /> : null}
          {IS_BETA && admin ? <SecourRelayButton r={r} onDone={onChanged} /> : null}
        </View>
      ) : null}

      {/* Actions, comme sur Seerr */}
      {(admin || (mine && r.status === RequestStatus.PENDING)) && (
        <View style={styles.actions}>
          {admin && r.status === RequestStatus.PENDING ? (
            <>
              <Button title="Approuver" icon="checkmark" onPress={() => act('approve')} loading={busy === 'approve'} style={styles.actBtn} />
              <Button title="Refuser" icon="close" variant="danger" onPress={decline} loading={busy === 'decline'} style={styles.actBtn} />
            </>
          ) : null}
          {admin && r.status === RequestStatus.FAILED ? (
            <Button title="Réessayer" icon="refresh" onPress={() => act('retry')} loading={busy === 'retry'} style={styles.actBtn} />
          ) : null}
          {admin || r.status === RequestStatus.PENDING ? (
            <Button
              title={!admin ? 'Annuler' : ''}
              icon="trash-outline"
              variant="secondary"
              onPress={remove}
              loading={busy === 'delete'}
              style={admin ? { width: 48, paddingHorizontal: 0 } : styles.actBtn}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** « LS » sur une demande bloquée (admin) : Lumio Secour la télécharge à la place de Radarr / Sonarr. */
function SecourRelayButton({ r, onDone }: { r: Req; onDone: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const app = r.type === 'movie' ? 'Radarr' : 'Sonarr';
  const go = () =>
    Alert.alert('Lumio Secour', `Télécharger « ${r.title} » avec Lumio Secour à la place de ${app} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Télécharger',
        onPress: async () => {
          setBusy(true);
          try {
            await secourAdminApi.viaRequest(settings, r.id);
            toast(`« ${r.title} » part avec Lumio Secour`);
            onDone();
          } catch (e: any) {
            toast(e?.message ?? String(e), 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  return (
    <Pressable onPress={go} disabled={busy} style={styles.ls} accessibilityLabel="Télécharger avec Lumio Secour">
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.lsText}>LS</Text>}
    </Pressable>
  );
}

export function ServerRequests({ header }: { header: React.ReactNode }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const admin = settings.jellyfin?.isAdmin !== false;
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
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE, gap: 12 }}
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
          {/* Téléchargements sur les disques + en attente dans Radarr / Sonarr (repliables) */}
          <DiskDownloadsBlock />
          <ArrWantedBlock />
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
  ls: { width: 48, height: 40, borderRadius: 12, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
  lsText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  seasonToggle: { width: 24, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.surface },
  cardBody: { flexDirection: 'row', gap: 14, padding: 14 },
  poster: { width: 74, height: 111, borderRadius: 10, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  kind: { color: C.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: C.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  seasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  season: { borderWidth: 1, borderColor: C.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  seasonText: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  meta: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  metaStrong: { color: C.text, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  actBtn: { flex: 1, paddingVertical: 10 },
});
