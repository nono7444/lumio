// Fenêtre « Demander » façon Seerr : choix des saisons, statut de chacune, quota, options avancées.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { formatBytes } from '@/lib/arr';
import { suggestFolder } from '@/lib/grab';
import { MediaStatus, mediaStatusLabel, requestsApi, type ArrOptions, type MediaInfo, type Me } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

export type RequestTarget = {
  type: 'movie' | 'tv';
  tmdbId: number;
  tvdbId?: number | null;
  title: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  seasons: { season_number: number; name?: string; episode_count: number }[];
  flavor: 'anime' | 'kids' | null;
};

const folderName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export function RequestModal({
  visible,
  target,
  media,
  onClose,
  onDone,
}: {
  visible: boolean;
  target: RequestTarget;
  media: MediaInfo | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<Me | null>(null);
  const [opts, setOpts] = useState<ArrOptions | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [folder, setFolder] = useState<string | null>(null);
  const [profile, setProfile] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  const isTv = target.type === 'tv';
  const seasons = useMemo(() => target.seasons.filter((s) => s.season_number > 0), [target.seasons]);
  const statusOf = (n: number) => media?.seasons.find((s) => s.seasonNumber === n)?.status ?? MediaStatus.UNKNOWN;
  const requestable = seasons.filter((s) => statusOf(s.season_number) === MediaStatus.UNKNOWN).map((s) => s.season_number);

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set(isTv ? requestable : []));
    requestsApi.me(settings).then(setMe).catch(() => {});
    requestsApi
      .options(settings, target.type)
      .then((o) => {
        setOpts(o);
        setFolder(suggestFolder(o.folders, target.flavor, o.default));
        setProfile(o.defaultProfile);
      })
      .catch(() => setOpts(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const allOn = requestable.length > 0 && requestable.every((n) => selected.has(n));
  const quota = me ? (isTv ? me.quota.tv : me.quota.movie) : null;
  const overQuota = Boolean(quota && quota.remaining != null && (isTv ? selected.size > quota.remaining : quota.remaining < 1));
  const canSend = !busy && !overQuota && (!isTv || selected.size > 0);

  async function submit() {
    setBusy(true);
    try {
      const r = await requestsApi.create(settings, {
        type: target.type,
        tmdbId: target.tmdbId,
        tvdbId: target.tvdbId ?? undefined,
        seasons: isTv ? [...selected].sort((a, b) => a - b) : undefined,
        title: target.title,
        year: target.year,
        poster: target.poster,
        backdrop: target.backdrop,
        rootFolderPath: folder ?? undefined,
        qualityProfileId: me?.admin && profile ? profile : undefined,
      });
      const what = isTv ? (r.seasons && r.seasons.length > 1 ? `${r.seasons.length} saisons` : `la saison ${r.seasons?.[0]}`) : 'le film';
      onDone(
        r.status === 1
          ? `Demande envoyée pour ${what}. Elle attend la validation de l’admin.`
          : r.status === 4
            ? `Demande enregistrée, mais l’envoi a échoué : ${r.error ?? 'erreur'}`
            : `Demande approuvée : ${what} part en téléchargement.`
      );
    } catch (e: any) {
      Alert.alert('Demande impossible', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable focusRing={false} style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          {target.poster ? <Image source={target.poster} style={styles.poster} contentFit="cover" /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{isTv ? 'Demander la série' : 'Demander le film'}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {target.title}
              {target.year ? <Text style={styles.dim}> ({target.year})</Text> : null}
            </Text>
          </View>
        </View>

        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
          {/* Saisons */}
          {isTv && (
            <View style={styles.table}>
              <Pressable
                disabled={!requestable.length}
                onPress={() => {
                  tap();
                  setSelected(allOn ? new Set() : new Set(requestable));
                }}
                style={[styles.seasonRow, styles.tableHead]}>
                <Switch
                  value={allOn}
                  disabled={!requestable.length}
                  onValueChange={(v) => setSelected(v ? new Set(requestable) : new Set())}
                  trackColor={{ true: C.accent, false: C.border }}
                />
                <Text style={[styles.cell, { flex: 1, fontWeight: '800' }]}>Toutes les saisons</Text>
                <Text style={[styles.cellDim, { textAlign: 'right' }]}>{selected.size ? `${selected.size} choisie${selected.size > 1 ? 's' : ''}` : ''}</Text>
              </Pressable>
              {/* Saisons en grille compacte : toutes visibles d'un coup */}
              <View style={styles.grid}>
                {seasons.map((s) => {
                  const st = statusOf(s.season_number);
                  const can = st === MediaStatus.UNKNOWN;
                  const lab = mediaStatusLabel(st);
                  const on = can && selected.has(s.season_number);
                  return (
                    <Pressable
                      key={s.season_number}
                      disabled={!can}
                      onPress={() => {
                        tap();
                        const next = new Set(selected);
                        if (next.has(s.season_number)) next.delete(s.season_number);
                        else next.add(s.season_number);
                        setSelected(next);
                      }}
                      style={[
                        styles.tile,
                        on && { backgroundColor: C.accent, borderColor: C.accent },
                        !can && { borderColor: lab?.color ?? C.border, opacity: 0.75 },
                      ]}>
                      <Text style={[styles.tileTitle, on && { color: '#fff' }, !can && { color: lab?.color ?? C.textDim }]}>
                        S{s.season_number}
                      </Text>
                      <Text style={[styles.tileSub, on && { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>
                        {!can && lab ? lab.label : `${s.episode_count} ép.`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Quota (comme Seerr) */}
          {quota && quota.limit > 0 ? (
            <View style={[styles.note, overQuota && { borderColor: C.danger }]}>
              <Ionicons name="speedometer-outline" size={18} color={overQuota ? C.danger : C.textDim} />
              <Text style={[styles.noteText, overQuota && { color: C.danger }]}>
                {isTv
                  ? `Il te reste ${quota.remaining} saison(s) sur ${quota.limit} tous les ${quota.days} jours.`
                  : `Il te reste ${quota.remaining} film(s) sur ${quota.limit} tous les ${quota.days} jours.`}
              </Text>
            </View>
          ) : null}

          {me && !me.permissions.autoApprove ? (
            <View style={styles.note}>
              <Ionicons name="hourglass-outline" size={18} color={C.warning} />
              <Text style={styles.noteText}>Ta demande devra être validée par l’admin avant le téléchargement.</Text>
            </View>
          ) : null}

          {/* Options avancées : dossier (tout le monde), profil de qualité (admin) */}
          {opts && (opts.folders.length > 1 || (me?.admin && opts.profiles.length > 1)) ? (
            <View>
              <Pressable
                onPress={() => {
                  tap();
                  setAdvanced((a) => !a);
                }}
                style={styles.advHead}>
                <Ionicons name="options-outline" size={18} color={C.textDim} />
                <Text style={[styles.cell, { flex: 1 }]}>
                  Options{folder ? ` · ${folderName(folder)}` : ''}
                  {opts.lockedProfile ? ` · ${opts.lockedProfile.name}` : me?.admin && profile ? ` · ${opts.profiles.find((p) => p.id === profile)?.name ?? ''}` : ''}
                </Text>
                <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={C.textDim} />
              </Pressable>
              {advanced && (
                <View style={{ gap: 10, marginTop: 10 }}>
                  <Text style={styles.label}>Dossier</Text>
                  <View style={styles.chips}>
                    {opts.folders.map((f) => (
                      <Pressable
                        key={f.path}
                        onPress={() => {
                          tap();
                          setFolder(f.path);
                        }}
                        style={[styles.chip, folder === f.path && styles.chipOn]}>
                        <Text style={[styles.chipText, folder === f.path && { color: '#000' }]}>{folderName(f.path)}</Text>
                        {f.freeSpace ? (
                          <Text style={[styles.chipSub, folder === f.path && { color: '#333' }]}>{formatBytes(f.freeSpace)} libres</Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                  {opts.lockedProfile ? (
                    <>
                      <Text style={styles.label}>Profil de qualité</Text>
                      <View style={styles.chips}>
                        <View style={[styles.chip, styles.chipOn]}>
                          <Text style={[styles.chipText, { color: '#000' }]}>🔒 {opts.lockedProfile.name}</Text>
                        </View>
                      </View>
                    </>
                  ) : me?.admin && opts.profiles.length > 1 ? (
                    <>
                      <Text style={styles.label}>Profil de qualité</Text>
                      <View style={styles.chips}>
                        {opts.profiles.map((p) => (
                          <Pressable
                            key={p.id}
                            onPress={() => {
                              tap();
                              setProfile(p.id);
                            }}
                            style={[styles.chip, profile === p.id && styles.chipOn]}>
                            <Text style={[styles.chipText, profile === p.id && { color: '#000' }]}>{p.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          ) : !opts ? (
            <ActivityIndicator color={C.textDim} />
          ) : null}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Button title="Annuler" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title={isTv ? (selected.size ? `Demander (${selected.size})` : 'Demander') : 'Demander'}
            icon="paper-plane"
            onPress={submit}
            loading={busy}
            disabled={!canSend}
            style={{ flex: 1.4 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#161618', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 14 },
  head: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 16 },
  poster: { width: 56, height: 84, borderRadius: 8, backgroundColor: C.surfaceHigh },
  kicker: { color: C.accent, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: C.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  dim: { color: C.textDim, fontWeight: '500' },
  table: { backgroundColor: C.surfaceHigh, borderRadius: R.lg, overflow: 'hidden' },
  tableHead: { backgroundColor: 'rgba(255,255,255,0.05)' },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  cell: { color: C.text, fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 },
  tile: {
    width: '23.5%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tileTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  tileSub: { color: C.textDim, fontSize: 10, marginTop: 1 },
  cellDim: { color: C.textDim, fontSize: 12, marginTop: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  noteText: { color: C.textDim, fontSize: 13, flex: 1, lineHeight: 18 },
  advHead: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 12 },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { backgroundColor: C.text },
  chipText: { color: C.text, fontSize: 14, fontWeight: '700' },
  chipSub: { color: C.textFaint, fontSize: 11, marginTop: 1 },
});
