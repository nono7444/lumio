// Bloc « demande » de la fiche, comme sur Seerr : statut du média, demandes en cours, boutons.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, Platform } from 'react-native';

import { TvPill } from '@/components/tv-actions';
import { RequestModal, type RequestTarget } from '@/components/request-modal';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  MediaStatus,
  mediaStatusLabel,
  RequestStatus,
  requestStatusLabel,
  requestsApi,
  partialText,
  timeAgo,
  type MediaInfo,
  type Req,
} from '@/lib/requests';
import { RecheckButton } from '@/components/recheck-button';
import { useSettings } from '@/lib/settings';

export function RequestSection({
  target,
  onChange,
  inJellyfin,
  onAvailable,
  onMedia,
  reloadKey,
}: {
  target: RequestTarget;
  onChange?: () => void;
  /** Appelé tant que le titre est prêt mais pas encore visible dans Jellyfin (la fiche le recherche pour afficher « Lire ») */
  onAvailable?: () => void;
  /** Film déjà présent dans Jellyfin (même s'il n'est pas géré par Radarr) : pas de demande possible */
  inJellyfin?: boolean;
  /** Statut du média (et de chaque saison), partagé avec la liste des saisons de la fiche */
  onMedia?: (m: MediaInfo) => void;
  /** Change quand la fiche a envoyé une demande (bouton « Demander » d'une saison) : on recharge */
  reloadKey?: number;
}) {
  const { settings } = useSettings();
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = settings.jellyfin?.isAdmin !== false;
  const me = settings.jellyfin?.userId;

  const load = useCallback(() => {
    const seasons = target.seasons.filter((s) => s.season_number > 0).map((s) => s.season_number);
    requestsApi
      .media(settings, target.type, target.tmdbId, target.tvdbId, seasons)
      .then((m) => {
        setMedia(m);
        onMedia?.(m);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, target.type, target.tmdbId, target.tvdbId]);

  useEffect(load, [load, reloadKey]);

  const movieInJf = inJellyfin && target.type === 'movie';
  const status = movieInJf ? MediaStatus.AVAILABLE : (media?.status ?? MediaStatus.UNKNOWN);
  const lab = mediaStatusLabel(status);
  const isTv = target.type === 'tv';
  const unknownSeasons = isTv ? (media?.seasons ?? []).filter((s) => s.status === MediaStatus.UNKNOWN).length : 0;
  const canRequest = media && !movieInJf
    ? isTv
      ? unknownSeasons > 0
      : status === MediaStatus.UNKNOWN
    : false;
  const pendingReqs = (media?.requests ?? []).filter((r) => r.status === RequestStatus.PENDING || r.status === RequestStatus.FAILED);
  // Demande validée en cours : le bouton devient la barre de téléchargement
  const active = (media?.requests ?? []).find((r) => r.status === RequestStatus.APPROVED);
  // Film prêt dans Radarr mais pas encore vu par Jellyfin (scan de la bibliothèque)
  const arriving = !isTv && !inJellyfin && status === MediaStatus.AVAILABLE;

  // Suivi en direct : toutes les 3 s pendant le téléchargement, puis jusqu'à l'arrivée dans Jellyfin
  useEffect(() => {
    if (!active && !arriving) return;
    const t = setInterval(() => {
      load();
      if (arriving) onAvailable?.();
    }, arriving ? 8000 : 3000);
    if (arriving) onAvailable?.();
    return () => clearInterval(t);
  }, [active?.id, arriving, load, onAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une demande vient de se terminer : on prévient la fiche pour qu'elle cherche le titre dans Jellyfin
  const [hadActive, setHadActive] = useState(false);
  useEffect(() => {
    if (active) setHadActive(true);
    else if (hadActive) {
      setHadActive(false);
      onAvailable?.();
      onChange?.();
    }
  }, [active, hadActive, onAvailable, onChange]);

  async function act(r: Req, kind: 'approve' | 'decline' | 'cancel' | 'retry') {
    setBusy(`${kind}:${r.id}`);
    try {
      if (kind === 'approve') await requestsApi.approve(settings, r.id);
      else if (kind === 'retry') await requestsApi.retry(settings, r.id);
      else if (kind === 'cancel') await requestsApi.remove(settings, r.id);
      else await requestsApi.decline(settings, r.id);
      toast(kind === 'approve' || kind === 'retry' ? 'Demande approuvée : téléchargement lancé.' : kind === 'cancel' ? 'Demande annulée.' : 'Demande refusée.');
      load();
      onChange?.();
    } catch (e: any) {
      Alert.alert('Action impossible', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  function decline(r: Req) {
    if (Alert.prompt)
      Alert.prompt('Refuser la demande', 'Raison (facultatif)', async (reason) => {
        setBusy(`decline:${r.id}`);
        try {
          await requestsApi.decline(settings, r.id, reason || undefined);
          toast('Demande refusée.');
          load();
        } catch (e: any) {
          Alert.alert('Action impossible', e?.message ?? String(e));
        } finally {
          setBusy(null);
        }
      });
    else act(r, 'decline');
  }

  if (error)
    return (
      <View style={styles.notice}>
        <Ionicons name="warning-outline" size={18} color={C.danger} />
        <Text style={[styles.text, { flex: 1 }]}>Serveur Lumio : {error}</Text>
      </View>
    );

  return (
    <View style={{ gap: 10 }}>
      {lab && isTv && !active ? (
        <View style={[styles.status, { borderColor: lab.color }]}>
          <Ionicons name={lab.icon as keyof typeof Ionicons.glyphMap} size={18} color={lab.color} />
          <Text style={[styles.statusText, { color: lab.color }]}>{lab.label}</Text>
        </View>
      ) : null}

      {/* Le bouton « Demander » devient la progression du téléchargement, puis « Lire » (sur la fiche) */}
      {active ? <ProgressButton r={active} /> : null}
      {active && (!active.download || active.download.state === 'searching' || active.download.state === 'partial') && (admin || active.requestedBy.id === me) ? (
        <RecheckButton r={active} onDone={load} />
      ) : null}
      {arriving ? <ProgressButton label="Arrivée dans Jellyfin…" progress={100} color={C.success} spinner /> : null}

      {/* Demandes en attente (ou en échec) : l'admin valide ici, le demandeur peut annuler */}
      {pendingReqs.map((r) => {
        const st = requestStatusLabel(r.status);
        const mine = r.requestedBy.id === me;
        return (
          <View key={r.id} style={styles.req}>
            <Text style={styles.text}>
              <Text style={{ color: st.color, fontWeight: '800' }}>{st.label}</Text> · demandé par {mine ? 'toi' : r.requestedBy.name}{' '}
              {timeAgo(r.createdAt)}
              {r.seasons?.length ? ` · saison${r.seasons.length > 1 ? 's' : ''} ${r.seasons.join(', ')}` : ''}
            </Text>
            {r.error ? <Text style={[styles.text, { color: C.danger }]}>{r.error}</Text> : null}
            {admin ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title={r.status === RequestStatus.FAILED ? 'Réessayer' : 'Approuver'}
                  icon="checkmark"
                  onPress={() => act(r, r.status === RequestStatus.FAILED ? 'retry' : 'approve')}
                  loading={busy === `approve:${r.id}` || busy === `retry:${r.id}`}
                  style={{ flex: 1 }}
                />
                {r.status === RequestStatus.PENDING ? (
                  <Button title="Refuser" icon="close" variant="danger" onPress={() => decline(r)} loading={busy === `decline:${r.id}`} style={{ flex: 1 }} />
                ) : null}
              </View>
            ) : mine && r.status === RequestStatus.PENDING ? (
              <Button title="Annuler ma demande" icon="trash-outline" variant="secondary" onPress={() => act(r, 'cancel')} loading={busy === `cancel:${r.id}`} />
            ) : null}
          </View>
        );
      })}

      {canRequest && !active && Platform.isTV ? (
        // TV, façon Nuvio : bouton ovale
        <TvPill
          hasTVPreferredFocus
          icon="paper-plane-outline"
          label={isTv && status !== MediaStatus.UNKNOWN ? 'Autres saisons' : 'Demander'}
          onPress={() => setOpen(true)}
        />
      ) : canRequest && !active ? (
        <Button
          title={isTv && status !== MediaStatus.UNKNOWN ? 'Demander d’autres saisons' : 'Demander'}
          icon="paper-plane-outline"
          variant={status === MediaStatus.UNKNOWN ? 'primary' : 'glass'}
          onPress={() => setOpen(true)}
        />
      ) : null}

      <RequestModal
        visible={open}
        target={target}
        media={media}
        onClose={() => setOpen(false)}
        onDone={(msg) => {
          setOpen(false);
          toast(msg);
          load();
          onChange?.();
        }}
      />
    </View>
  );
}

/** Bouton-barre de progression : recherche, téléchargement %, import, problème. */
function ProgressButton({ r, label, progress, color, spinner }: { r?: Req; label?: string; progress?: number; color?: string; spinner?: boolean }) {
  const d = r?.download;
  const app = r?.type === 'movie' ? 'Radarr' : 'Sonarr';
  let text = label ?? 'Recherche d’une source…';
  let pct = progress ?? 0;
  let tint = color ?? C.accent;
  let spin = spinner ?? true;
  let icon: keyof typeof Ionicons.glyphMap | null = null;
  let note: string | null = null;
  if (r && d) {
    if (d.state === 'downloading') {
      pct = d.progress ?? 0;
      text = `Téléchargement ${d.progress != null ? `${d.progress} %` : '…'}`;
      if (d.count && d.count > 1) note = `${d.count} épisodes en cours`;
      spin = false;
      icon = 'arrow-down-circle';
    } else if (d.state === 'importing') {
      pct = 100;
      text = 'Ajout au serveur…';
      tint = C.success;
    } else if (d.state === 'partial') {
      // Une partie des saisons est là, le reste n'est disponible nulle part pour l'instant
      pct = d.total ? Math.round((((d.available ?? 0) + (d.partial ?? 0) * 0.5) / d.total) * 100) : 50;
      text = `Partiel · ${partialText(d)}`;
      tint = C.warning;
      spin = false;
      icon = 'contrast';
      note = `Le reste n'est pas encore disponible : ${app} continue de chercher.`;
    } else if (d.state === 'warning') {
      pct = d.progress ?? 100;
      text = 'Bloqué : à vérifier';
      tint = C.warning;
      spin = false;
      icon = 'warning';
      note = `${app} : ${d.message ?? 'intervention manuelle nécessaire'}`;
    }
  } else if (r) {
    note = `${app} cherche une version à télécharger`;
  }
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.progress}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: tint }]} />
        <View style={styles.progressContent}>
          {spin ? <ActivityIndicator size="small" color="#fff" /> : icon ? <Ionicons name={icon} size={19} color="#fff" /> : null}
          <Text style={styles.progressText}>{text}</Text>
        </View>
      </View>
      {note ? <Text style={[styles.text, { textAlign: 'center' }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { height: 50, borderRadius: R.md, backgroundColor: C.surfaceHigh, overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.85 },
  progressContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  progressText: { color: '#fff', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: R.md,
    paddingVertical: 10,
  },
  statusText: { fontSize: 15, fontWeight: '800' },
  req: { backgroundColor: C.surface, borderRadius: R.md, padding: 12, gap: 10 },
  text: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: R.md, padding: 14 },
});
