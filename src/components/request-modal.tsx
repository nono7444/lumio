// Fenêtre « Demander » façon Seerr : choix des saisons, statut de chacune, quota, options avancées.
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { formatBytes } from '@/lib/arr';
import { suggestFolder } from '@/lib/grab';
import { MediaStatus, mediaStatusLabel, requestsApi, type ArrOptions, type MediaInfo, type Me } from '@/lib/requests';
import { secourApi, type SecourLink } from '@/lib/secour';
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
  // Profil de téléchargement : 1080p (normal) ou 4K H.265
  const [uhd, setUhd] = useState(false);
  // 4K (admin) : fichiers Wawacity proposés d'abord ; rien de choisi = C411
  const [wawa, setWawa] = useState<Record<string, SecourLink[] | null>>({});
  const [moviePick, setMoviePick] = useState<SecourLink | null>(null);
  const [tpl, setTpl] = useState<Record<number, SecourLink | null>>({});
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

  // Liste Wawacity en 4K : film, ou épisode 1 de chaque saison choisie (une version par saison)
  const is4k = (l: SecourLink) => /wawa/i.test(l.source) && /2160|4k|uhd/i.test(l.quality);
  const wawaKeys = !uhd || !me?.admin ? [] : isTv ? [...selected].sort((a, b) => a - b).map(String) : ['movie'];
  useEffect(() => {
    for (const k of wawaKeys) {
      if (k in wawa) continue;
      setWawa((o) => ({ ...o, [k]: null }));
      secourApi
        .links(settings, isTv ? { type: 'tv', tmdbId: target.tmdbId, season: Number(k), episode: 1 } : { type: 'movie', tmdbId: target.tmdbId })
        .then((r) => {
          const seen = new Set<string>();
          const list = r.links.filter(is4k).filter((l) => {
            const id = isTv ? `${l.quality}|${l.language}|${l.hoster}` : l.link;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          setWawa((o) => ({ ...o, [k]: list }));
        })
        .catch(() => setWawa((o) => ({ ...o, [k]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wawaKeys.join(',')]);

  const allOn = requestable.length > 0 && requestable.every((n) => selected.has(n));
  const quota = me ? (isTv ? me.quota.tv : me.quota.movie) : null;
  const overQuota = Boolean(quota && quota.remaining != null && (isTv && me?.quota.tv.unit !== 'series' ? selected.size > quota.remaining : quota.remaining < 1));
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
        uhd,
        ...(uhd && me?.admin && !isTv && moviePick ? { secourPick: moviePick } : {}),
        ...(uhd && me?.admin && isTv && Object.values(tpl).some(Boolean)
          ? { secourTemplates: Object.fromEntries(Object.entries(tpl).filter(([n, l]) => l && selected.has(Number(n))).map(([n, l]) => [n, { quality: l!.quality, language: l!.language, hoster: l!.hoster }])) }
          : {}),
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

  const folders = opts?.folders ?? [];
  const showFolders = folders.length > 1;
  const showProfiles = Boolean(me?.admin && !opts?.lockedProfile && (opts?.profiles.length ?? 0) > 1);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable focusRing={false} style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.grip} />
        {/* En-tête compact : affiche, titre, fermer */}
        <View style={styles.head}>
          {target.poster ? <Image source={target.poster} style={styles.poster} contentFit="cover" /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{isTv ? 'Série' : 'Film'}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {target.title}
              {target.year ? <Text style={styles.dim}> {target.year}</Text> : null}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
            <Ionicons name="close" size={18} color={C.text} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
          {/* Saisons : pastilles rondes */}
          {isTv && (
            <View>
              <View style={styles.rowBetween}>
                <Text style={styles.label}>Saisons</Text>
                {requestable.length ? (
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      tap();
                      setSelected(allOn ? new Set() : new Set(requestable));
                    }}>
                    <Text style={styles.link}>{allOn ? 'Aucune' : 'Toutes'}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.pills}>
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
                      style={[styles.season, on && styles.seasonOn, !can && { opacity: 0.55 }]}>
                      {!can ? <Ionicons name={st === MediaStatus.AVAILABLE ? 'checkmark' : 'time-outline'} size={11} color={lab?.color ?? C.textDim} /> : null}
                      <Text style={[styles.seasonTxt, on && { color: '#fff' }, !can && { color: lab?.color ?? C.textDim }]}>S{s.season_number}</Text>
                      <Text style={[styles.seasonSub, on && { color: 'rgba(255,255,255,0.8)' }]}>{s.episode_count}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Dossier : pastilles */}
          {showFolders ? (
            <View>
              <Text style={styles.label}>Dossier</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hpills}>
                {folders.map((f) => (
                  <Pressable
                    key={f.path}
                    onPress={() => {
                      tap();
                      setFolder(f.path);
                    }}
                    style={[styles.chip, folder === f.path && styles.chipOn]}>
                    <Text style={[styles.chipText, folder === f.path && { color: '#000' }]}>{folderName(f.path)}</Text>
                    {f.freeSpace ? <Text style={[styles.chipSub, folder === f.path && { color: '#555' }]}>{formatBytes(f.freeSpace)}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : !opts ? (
            <ActivityIndicator color={C.textDim} />
          ) : null}

          {/* Profil de téléchargement */}
          <View>
            <Text style={styles.label}>Profil</Text>
            <View style={styles.hpills}>
              {[
                { on: false, label: '1080p', sub: 'normal' },
                { on: true, label: '4K H.265', sub: 'plus lourd' },
              ].map((o) => (
                <Pressable
                  key={o.label}
                  onPress={() => {
                    tap();
                    setUhd(o.on);
                  }}
                  style={[styles.chip, uhd === o.on && styles.chipOn]}>
                  <Text style={[styles.chipText, uhd === o.on && { color: '#000' }]}>{o.label}</Text>
                  <Text style={[styles.chipSub, uhd === o.on && { color: '#555' }]}>{o.sub}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 4K (admin) : Wawacity d'abord, C411 si rien n'est choisi */}
          {wawaKeys.length ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.label}>Fichiers 4K Wawacity</Text>
              {wawaKeys.map((k) => {
                const list = wawa[k];
                const chosen = isTv ? tpl[Number(k)] ?? null : moviePick;
                const choose = (l: SecourLink | null) => {
                  tap();
                  if (isTv) setTpl((o) => ({ ...o, [Number(k)]: l }));
                  else setMoviePick(l);
                };
                return (
                  <View key={k} style={{ gap: 6 }}>
                    {isTv ? <Text style={styles.infoTxt}>Saison {k} · la version choisie sert pour tous ses épisodes</Text> : null}
                    {list == null ? (
                      <View style={styles.wawaRow}>
                        <ActivityIndicator color={C.textDim} />
                        <Text style={styles.wawaSub}>Recherche sur Wawacity…</Text>
                      </View>
                    ) : (
                      <>
                        <Pressable onPress={() => choose(null)} style={[styles.wawaRow, !chosen && styles.wawaOn]}>
                          <Text style={[styles.wawaTxt, !chosen && { color: '#000' }]}>{list.length ? 'Aucun : C411' : 'Rien en 4K sur Wawacity : C411'}</Text>
                        </Pressable>
                        {list.slice(0, 8).map((l) => {
                          const on = chosen != null && (isTv ? chosen.quality === l.quality && chosen.language === l.language && chosen.hoster === l.hoster : chosen.link === l.link);
                          return (
                            <Pressable key={`${l.link}`} onPress={() => choose(l)} style={[styles.wawaRow, on && styles.wawaOn]}>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.wawaTxt, on && { color: '#000' }]} numberOfLines={1}>
                                  {[l.quality, l.language].filter(Boolean).join(' · ')}
                                </Text>
                                <Text style={[styles.wawaSub, on && { color: '#444' }]} numberOfLines={1}>
                                  {[isTv ? null : l.size, l.hoster].filter(Boolean).join(' · ')}
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Qualité (admin) */}
          {showProfiles ? (
            <View>
              <Text style={styles.label}>Qualité</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hpills}>
                {opts!.profiles.map((p) => (
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
              </ScrollView>
            </View>
          ) : null}

          {/* Petites infos : qualité imposée, quota, validation */}
          <View style={styles.pills}>
            {opts?.lockedProfile ? (
              <View style={styles.info}>
                <Ionicons name="lock-closed" size={11} color={C.textDim} />
                <Text style={styles.infoTxt}>{opts.lockedProfile.name}</Text>
              </View>
            ) : null}
            {quota && quota.limit > 0 ? (
              <View style={[styles.info, overQuota && { borderColor: C.danger }]}>
                <Ionicons name="speedometer-outline" size={11} color={overQuota ? C.danger : C.textDim} />
                <Text style={[styles.infoTxt, overQuota && { color: C.danger }]}>
                  {quota.remaining}/{quota.limit} {isTv ? (me?.quota.tv.unit === 'series' ? 'séries' : 'saisons') : 'films'} · {quota.days} j
                </Text>
              </View>
            ) : null}
            {me && !me.permissions.autoApprove ? (
              <View style={styles.info}>
                <Ionicons name="hourglass-outline" size={11} color={C.warning} />
                <Text style={styles.infoTxt}>Validation par l’admin</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        <Pressable onPress={submit} disabled={!canSend} style={[styles.send, !canSend && { opacity: 0.45 }]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="paper-plane" size={16} color="#fff" />
              <Text style={styles.sendTxt}>{isTv ? (selected.size ? `Demander ${selected.size} saison${selected.size > 1 ? 's' : ''}` : 'Choisis une saison') : 'Demander'}</Text>
            </>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: 'rgba(22,22,24,0.72)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  poster: { width: 40, height: 60, borderRadius: 8, backgroundColor: C.surfaceHigh },
  kicker: { color: C.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2, marginTop: 1 },
  dim: { color: C.textDim, fontWeight: '500' },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: C.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  link: { color: C.accent, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hpills: { gap: 6 },
  season: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  seasonOn: { backgroundColor: C.accent, borderColor: C.accent },
  seasonTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  seasonSub: { color: C.textDim, fontSize: 11, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  wawaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)' },
  wawaOn: { backgroundColor: '#fff' },
  wawaTxt: { color: C.text, fontSize: 14, fontWeight: '700' },
  wawaSub: { color: C.textDim, fontSize: 12 },
  chipText: { color: C.text, fontSize: 13, fontWeight: '700' },
  chipSub: { color: C.textFaint, fontSize: 11 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  infoTxt: { color: C.textDim, fontSize: 11, fontWeight: '600' },
  send: {
    marginTop: 14,
    height: 46,
    borderRadius: 999,
    backgroundColor: C.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
