// Lumio Auto → « Tableau » : l'essentiel du serveur en un coup d'œil, chaque carte ouvre le détail.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { C, TAB_SPACE } from '@/constants/theme';
import { APP_VERSION, useAppUpdate } from '@/lib/app-update';
import { autoApi, type AutoRatio, type AutoState } from '@/lib/auto';
import { serverCall } from '@/lib/chat';
import { jf, type JfSession } from '@/lib/jellyfin';
import { usePendingRequests } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

type Service = { key: string; name: string; ok: boolean };
type System = { cpu: number | null; temp: number | null; disks: { name: string; free: number | null; total: number | null }[] };

const RUNNING = ['sent', 'downloading', 'importing'];
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} To` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} Go` : `${Math.round(b / 1e6)} Mo`).replace('.', ',');
const speed = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mo/s` : `${Math.round(b / 1e3)} ko/s`).replace('.', ',');
const ratioColor = (r: number | null | undefined) => (r == null ? C.textDim : r >= 1.2 ? C.success : r >= 1 ? C.warning : C.danger);

export function AutoDashboard() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const update = useAppUpdate();
  const pending = usePendingRequests();
  const [st, setSt] = useState<AutoState | null>(null);
  const [ratio, setRatio] = useState<AutoRatio | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [sys, setSys] = useState<System | null>(null);
  const [watching, setWatching] = useState<JfSession[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    autoApi
      .state(settings)
      .then((s) => (setSt(s), setErr(null)))
      .catch((e) => setErr(e?.message ?? String(e)));
    autoApi.ratio(settings).then(setRatio).catch(() => {});
    serverCall<{ services: Service[] }>(settings, '/api/uptime')
      .then((r) => setServices(r.services))
      .catch(() => {});
    serverCall<System>(settings, '/api/system').then(setSys).catch(() => {});
    jf.sessions(settings)
      .then((l) => setWatching(l.filter((x) => x.NowPlayingItem)))
      .catch(() => {});
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 10000);
      return () => clearInterval(t);
    }, [load])
  );

  const save = async (b: Parameters<typeof autoApi.save>[1], msg: string) => {
    try {
      await autoApi.save(settings, b);
      toast(msg);
      load();
    } catch (e: any) {
      Alert.alert('Lumio Auto', e?.message ?? String(e));
    }
  };

  const running = st?.grabs.filter((g) => RUNNING.includes(g.state)) ?? [];
  const seeding = st?.grabs.filter((g) => g.seeding) ?? [];
  const toChoose = st?.items.filter((i) => i.needsChoice).length ?? 0;
  const down = running.reduce((n, g) => n + (g.paused ? 0 : g.speed || 0), 0);
  const up = seeding.reduce((n, g) => n + (g.upSpeed || 0), 0);
  const down_ = services?.filter((s) => !s.ok) ?? [];
  const site = ratio?.sites.find((x) => x.type === 'c411' || /c411/i.test(x.name)) ?? ratio?.sites[0] ?? null;
  const siteRatio = site ? (site.estimate?.ratio ?? site.lumio.ratio) : null;
  const marge = site?.estimate && (site.type === 'c411' || /c411/i.test(site.name)) ? site.estimate.up / 0.8 - site.estimate.down : null;
  const quotaPct = site?.cap ? Math.min(100, (site.today / site.cap) * 100) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: TAB_SPACE + 20, gap: 14 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
      {/* En-tête : état global en une phrase */}
      <View style={{ gap: 4, marginBottom: 4 }}>
        <Text style={s.h1}>Lumio Auto</Text>
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: !services ? C.textFaint : down_.length ? C.danger : C.success }]} />
          <Text style={s.sub}>
            {!services ? 'Connexion au serveur…' : down_.length ? `${down_.map((x) => x.name).join(', ')} hors ligne` : 'Tout fonctionne'}
            {sys?.cpu != null ? ` · CPU ${Math.round(sys.cpu)} %` : ''}
            {sys?.temp != null ? ` · ${Math.round(sys.temp)} °C` : ''}
          </Text>
        </View>
      </View>

      {err && !st ? <Text style={s.sub}>{/404|inconnue/.test(err) ? 'Mets le serveur Lumio à jour (Réglages → Serveur).' : err}</Text> : null}

      {update ? (
        <Card onPress={() => router.push('/settings')} tint={C.accent}>
          <Ionicons name="arrow-down-circle" size={22} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Lumio Auto {update.version} disponible</Text>
            <Text style={s.sub}>Tu as la {APP_VERSION}. Réglages → Version.</Text>
          </View>
        </Card>
      ) : null}

      {/* Les deux interrupteurs */}
      {st ? (
        <View style={s.card}>
          <SwitchRow
            icon="flash"
            color={C.success}
            title="Lumio Auto"
            sub={st.enabled ? 'Cherche et télécharge les demandes' : 'En pause'}
            value={st.enabled}
            onChange={(v) => save({ enabled: v }, v ? 'Lumio Auto activé' : 'Lumio Auto en pause')}
          />
          <View style={s.sep} />
          <SwitchRow
            icon="cloud-download"
            color={C.accent}
            title="AllDebrid"
            sub={st.debridOnly ? 'Seulement le cache AllDebrid' : 'Torrents par qBittorrent'}
            value={!!st.debridOnly}
            onChange={(v) => save({ debridOnly: v }, v ? 'AllDebrid activé' : 'Torrents (qBittorrent)')}
          />
        </View>
      ) : null}

      {/* Quatre tuiles */}
      <View style={s.grid}>
        <Tile icon="arrow-down" color={C.accent} value={String(running.length)} label="en téléchargement" foot={running.length ? speed(down) : 'rien en cours'} onPress={() => router.push({ pathname: '/auto', params: { tab: 'telechargements' } })} />
        <Tile icon="arrow-up" color={C.success} value={String(seeding.length)} label="en partage" foot={seeding.length ? speed(up) : '—'} onPress={() => router.push({ pathname: '/auto', params: { tab: 'qbit' } })} />
        <Tile icon="hand-left" color={toChoose ? C.warning : C.textDim} value={String(toChoose)} label="à choisir" foot="versions à valider" onPress={() => router.push({ pathname: '/auto', params: { tab: 'demandes' } })} />
        <Tile icon="file-tray-full" color={pending ? C.warning : C.textDim} value={String(pending)} label="demande(s)" foot="en attente" onPress={() => router.push('/activity')} />
      </View>

      {/* Ratio du site */}
      {site ? (
        <Card onPress={() => router.push({ pathname: '/auto', params: { tab: 'ratio' } })}>
          <View style={{ flex: 1, gap: 8 }}>
            <View style={s.rowBetween}>
              <Text style={s.cardTitle}>Ratio {site.name}</Text>
              <Text style={[s.big, { color: ratioColor(siteRatio) }]}>{siteRatio == null ? '—' : siteRatio.toFixed(2).replace('.', ',')}</Text>
            </View>
            {marge != null ? (
              <View style={s.rowBetween}>
                <Text style={s.sub}>Marge avant blocage</Text>
                <Text style={[s.mid, { color: marge > 20e9 ? C.success : marge > 5e9 ? C.warning : C.danger }]}>{marge > 0 ? gb(marge) : '0 Go'}</Text>
              </View>
            ) : !site.estimate ? (
              <Text style={s.sub}>Entre tes chiffres du site pour voir ton vrai ratio →</Text>
            ) : null}
            {site.cap ? (
              <View style={{ gap: 5 }}>
                <View style={s.rowBetween}>
                  <Text style={s.sub}>Téléchargé aujourd’hui</Text>
                  <Text style={s.sub}>
                    {gb(site.today)} / {gb(site.cap)}
                  </Text>
                </View>
                <View style={s.bar}>
                  <View style={[s.barFill, { width: `${Math.max(quotaPct, 2)}%`, backgroundColor: quotaPct >= 90 ? C.danger : quotaPct >= 70 ? C.warning : C.success }]} />
                </View>
              </View>
            ) : null}
            {site.hr.length ? <Text style={[s.sub, { color: C.warning }]}>{site.hr.length} torrent(s) encore sous la règle des 72 h</Text> : null}
          </View>
        </Card>
      ) : null}

      {/* Services */}
      {services ? (
        <Card onPress={() => router.push('/settings')}>
          <View style={{ flex: 1, gap: 10 }}>
            <Text style={s.cardTitle}>Services</Text>
            <View style={s.chips}>
              {services.map((x) => (
                <View key={x.key} style={s.chip}>
                  <View style={[s.dot, { backgroundColor: x.ok ? C.success : C.danger }]} />
                  <Text style={s.chipTxt}>{x.name}</Text>
                </View>
              ))}
            </View>
            {sys?.disks?.length ? (
              <Text style={s.sub}>
                {sys.disks
                  .filter((d) => d.free != null)
                  .map((d) => `${d.name} : ${gb(d.free!)} libres`)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {/* Qui regarde quoi */}
      <Card onPress={() => router.push('/sessions')}>
        <Ionicons name="eye" size={22} color={watching.length ? C.success : C.textDim} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.cardTitle}>{watching.length ? `${watching.length} en train de regarder` : 'Personne ne regarde'}</Text>
          {watching.slice(0, 3).map((w) => (
            <Text key={w.Id} style={s.sub} numberOfLines={1}>
              {w.UserName} · {w.NowPlayingItem?.SeriesName ? `${w.NowPlayingItem.SeriesName} · ` : ''}
              {w.NowPlayingItem?.Name}
            </Text>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

function Card({ children, onPress, tint }: { children: React.ReactNode; onPress?: () => void; tint?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, s.cardRow, tint ? { borderColor: tint } : null, pressed && { opacity: 0.85 }]}>
      {children}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={C.textFaint} /> : null}
    </Pressable>
  );
}

function SwitchRow({ icon, color, title, sub, value, onChange }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.switchRow}>
      <View style={[s.iconBox, { backgroundColor: value ? `${color}26` : C.surfaceHigh }]}>
        <Ionicons name={icon} size={18} color={value ? color : C.textDim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: color, false: C.border }} />
    </View>
  );
}

function Tile({ icon, color, value, label, foot, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: string; label: string; foot: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, pressed && { opacity: 0.85 }]}>
      <View style={[s.iconBox, { backgroundColor: `${color}26` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.sub} numberOfLines={1}>
        {foot}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  h1: { color: C.text, fontSize: 34, fontWeight: '900', letterSpacing: -0.8 },
  sub: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { backgroundColor: C.surface, borderRadius: 22, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginVertical: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', flexGrow: 1, backgroundColor: C.surface, borderRadius: 22, padding: 14, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  tileValue: { color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.6, marginTop: 6 },
  tileLabel: { color: C.text, fontSize: 14, fontWeight: '700' },
  big: { fontSize: 30, fontWeight: '900', letterSpacing: -0.6 },
  mid: { fontSize: 18, fontWeight: '800' },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: C.surfaceHigh },
  chipTxt: { color: C.text, fontSize: 13, fontWeight: '600' },
});
