// Onglet admin « Auto » (bêta) : Lumio Auto remplace Radarr / Sonarr. On y suit chaque demande (historique,
// recherches site par site, raisons des refus), on choisit une version à la main (recherche interactive),
// et on règle les indexeurs (C411…), le téléchargement et le profil de qualité.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Picker, Toggle } from '@/components/arr-section';
import { toast } from '@/components/toast';
import { Button, Field, ScreenTitle, Section, SectionCollapse, SegChip } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { autoApi, gb, type AutoSeed, type QbitPrefs, type QbitTorrent, type AutoEvent, type AutoGrab, type AutoIndexer, type AutoItem, type AutoMissingSeason, type AutoRatio, type AutoRatioSite, type AutoBoost, type AutoBoostCandidate, type AutoSeedView, type AutoMissingSeries, type AutoRelease, type AutoState, type AutoWant } from '@/lib/auto';
import { useSettings } from '@/lib/settings';
import { IS_AUTO } from '@/lib/variant';
import { ServerRequests } from '@/components/server-requests';
import { ServerActionsSection } from '@/components/server-actions';
import { StorageSection } from '@/components/storage-section';
import { UptimeSection } from '@/components/uptime';
import { serverCall } from '@/lib/chat';
import { jf, jfPoster, type JfItem, type JfSession } from '@/lib/jellyfin';
import { filesApi, type Disk } from '@/lib/files';
import { SessionsBody } from '@/app/sessions';
import { useFocusEffect } from 'expo-router';

type Tab = 'demandes' | 'manquants' | 'telechargements' | 'qbit' | 'ratio';
const CLIENT_LABEL: Record<string, string> = { rdt: 'rdt-client', qbit: 'qBittorrent', alldebrid: 'AllDebrid', movix: 'Movix (AllDebrid)' };
const RUNNING: AutoGrab['state'][] = ['sent', 'downloading', 'importing'];
const STATE_LABEL: Record<AutoGrab['state'], string> = { sent: 'envoyé', downloading: 'téléchargement', importing: 'rangement', done: 'terminé', failed: 'échec' };
const STATE_COLOR: Record<AutoGrab['state'], string> = { sent: C.warning, downloading: C.accent, importing: C.accent, done: C.success, failed: C.danger };
const EVENT_ICON: Record<AutoEvent['type'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  added: { icon: 'add-circle', color: C.textDim },
  found: { icon: 'search', color: C.success },
  none: { icon: 'search', color: C.warning },
  sent: { icon: 'cloud-download', color: C.accent },
  imported: { icon: 'checkmark-circle', color: C.success },
  failed: { icon: 'alert-circle', color: C.danger },
};
const LANGS = [
  { value: 'multi', label: 'MULTI' },
  { value: 'vff', label: 'VFF' },
  { value: 'truefrench', label: 'TRUEFRENCH' },
  { value: 'vf2', label: 'VF2' },
  { value: 'french', label: 'FRENCH' },
  { value: 'vfq', label: 'VFQ' },
];
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const inMin = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  return m <= 0 ? 'bientôt' : m < 60 ? `dans ${m} min` : `dans ${Math.round(m / 60)} h`;
};
const lastPart = (p?: string | null) => (p ? p.replace(/\/+$/, '').split('/').pop() : '—');
const wantLabel = (w: AutoWant) => (w.kind === 'movie' ? 'Film' : w.kind === 'season' ? `Saison ${w.season}` : `S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}`);

/** État d'un titre en une pastille : à choisir, recherche, téléchargement, pas sorti… */
function itemStatus(i: AutoItem, grabs: AutoGrab[]): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  const g = grabs.find((x) => x.itemId === i.id && ['sent', 'downloading', 'importing'].includes(x.state));
  if (i.paused) return { label: 'En pause', color: C.textDim, icon: 'pause' };
  if (i.searching) return { label: `Recherche ${i.searching}`, color: C.accent, icon: 'search' };
  if (g) return { label: g.state === 'downloading' ? `Téléchargement ${g.progress}%` : STATE_LABEL[g.state], color: C.accent, icon: 'cloud-download' };
  if (i.needsChoice) return { label: 'À choisir', color: C.warning, icon: 'hand-left' };
  if (i.type === 'movie' && i.available === false) return { label: 'Pas encore sorti', color: C.textDim, icon: 'calendar' };
  if (i.note === 'rien ne manque') return { label: 'Complet', color: C.success, icon: 'checkmark-circle' };
  return { label: 'En attente', color: C.textDim, icon: 'time' };
}

/** État de Lumio Auto, rechargé toutes les 4 s (onglet Auto et Profil → Lumio Auto). */
function useAutoState() {
  const { settings } = useSettings();
  const [st, setSt] = useState<AutoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    autoApi
      .state(settings)
      .then((s) => {
        setSt(s);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  const save = async (b: Parameters<typeof autoApi.save>[1], msg?: string) => {
    try {
      await autoApi.save(settings, b);
      if (msg) toast(msg);
      load();
    } catch (e: any) {
      Alert.alert('Lumio Auto', e?.message ?? String(e));
    }
  };
  return { st, error, load, save };
}

function Loading({ error }: { error: string | null }) {
  return (
    <View style={styles.center}>
      {error ? (
        <Text style={styles.dim}>{/404|inconnue/.test(error) ? 'Le serveur Lumio doit être mis à jour : Profil → Serveur → Mettre à jour.' : error}</Text>
      ) : (
        <ActivityIndicator color="#fff" />
      )}
    </View>
  );
}

// Toutes les rubriques (Section) de Lumio Auto se replient d'un appui
const COLLAPSE = { enabled: true, all: null, version: 0 };

/** Bloc repliable avec un compteur (Titres, File d'attente, En partage, Historique…) ; l'état est gardé pendant la session. */
const folds = new Map<string, boolean>();
function Fold({ id, title, count, color, right, defaultOpen = true, children }: { id: string; title: string; count?: number; color?: string; right?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => folds.get(id) ?? defaultOpen);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() =>
          setOpen((o) => {
            folds.set(id, !o);
            return !o;
          })
        }
        style={styles.foldHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={C.textDim} />
        <Text style={[styles.foldTitle, color ? { color } : null]} numberOfLines={1}>
          {title}
        </Text>
        {count != null ? (
          <View style={[styles.foldCount, color ? { backgroundColor: color } : null]}>
            <Text style={[styles.foldCountTxt, color ? { color: '#000' } : null]}>{count}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {right}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export default function AutoTab() {
  const insets = useSafeAreaInsets();
  // Le tableau de bord peut ouvrir directement une rubrique (?tab=ratio…)
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>('demandes');
  useEffect(() => {
    if (params.tab && ['demandes', 'manquants', 'telechargements', 'qbit', 'ratio'].includes(params.tab)) setTab(params.tab as Tab);
  }, [params.tab]);
  const { st, error, load, save } = useAutoState();
  const [itemOpen, setItemOpen] = useState<string | null>(null);

  const open = st?.items.find((i) => i.id === itemOpen) ?? null;
  const toChoose = st?.items.filter((i) => i.needsChoice).length ?? 0;
  const running = st?.grabs.filter((g) => RUNNING.includes(g.state)).length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle
        title={IS_AUTO ? 'Torrents' : 'Auto'}
        right={
          <Pressable onPress={() => router.push('/lumio-auto')} hitSlop={8} style={styles.pill} accessibilityLabel="Sites et réglages de Lumio Auto">
            <Ionicons name="settings-outline" size={15} color={C.text} />
            <Text style={styles.pillTxt}>Réglages</Text>
          </Pressable>
        }
      />
      {/* Trois rubriques : Titres, Transferts, qBit (sites et réglages : Profil → Lumio Auto) */}
      <View style={styles.seg}>
        {(
          [
            { id: 'demandes', label: 'Titres', icon: 'film-outline', badge: toChoose, badgeColor: C.warning },
            { id: 'manquants', label: 'Manquants', icon: 'albums-outline', badge: 0, badgeColor: C.accent },
            { id: 'telechargements', label: 'Transferts', icon: 'swap-vertical', badge: running, badgeColor: C.accent },
            { id: 'qbit', label: 'qBit', icon: 'magnet-outline', badge: 0, badgeColor: C.accent },
            { id: 'ratio', label: 'Ratio', icon: 'speedometer-outline', badge: 0, badgeColor: C.accent },
          ] as { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; badge: number; badgeColor: string }[]
        ).map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.segItem, tab === t.id && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Ionicons name={t.icon} size={16} color={tab === t.id ? '#000' : C.textDim} />
            <Text style={[styles.segTxt, tab === t.id && { color: '#000' }]} numberOfLines={1}>
              {t.label}
            </Text>
            {t.badge ? (
              <View style={[styles.segBadge, { backgroundColor: t.badgeColor }]}>
                <Text style={styles.segBadgeTxt}>{t.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      {!st ? (
        <Loading error={error} />
      ) : (
        <SectionCollapse.Provider value={COLLAPSE}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: TAB_SPACE + insets.bottom + 20 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
            <Pressable onPress={() => router.push('/lumio-auto')} style={styles.stateLine} accessibilityLabel="État de Lumio Auto et d’AllDebrid, ouvrir les réglages">
              <View style={[styles.stateDot, { backgroundColor: st.enabled ? C.success : C.textDim }]} />
              <Text style={styles.small}>Lumio Auto {st.enabled ? 'actif' : 'en pause'}</Text>
              <View style={[styles.stateDot, { backgroundColor: st.debridOnly ? C.accent : C.textDim, marginLeft: 10 }]} />
              <Text style={styles.small}>AllDebrid {st.debridOnly ? 'actif' : 'éteint'}</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="chevron-forward" size={14} color={C.textDim} />
            </Pressable>
            {tab === 'demandes' ? <Demandes st={st} onItem={(i) => setItemOpen(i.id)} /> : null}
            {tab === 'manquants' ? <Manquants /> : null}
            {tab === 'telechargements' ? <Telechargements st={st} reload={load} onItem={(id) => setItemOpen(id)} /> : null}
            {tab === 'qbit' ? <QbitTab /> : null}
            {tab === 'ratio' ? <RatioTab /> : null}
          </ScrollView>
        </SectionCollapse.Provider>
      )}
      {open && st ? <ItemSheet item={open} st={st} onClose={() => setItemOpen(null)} reload={load} /> : null}
    </View>
  );
}

/** Profil → Lumio Auto : sites (indexeurs) et réglages. */
export function AutoSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { st, error, load, save } = useAutoState();
  const [part, setPart] = useState<'sites' | 'reglages'>('sites');
  const [editIx, setEditIx] = useState<(Partial<AutoIndexer> & { key?: string }) | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Lumio Auto" onBack={() => router.back()} />
      <View style={[styles.seg, { marginBottom: 4 }]}>
        {(
          [
            { id: 'sites', label: 'Sites', icon: 'globe-outline' },
            { id: 'reglages', label: 'Réglages', icon: 'options-outline' },
          ] as const
        ).map((t) => (
          <Pressable key={t.id} onPress={() => setPart(t.id)} style={[styles.segItem, part === t.id && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: part === t.id }}>
            <Ionicons name={t.icon} size={16} color={part === t.id ? '#000' : C.textDim} />
            <Text style={[styles.segTxt, part === t.id && { color: '#000' }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {!st ? (
        <Loading error={error} />
      ) : (
        <SectionCollapse.Provider value={COLLAPSE}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
            <Switches st={st} save={save} running={st.grabs.filter((g) => RUNNING.includes(g.state)).length} toChoose={st.items.filter((i) => i.needsChoice).length} />
            {part === 'sites' ? <Indexeurs st={st} reload={load} onEdit={setEditIx} /> : <Reglages st={st} save={save} />}
          </ScrollView>
        </SectionCollapse.Provider>
      )}
      {editIx ? <IndexerEditor ix={editIx} onClose={() => setEditIx(null)} onSaved={load} /> : null}
    </View>
  );
}

/** Les deux interrupteurs : Lumio Auto et AllDebrid, avec un résumé d'une ligne. */
export function Switches({ st, save, running, toChoose }: { st: AutoState; save: (b: any, msg?: string) => void; running: number; toChoose: number }) {
  const seeding = st.grabs.filter((g) => g.seeding).length;
  return (
    <View style={[styles.banner, { borderColor: st.enabled ? 'rgba(48,209,88,0.5)' : C.border, flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
      <View style={styles.switchRow}>
        <Ionicons name="flash" size={20} color={st.enabled ? C.success : C.textDim} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Lumio Auto</Text>
          <Text style={styles.small}>{st.enabled ? 'Cherche et télécharge les demandes tout seul' : 'En pause : les nouvelles demandes attendent'}</Text>
        </View>
        <Switch
          value={st.enabled}
          onValueChange={(v) => {
            if (v && !st.indexers.length)
              return Alert.alert('Lumio Auto', 'Ajoute d’abord un site : Réglages → Sites.', [
                { text: 'Plus tard', style: 'cancel' },
                { text: 'Ouvrir', onPress: () => router.push('/lumio-auto') },
              ]);
            save({ enabled: v }, v ? 'Lumio Auto activé' : 'Lumio Auto en pause');
          }}
          trackColor={{ true: C.success, false: C.border }}
        />
      </View>
      <View style={styles.switchRow}>
        <Ionicons name="cloud-download" size={20} color={st.debridOnly ? C.accent : C.textDim} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>AllDebrid</Text>
          <Text style={styles.small}>{st.debridOnly ? 'Seulement les versions déjà en cache AllDebrid : instantané, ratio intact' : 'Éteint : torrents par qBittorrent (derrière le VPN), puis partage'}</Text>
        </View>
        <Switch value={!!st.debridOnly} onValueChange={(v) => save({ debridOnly: v }, v ? 'AllDebrid activé' : 'Torrents (qBittorrent)')} trackColor={{ true: C.accent, false: C.border }} />
      </View>
      <Text style={styles.dim} numberOfLines={2}>
        {[running ? `${running} en cours` : 'rien en cours', seeding ? `${seeding} en partage` : null, toChoose ? `${toChoose} à choisir` : null, st.vpnPort?.port ? `VPN ✓ port ${st.vpnPort.port}` : st.qbit?.url ? 'VPN : port non ouvert' : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

/** « Manquants » : les saisons / épisodes déjà sortis qui manquent dans tes séries. Rien ne part tout seul : tu lances. */
function Manquants() {
  const { settings } = useSettings();
  const [data, setData] = useState<{ series: AutoMissingSeries[]; at: string | null; busy: boolean; hidden: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(
    (refresh = false) =>
      autoApi
        .missing(settings, refresh)
        .then((d) => (setData(d), setErr(null)))
        .catch((e) => setErr(e?.message ?? String(e))),
    [settings]
  );
  useEffect(() => {
    load();
  }, [load]);
  // Pendant le calcul (1re fois ou « Revérifier »), on relit toutes les 10 s
  useEffect(() => {
    if (!data?.busy) return;
    const t = setInterval(() => load(), 10000);
    return () => clearInterval(t);
  }, [data?.busy, load]);

  const launch = (sr: AutoMissingSeries, seasons: number[]) =>
    autoApi
      .missingGet(settings, sr.tmdbId, seasons)
      .then((r) => (toast(r.message), load()))
      .catch((e) => Alert.alert('Lumio Auto', e?.message ?? String(e)));
  const launchEps = (sr: AutoMissingSeries, season: number, eps: number[]) =>
    autoApi
      .missingGetEpisodes(settings, sr.tmdbId, season, eps)
      .then((r) => (toast(r.message), load()))
      .catch((e) => Alert.alert('Lumio Auto', e?.message ?? String(e)));
  const hide = (sr: AutoMissingSeries) =>
    autoApi
      .missingHide(settings, sr.tmdbId)
      .then(() => (toast(`${sr.title} masquée`), load()))
      .catch((e) => toast(e.message, 'error'));

  if (!data) return err ? <Text style={styles.dim}>{/404|inconnue/.test(err) ? 'Mets le serveur à jour (3.84.0) : Profil → Serveur → Mettre à jour.' : err}</Text> : <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />;
  const list = data.series.filter((x) => !q || x.title.toLowerCase().includes(q.toLowerCase()));
  const total = data.series.reduce((n, x) => n + x.missing, 0);
  return (
    <>
      <Text style={styles.help}>
        Les épisodes déjà sortis qui manquent dans tes séries. Rien ne se télécharge tout seul : touche « Lancer » sur la saison voulue. Les nouveaux épisodes des séries en cours restent suivis automatiquement, comme Sonarr.
      </Text>
      <View style={styles.rowBetween}>
        <Text style={styles.h2}>
          {data.series.length} série{data.series.length > 1 ? 's' : ''} · {total} épisode{total > 1 ? 's' : ''}
        </Text>
        <Pressable onPress={() => load(true)} hitSlop={8} style={styles.pill} disabled={data.busy}>
          {data.busy ? <ActivityIndicator size="small" color={C.text} /> : <Ionicons name="refresh" size={14} color={C.text} />}
          <Text style={styles.pillTxt}>{data.busy ? 'Vérification…' : 'Revérifier'}</Text>
        </Pressable>
      </View>
      {data.series.length > 6 ? <Field label="" value={q} onChangeText={setQ} placeholder="Chercher une série" /> : null}
      {!data.series.length && !data.busy ? <Text style={styles.help}>Toutes tes séries sont complètes 🎉</Text> : null}
      <View style={styles.list}>
        {list.map((sr, k) => {
          const open = openId === sr.tmdbId;
          const todo = sr.seasons.filter((x) => !x.asked);
          return (
            <View key={sr.tmdbId} style={k > 0 && styles.itemSep}>
              <Pressable onPress={() => setOpenId(open ? null : sr.tmdbId)} style={styles.itemRow} accessibilityState={{ expanded: open }}>
                {sr.poster ? <Image source={sr.poster} style={styles.missPoster} contentFit="cover" /> : <View style={[styles.missPoster, { backgroundColor: C.surfaceHigh }]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {sr.title}
                    {sr.year ? <Text style={styles.small}> {sr.year}</Text> : null}
                  </Text>
                  <Text style={styles.small} numberOfLines={1}>
                    <Text style={{ color: todo.length ? C.warning : C.success, fontWeight: '700' }}>
                      {sr.missing} manquant{sr.missing > 1 ? 's' : ''}
                    </Text>
                    {` · saison${sr.seasons.length > 1 ? 's' : ''} ${sr.seasons.map((x) => x.season).join(', ')}`}
                    {sr.status === 'Returning Series' ? ' · en cours' : sr.status === 'Ended' ? ' · terminée' : ''}
                  </Text>
                </View>
                <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={C.textDim} />
              </Pressable>
              {open ? (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {sr.seasons.map((x) => (
                    <MissingSeason
                      key={x.season}
                      x={x}
                      onSeason={() =>
                        Alert.alert(sr.title, `Lancer les ${x.missing.length} épisodes manquants de la saison ${x.season} ?`, [
                          { text: 'Annuler', style: 'cancel' },
                          { text: 'Lancer', onPress: () => launch(sr, [x.season]) },
                        ])
                      } onEpisodes={(eps) => launchEps(sr, x.season, eps)} />
                  ))}
                  <View style={[styles.rowBetween, { marginTop: 2 }]}>
                    <Pressable onPress={() => hide(sr)} hitSlop={6} style={styles.pill}>
                      <Ionicons name="eye-off-outline" size={14} color={C.textDim} />
                      <Text style={[styles.pillTxt, { color: C.textDim }]}>Ne plus proposer</Text>
                    </Pressable>
                    {todo.length > 1 ? (
                      <Pressable
                        onPress={() =>
                          Alert.alert(sr.title, `Lancer les ${todo.length} saisons (${todo.reduce((n, x) => n + x.missing.length, 0)} épisodes) ? Attention au ratio sur les trackers.`, [
                            { text: 'Annuler', style: 'cancel' },
                            { text: 'Tout lancer', onPress: () => launch(sr, todo.map((x) => x.season)) },
                          ])
                        }
                        hitSlop={6}
                        style={styles.pill}>
                        <Ionicons name="layers-outline" size={14} color={C.text} />
                        <Text style={styles.pillTxt}>Tout lancer</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {data.hidden ? (
        <Pressable
          onPress={() =>
            autoApi
              .missingReset(settings)
              .then(() => load())
              .catch(() => {})
          }
          hitSlop={8}>
          <Text style={[styles.dim, { textAlign: 'center' }]}>
            {data.hidden} série{data.hidden > 1 ? 's' : ''} masquée{data.hidden > 1 ? 's' : ''} · tout réafficher
          </Text>
        </Pressable>
      ) : null}
      {data.at ? <Text style={[styles.dim, { textAlign: 'center' }]}>Vérifié {new Date(data.at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · revérifié toutes les 12 h</Text> : null}
    </>
  );
}

/** Une saison de « Manquants » : la saison entière, ou les épisodes cochés un par un. */
function MissingSeason({ x, onSeason, onEpisodes }: { x: AutoMissingSeason; onSeason: () => void; onEpisodes: (eps: number[]) => void }) {
  const [pick, setPick] = useState<number[]>([]);
  const asked = new Set(x.askedEps ?? []);
  const whole = x.have === 0;
  const toggle = (e: number) => setPick((p) => (p.includes(e) ? p.filter((y) => y !== e) : [...p, e].sort((a, b) => a - b)));
  return (
    <View style={[styles.missSeason, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Saison {x.season}</Text>
          <Text style={styles.small} numberOfLines={1}>
            {whole ? `Saison entière absente · ${x.aired} épisode${x.aired > 1 ? 's' : ''}` : `${x.missing.length} manquant${x.missing.length > 1 ? 's' : ''} sur ${x.aired}`}
            {x.aired < x.total ? ` · ${x.total - x.aired} à venir` : ''}
          </Text>
        </View>
        {x.busy ? (
          <Text style={[styles.small, { color: C.accent, fontWeight: '700' }]}>En cours</Text>
        ) : x.asked ? (
          <Text style={[styles.small, { color: C.success, fontWeight: '700' }]}>Lancée ✓</Text>
        ) : (
          <Pressable onPress={onSeason} hitSlop={6} style={styles.pill} accessibilityLabel={`Lancer toute la saison ${x.season}`}>
            <Ionicons name="layers-outline" size={14} color={C.text} />
            <Text style={styles.pillTxt}>Toute la saison</Text>
          </Pressable>
        )}
      </View>
      {!x.asked ? (
        <>
          <Text style={styles.small}>Ou choisis les épisodes :</Text>
          <View style={styles.epGrid}>
            {x.missing.map((e) => {
              const done = asked.has(e);
              const on = pick.includes(e);
              return (
                <Pressable
                  key={e}
                  disabled={done}
                  onPress={() => toggle(e)}
                  style={[styles.epChip, on && { backgroundColor: C.accent, borderColor: C.accent }, done && { borderColor: C.success, opacity: 0.7 }]}
                  accessibilityState={{ selected: on, disabled: done }}
                  accessibilityLabel={`Épisode ${e}`}>
                  <Text style={[styles.epChipTxt, on && { color: '#000' }, done && { color: C.success }]}>
                    E{e}
                    {done ? ' ✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {pick.length ? (
            <Pressable
              onPress={() => {
                onEpisodes(pick);
                setPick([]);
              }}
              style={[styles.pill, { backgroundColor: C.accent, alignSelf: 'flex-start' }]}>
              <Ionicons name="download-outline" size={14} color="#000" />
              <Text style={[styles.pillTxt, { color: '#000' }]}>
                Lancer {pick.length === 1 ? `l’épisode ${pick[0]}` : `${pick.length} épisodes`}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const ratioColor = (r: number | null | undefined) => (r == null ? C.textDim : r >= 1.2 ? C.success : r >= 1 ? C.warning : C.danger);
const fmtRatio = (r: number | null | undefined) => (r == null ? '—' : r.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Onglet « Ratio » : pour chaque site (C411…), ratio, quota du jour, torrents encore sous la règle des 72 h. */
function RatioTab() {
  const { settings } = useSettings();
  const [data, setData] = useState<AutoRatio | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () =>
      autoApi
        .ratio(settings)
        .then((d) => (setData(d), setErr(null)))
        .catch((e) => setErr(e?.message ?? String(e))),
    [settings]
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return err ? <Text style={styles.dim}>{/404|inconnue/.test(err) ? 'Mets le serveur à jour (3.87.0) : Profil → Serveur → Mettre à jour.' : err}</Text> : <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />;
  return (
    <>
      {data.boost ? <BoostCard b={data.boost} reload={load} /> : null}
      {data.qbit ? (
        <View style={styles.ratioCard}>
          <Text style={styles.ratioLabel}>qBittorrent, depuis le début</Text>
          <View style={styles.ratioRow}>
            <RatioStat label="Envoyé" value={gb(data.qbit.up)} color={C.success} icon="arrow-up" />
            <RatioStat label="Reçu" value={gb(data.qbit.down)} color={C.accent} icon="arrow-down" />
            <RatioStat label="Ratio" value={fmtRatio(data.qbit.ratio)} color={ratioColor(data.qbit.ratio)} />
          </View>
          <Text style={styles.small}>
            Maintenant : ↑ {fmtSpeed(data.qbit.upSpeed)} · ↓ {fmtSpeed(data.qbit.downSpeed)}
          </Text>
        </View>
      ) : null}
      {!data.sites.length ? <Text style={styles.help}>Ajoute un site dans Réglages → Sites pour suivre ton ratio.</Text> : null}
      {data.sites.map((x) => (
        <RatioSite key={x.id} x={x} reload={load} />
      ))}
      <Text style={[styles.dim, { textAlign: 'center' }]}>Mis à jour toutes les 30 s · les chiffres du site sont estimés à partir de ce que Lumio a envoyé et reçu</Text>
    </>
  );
}

const fmtWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Booster de seed : tout est automatique (un passage par heure), la carte ne fait qu'afficher. */
function BoostCard({ b }: { b: AutoBoost; reload?: () => void }) {
  const pct = b.budget > 0 ? Math.min(100, (b.used / b.budget) * 100) : 0;
  const up = b.torrents.reduce((n, t) => n + (t.uploaded || 0), 0);
  const speed = b.torrents.reduce((n, t) => n + (t.upSpeed || 0), 0);
  return (
    <View style={styles.ratioCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.ratioLabel}>Booster de seed</Text>
        <Text style={[styles.small, { color: b.enabled ? C.success : C.textDim, fontWeight: '800' }]}>{b.enabled ? 'Automatique' : 'À la main'}</Text>
      </View>
      <Text style={styles.small}>
        {b.enabled
          ? 'Toutes les heures, le serveur prend tout seul les torrents qui valent le coup, seulement pour partager. Ils ne vont pas dans Jellyfin.'
          : 'Le serveur ne prend plus aucun torrent tout seul. Tu en ajoutes toi-même dans l’onglet qBittorrent → « Ajouter un torrent ». Ils servent seulement à partager et ne vont pas dans Jellyfin.'}
      </Text>
      {!b.diskFound ? (
        <View style={styles.ratioAlert}>
          <Ionicons name="warning" size={14} color={C.warning} />
          <Text style={[styles.small, { color: C.warning, flex: 1 }]}>Disque « {b.disk} » introuvable : le booster ne prend rien.</Text>
        </View>
      ) : null}
      <View style={styles.ratioRow}>
        <RatioStat label="Envoyé" value={gb(up)} color={C.success} icon="arrow-up" />
        <RatioStat label="En partage" value={String(b.torrents.filter((t) => t.state === 'seeding').length)} color={C.text} />
        <RatioStat label="Maintenant" value={fmtSpeed(speed)} color={C.accent} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>Place sur {b.disk}</Text>
        <Text style={[styles.small, { color: C.text, fontWeight: '700' }]}>
          {gb(b.used)} / {b.gb} Go
        </Text>
      </View>
      <View style={styles.svcBar}>
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct > 90 ? C.warning : C.success }} />
      </View>
      {b.enabled ? (
        <Text style={styles.small}>
          Dernier passage : {fmtWhen(b.lastRun)} · prochain : {fmtWhen(b.nextRun)}
          {b.lastNote ? `\n${b.lastNote}` : ''}
        </Text>
      ) : null}
      {b.torrents.map((t) => (
        <View key={t.id} style={{ gap: 2 }}>
          <Text style={[styles.small, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={styles.small}>
            {t.free === false ? 'compté · ' : ''}
            {t.state === 'downloading' ? `arrive · ${t.progress}%` : `ratio ${fmtRatio(t.ratio)} · ${gb(t.uploaded)} envoyés`}
            {t.upSpeed ? ` · ↑ ${fmtSpeed(t.upSpeed)}` : ''} · {gb(t.size)}
            {t.leechers != null ? ` · ${t.leechers} le téléchargent` : ''}
            {t.hoursLeft ? ` · encore ${t.hoursLeft} h obligatoires` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** qBittorrent → « Ajouter un torrent » : un torrent choisi à la main, seulement pour le partage (dossier du booster, pas dans Jellyfin). */
function AddTorrentCard() {
  const { settings } = useSettings();
  const [q, setQ] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'search' | 'link' | null>(null);
  const [list, setList] = useState<AutoBoostCandidate[] | null>(null);
  const oops = (e: any) => Alert.alert('Ajouter un torrent', /404|inconnue/.test(e?.message ?? '') ? 'Mets le serveur à jour (3.100.1) : onglet Serveur → Mettre à jour.' : (e?.message ?? String(e)));
  const search = () => {
    if (q.trim().length < 2) return;
    setBusy('search');
    autoApi
      .boostSearch(settings, q.trim())
      .then((r) => setList(r.candidates))
      .catch(oops)
      .finally(() => setBusy(null));
  };
  const take = (c: AutoBoostCandidate) => {
    const go = () =>
      autoApi
        .boostTake(settings, c.guid)
        .then((r) => (toast(r.message), setList((o) => (o ? o.filter((x) => x.guid !== c.guid) : o))))
        .catch(oops);
    if (c.free) return go();
    Alert.alert('Compté dans ton ratio', `${c.title}\n\nCe torrent n’est pas en freeleech : son téléchargement (${gb(c.size)}) compte sur le site. ${c.leechers ?? 0} personne(s) le téléchargent en ce moment.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Ajouter', onPress: go },
    ]);
  };
  const addLink = () => {
    if (!link.trim()) return;
    setBusy('link');
    autoApi
      .boostAddLink(settings, link.trim())
      .then((r) => (toast(r.message), setLink('')))
      .catch(oops)
      .finally(() => setBusy(null));
  };
  return (
    <Fold id="qb-add" title="Ajouter un torrent" defaultOpen={false}>
      <Text style={styles.help}>Pour le partage seulement : le torrent va dans le dossier du booster (pas dans Jellyfin) et il est retiré tout seul après 72 h s’il reste à 1 de ratio ou moins.</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={[styles.searchBox, { flex: 1 }]}>
          <Ionicons name="search" size={18} color={C.textDim} />
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={search} placeholder="Chercher sur le site (nom)" placeholderTextColor={C.textFaint} style={styles.searchInput} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        </View>
        <Button title="Chercher" small loading={busy === 'search'} onPress={search} />
      </View>
      {list && !list.length ? <Text style={styles.small}>Rien trouvé.</Text> : null}
      {(list ?? []).slice(0, 25).map((c) => (
        <View key={c.guid} style={[styles.watchRow, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.small, { color: C.text, fontWeight: '700' }]} numberOfLines={2}>
              {c.title}
            </Text>
            <Text style={styles.small}>
              <Text style={{ color: c.free ? C.success : C.warning, fontWeight: '800' }}>{c.free ? 'Freeleech' : 'Compté'}</Text> · {gb(c.size)} · {c.leechers ?? '?'} téléchargent · {c.seeders ?? '?'} partagent
            </Text>
          </View>
          <Pressable onPress={() => take(c)} hitSlop={8} style={[styles.pill, { paddingVertical: 8 }]}>
            <Text style={styles.pillTxt}>Ajouter</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={[styles.searchBox, { flex: 1 }]}>
          <Ionicons name="link" size={18} color={C.textDim} />
          <TextInput value={link} onChangeText={setLink} placeholder="Ou colle un lien magnet / .torrent" placeholderTextColor={C.textFaint} style={styles.searchInput} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
        </View>
        <Button title="Ajouter" small variant="secondary" loading={busy === 'link'} onPress={addLink} />
      </View>
    </Fold>
  );
}

const VIA_LABEL: Record<string, string> = { alldebrid: 'Cache AllDebrid', torbox: 'Cache TorBox', torrent: 'Torrent du site' };
const LEVEL_COLOR = { ok: C.success, warn: C.warning, bad: C.danger } as const;
const LEVEL_ICON = { ok: 'checkmark-circle', warn: 'alert-circle', bad: 'close-circle' } as const;

/** Onglet Seed : ce que le serveur fait tout seul pour le ratio (garde à 1,20, chemin de chaque titre, nettoyage, vérifications). Aucun bouton. */
function SeedAutoCards() {
  const { settings } = useSettings();
  const [d, setD] = useState<AutoSeedView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () =>
      autoApi
        .seed(settings)
        .then((x) => (setD(x), setErr(null)))
        .catch((e) => setErr(e?.message ?? String(e))),
    [settings]
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  if (!d) return err ? <Text style={styles.dim}>{/404|inconnue/.test(err) ? 'Mets le serveur à jour (3.99.0) : onglet Serveur → Mettre à jour.' : err}</Text> : null;
  const bad = d.health?.checks.filter((c) => c.level !== 'ok') ?? [];
  return (
    <>
      <View style={styles.ratioCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.ratioLabel}>Garde du ratio</Text>
          <Text style={[styles.small, { color: C.text, fontWeight: '800' }]}>seuil {fmtRatio(d.guard.ratio)}</Text>
        </View>
        {d.guard.sites.map((x) => (
          <View key={x.id} style={styles.rowBetween}>
            <Text style={[styles.small, { color: C.text, fontWeight: '700' }]}>
              {x.name} · <Text style={{ color: ratioColor(x.ratio) }}>{fmtRatio(x.ratio)}</Text>
              {x.real ? '' : ' (estimé)'}
            </Text>
            <Text style={[styles.small, { color: x.freeleech ? C.success : x.low ? C.warning : C.success, fontWeight: '800' }]}>{x.freeleech ? 'Freeleech' : x.low ? 'Cache d’abord' : 'Torrent direct'}</Text>
          </View>
        ))}
        <Text style={styles.small}>
          Sous le seuil, chaque titre est d’abord cherché dans le cache AllDebrid / TorBox (rien de compté sur le site), puis remis en partage par-dessus. Pas en cache : torrent du site, puis partage. Au-dessus du seuil ou en
          freeleech : torrent du site directement.
        </Text>
      </View>
      {d.health ? (
        <View style={styles.ratioCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.ratioLabel}>Vérifications automatiques</Text>
            <Text style={[styles.small, { color: bad.length ? C.warning : C.success, fontWeight: '800' }]}>{bad.length ? `${bad.length} à voir` : 'Tout roule'}</Text>
          </View>
          {d.health.checks.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name={LEVEL_ICON[c.level]} size={15} color={LEVEL_COLOR[c.level]} style={{ marginTop: 1 }} />
              <Text style={[styles.small, { flex: 1 }]}>
                <Text style={{ color: C.text, fontWeight: '700' }}>{c.label}</Text>
                {c.note ? ` · ${c.note}` : ''}
              </Text>
            </View>
          ))}
          <Text style={styles.small}>Refait toutes les 15 min · dernière fois : {fmtWhen(d.health.at)}</Text>
        </View>
      ) : null}
      <Fold id="seed-routes" title="Chemin des derniers titres" count={d.routes.length}>
        {!d.routes.length ? <Text style={styles.help}>Rien pour le moment.</Text> : null}
        {d.routes.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.rowBetween}>
                <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
                  {r.title}
                </Text>
                <Text style={[styles.small, { color: r.via === 'torrent' ? (r.free ? C.success : C.accent) : C.success, fontWeight: '800' }]}>{r.via === 'torrent' && r.free ? 'Freeleech' : VIA_LABEL[r.via]}</Text>
              </View>
              <Text style={styles.small}>
                {fmtWhen(r.at)} · {gb(r.size)}
                {r.via !== 'torrent' ? ' · 0 Go compté' : r.low ? ' · pas en cache' : ''}
                {r.seeding ? ` · en partage, ratio ${fmtRatio(r.ratio)}${r.hoursLeft ? `, encore ${r.hoursLeft} h` : ''}` : r.seedEnd ? ` · ${r.seedEnd}` : r.state === 'done' ? '' : ` · ${r.state === 'failed' ? 'échec' : 'en cours'}`}
                {r.note ? ` · ${r.note}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Fold>
      <Fold id="seed-cleaned" title="Retirés automatiquement" count={d.cleaned.length} defaultOpen={false}>
        <Text style={styles.help}>Après 72 h de partage, un torrent resté à 1 de ratio ou moins est retiré tout seul. Les fichiers de Jellyfin ne bougent pas.</Text>
        {d.cleaned.map((c, i) => (
          <View key={`${c.at}-${i}`} style={styles.card}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.title} numberOfLines={1}>
                {c.title}
              </Text>
              <Text style={styles.small}>
                {fmtWhen(c.at)} · {c.boost ? 'booster · ' : ''}
                {c.why} · {gb(c.uploaded)} envoyés
              </Text>
            </View>
          </View>
        ))}
      </Fold>
    </>
  );
}

function RatioStat({ label, value, color, icon }: { label: string; value: string; color: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.small}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
        <Text style={[styles.ratioBig, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
    </View>
  );
}

function RatioSite({ x, reload }: { x: AutoRatioSite; reload: () => void }) {
  const { settings } = useSettings();
  const [edit, setEdit] = useState(false);
  const [up, setUp] = useState(x.base ? String(Math.round((x.base.up / 1e9) * 10) / 10) : '');
  const [down, setDown] = useState(x.base ? String(Math.round((x.base.down / 1e9) * 10) / 10) : '');
  const ratio = x.estimate?.ratio ?? x.lumio.ratio;
  // C411 : on peut télécharger tant que l'envoyé reste au-dessus de 80 % du reçu → marge = envoyé ÷ 0,8 − reçu
  const isC411 = x.type === 'c411' || /c411/i.test(x.name);
  const marge = isC411 && x.estimate ? x.estimate.up / 0.8 - x.estimate.down : null;
  const pct = x.cap ? Math.min(100, (x.today / x.cap) * 100) : 0;
  const quotaColor = pct >= 90 ? C.danger : pct >= 70 ? C.warning : C.success;
  const alerts = [
    ratio != null && ratio < 1 ? 'Ratio sous 1 : laisse partager avant de télécharger' : ratio != null && ratio < 1.1 ? 'Ratio juste au-dessus de 1 : prudence' : null,
    x.cap && pct >= 80 ? `Quota du jour presque atteint (${Math.round(pct)} %)` : null,
    marge != null && marge < 10e9 ? (marge <= 0 ? 'Marge épuisée : C411 bloque le téléchargement' : `Plus que ${gb(marge)} de marge avant blocage`) : null,
  ].filter(Boolean) as string[];
  const save = () => {
    const u = Number(up.replace(',', '.'));
    const d = Number(down.replace(',', '.'));
    if (!(u >= 0) || !(d > 0)) return Alert.alert('Ratio', 'Entre l’envoyé et le reçu en Go, comme sur ton profil du site.');
    autoApi
      .ratioBase(settings, x.id, u * 1e9, d * 1e9)
      .then(() => (setEdit(false), toast('Chiffres enregistrés'), reload()))
      .catch((e) => Alert.alert('Ratio', e?.message ?? String(e)));
  };
  return (
    <View style={styles.ratioCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.h2}>{x.name}</Text>
        <Text style={[styles.ratioHuge, { color: ratioColor(ratio) }]}>{fmtRatio(ratio)}</Text>
      </View>
      <Text style={styles.small}>
        {x.estimate
          ? `Ratio estimé sur le site (tes chiffres du ${new Date(x.estimate.since).toLocaleDateString('fr-FR')} + Lumio depuis)`
          : 'Attention : ce n’est que le ratio des torrents téléchargés par Lumio, pas celui de ton compte. Touche « Entrer mes chiffres du site » ci-dessous.'}
      </Text>
      {alerts.map((a) => (
        <View key={a} style={styles.ratioAlert}>
          <Ionicons name="warning" size={14} color={C.warning} />
          <Text style={[styles.small, { color: C.warning, flex: 1 }]}>{a}</Text>
        </View>
      ))}
      {marge != null ? (
        <View style={styles.rowBetween}>
          <Text style={styles.title}>Marge de téléchargement</Text>
          <Text style={[styles.ratioBig, { color: marge > 20e9 ? C.success : marge > 5e9 ? C.warning : C.danger }]}>{marge > 0 ? gb(marge) : '0 Go'}</Text>
        </View>
      ) : null}
      <View style={styles.ratioRow}>
        <RatioStat label="Envoyé" value={gb(x.estimate?.up ?? x.lumio.up)} color={C.success} icon="arrow-up" />
        <RatioStat label="Reçu" value={gb(x.estimate?.down ?? x.lumio.down)} color={C.accent} icon="arrow-down" />
        <RatioStat label="En partage" value={String(x.seeding)} color={C.text} />
      </View>
      {x.estimate ? (
        <Text style={styles.small}>
          Par Lumio : ↑ {gb(x.lumio.up)} · ↓ {gb(x.lumio.down)}
          {x.lumio.freeDown ? ` (+ ${gb(x.lumio.freeDown)} en freeleech, non compté)` : ''}
        </Text>
      ) : x.lumio.freeDown ? (
        <Text style={styles.small}>+ {gb(x.lumio.freeDown)} reçus en freeleech (non comptés)</Text>
      ) : null}
      {x.cap ? (
        <View style={{ gap: 5 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.small}>Téléchargé aujourd’hui</Text>
            <Text style={[styles.small, { color: quotaColor, fontWeight: '800' }]}>
              {gb(x.today) === '—' ? '0 Go' : gb(x.today)} / {gb(x.cap)}
            </Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: quotaColor }]} />
          </View>
          {x.days.length > 1 ? (
            <Text style={styles.small}>
              7 derniers jours : {x.days.map((d) => `${new Date(d.day).toLocaleDateString('fr-FR', { weekday: 'short' })} ${(d.bytes / 1e9).toFixed(1)}`).join(' · ')} Go
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Règle des 72 h</Text>
        {!x.hr.length ? (
          <Text style={[styles.small, { color: C.success }]}>Aucun torrent en danger : tous ont 72 h de partage ou un ratio de 1 ✓</Text>
        ) : (
          x.hr.map((h) => (
            <Text key={h.title} style={styles.small} numberOfLines={1}>
              <Text style={{ color: C.warning, fontWeight: '800' }}>encore {h.hoursLeft} h</Text> · {h.title} · ratio {fmtRatio(h.ratio)}
            </Text>
          ))
        )}
        {x.hr.length ? <Text style={styles.small}>Ne les supprime pas avant : Lumio les garde de lui-même.</Text> : null}
      </View>
      {x.rules.length ? <Text style={styles.small}>Règles : {x.rules.join(' · ')}</Text> : null}
      {edit ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.small}>
            Recopie les chiffres de ton profil {x.name} (en Go){isC411 ? ' : « Upload » (crédit inclus) et « Download », dans la bulle « Marge de téléchargement »' : ''}. Lumio ajoutera ensuite tout seul ce qu’il envoie et reçoit.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label="Envoyé (Go)" value={up} onChangeText={setUp} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Reçu (Go)" value={down} onChangeText={setDown} keyboardType="decimal-pad" />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Enregistrer" onPress={save} />
            <Button title="Annuler" variant="secondary" onPress={() => setEdit(false)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setEdit(true)} hitSlop={6} style={styles.pill}>
            <Ionicons name="create-outline" size={14} color={C.text} />
            <Text style={styles.pillTxt}>{x.base ? 'Mettre à jour mes chiffres' : 'Entrer mes chiffres du site'}</Text>
          </Pressable>
          {x.base ? (
            <Pressable
              onPress={() =>
                autoApi
                  .ratioBaseClear(settings, x.id)
                  .then(reload)
                  .catch(() => {})
              }
              hitSlop={6}
              style={styles.pill}>
              <Text style={[styles.pillTxt, { color: C.textDim }]}>Effacer</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const ITEM_GROUPS = [
  { id: 'choose', title: 'À choisir', color: C.warning, open: true },
  { id: 'busy', title: 'En cours', color: C.accent, open: true },
  { id: 'wait', title: 'En attente', color: undefined, open: true },
  { id: 'done', title: 'Complets', color: undefined, open: false },
] as const;

function Demandes({ st, onItem }: { st: AutoState; onItem: (i: AutoItem) => void }) {
  const { settings } = useSettings();
  const group = (i: AutoItem, s: ReturnType<typeof itemStatus>) =>
    i.needsChoice ? 'choose' : i.searching || i.active || s.icon === 'cloud-download' ? 'busy' : s.label === 'Complet' ? 'done' : 'wait';
  const rows = st.items.map((i) => ({ i, s: itemStatus(i, st.grabs) }));
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.h2}>
          {st.items.length} titre{st.items.length > 1 ? 's' : ''}
        </Text>
        <Pressable
          onPress={() =>
            autoApi
              .searchAll(settings)
              .then((r) => toast(r.message))
              .catch((e) => toast(e.message, 'error'))
          }
          hitSlop={8}
          style={styles.pill}>
          <Ionicons name="refresh" size={14} color={C.text} />
          <Text style={styles.pillTxt}>Tout chercher</Text>
        </Pressable>
      </View>
      {!st.items.length ? <Text style={styles.help}>Les demandes validées apparaissent ici dès que Lumio Auto est actif.</Text> : null}
      {ITEM_GROUPS.map((gr) => {
        const list = rows.filter((r) => group(r.i, r.s) === gr.id);
        if (!list.length) return null;
        return (
          <Fold key={gr.id} id={`titres-${gr.id}`} title={gr.title} count={list.length} color={gr.color} defaultOpen={gr.open}>
            <View style={styles.list}>
              {list.map(({ i, s }, k) => (
                <Pressable key={i.id} onPress={() => onItem(i)} style={[styles.itemRow, k > 0 && styles.itemSep]}>
                  <View style={[styles.itemIcon, { backgroundColor: `${s.color}22` }]}>
                    {i.searching ? <ActivityIndicator size="small" color={s.color} /> : <Ionicons name={i.type === 'movie' ? 'film' : i.anime ? 'sparkles' : 'tv'} size={17} color={s.color} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {i.title}
                      {i.year ? <Text style={styles.small}> {i.year}</Text> : null}
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>
                      <Text style={{ color: s.color, fontWeight: '700' }}>{s.label}</Text>
                      {i.type === 'tv' && i.seasons.length ? ` · saison ${i.seasons.join(', ')}` : ''}
                      {i.requestedBy.length ? ` · ${i.requestedBy.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textDim} />
                </Pressable>
              ))}
            </View>
          </Fold>
        );
      })}
    </>
  );
}

function Journal({ st }: { st: AutoState }) {
  return (
    <>
      <Section title="Journal" id="auto-journal">
        {st.log.slice(0, 50).map((l, k) => (
          <Text key={k} style={[styles.log, l.level === 'error' && { color: C.danger }, l.level === 'warn' && { color: C.warning }]}>
            {new Date(l.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.msg}
          </Text>
        ))}
      </Section>
    </>
  );
}

/** Fiche d'un titre : où il en est, historique, recherches site par site, recherche interactive. */
function ItemSheet({ item, st, onClose, reload }: { item: AutoItem; st: AutoState; onClose: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [res, setRes] = useState<Awaited<ReturnType<typeof autoApi.releases>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(true);
  const [sort, setSort] = useState<'score' | 'size' | 'seeders' | 'age'>('score');
  const s = itemStatus(item, st.grabs);
  const grabs = st.grabs.filter((g) => g.itemId === item.id);

  const interactive = async (want?: AutoWant) => {
    setBusy(true);
    try {
      setRes(await autoApi.releases(settings, item.id, want?.season, want?.kind === 'episode' ? want.episode : undefined));
    } catch (e: any) {
      Alert.alert('Recherche', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // Rien trouvé automatiquement : on ouvre directement la recherche interactive
    if (item.needsChoice) interactive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const list = (res?.results ?? []).filter((r) => showRejected || !r.rejected);
    const key = (r: AutoRelease) => (sort === 'size' ? -r.size : sort === 'seeders' ? -(r.seeders ?? 0) : sort === 'age' ? r.ageDays ?? 9999 : 0);
    return sort === 'score' ? list : [...list].sort((a, b) => key(a) - key(b));
  }, [res, showRejected, sort]);

  const take = (r: AutoRelease) =>
    Alert.alert(
      r.rejected ? 'Version écartée par le profil' : 'Télécharger cette version ?',
      r.rejected ? `${r.title}\n\nRaisons : ${r.reasons.join(', ')}.\n\nLa télécharger quand même ?` : r.title,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: r.rejected ? 'Télécharger quand même' : 'Télécharger',
          onPress: () =>
            autoApi
              .grab(settings, item.id, r.guid)
              .then(() => (toast('Téléchargement lancé'), reload(), setRes(null)))
              .catch((e) => Alert.alert('Lumio Auto', e.message)),
        },
      ]
    );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1} numberOfLines={2}>
            {item.title}
            {item.year ? ` (${item.year})` : ''}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.status, { borderColor: s.color }]}>
            <Ionicons name={s.icon} size={11} color={s.color} />
            <Text style={[styles.statusTxt, { color: s.color }]}>{s.label}</Text>
          </View>
          <Text style={styles.small}>
            {item.type === 'tv' ? `Saisons ${item.seasons.join(', ') || '—'} · ` : ''}
            {lastPart(item.folderPath)}
            {item.requestedBy.length ? ` · demandé par ${item.requestedBy.join(', ')}` : ''}
          </Text>
        </View>
        <Text style={styles.dim}>
          {item.type === 'movie' && item.available === false ? `Pas encore sorti en vidéo${item.availableFrom ? ` (prévu le ${new Date(item.availableFrom).toLocaleDateString('fr-FR')})` : ''} · ` : ''}
          {item.note ?? 'en attente'}
          {item.lastSearch ? ` · dernière recherche ${ago(item.lastSearch)}` : ''}
          {item.nextSearch && !item.active ? ` · prochaine ${inMin(item.nextSearch)}` : ''}
          {item.imdbId ? ` · ${item.imdbId}` : ''}
        </Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Recherche interactive" icon="list" onPress={() => interactive()} loading={busy} style={{ flex: 1.3 }} small />
          <Button
            title="Auto"
            icon="flash"
            variant="secondary"
            small
            onPress={() => autoApi.searchItem(settings, item.id).then((r) => (toast(r.message), reload()))}
            style={{ flex: 0.8 }}
          />
          <Button title={item.paused ? 'Reprendre' : 'Pause'} icon={item.paused ? 'play' : 'pause'} variant="secondary" small onPress={() => autoApi.pauseItem(settings, item.id).then(reload)} style={{ flex: 1 }} />
        </View>

        {/* Recherche interactive, façon Radarr / Sonarr */}
        {res ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.h2}>Versions trouvées · {wantLabel(res.want)}</Text>
            {res.wanted.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {res.wanted.slice(0, 30).map((w, k) => (
                  <SegChip key={k} label={wantLabel(w)} on={wantLabel(w) === wantLabel(res.want)} onPress={() => interactive(w)} />
                ))}
              </ScrollView>
            ) : null}
            {res.status.map((x) => (
              <View key={x.name} style={styles.siteBox}>
                <Text style={[styles.small, { color: x.error ? C.danger : C.text, fontWeight: '700' }]}>
                  {x.name} : {x.error ? `erreur — ${x.error}` : x.skipped ? 'limite de requêtes atteinte, réessaie plus tard' : `${x.count} résultat(s)`}
                </Text>
                {(x.tries ?? []).map((t, k) => (
                  <Text key={k} style={styles.mono} numberOfLines={2}>
                    {t.query} → {t.error ? 'erreur' : t.skipped ? 'limite' : t.count}
                  </Text>
                ))}
              </View>
            ))}
            <View style={styles.metaRow}>
              {(['score', 'size', 'seeders', 'age'] as const).map((k) => (
                <SegChip key={k} label={{ score: 'Meilleures', size: 'Taille', seeders: 'Sources', age: 'Récentes' }[k]} on={sort === k} onPress={() => setSort(k)} />
              ))}
            </View>
            <Toggle label="Afficher aussi les versions écartées" value={showRejected} onChange={setShowRejected} />
            {!shown.length ? <Text style={styles.dim}>Aucune version. Vérifie les erreurs des sites ci-dessus.</Text> : null}
            {shown.map((r) => (
              <Pressable key={r.guid} onPress={() => take(r)} style={[styles.rel, r.rejected ? { opacity: 0.75 } : { borderColor: C.success }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.relTitle}>{r.title}</Text>
                  <View style={styles.metaRow}>
                    {r.quality ? <Text style={styles.tag}>{r.quality}</Text> : null}
                    {r.languages.map((l) => (
                      <Text key={l} style={[styles.tag, { color: C.accent }]}>
                        {l}
                      </Text>
                    ))}
                    {r.freeleech ? <Text style={[styles.tag, { color: C.success }]}>FREELEECH</Text> : null}
                    {r.matchedBy === 'identifiant' ? <Text style={[styles.tag, { color: C.success }]}>ID ✓</Text> : null}
                  </View>
                  <Text style={styles.small}>
                    {gb(r.size)} · ↑{r.seeders ?? '?'} ↓{r.leechers ?? '?'}
                    {r.ageDays != null ? ` · ${r.ageDays} j` : ''} · {r.indexer} · note {r.score}
                  </Text>
                  {r.reasons.length ? (
                    <View style={styles.metaRow}>
                      {r.reasons.map((x) => (
                        <Text key={x} style={[styles.tag, { color: C.danger, borderColor: 'rgba(255,69,58,0.4)' }]}>
                          {x}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
                <View style={[styles.dl, r.rejected ? { backgroundColor: C.surfaceHigh } : null]}>
                  <Ionicons name="download-outline" size={18} color={r.rejected ? C.textDim : '#fff'} />
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Dernière recherche automatique : site par site, requête par requête */}
        {item.lastReport && !res ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.h2}>Dernière recherche · {item.lastReport.want}</Text>
            {item.lastReport.sites.map((x) => (
              <View key={x.name} style={styles.siteBox}>
                <Text style={[styles.small, { color: x.error ? C.danger : C.text, fontWeight: '700' }]}>
                  {x.name} : {x.error ? `erreur — ${x.error}` : x.skipped ? 'limite atteinte' : `${x.count} résultat(s)`}
                </Text>
                {x.tries.map((t, k) => (
                  <Text key={k} style={styles.mono} numberOfLines={3}>
                    {t.query} → {t.error ?? (t.skipped ? 'limite' : t.count)}
                    {t.url ? `\n${t.url}` : ''}
                  </Text>
                ))}
              </View>
            ))}
            {item.lastReport.reasons.length ? <Text style={[styles.small, { color: C.warning }]}>Écartés : {item.lastReport.reasons.join(', ')}</Text> : null}
          </View>
        ) : null}

        {grabs.length ? <Text style={styles.h2}>Téléchargements</Text> : null}
        {grabs.slice(0, 6).map((g) => (
          <GrabRow key={g.id} g={g} reload={reload} />
        ))}

        <Text style={styles.h2}>Historique</Text>
        {!item.events.length ? <Text style={styles.dim}>Rien pour l’instant.</Text> : null}
        {item.events.map((e, k) => (
          <View key={k} style={styles.event}>
            <Ionicons name={EVENT_ICON[e.type]?.icon ?? 'ellipse'} size={16} color={EVENT_ICON[e.type]?.color ?? C.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTxt}>{e.msg}</Text>
              <Text style={styles.small}>
                {new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {e.indexer ? ` · ${e.indexer}` : ''}
                {e.size ? ` · ${gb(e.size)}` : ''}
                {e.by && e.by !== 'auto' ? ` · ${e.by === 'rss' ? 'veille RSS' : e.by}` : ''}
              </Text>
            </View>
          </View>
        ))}

        {item.type === 'tv' ? (
          <>
            <Toggle label="Suivre aussi les prochaines saisons" value={item.future} onChange={(v) => autoApi.updateItem(settings, item.id, { future: v }).then(reload)} />
            <Toggle label="Animé (numérotation absolue)" value={item.anime} onChange={(v) => autoApi.updateItem(settings, item.id, { anime: v }).then(reload)} />
          </>
        ) : null}
        <Button
          title="Ne plus suivre"
          icon="trash-outline"
          variant="danger"
          onPress={() =>
            Alert.alert('Ne plus suivre ce titre ?', 'Les fichiers déjà téléchargés restent dans la bibliothèque.', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ne plus suivre', style: 'destructive', onPress: () => autoApi.removeItem(settings, item.id).then(() => (reload(), onClose())) },
            ])
          }
        />
      </ScrollView>
    </Modal>
  );
}

function Indexeurs({ st, reload, onEdit }: { st: AutoState; reload: () => void; onEdit: (ix: Partial<AutoIndexer> & { key?: string }) => void }) {
  return (
    <>
      <Text style={styles.help}>
        Lumio cherche d’abord par identifiant (TMDB / IMDb + saison / épisode) quand le site le permet, puis par le titre. Les adresses des sites passent par le DNS 1.1.1.1. Les clés restent sur le serveur.
      </Text>
      {st.indexers.map((ix) => (
        <IndexerRow key={ix.id} ix={ix} onEdit={() => onEdit(ix)} reload={reload} />
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {!st.indexers.some((x) => x.type === 'c411') ? (
          <Button title="C411" icon="add" small onPress={() => onEdit({ type: 'c411', name: 'C411', url: 'https://c411.org/api/torznab', enabled: true, rss: true, search: true, maxPerHour: 60 })} style={{ flex: 1 }} />
        ) : null}
        <Button title="Torznab" icon="add" variant="secondary" small onPress={() => onEdit({ type: 'torznab', enabled: true, rss: true, search: true, maxPerHour: 15 })} style={{ flex: 1 }} />
        <Button title="Prowlarr" icon="add" variant="secondary" small onPress={() => onEdit({ type: 'prowlarr', name: 'Prowlarr', url: 'http://prowlarr:9696', enabled: true, search: true, rss: false, maxPerHour: 30 })} style={{ flex: 1 }} />
      </View>
    </>
  );
}

function IndexerRow({ ix, onEdit, reload }: { ix: AutoIndexer; onEdit: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable onPress={onEdit} style={styles.card}>
      <Ionicons name={ix.type === 'prowlarr' ? 'layers-outline' : 'globe-outline'} size={20} color={ix.enabled ? C.accent : C.textDim} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>
          {ix.name} {ix.enabled ? '' : '(désactivé)'}
        </Text>
        <Text style={styles.small} numberOfLines={2}>
          {ix.type === 'prowlarr' ? 'Prowlarr' : ix.type === 'c411' ? 'C411 (Torznab)' : 'Torznab'} · {ix.rss ? 'veille RSS · ' : ''}
          {ix.callsLastHour}/{ix.maxPerHour} requêtes cette heure
          {ix.todayGb ? ` · ${ix.todayGb} Go aujourd’hui` : ''}
          {ix.caps ? ` · par ID : ${[ix.caps.movie?.includes('tmdbid') ? 'films' : null, ix.caps.tv?.includes('tmdbid') || ix.caps.tv?.includes('imdbid') ? 'séries' : null].filter(Boolean).join(', ') || 'non'}` : ''}
        </Text>
        {ix.status ? (
          <Text style={[styles.small, { color: ix.status.ok ? C.success : C.danger }]} numberOfLines={3}>
            {ix.status.ok ? `OK (${ix.status.count ?? 0} résultats)` : `Erreur : ${ix.status.message}`} · {ago(ix.status.at)}
          </Text>
        ) : null}
      </View>
      <Pressable
        hitSlop={8}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await autoApi.testIndexer(settings, ix.id);
            Alert.alert(ix.name, `${r.ok ? `✅ ${r.message}` : `❌ ${r.message}`}\n\n${r.caps ?? ''}${r.url ? `\n\nAdresse appelée :\n${r.url}` : ''}${r.sample?.length ? `\n\nExemples :\n${r.sample.join('\n')}` : ''}`);
            reload();
          } catch (e: any) {
            Alert.alert(ix.name, e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        }}
        style={styles.pill}>
        {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.pillTxt}>Tester</Text>}
      </Pressable>
    </Pressable>
  );
}

function IndexerEditor({ ix, onClose, onSaved }: { ix: Partial<AutoIndexer> & { key?: string }; onClose: () => void; onSaved: () => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({ ...ix, key: '' });
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));
  const type = f.type ?? 'torznab';
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>{ix.id ? ix.name : type === 'c411' ? 'C411' : type === 'prowlarr' ? 'Prowlarr' : 'Nouvel indexeur'}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        {type === 'c411' ? (
          <View style={styles.siteBox}>
            <Text style={styles.small}>
              Sur c411.org : Mon compte → Intégrations → crée une clé API (ce n’est pas le passkey des torrents). Lumio appelle https://c411.org/api/torznab, au plus 15 requêtes par minute, en
              cherchant les séries par identifiant TMDB + saison / épisode.
            </Text>
            <Pressable onPress={() => Linking.openURL('https://c411.org')} hitSlop={6}>
              <Text style={[styles.small, { color: C.accent, marginTop: 6 }]}>Ouvrir c411.org</Text>
            </Pressable>
          </View>
        ) : null}
        <Field label="Nom" value={f.name ?? ''} onChangeText={(v) => set('name', v)} placeholder={type === 'prowlarr' ? 'Prowlarr' : 'Tr4ker'} />
        <Field
          label={type === 'prowlarr' ? 'Adresse de Prowlarr' : 'Adresse Torznab'}
          value={f.url ?? ''}
          onChangeText={(v) => set('url', v)}
          placeholder={type === 'prowlarr' ? 'http://prowlarr:9696' : 'https://site/api/torznab'}
          keyboardType="url"
          hint={type === 'prowlarr' ? 'Vue depuis le serveur Lumio : http://prowlarr:9696 (même docker compose).' : type === 'c411' ? 'Laisse https://c411.org/api/torznab.' : 'Le lien Torznab du site, ou d’un indexeur dans Prowlarr / Jackett.'}
        />
        <Field
          label={`${type === 'prowlarr' ? 'Clé API Prowlarr' : 'Clé API'}${ix.hasKey ? ' · enregistrée ✓' : ''}`}
          value={f.key}
          onChangeText={(v) => set('key', v)}
          placeholder={ix.hasKey ? 'Coller pour remplacer' : 'Coller ici'}
          secureTextEntry
        />
        <Toggle label="Activé" value={f.enabled !== false} onChange={(v) => set('enabled', v)} />
        <Toggle label="Recherche des titres qui manquent" value={f.search !== false} onChange={(v) => set('search', v)} />
        {type !== 'prowlarr' ? <Toggle label="Veille RSS (nouvelles sorties)" value={f.rss !== false} onChange={(v) => set('rss', v)} /> : null}
        <Picker
          label="Télécharger avec"
          options={[
            { value: '', label: 'Client par défaut' },
            { value: 'qbit', label: 'qBittorrent', hint: 'trackers privés : partage' },
            { value: 'rdt', label: 'rdt-client' },
            { value: 'alldebrid', label: 'AllDebrid direct' },
          ]}
          value={f.client ?? ''}
          onChange={(v) => set('client', v)}
        />
        <Picker
          label="Requêtes maximum par heure"
          options={[15, 30, 60, 120, 300].map((n) => ({ value: n, label: String(n) }))}
          value={f.maxPerHour ?? 15}
          onChange={(v) => set('maxPerHour', v)}
        />
        <Section title="Catégories (avancé)" id="auto-cats">
          <Field label="Films" value={f.catMovie ?? ''} onChangeText={(v) => set('catMovie', v)} placeholder="2000" keyboardType="numbers-and-punctuation" />
          <Field label="Séries" value={f.catTv ?? ''} onChangeText={(v) => set('catTv', v)} placeholder="5000" keyboardType="numbers-and-punctuation" />
          <Field label="Séries animées" value={f.catAnime ?? ''} onChangeText={(v) => set('catAnime', v)} placeholder="5070" keyboardType="numbers-and-punctuation" />
        </Section>
        <Button
          title="Enregistrer"
          icon="checkmark"
          onPress={async () => {
            try {
              await autoApi.saveIndexer(settings, { ...f, key: f.key || undefined });
              toast('Indexeur enregistré : touche « Tester »');
              onSaved();
              onClose();
            } catch (e: any) {
              Alert.alert('Indexeur', e?.message ?? String(e));
            }
          }}
        />
        {ix.id ? (
          <Button
            title="Supprimer"
            icon="trash-outline"
            variant="danger"
            style={{ marginTop: 10 }}
            onPress={() =>
              Alert.alert('Supprimer cet indexeur ?', undefined, [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Supprimer', style: 'destructive', onPress: () => autoApi.removeIndexer(settings, ix.id!).then(() => (onSaved(), onClose())) },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function Blocklist() {
  const { settings } = useSettings();
  const [list, setList] = useState<{ key: string; title: string | null; indexer?: string | null; reason?: string | null; at?: string }[] | null>(null);
  const load = () => autoApi.blocklist(settings).then((r) => setList(r.blocked)).catch(() => setList([]));
  return (
    <Section title="Liste noire" id="auto-block">
      <Text style={styles.help}>Versions en échec ou annulées : Lumio ne les reprend plus. Retire-en une pour qu’elle soit de nouveau proposée.</Text>
      {list === null ? <Button title="Afficher" icon="eye-outline" variant="secondary" small onPress={load} /> : null}
      {list?.length === 0 ? <Text style={styles.dim}>Vide.</Text> : null}
      {list?.map((b) => (
        <View key={b.key} style={[styles.card, { marginBottom: 6 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.relTitle}>{b.title ?? b.key}</Text>
            <Text style={styles.small}>
              {b.reason ?? 'échec'}
              {b.indexer ? ` · ${b.indexer}` : ''}
              {b.at ? ` · ${ago(b.at)}` : ''}
            </Text>
          </View>
          <Pressable hitSlop={8} onPress={() => autoApi.unblockOne(settings, b.key).then(load)}>
            <Ionicons name="close-circle" size={22} color={C.textDim} />
          </Pressable>
        </View>
      ))}
    </Section>
  );
}


// ——— Téléchargements : file d'attente et historique, comme l'onglet Activité de Radarr / Sonarr ———
const fmtSpeed = (b?: number) => (!b ? '—' : b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo/s` : `${Math.round(b / 1e3)} ko/s`);
const fmtEta = (sec?: number | null) => {
  if (sec == null || sec <= 0) return '—';
  const m = Math.round(sec / 60);
  return m < 1 ? '< 1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const epLabel = (g: AutoGrab) =>
  g.episodes[0] === 'movie'
    ? 'Film'
    : g.episodes.length > 1
      ? `S${g.episodes[0].split(':')[0].padStart(2, '0')} · ${g.episodes.length} épisodes`
      : `S${g.episodes[0].split(':')[0].padStart(2, '0')}E${g.episodes[0].split(':')[1].padStart(2, '0')}`;
const grabColor = (g: AutoGrab) => (g.paused ? C.textDim : /bloqué|erreur|manquants/.test(g.statusText ?? '') ? C.warning : STATE_COLOR[g.state]);
const grabStatus = (g: AutoGrab) =>
  g.paused ? 'En pause' : g.state === 'downloading' ? (g.statusText ? g.statusText[0].toUpperCase() + g.statusText.slice(1) : 'Téléchargement') : STATE_LABEL[g.state][0].toUpperCase() + STATE_LABEL[g.state].slice(1);

function Telechargements({ st, reload, onItem, hideSeed }: { st: AutoState; reload: () => void; onItem: (id: string) => void; hideSeed?: boolean }) {
  const { settings } = useSettings();
  const [filter, setFilter] = useState<'all' | 'done' | 'failed'>('all');
  const queue = st.grabs.filter((g) => RUNNING.includes(g.state));
  const seeding = st.grabs.filter((g) => g.seeding);
  const past = st.grabs.filter((g) => !RUNNING.includes(g.state));
  const history = past.filter((g) => filter === 'all' || g.state === filter);
  const removable = history.filter((g) => !g.seeding).length;
  const speed = queue.reduce((n, g) => n + (g.paused ? 0 : g.speed || 0), 0);
  const left = queue.reduce((n, g) => n + Math.max(0, (g.size || g.release.size || 0) - (g.downloaded || 0)), 0);
  const clearAll = () =>
    Alert.alert(
      filter === 'all' ? 'Vider l’historique ?' : filter === 'done' ? 'Retirer les titres rangés ?' : 'Retirer les échecs ?',
      'Seules les lignes de l’historique disparaissent : les films restent dans la bibliothèque et ce qui partage encore continue.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Tout supprimer',
          style: 'destructive',
          onPress: () =>
            autoApi
              .clearHistory(settings, filter)
              .then((r) => (toast(r.message), reload()))
              .catch((e) => Alert.alert('Lumio Auto', e?.message ?? String(e))),
        },
      ]
    );
  return (
    <>
      <Fold id="tr-queue" title="File d’attente" count={queue.length} color={queue.length ? C.accent : undefined} right={queue.length ? <Text style={styles.small}>↓ {fmtSpeed(speed)} · reste {gb(left)}</Text> : null}>
        {!queue.length ? <Text style={styles.help}>Rien en cours. Les versions envoyées à {CLIENT_LABEL[st.client] ?? st.client} apparaissent ici.</Text> : null}
        {queue.map((g) => (
          <GrabRow key={g.id} g={g} reload={reload} onItem={onItem} />
        ))}
      </Fold>

      {seeding.length && !hideSeed ? (
        <Fold id="tr-seed" title="En partage" count={seeding.length} color={C.success} right={<Text style={styles.small}>↑ {fmtSpeed(seeding.reduce((n, g) => n + (g.upSpeed || 0), 0))}</Text>}>
          <Text style={styles.help}>
            Partagé jusqu’au ratio {st.seed?.ratio || 1}
            {st.seed?.days ? ` et au moins ${st.seed.days} jours` : ''}, puis retiré de qBittorrent. Le film reste dans la bibliothèque.
          </Text>
          {seeding.map((g) => {
            const goal = st.seed ?? { ratio: 1, days: 7 };
            const pct = Math.min(100, Math.max(goal.ratio ? ((g.ratio ?? 0) / goal.ratio) * 100 : 0, goal.days ? ((g.seedTime ?? 0) / (goal.days * 86400)) * 100 : 0));
            return (
              <View key={g.id} style={styles.card}>
                <Ionicons name="arrow-up-circle" size={22} color={C.success} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {g.title} · {epLabel(g)}
                  </Text>
                  <Text style={styles.small}>
                    ratio {g.ratio ?? 0} · {gb(g.uploaded ?? 0)} envoyés · {fmtEta(g.seedTime)} de partage{g.upSpeed ? ` · ↑ ${fmtSpeed(g.upSpeed)}` : ''}
                    {g.leechers ? ` · ${g.leechers} téléchargent` : ''}
                    {g.seedNote ? `\n${g.seedNote}` : ''}
                  </Text>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${pct || 2}%`, backgroundColor: C.success }]} />
                  </View>
                </View>
              </View>
            );
          })}
        </Fold>
      ) : null}

      <Fold
        id="tr-history"
        title="Historique"
        count={past.length}
        defaultOpen={false}
        right={
          removable ? (
            <Pressable onPress={clearAll} hitSlop={8} style={[styles.pill, { backgroundColor: 'rgba(255,69,58,0.15)' }]} accessibilityLabel="Tout supprimer de l’historique">
              <Ionicons name="trash-outline" size={14} color={C.danger} />
              <Text style={[styles.pillTxt, { color: C.danger }]}>Tout supprimer</Text>
            </Pressable>
          ) : null
        }>
        <View style={styles.metaRow}>
          <SegChip label="Tout" on={filter === 'all'} onPress={() => setFilter('all')} />
          <SegChip label="Rangés" on={filter === 'done'} onPress={() => setFilter('done')} icon="checkmark-circle-outline" />
          <SegChip label="Échecs" on={filter === 'failed'} onPress={() => setFilter('failed')} icon="alert-circle-outline" />
        </View>
        {!history.length ? <Text style={styles.dim}>Rien ici.</Text> : null}
        {history.slice(0, 40).map((g) => (
          <GrabRow key={g.id} g={g} reload={reload} onItem={onItem} />
        ))}
      </Fold>
    </>
  );
}

function GrabRow({ g, reload, onItem, compact }: { g: AutoGrab; reload: () => void; onItem?: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const running = RUNNING.includes(g.state);
  const color = grabColor(g);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.card}>
        <Ionicons
          name={g.paused ? 'pause-circle' : g.state === 'done' ? 'checkmark-circle' : g.state === 'failed' ? 'alert-circle' : g.state === 'importing' ? 'folder-open' : 'cloud-download'}
          size={22}
          color={color}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.title} numberOfLines={1}>
            {g.title} · {epLabel(g)}
          </Text>
          {!compact ? (
            <Text style={styles.small} numberOfLines={1}>
              {g.release.title}
            </Text>
          ) : null}
          <Text style={styles.small} numberOfLines={2}>
            <Text style={{ color, fontWeight: '700' }}>{grabStatus(g)}</Text>
            {running && g.state === 'downloading' && !g.paused ? ` · ${g.progress}% · ${fmtSpeed(g.speed)} · ${fmtEta(g.eta)}` : ''}
            {!running ? ` · ${ago(g.doneAt || g.startedAt)}` : ''}
            {g.error ? ` · ${g.error}` : ''}
          </Text>
          {running ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${g.progress || 2}%`, backgroundColor: g.paused ? C.textDim : C.accent }]} />
            </View>
          ) : null}
        </View>
        <Ionicons name="ellipsis-horizontal" size={18} color={C.textDim} />
      </Pressable>
      {open ? <GrabSheet g={g} onClose={() => setOpen(false)} reload={reload} onItem={onItem} /> : null}
    </>
  );
}

/** Détail d'un téléchargement + actions : pause, reprise, rangement manuel, retrait (avec options). */
function GrabSheet({ g, onClose, reload, onItem }: { g: AutoGrab; onClose: () => void; reload: () => void; onItem?: (id: string) => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const running = RUNNING.includes(g.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [rm, setRm] = useState({ client: true, blocklist: running, search: running });
  const [askRemove, setAskRemove] = useState(false);
  const act = async (key: string, fn: () => Promise<any>, msg?: string, close = false) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(r?.message ?? msg ?? 'OK');
      reload();
      if (close) onClose();
    } catch (e: any) {
      Alert.alert('Téléchargement', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };
  const size = g.size || g.release.size || 0;
  const rows: [string, string][] = [
    ['État', grabStatus(g)],
    ['Avancement', running ? `${g.progress}%${g.downloaded ? ` · ${gb(g.downloaded)} sur ${gb(size)}` : ''}` : g.state === 'done' ? '100%' : '—'],
    ['Taille', gb(size)],
    ...(running ? ([['Vitesse', fmtSpeed(g.speed)], ['Temps restant', fmtEta(g.eta)]] as [string, string][]) : []),
    ['Contenu', epLabel(g)],
    ['Indexeur', g.release.indexer],
    ['Sources', g.release.seeders != null ? String(g.release.seeders) : '—'],
    ['Client', g.client === 'alldebrid' ? 'AllDebrid (direct)' : `${CLIENT_LABEL[g.client ?? 'rdt']}${g.clientState ? ` · ${g.clientState}` : ''}`],
    ...(g.seeding || g.ratio != null
      ? ([['Partage', g.seeding ? `en cours · ratio ${g.ratio ?? 0} · ${gb(g.uploaded ?? 0)} envoyés` : `terminé${g.seedEnd ? ` (${g.seedEnd})` : ''}`]] as [string, string][])
      : []),
    ['Lancé', `${new Date(g.startedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${g.by && g.by !== 'auto' ? ` par ${g.by === 'rss' ? 'la veille RSS' : g.by}` : ' automatiquement'}`],
    ...(g.doneAt ? ([['Terminé', new Date(g.doneAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })]] as [string, string][]) : []),
  ];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1} numberOfLines={2}>
            {g.title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <Text style={styles.relTitle} selectable>
          {g.release.title}
        </Text>
        {running ? (
          <View style={[styles.bar, { height: 8, borderRadius: 4 }]}>
            <View style={[styles.barFill, { height: 8, width: `${g.progress || 2}%`, backgroundColor: g.paused ? C.textDim : C.accent }]} />
          </View>
        ) : null}
        {g.error ? (
          <View style={[styles.siteBox, { borderWidth: 1, borderColor: 'rgba(255,69,58,0.4)' }]}>
            <Text style={[styles.small, { color: C.danger, fontWeight: '700' }]}>{g.error}</Text>
            {/^import/.test(g.error) ? (
              <Text style={styles.small}>Le téléchargement est fini mais Lumio n’a pas su le ranger. Vérifie le nom des fichiers, puis « Réessayer le rangement ».</Text>
            ) : /introuvables/.test(g.error) ? (
              <Text style={styles.small}>Vérifie dans Réglages → rdt-client le « chemin vu par rdt-client » et le disque / dossier.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.siteBox}>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.kv}>
              <Text style={styles.kvK}>{k}</Text>
              <Text style={styles.kvV}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {running && g.client === 'rdt' && g.state !== 'importing' ? (
            <Button
              title={g.paused ? 'Reprendre' : 'Pause'}
              icon={g.paused ? 'play' : 'pause'}
              variant="secondary"
              small
              loading={busy === 'pause'}
              onPress={() => act('pause', () => (g.paused ? autoApi.resumeGrab(settings, g.id) : autoApi.pauseGrab(settings, g.id)), g.paused ? 'Repris' : 'En pause')}
              style={{ flex: 1 }}
            />
          ) : null}
          {g.state === 'failed' && g.importSrc ? (
            <Button title="Réessayer le rangement" icon="folder-open" small loading={busy === 'import'} onPress={() => act('import', () => autoApi.retryImport(settings, g.id), undefined, true)} style={{ flex: 1 }} />
          ) : null}
          {onItem ? (
            <Button
              title="Voir le titre"
              icon="film-outline"
              variant="secondary"
              small
              onPress={() => {
                onClose();
                onItem(g.itemId);
              }}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>

        {!askRemove ? (
          <Button title={running ? 'Retirer de la file…' : 'Retirer de l’historique…'} icon="trash-outline" variant="danger" onPress={() => setAskRemove(true)} />
        ) : (
          <View style={[styles.siteBox, { gap: 2 }]}>
            <Text style={[styles.title, { marginBottom: 4 }]}>{running ? 'Retirer de la file' : 'Retirer de l’historique'}</Text>
            {running || g.seeding ? <Toggle label={running ? `Supprimer aussi dans ${CLIENT_LABEL[g.client ?? 'rdt']} (et les fichiers)` : 'Arrêter le partage (la bibliothèque garde son fichier)'} value={rm.client} onChange={(v) => setRm((o) => ({ ...o, client: v }))} /> : null}
            <Toggle label="Mettre cette version en liste noire" value={rm.blocklist} onChange={(v) => setRm((o) => ({ ...o, blocklist: v }))} />
            <Toggle label="Chercher une autre version tout de suite" value={rm.search} onChange={(v) => setRm((o) => ({ ...o, search: v }))} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button title="Annuler" variant="secondary" small onPress={() => setAskRemove(false)} style={{ flex: 1 }} />
              <Button
                title="Retirer"
                icon="trash-outline"
                variant="danger"
                small
                loading={busy === 'rm'}
                onPress={() =>
                  autoApi
                    .removeGrab(settings, g.id, rm)
                    .then(() => (toast('Retiré'), reload(), onClose()))
                    .catch((e) =>
                      /^Règle C411/.test(e?.message ?? '')
                        ? Alert.alert('Attention : Hit & Run', e.message, [
                            { text: 'Garder en partage', style: 'cancel' },
                            { text: 'Retirer quand même', style: 'destructive', onPress: () => autoApi.removeGrab(settings, g.id, { ...rm, force: true }).then(() => (toast('Retiré'), reload(), onClose())) },
                          ])
                        : Alert.alert('Téléchargement', e?.message ?? String(e))
                    )
                }
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

function Reglages({ st, save }: { st: AutoState; save: (b: any, msg?: string) => void }) {
  const { settings } = useSettings();
  const [pf, setPf] = useState(st.profile);
  const setP = (k: keyof typeof pf, v: any) => setPf((o) => ({ ...o, [k]: v }));
  return (
    <>
      <Section title="Qualité" defaultOpen id="auto-profil">
        <Picker label="Résolution" options={[720, 1080, 2160].map((n) => ({ value: n, label: `${n}p` }))} value={pf.resolution} onChange={(v) => setP('resolution', v)} />
        <Picker
          label="Codec"
          options={[
            { value: 'preferred', label: 'H.265 de préférence', hint: 'conseillé : léger, sans blocage' },
            { value: 'required', label: 'H.265 obligatoire', hint: 'sinon tu choisis à la main' },
            { value: 'any', label: 'Peu importe' },
          ]}
          value={pf.h265}
          onChange={(v) => setP('h265', v)}
        />
        {pf.h265 === 'preferred' ? (
          <>
            <Picker
              label="Sortie récente : attendre une version H.265"
              options={[0, 24, 48, 72].map((n) => ({ value: n, label: n ? `${n} h` : 'Non' }))}
              value={pf.h265Wait ?? 48}
              onChange={(v) => setP('h265Wait', v)}
            />
            <Picker
              label="Remplacer le H.264 par du H.265 s’il arrive"
              options={[0, 7, 30, 90].map((n) => ({ value: n, label: n ? `pendant ${n} j` : 'Non' }))}
              value={pf.upgradeDays ?? 30}
              onChange={(v) => setP('upgradeDays', v)}
            />
            <Text style={styles.help}>
              Lumio prend toujours la version la plus légère. Pour un film ou un épisode qui vient de sortir, il attend d’abord une version H.265. Sinon il prend du H.264, puis le remplace tout seul si une version H.265 apparaît.
            </Text>
          </>
        ) : null}
        <Text style={styles.label}>Langues acceptées (dans l’ordre de préférence)</Text>
        <View style={styles.chips}>
          {LANGS.map((l) => {
            const on = pf.languages.includes(l.value);
            return (
              <SegChip
                key={l.value}
                label={on ? `${pf.languages.indexOf(l.value) + 1}. ${l.label}` : l.label}
                on={on}
                onPress={() => setP('languages', on ? pf.languages.filter((x) => x !== l.value) : [...pf.languages, l.value])}
              />
            );
          })}
        </View>
        <Text style={styles.help}>Les versions VOSTFR seules, les copies de cinéma (CAM, TS) et les REMUX sont toujours écartées.</Text>
        <Picker label="Taille maximale d’un film" options={[4, 6, 8, 12, 20].map((n) => ({ value: n, label: `${n} Go` }))} value={pf.maxMovieGb} onChange={(v) => setP('maxMovieGb', v)} />
        <Picker label="Taille maximale d’un épisode" options={[1, 1.5, 2.5, 4, 6].map((n) => ({ value: n, label: `${String(n).replace('.', ',')} Go` }))} value={pf.maxEpisodeGb} onChange={(v) => setP('maxEpisodeGb', v)} />
        <Toggle label="Accepter le 720p si rien en 1080p" value={pf.allowLower} onChange={(v) => setP('allowLower', v)} />
        <Picker label="Téléchargements en même temps" options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} value={pf.maxActive} onChange={(v) => setP('maxActive', v)} />
        <Picker label="Nouvelle recherche des titres manquants" options={[30, 60, 120, 360].map((n) => ({ value: n, label: n < 60 ? `${n} min` : `${n / 60} h` }))} value={pf.searchEveryMin} onChange={(v) => setP('searchEveryMin', v)} />
        <Picker label="Veille RSS" options={[15, 20, 30, 60].map((n) => ({ value: n, label: `${n} min` }))} value={pf.rssEveryMin} onChange={(v) => setP('rssEveryMin', v)} />
        <Button title="Enregistrer le profil" icon="checkmark" onPress={() => save({ profile: pf }, 'Profil enregistré')} />
      </Section>

      <Section title="Client de téléchargement" id="auto-client">
        <Picker
          label="Client par défaut"
          options={[
            { value: 'qbit', label: 'qBittorrent', hint: 'derrière le VPN, partage ensuite' },
            { value: 'rdt', label: 'rdt-client', hint: 'AllDebrid, sans partage' },
            { value: 'alldebrid', label: 'AllDebrid direct', hint: st.alldebrid ? 'clé présente' : 'clé manquante' },
          ]}
          value={st.client}
          onChange={(v) => save({ client: v })}
        />
        <Text style={styles.help}>Chaque indexeur peut avoir son propre client (onglet Sites) : par exemple C411 et TR4KER sur qBittorrent, le reste sur AllDebrid.</Text>
      </Section>

      <Section title="qBittorrent et partage" id="auto-qbit">
        <ClientForm kind="qbit" st={st} save={save} />
        <Text style={[styles.label, { marginTop: 12 }]}>Partage (seed) : retirer le torrent après</Text>
        <Picker
          label="Ratio à atteindre"
          options={[0, 0.5, 1, 1.5, 2, 3].map((n) => ({ value: n, label: n ? String(n) : 'Ignorer' }))}
          value={st.seed?.ratio ?? 1}
          onChange={(v) => save({ seed: { ratio: v, days: st.seed?.days ?? 7 } }, 'Partage enregistré')}
        />
        <Picker
          label="Et partager au moins"
          options={[0, 3, 7, 14, 30].map((n) => ({ value: n, label: n ? `${n} jours` : 'Ignorer' }))}
          value={st.seed?.days ?? 7}
          onChange={(v) => save({ seed: { ratio: st.seed?.ratio ?? 1, days: v } }, 'Partage enregistré')}
        />
        <Text style={styles.help}>
          Le torrent n’est retiré que quand les deux sont atteints (au plus 60 jours) : ton ratio ne peut que monter. Le film est rangé par lien dur : il apparaît dans la bibliothèque sans prendre de place en plus, et reste quand le torrent est retiré. Les téléchargements doivent être sur le même disque que la bibliothèque. Vérifie les règles de ratio de tes trackers.
        </Text>
      </Section>

      <Section title="AllDebrid (rdt-client)" id="auto-rdt">
        <ClientForm kind="rdt" st={st} save={save} />
      </Section>

      <Section title="Dossiers par défaut" id="auto-folders">
        <Picker label="Films" options={st.folders.movie.map((f) => ({ value: f.path, label: `${f.name}`, hint: f.root }))} value={st.folders.defaults.movie ?? st.folders.movie[0]?.path} onChange={(v) => save({ folders: { ...st.folders.defaults, movie: v } })} />
        <Picker label="Séries" options={st.folders.tv.map((f) => ({ value: f.path, label: `${f.name}`, hint: f.root }))} value={st.folders.defaults.tv ?? st.folders.tv[0]?.path} onChange={(v) => save({ folders: { ...st.folders.defaults, tv: v } })} />
        <Text style={styles.help}>Le dossier choisi dans une demande (Films, Kids, Séries, Animés…) est toujours respecté.</Text>
      </Section>

      <Blocklist />
      <Button title="Vider toute la liste noire" icon="refresh" variant="secondary" onPress={() => autoApi.unblock(settings).then(() => toast('Liste noire vidée'))} />
      <Journal st={st} />
    </>
  );
}


// ——— qBittorrent : tous les torrents, vitesses, actions (comme l'interface web, en plus simple) ———
const QB_STATE: Record<string, { label: string; color: string }> = {
  downloading: { label: 'Téléchargement', color: C.accent },
  forcedDL: { label: 'Téléchargement', color: C.accent },
  metaDL: { label: 'Infos…', color: C.textDim },
  forcedMetaDL: { label: 'Infos…', color: C.textDim },
  stalledDL: { label: 'Bloqué (pas de source)', color: C.warning },
  queuedDL: { label: 'En file', color: C.textDim },
  pausedDL: { label: 'En pause', color: C.textDim },
  stoppedDL: { label: 'En pause', color: C.textDim },
  checkingDL: { label: 'Vérification', color: C.textDim },
  checkingUP: { label: 'Vérification', color: C.textDim },
  uploading: { label: 'Partage', color: C.success },
  forcedUP: { label: 'Partage', color: C.success },
  stalledUP: { label: 'Partage (en attente)', color: C.success },
  queuedUP: { label: 'Partage en file', color: C.textDim },
  pausedUP: { label: 'Terminé (arrêté)', color: C.textDim },
  stoppedUP: { label: 'Terminé (arrêté)', color: C.textDim },
  moving: { label: 'Déplacement', color: C.textDim },
  error: { label: 'Erreur', color: C.danger },
  missingFiles: { label: 'Fichiers manquants', color: C.danger },
};
const qbGroup = (st: string) => (/DL$|^downloading$|^metaDL$/.test(st) ? 'dl' : /UP$|^uploading$/.test(st) ? 'up' : 'other');

function QbitTab({ noPrefs }: { noPrefs?: boolean } = {}) {
  const { settings } = useSettings();
  const [d, setD] = useState<Awaited<ReturnType<typeof autoApi.qbit>> | null>(null);
  const [filter, setFilter] = useState<'all' | 'dl' | 'up'>('all');
  const [sel, setSel] = useState<QbitTorrent | null>(null);
  const load = useCallback(() => {
    autoApi
      .qbit(settings)
      .then(setD)
      .catch((e) => setD({ ok: false, error: e?.message ?? String(e), torrents: [] }));
  }, [settings]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  const act = (action: Parameters<typeof autoApi.qbitAction>[1], hashes: string[] = [], msg?: string, force = false) =>
    autoApi
      .qbitAction(settings, action, hashes, force)
      .then(() => (msg ? toast(msg) : null, load()))
      .catch((e) =>
        /^Règle C411/.test(e?.message ?? '')
          ? Alert.alert('Attention : Hit & Run', e.message, [
              { text: 'Garder en partage', style: 'cancel' },
              { text: 'Supprimer quand même', style: 'destructive', onPress: () => act(action, hashes, msg, true) },
            ])
          : Alert.alert('qBittorrent', e?.message ?? String(e))
      );

  if (!d) return <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />;
  if (!d.ok)
    return (
      <View style={[styles.siteBox, { gap: 6 }]}>
        <Text style={[styles.title, { color: C.danger }]}>qBittorrent injoignable</Text>
        <Text style={styles.small}>{d.error}</Text>
        <Text style={styles.small}>Vérifie l’adresse et les identifiants dans Auto → Réglages → qBittorrent et partage.</Text>
      </View>
    );
  const t = d.transfer!;
  const list = d.torrents.filter((x) => filter === 'all' || qbGroup(x.state) === filter);
  const nDl = d.torrents.filter((x) => qbGroup(x.state) === 'dl').length;
  const nUp = d.torrents.filter((x) => qbGroup(x.state) === 'up').length;
  return (
    <>
      <View style={styles.qbStats}>
        <View style={styles.qbStat}>
          <Ionicons name="arrow-down" size={16} color={C.accent} />
          <Text style={styles.qbStatVal}>{fmtSpeed(t.dl)}</Text>
          <Text style={styles.small}>{t.dlLimit ? `max ${fmtSpeed(t.dlLimit)}` : 'sans limite'}</Text>
        </View>
        <View style={styles.qbStat}>
          <Ionicons name="arrow-up" size={16} color={C.success} />
          <Text style={styles.qbStatVal}>{fmtSpeed(t.up)}</Text>
          <Text style={styles.small}>{t.upLimit ? `max ${fmtSpeed(t.upLimit)}` : 'sans limite'}</Text>
        </View>
        <View style={styles.qbStat}>
          <Ionicons name={d.vpnPort ? 'shield-checkmark' : 'shield-outline'} size={16} color={d.vpnPort ? C.success : C.warning} />
          <Text style={styles.qbStatVal}>{d.vpnPort ? `port ${d.vpnPort}` : 'port ?'}</Text>
          <Text style={styles.small}>{t.status === 'connected' ? 'connecté' : t.status === 'firewalled' ? 'derrière un pare-feu' : t.status ?? ''}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title={t.alt ? 'Vitesse réduite : oui' : 'Vitesse réduite : non'}
          icon="speedometer-outline"
          variant="secondary"
          small
          onPress={() => act('alt', [], t.alt ? 'Vitesse normale' : 'Vitesse réduite (limites alternatives de qBittorrent)')}
          style={{ flex: 1 }}
        />
        {nDl ? (
          <Button title="Tout mettre en pause" icon="pause" variant="secondary" small onPress={() => act('pause', d.torrents.filter((x) => qbGroup(x.state) === 'dl').map((x) => x.hash), 'Téléchargements en pause')} style={{ flex: 1 }} />
        ) : null}
      </View>
      {noPrefs ? null : <QbitPrefsSection />}
      <View style={styles.metaRow}>
        <SegChip label={`Tout (${d.torrents.length})`} on={filter === 'all'} onPress={() => setFilter('all')} />
        <SegChip label={`Téléchargement (${nDl})`} on={filter === 'dl'} onPress={() => setFilter('dl')} />
        <SegChip label={`Partage (${nUp})`} on={filter === 'up'} onPress={() => setFilter('up')} />
      </View>
      {!list.length ? <Text style={styles.dim}>Aucun torrent.</Text> : null}
      {list.map((x) => {
        const stt = QB_STATE[x.state] ?? { label: x.state, color: C.textDim };
        return (
          <Pressable key={x.hash} onPress={() => setSel(x)} style={styles.card}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.relTitle} numberOfLines={2}>
                {x.lumio ? `${x.lumio} · ` : ''}
                {x.name}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                <Text style={{ color: stt.color, fontWeight: '700' }}>{stt.label}</Text>
                {qbGroup(x.state) === 'dl' ? ` · ${x.progress}% · ↓ ${fmtSpeed(x.dl)} · ${fmtEta(x.eta)}` : ` · ratio ${x.ratio}${x.up ? ` · ↑ ${fmtSpeed(x.up)}` : ''}`} · {gb(x.size)}
                {x.tracker ? ` · ${x.tracker}` : ''}
              </Text>
              {x.hrLeftH || x.swarmLeechers ? (
                <Text style={styles.small} numberOfLines={1}>
                  {x.hrLeftH ? <Text style={{ color: C.warning, fontWeight: '700' }}>🔒 encore {x.hrLeftH} h (règle C411)</Text> : null}
                  {x.hrLeftH && x.swarmLeechers ? ' · ' : ''}
                  {x.swarmLeechers ? `${x.swarmLeechers} téléchargent · ${x.swarmSeeders ?? '?'} partagent` : ''}
                </Text>
              ) : null}
              {x.progress < 100 ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.max(2, x.progress)}%`, backgroundColor: stt.color }]} />
                </View>
              ) : null}
            </View>
            <Ionicons name="ellipsis-horizontal" size={18} color={C.textDim} />
          </Pressable>
        );
      })}
      {sel ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSel(null)}>
          <Pressable style={styles.sheetBack} onPress={() => setSel(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.relTitle} numberOfLines={3}>
                {sel.name}
              </Text>
              <Text style={styles.small}>
                {(QB_STATE[sel.state] ?? { label: sel.state }).label} · {sel.progress}% · {gb(sel.size)} · ratio {sel.ratio} · {gb(sel.uploaded)} envoyés · {sel.seeds} sources / {sel.peers} pairs
                {sel.seedTime ? ` · ${fmtEta(sel.seedTime)} de partage` : ''}
                {sel.category ? ` · catégorie ${sel.category}` : ''}
              </Text>
              {(
                [
                  /paused|stopped/i.test(sel.state) ? ['resume', 'Reprendre', 'play'] : ['pause', 'Mettre en pause', 'pause'],
                  ['reannounce', 'Relancer les trackers', 'megaphone-outline'],
                  ['recheck', 'Vérifier les fichiers', 'checkmark-done-outline'],
                  ['delete', 'Retirer (garder les fichiers)', 'remove-circle-outline'],
                  ['deleteFiles', 'Supprimer avec les fichiers téléchargés', 'trash-outline'],
                ] as [Parameters<typeof autoApi.qbitAction>[1], string, keyof typeof Ionicons.glyphMap][]
              ).map(([a, label, icon]) => (
                <Button
                  key={a}
                  title={label}
                  icon={icon}
                  variant={a === 'deleteFiles' ? 'danger' : 'secondary'}
                  small
                  onPress={() => {
                    const h = sel.hash;
                    setSel(null);
                    if (a === 'deleteFiles')
                      Alert.alert(
                        'Supprimer avec les fichiers ?',
                        sel.lumio ? 'Le torrent et sa copie de téléchargement sont supprimés. Le film rangé dans la bibliothèque reste (lien dur).' : 'Le torrent et ses fichiers téléchargés sont supprimés du disque.',
                        [
                          { text: 'Annuler', style: 'cancel' },
                          { text: 'Supprimer', style: 'destructive', onPress: () => act('deleteFiles', [h], 'Supprimé') },
                        ]
                      );
                    else act(a, [h], 'OK');
                  }}
                />
              ))}
              <Button title="Fermer" variant="secondary" small onPress={() => setSel(null)} />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

/** Réglages de partage de qBittorrent, modifiables depuis l'appli. */
function QbitPrefsSection() {
  const { settings } = useSettings();
  const [p, setP] = useState<QbitPrefs | null>(null);
  const [seed, setSeed] = useState<AutoSeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    autoApi
      .qbitPrefs(settings)
      .then((r) => (setP(r.prefs), setSeed(r.seed), setErr(null)))
      .catch((e) => setErr(e?.message ?? String(e)));
  }, [settings]);
  useEffect(load, [load]);
  const put = (b: Partial<QbitPrefs> & { night?: boolean }, msg = 'Enregistré dans qBittorrent') =>
    autoApi
      .qbitPrefs(settings, b)
      .then((r) => (setP(r.prefs), toast(msg)))
      .catch((e) => Alert.alert('qBittorrent', e?.message ?? String(e)));
  const saveSeed = (s2: AutoSeed) =>
    autoApi
      .save(settings, { seed: s2 })
      .then(() => (setSeed(s2), toast('Objectif de partage enregistré')))
      .catch((e) => Alert.alert('Partage', e?.message ?? String(e)));
  const speeds = [0, 1, 2, 5, 10, 20, 50].map((n) => ({ value: n * 1024 * 1024, label: n ? `${n} Mo/s` : 'Sans limite' }));
  const nearest = (v: number, list: { value: number }[]) => (list.find((o) => o.value === v) ? v : list.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).value);
  const count = (vals: number[]) => vals.map((n) => ({ value: n, label: n < 0 ? 'Sans limite' : String(n) }));
  return (
    <Section title="Réglages du partage" id="auto-qbprefs">
      {err ? <Text style={[styles.small, { color: C.danger }]}>{err}</Text> : null}
      {!p ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <View style={{ gap: 4 }}>
          {/* Trois réglages simples, le reste en dessous */}
          <Toggle label="Envoi à fond la nuit (1 h – 8 h)" value={p.scheduler_enabled} onChange={(v) => put({ night: v }, v ? 'Envoi sans limite la nuit, de 1 h à 8 h' : 'Même vitesse jour et nuit')} />
          {seed ? (
            <>
              <Toggle label="Partage intelligent" value={seed.smart !== false} onChange={(v) => saveSeed({ ...seed, smart: v })} />
              <Toggle label="Résumé chaque soir (21 h)" value={seed.summary !== false} onChange={(v) => saveSeed({ ...seed, summary: v })} />
            </>
          ) : null}
          <Text style={styles.help}>
            Règle C411 toujours respectée : un torrent n’est jamais retiré avant 72 h de partage ou un ratio de 1 sur ce torrent (sinon c’est un Hit & Run). Partage intelligent : un torrent encore demandé (3 personnes ou plus) reste en partage même objectif atteint ; un torrent que plus personne ne demande depuis 14 jours est retiré une fois la durée minimum passée. Le résumé du soir arrive en notification : envoyé, reçu et partages.
          </Text>
          <Button
            title="Partager un maximum"
            icon="rocket-outline"
            small
            onPress={() =>
              put(
                { queueing_enabled: false, max_uploads: -1, max_uploads_per_torrent: -1, max_connec: 500, max_connec_per_torrent: 100, dont_count_slow_torrents: true },
                'Tous les torrents partagent en même temps'
              )
            }
          />
          <Text style={styles.help}>Coupe la file d’attente : tous les torrents finis partagent en même temps. La limite d’envoi ci-dessous reste respectée.</Text>
          <Toggle label="File d’attente (seulement quelques torrents actifs à la fois)" value={p.queueing_enabled} onChange={(v) => put({ queueing_enabled: v })} />
          {p.queueing_enabled ? (
            <>
              <Picker label="Torrents actifs au total" options={count([5, 10, 20, 50, 100, -1])} value={nearest(p.max_active_torrents, count([5, 10, 20, 50, 100, -1]))} onChange={(v) => put({ max_active_torrents: v })} />
              <Picker label="… dont en partage" options={count([3, 5, 10, 20, 50, 100, -1])} value={nearest(p.max_active_uploads, count([3, 5, 10, 20, 50, 100, -1]))} onChange={(v) => put({ max_active_uploads: v })} />
              <Picker label="… dont en téléchargement" options={count([1, 2, 3, 5, 10])} value={nearest(p.max_active_downloads, count([1, 2, 3, 5, 10]))} onChange={(v) => put({ max_active_downloads: v })} />
              <Toggle label="Ne pas compter les torrents sans activité" value={p.dont_count_slow_torrents} onChange={(v) => put({ dont_count_slow_torrents: v })} />
            </>
          ) : null}
          <Picker label="Vitesse d’envoi maximum" options={speeds} value={nearest(p.up_limit, speeds)} onChange={(v) => put({ up_limit: v })} />
          <Picker label="Vitesse de réception maximum" options={speeds} value={nearest(p.dl_limit, speeds)} onChange={(v) => put({ dl_limit: v })} />
          <Picker label="Envois en même temps (au total)" options={count([20, 50, 100, -1])} value={nearest(p.max_uploads, count([20, 50, 100, -1]))} onChange={(v) => put({ max_uploads: v })} />
          <Picker label="Envois en même temps (par torrent)" options={count([4, 8, 16, -1])} value={nearest(p.max_uploads_per_torrent, count([4, 8, 16, -1]))} onChange={(v) => put({ max_uploads_per_torrent: v })} />
          {seed ? (
            <>
              <Text style={[styles.label, { marginTop: 10 }]}>Quand Lumio retire un torrent (le film reste dans la bibliothèque)</Text>
              <Picker
                label="Ratio à atteindre"
                options={[0.5, 1, 1.5, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))}
                value={seed.ratio || 1}
                onChange={(v) => saveSeed({ ...seed, ratio: v })}
              />
              <Picker
                label="Et partager au moins"
                options={[0, 3, 7, 14, 30, 60].map((n) => ({ value: n, label: n ? `${n} jours` : '72 h (minimum C411)' }))}
                value={seed.days ?? 7}
                onChange={(v) => saveSeed({ ...seed, days: v })}
              />
              <Text style={styles.help}>Plus le ratio et la durée sont élevés, plus les torrents restent en partage longtemps (au plus 60 jours).</Text>
            </>
          ) : null}
        </View>
      )}
    </Section>
  );
}

/** Réglages d'un client torrent (même API pour qBittorrent et rdt-client). */
function ClientForm({ kind, st, save }: { kind: 'rdt' | 'qbit'; st: AutoState; save: (b: any, msg?: string) => void }) {
  const { settings } = useSettings();
  const cur = (kind === 'qbit' ? st.qbit : st.rdt) ?? { url: '', user: '', hasPass: false, category: 'lumio', remotePath: '', localRoot: '', localFolder: '' };
  const [f, setF] = useState({ ...cur, pass: '' });
  const name = kind === 'qbit' ? 'qBittorrent' : 'rdt-client';
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  return (
    <>
      <Field label={`Adresse de ${name}`} value={f.url} onChangeText={(v) => set('url', v)} placeholder={kind === 'qbit' ? 'http://gluetun:8080' : 'http://rdtclient:6500'} keyboardType="url" hint={kind === 'qbit' ? 'qBittorrent passe par le conteneur du VPN : c’est son nom qu’on appelle.' : undefined} />
      <Field label="Identifiant" value={f.user} onChangeText={(v) => set('user', v)} />
      <Field label={`Mot de passe${cur.hasPass ? ' · enregistré ✓' : ''}`} value={f.pass} onChangeText={(v) => set('pass', v)} secureTextEntry placeholder={cur.hasPass ? 'Coller pour remplacer' : ''} />
      <Field label="Catégorie" value={f.category} onChangeText={(v) => set('category', v)} placeholder="lumio" />
      <Field
        label={`Dossier des téléchargements vu par ${name}`}
        value={f.remotePath}
        onChangeText={(v) => set('remotePath', v)}
        placeholder={kind === 'qbit' ? '/downloads' : '/data/downloads'}
      />
      <Picker label="Le même dossier, vu par Lumio : disque" options={st.disks.map((d) => ({ value: d, label: d }))} value={f.localRoot} onChange={(v) => set('localRoot', v)} />
      <Field label="… et dossier sur ce disque" value={f.localFolder} onChangeText={(v) => set('localFolder', v)} placeholder={kind === 'qbit' ? 'downloads/qbit' : 'downloads'} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Enregistrer" icon="checkmark" onPress={() => save({ [kind]: { ...f, pass: f.pass || undefined, hasPass: undefined } }, `${name} enregistré`)} style={{ flex: 1 }} />
        <Button
          title="Tester"
          icon="pulse"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() =>
            autoApi
              .testClient(settings, kind)
              .then((r) => Alert.alert(name, `${r.ok ? '✅' : '❌'} ${r.message}`))
              .catch((e) => Alert.alert(name, e.message))
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  qbStats: { flexDirection: 'row', gap: 8 },
  qbStat: { flex: 1, padding: 12, borderRadius: 16, backgroundColor: C.surface, gap: 2 },
  qbStatVal: { color: C.text, fontSize: 15, fontWeight: '800' },
  sheetBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, padding: 18, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 10 },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 6, padding: 3, borderRadius: 14, backgroundColor: C.surface },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6, borderRadius: 11 },
  segOn: { backgroundColor: '#fff' },
  segTxt: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  segBadge: { position: 'absolute', top: 2, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  segBadgeTxt: { color: '#000', fontSize: 10, fontWeight: '900' },
  ahead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  aheadTitle: { color: C.text, fontSize: 34, fontWeight: '900', letterSpacing: -0.8 },
  aheadSub: { color: C.textDim, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  aheadDot: { width: 9, height: 9, borderRadius: 5 },
  gear: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bigCard: { backgroundColor: C.surface, borderRadius: 22, padding: 16, gap: 8 },
  bigCardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  bigNum: { fontSize: 28, fontWeight: '900' },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, marginTop: 4 },
  foldTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  foldCount: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceHigh },
  foldCountTxt: { color: C.text, fontSize: 12, fontWeight: '900' },
  list: { borderRadius: 20, backgroundColor: C.surface, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  itemSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  epGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  epChip: { minWidth: 46, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  epChipTxt: { color: C.text, fontSize: 13, fontWeight: '800' },
  ratioCard: { borderRadius: 20, backgroundColor: C.surface, padding: 16, gap: 10 },
  svcStep: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, backgroundColor: C.surfaceHigh, borderWidth: 1.5, borderColor: 'transparent' },
  tile: { flex: 1, backgroundColor: C.surface, borderRadius: 18, padding: 12, gap: 3 },
  tileNum: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 46, borderRadius: 14, backgroundColor: C.surfaceHigh },
  searchInput: { flex: 1, color: C.text, fontSize: 16 },
  svcBar: { height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  ratioRow: { flexDirection: 'row', gap: 10 },
  ratioLabel: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  ratioBig: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  ratioHuge: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  ratioAlert: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, backgroundColor: 'rgba(255,159,10,0.12)' },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: C.surface },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  missPoster: { width: 38, height: 56, borderRadius: 7 },
  missSeason: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: C.surfaceHigh },
  itemIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  groupHead: { color: C.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, borderWidth: 1.5, backgroundColor: C.surface },
  bannerTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  h1: { color: C.text, fontSize: 22, fontWeight: '800', flex: 1 },
  h2: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  help: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.surface },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  relTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: C.surfaceHigh },
  pillTxt: { color: C.text, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  bar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 4 },
  barFill: { height: 5, backgroundColor: C.accent },
  log: { color: C.textDim, fontSize: 12, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  statusTxt: { fontSize: 11, fontWeight: '800' },
  small: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  mono: { color: C.textDim, fontSize: 11, lineHeight: 16, fontFamily: 'Menlo' },
  siteBox: { padding: 12, borderRadius: 16, backgroundColor: C.surface, gap: 4 },
  rel: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: 'transparent' },
  tag: { color: C.text, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  kvK: { color: C.textDim, fontSize: 13 },
  kvV: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  dl: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventTxt: { color: C.text, fontSize: 13, lineHeight: 18 },
});


// ═══════════════════ Lumio Auto : sept onglets très lisibles ═══════════════════
// Performance (vue d'ensemble), Seed, Demandes, qBittorrent, Disques, Serveur, Lecture. Les réglages : roue en haut à droite.

const fmtSpeed2 = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mo/s` : `${Math.round(b / 1e3)} ko/s`).replace('.', ',');

/** Grand titre + une phrase d'état + la roue des réglages. */
function AutoHeader({ title, sub, color }: { title: string; sub?: string | null; color?: string }) {
  return (
    <View style={styles.ahead}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.aheadTitle}>{title}</Text>
        {sub ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            {color ? <View style={[styles.aheadDot, { backgroundColor: color }]} /> : null}
            <Text style={styles.aheadSub} numberOfLines={2}>
              {sub}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => router.push('/settings')} hitSlop={10} style={styles.gear} accessibilityLabel="Réglages">
        <Ionicons name="settings-outline" size={20} color={C.text} />
      </Pressable>
    </View>
  );
}

const fmtDisk = (n?: number | null) => (n == null ? '—' : n >= 1e12 ? `${(n / 1e12).toFixed(2).replace('.', ',')} To` : `${Math.round(n / 1e9)} Go`);

/** Petite tuile de la vue d'ensemble : un chiffre, une légende, ouvre l'onglet concerné. */
function PerfTile({ icon, value, label, color, to }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string; color: string; to: string }) {
  return (
    <Pressable onPress={() => router.navigate(to as never)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.tileNum, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.small} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Onglet « Performance » : vue d'ensemble (lectures, service en route, place) puis la machine et les services. */
export function AutoPerfScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<{ name: string; ok: boolean }[] | null>(null);
  const [watching, setWatching] = useState<JfSession[]>([]);
  const [disks, setDisks] = useState<Disk[] | null>(null);
  const [ratio, setRatio] = useState<AutoRatio | null>(null);
  const load = useCallback(() => {
    serverCall<{ services: { name: string; ok: boolean }[] }>(settings, '/api/uptime')
      .then((r) => setServices(r.services))
      .catch(() => setServices(null));
    jf.sessions(settings)
      .then((l) => setWatching(l.filter((x) => x.NowPlayingItem)))
      .catch(() => {});
    filesApi.disks(settings).then(setDisks).catch(() => {});
    autoApi.ratio(settings).then(setRatio).catch(() => {});
  }, [settings]);
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 15000);
      return () => clearInterval(t);
    }, [load])
  );
  const bad = services?.filter((x) => !x.ok) ?? [];
  const free = disks ? disks.reduce((n, d) => n + (d.free || 0), 0) : null;
  const tight = disks?.some((d) => d.free != null && d.free < 30e9);
  // Ratio du premier site (vrai ratio du profil si le serveur le lit, sinon l'estimation)
  const site = ratio?.sites?.[0];
  const rv = site ? (site.estimate?.ratio ?? site.lumio.ratio) : null;
  const svc = rv == null ? { v: '—', l: site ? `Ratio ${site.name}` : 'Ratio', c: C.textDim } : { v: fmtRatio(rv), l: `Ratio ${site!.name}`, c: rv < 1 ? C.danger : rv < 1.1 ? C.warning : C.success };
  const names = [...new Set(watching.map((w) => w.UserName).filter(Boolean))];
  const boost = ratio?.boost;
  return (
    <SectionCollapse.Provider value={COLLAPSE}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <AutoHeader
          title="Performance"
          sub={!services ? 'Connexion au serveur…' : bad.length ? `${bad.map((x) => x.name).join(', ')} hors ligne` : 'Tout fonctionne'}
          color={!services ? C.textFaint : bad.length ? C.danger : C.success}
        />
        <View style={styles.ratioRow}>
          <PerfTile icon="play-circle" value={String(watching.length)} label={watching.length ? names.join(', ') : 'Personne ne regarde'} color={watching.length ? C.success : C.textDim} to="/playing" />
          <PerfTile icon="swap-vertical" value={svc.v} label={svc.l} color={svc.c} to="/auto" />
          <PerfTile icon="server" value={fmtDisk(free)} label={tight ? 'Un disque est presque plein' : 'libres sur les disques'} color={tight ? C.warning : C.text} to="/disks" />
        </View>
        {boost?.enabled ? (
          <Pressable onPress={() => router.navigate('/auto' as never)} style={styles.stateLine}>
            <Ionicons name="rocket" size={14} color={C.success} />
            <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
              Booster de seed : {boost.torrents.length} torrent{boost.torrents.length > 1 ? 's' : ''} · {gb(boost.used)} / {boost.gb} Go
            </Text>
            <Ionicons name="chevron-forward" size={14} color={C.textFaint} />
          </Pressable>
        ) : null}
        <UptimeSection />
      </ScrollView>
    </SectionCollapse.Provider>
  );
}

/** Recherche dans les bibliothèques Jellyfin : ouvrir un titre pour le supprimer, le déplacer, le rescanner. */
function LibrarySearchCard() {
  const { settings } = useSettings();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<JfItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      jf.items(settings, { search: term, types: 'Movie,Series', limit: 20 })
        .then((r) => alive && setItems(r.Items))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, settings]);
  return (
    <View style={styles.bigCard}>
      <Text style={styles.bigCardTitle}>Chercher un film ou une série</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={C.textDim} />
        <TextInput value={q} onChangeText={setQ} placeholder="Titre dans les bibliothèques" placeholderTextColor={C.textFaint} style={styles.searchInput} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        {loading ? <ActivityIndicator size="small" color={C.textDim} /> : null}
      </View>
      {items === null ? (
        <Text style={styles.small}>Tape au moins 2 lettres, puis ouvre le titre : supprimer, déplacer sur un autre disque, modifier les infos, rescanner.</Text>
      ) : !items.length ? (
        <Text style={styles.small}>Aucun titre trouvé dans les bibliothèques.</Text>
      ) : (
        items.map((item) => (
          <Pressable key={item.Id} onPress={() => router.push({ pathname: '/jellyfin/[id]', params: { id: item.Id } })} style={({ pressed }) => [styles.watchRow, { gap: 12 }, pressed && { opacity: 0.75 }]}>
            <Image source={jfPoster(settings, item, 180)} style={styles.missPoster} contentFit="cover" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title} numberOfLines={1}>
                {item.Name}
              </Text>
              <Text style={styles.small}>
                {item.Type === 'Series' ? 'Série' : 'Film'}
                {item.ProductionYear ? ` · ${item.ProductionYear}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
          </Pressable>
        ))
      )}
    </View>
  );
}

/** Onglet « Disques » : place sur chaque disque, recherche dans les bibliothèques, fichiers, téléchargements, stockage. */
export function AutoDisksScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [disks, setDisks] = useState<Disk[] | null>(null);
  const load = useCallback(() => {
    filesApi.disks(settings).then(setDisks).catch(() => setDisks([]));
  }, [settings]);
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 30000);
      return () => clearInterval(t);
    }, [load])
  );
  const free = (disks ?? []).reduce((n, d) => n + (d.free || 0), 0);
  const tight = (disks ?? []).filter((d) => d.free != null && d.free < 30e9);
  return (
    <SectionCollapse.Provider value={COLLAPSE}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <AutoHeader
          title="Disques"
          sub={!disks ? 'Lecture des disques…' : tight.length ? `${tight.map((d) => d.name).join(', ')} presque plein` : `${fmtDisk(free)} libres en tout`}
          color={!disks ? C.textFaint : tight.length ? C.warning : C.success}
        />
        <View style={styles.bigCard}>
          <Text style={styles.bigCardTitle}>Place sur les disques</Text>
          {!disks ? <ActivityIndicator color={C.text} /> : null}
          {disks && !disks.length ? <Text style={styles.small}>Aucun disque déclaré sur le serveur.</Text> : null}
          {(disks ?? []).map((d) => {
            const used = d.total && d.free != null ? d.total - d.free : null;
            const pct = d.total && used != null ? Math.min(100, (used / d.total) * 100) : 0;
            const color = d.free != null && d.free < 30e9 ? C.danger : pct > 85 ? C.warning : C.success;
            return (
              <Pressable key={d.name} onPress={() => router.push({ pathname: '/files', params: { root: d.name } })} style={({ pressed }) => [{ gap: 5 }, pressed && { opacity: 0.75 }]}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{d.name}</Text>
                  <Text style={[styles.small, { color, fontWeight: '800' }]}>{fmtDisk(d.free)} libres</Text>
                </View>
                <View style={styles.svcBar}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: color }} />
                </View>
                <Text style={styles.small}>
                  {fmtDisk(used)} utilisés sur {fmtDisk(d.total)} · {Math.round(pct)} %
                </Text>
              </Pressable>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable onPress={() => router.push('/files')} style={[styles.pill, { flex: 1, justifyContent: 'center', paddingVertical: 12 }]}>
              <Ionicons name="folder-open-outline" size={16} color={C.text} />
              <Text style={styles.pillTxt}>Parcourir</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/downloads')} style={[styles.pill, { flex: 1, justifyContent: 'center', paddingVertical: 12 }]}>
              <Ionicons name="cloud-download-outline" size={16} color={C.text} />
              <Text style={styles.pillTxt}>Téléchargements</Text>
            </Pressable>
          </View>
        </View>
        <LibrarySearchCard />
        <StorageSection />
      </ScrollView>
    </SectionCollapse.Provider>
  );
}

/** Onglet « Serveur » : scanner, redémarrer, mettre à jour (serveur Lumio, conteneurs, PC). */
export function AutoServerScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [version, setVersion] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      serverCall<{ version?: string }>(settings, '/health')
        .then((r) => setVersion(r.version ?? null))
        .catch(() => setVersion(null));
    }, [settings])
  );
  return (
    <SectionCollapse.Provider value={COLLAPSE}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}>
        <AutoHeader title="Serveur" sub={version ? `Serveur Lumio ${version}` : 'Redémarrer et mettre à jour'} color={version ? C.success : C.textFaint} />
        <ServerActionsSection />
        <DirectDownloadCard />
      </ScrollView>
    </SectionCollapse.Provider>
  );
}

/** Téléchargement direct (bouton « Movix ») : les deux services qui ouvrent les liens, et la clé TorBox gardée sur le serveur. */
function DirectDownloadCard() {
  const { settings } = useSettings();
  const [st, setSt] = useState<{ alldebrid: boolean; torbox?: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    serverCall<{ alldebrid: boolean; torbox?: boolean }>(settings, '/api/secour')
      .then(setSt)
      .catch(() => setSt(null));
  }, [settings]);
  useFocusEffect(load);
  const save = (k: string) => {
    setBusy(true);
    serverCall<{ torbox: boolean }>(settings, '/api/secour/torbox', { method: 'PUT', body: JSON.stringify({ key: k }) })
      .then(() => (setKey(''), toast(k ? 'Clé TorBox enregistrée sur le serveur' : 'Clé TorBox retirée'), load()))
      .catch((e) => Alert.alert('Téléchargement direct', /404|inconnue/.test(e?.message ?? '') ? 'Mets le serveur à jour (3.98.0).' : (e?.message ?? String(e))))
      .finally(() => setBusy(false));
  };
  if (!st) return null;
  return (
    <View style={styles.bigCard}>
      <Text style={styles.bigCardTitle}>Téléchargement direct</Text>
      <Text style={styles.small}>Le bouton « Movix » des fiches télécharge sans passer par le tracker. AllDebrid ouvre le lien ; s’il n’y arrive pas, TorBox essaie à son tour.</Text>
      <View style={styles.kv}>
        <Text style={styles.kvK}>AllDebrid</Text>
        <Text style={[styles.small, { color: st.alldebrid ? C.success : C.warning, fontWeight: '700' }]}>{st.alldebrid ? 'clé enregistrée' : 'pas de clé'}</Text>
      </View>
      <View style={styles.kv}>
        <Text style={styles.kvK}>TorBox</Text>
        <Text style={[styles.small, { color: st.torbox ? C.success : C.textDim, fontWeight: '700' }]}>{st.torbox === undefined ? 'serveur à mettre à jour' : st.torbox ? 'clé enregistrée' : 'pas de clé'}</Text>
      </View>
      <View style={styles.searchBox}>
        <Ionicons name="key-outline" size={18} color={C.textDim} />
        <TextInput value={key} onChangeText={setKey} placeholder={st.torbox ? 'Nouvelle clé API TorBox' : 'Clé API TorBox'} placeholderTextColor={C.textFaint} style={styles.searchInput} autoCapitalize="none" autoCorrect={false} secureTextEntry />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Enregistrer la clé" icon="save-outline" small loading={busy} disabled={!key.trim()} onPress={() => save(key.trim())} style={{ flex: 1 }} />
        {st.torbox ? <Button title="Retirer" variant="secondary" small onPress={() => save('')} /> : null}
      </View>
      <Text style={styles.small}>La clé part sur ton serveur et y reste : elle n’est jamais renvoyée aux applis.</Text>
    </View>
  );
}

/** Onglet « Lecture » : qui regarde quoi (affiche, avancement, compte, appareil, lecture directe ou conversion) et les statistiques. */
export function AutoPlayingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 12 }}>
      <AutoHeader title="Lecture" sub="Mis à jour toutes les 5 secondes" />
      <SessionsBody />
    </ScrollView>
  );
}

/** Onglet « Seed » : ratio et marge par site, torrents en partage, réglages du partage. */
export function AutoSeedScreen() {
  const insets = useSafeAreaInsets();
  const { st, load } = useAutoState();
  const seeding = st?.grabs.filter((g) => g.seeding) ?? [];
  const up = seeding.reduce((n, g) => n + (g.upSpeed || 0), 0);
  const goal = st?.seed ?? { ratio: 1, days: 7 };
  return (
    <SectionCollapse.Provider value={COLLAPSE}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <AutoHeader title="Seed" sub={st ? `${seeding.length} en partage · ↑ ${fmtSpeed2(up)}` : null} color={seeding.length ? C.success : C.textFaint} />
        <SeedAutoCards />
        <RatioTab />
        {st ? (
          <Fold id="seed-list" title="En partage" count={seeding.length} color={seeding.length ? C.success : undefined}>
            {!seeding.length ? <Text style={styles.help}>Rien en partage pour le moment.</Text> : null}
            {seeding.map((g) => {
              const pct = Math.min(100, Math.max(goal.ratio ? ((g.ratio ?? 0) / goal.ratio) * 100 : 0, goal.days ? ((g.seedTime ?? 0) / (goal.days * 86400)) * 100 : 0));
              return (
                <View key={g.id} style={styles.card}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
                        {g.title}
                      </Text>
                      <Text style={[styles.title, { color: (g.ratio ?? 0) >= 1 ? C.success : C.warning }]}>{(g.ratio ?? 0).toFixed(2).replace('.', ',')}</Text>
                    </View>
                    <Text style={styles.small}>
                      ↑ {gb(g.uploaded ?? 0)} envoyés · {fmtEta(g.seedTime)} de partage{g.upSpeed ? ` · ${fmtSpeed2(g.upSpeed)}` : ''}
                    </Text>
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${pct || 2}%`, backgroundColor: C.success }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </Fold>
        ) : null}
        <QbitPrefsSection />
      </ScrollView>
    </SectionCollapse.Provider>
  );
}

/** Onglet « qBittorrent » : interrupteurs, téléchargements en cours, liste des torrents, historique. */
export function AutoQbitScreen() {
  const insets = useSafeAreaInsets();
  const { st, error, load, save } = useAutoState();
  const [itemOpen, setItemOpen] = useState<string | null>(null);
  const open = st?.items.find((i) => i.id === itemOpen) ?? null;
  const running = st?.grabs.filter((g) => RUNNING.includes(g.state)) ?? [];
  const down = running.reduce((n, g) => n + (g.paused ? 0 : g.speed || 0), 0);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SectionCollapse.Provider value={COLLAPSE}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
          <AutoHeader title="qBittorrent" sub={st ? (running.length ? `${running.length} en téléchargement · ↓ ${fmtSpeed2(down)}` : 'Rien en téléchargement') : null} color={running.length ? C.accent : C.textFaint} />
          {!st ? (
            <Loading error={error} />
          ) : (
            <>
              <Switches st={st} save={save} running={running.length} toChoose={st.items.filter((i) => i.needsChoice).length} />
              <Telechargements st={st} reload={load} onItem={(id) => setItemOpen(id)} hideSeed />
              <AddTorrentCard />
              <Fold id="qb-all" title="Tous les torrents" defaultOpen={false}>
                <QbitTab noPrefs />
              </Fold>
            </>
          )}
        </ScrollView>
      </SectionCollapse.Provider>
      {open && st ? <ItemSheet item={open} st={st} onClose={() => setItemOpen(null)} reload={load} /> : null}
    </View>
  );
}

/** Onglet « Demandes » : les demandes de la famille, les titres suivis par Lumio Auto, les épisodes manquants. */
export function AutoDemandesScreen() {
  const insets = useSafeAreaInsets();
  const [part, setPart] = useState<'demandes' | 'titres' | 'manquants'>('demandes');
  const { st, error, load } = useAutoState();
  const [itemOpen, setItemOpen] = useState<string | null>(null);
  const open = st?.items.find((i) => i.id === itemOpen) ?? null;
  const toChoose = st?.items.filter((i) => i.needsChoice).length ?? 0;
  const seg = (
    <View style={[styles.seg, { marginHorizontal: 16, marginBottom: 10 }]}>
      {(
        [
          { id: 'demandes', label: 'Demandes', badge: 0 },
          { id: 'titres', label: 'Titres', badge: toChoose },
          { id: 'manquants', label: 'Manquants', badge: 0 },
        ] as const
      ).map((t) => (
        <Pressable key={t.id} onPress={() => setPart(t.id)} style={[styles.segItem, part === t.id && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: part === t.id }}>
          <Text style={[styles.segTxt, part === t.id && { color: '#000' }]}>{t.label}</Text>
          {t.badge ? (
            <View style={[styles.segBadge, { backgroundColor: C.warning }]}>
              <Text style={styles.segBadgeTxt}>{t.badge}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
  const header = (
    <View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <AutoHeader title="Demandes" sub={toChoose ? `${toChoose} version(s) à choisir` : null} color={toChoose ? C.warning : undefined} />
      </View>
      {seg}
    </View>
  );
  if (part === 'demandes') return <ServerRequests header={header} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <SectionCollapse.Provider value={COLLAPSE}>
        <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE + 20 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
          {header}
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {part === 'titres' ? st ? <Demandes st={st} onItem={(i) => setItemOpen(i.id)} /> : <Loading error={error} /> : <Manquants />}
          </View>
        </ScrollView>
      </SectionCollapse.Provider>
      {open && st ? <ItemSheet item={open} st={st} onClose={() => setItemOpen(null)} reload={load} /> : null}
    </View>
  );
}
