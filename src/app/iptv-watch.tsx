// Admin : qui regarde quelle chaîne IPTV en ce moment (membre, appareil, adresse, débit), relayée par le serveur Lumio.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Watcher = { user: string; device: string; ip: string; since: string; bytes: number; rate: number; channel: string };
type Playing = { name: string; logo: string | null; group: string | null; viewers: number; since: string; bytes: number; rate: number; watchers: Watcher[] };
type Status = {
  configured: boolean;
  name: string | null;
  host: string | null;
  maxStreams: number;
  vpn: boolean;
  channels: number;
  error: string | null;
  playing: Playing[];
  history?: { user: string; device: string; channel: string; since: string; end: string; bytes: number }[];
};

const mbps = (bps: number) => `${(bps / 1e6).toFixed(1)} Mb/s`;
const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} Go` : `${Math.round(b / 1e6)} Mo`);
const dur = (from: string, to?: string) => {
  const s = Math.max(0, ((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const hour = (t: string) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function IptvWatchScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Rafraîchi toutes les 3 s tant que l'écran est ouvert
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = () =>
        serverCall<Status>(settings, '/api/iptv/relay')
          .then((r) => alive && (setSt(r), setErr(null)))
          .catch((e) => alive && setErr(e?.message ?? String(e)));
      load();
      const t = setInterval(load, 3000);
      return () => {
        alive = false;
        clearInterval(t);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.chatUrl])
  );

  const total = (st?.playing ?? []).reduce((a, p) => a + p.rate, 0);
  const viewers = (st?.playing ?? []).reduce((a, p) => a + p.viewers, 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, gap: 14 }}>
        <View style={styles.head}>
          <Text style={styles.title}>Qui regarde la TV</Text>
          <Pressable onPress={() => router.back()} style={styles.close} accessibilityLabel="Fermer">
            <Ionicons name="close" size={22} color={C.text} />
          </Pressable>
        </View>

        {err ? <Text style={styles.dim}>{err}</Text> : null}
        {st ? (
          <View style={styles.stats}>
            <Stat label="Chaînes ouvertes" value={`${st.playing.length} / ${st.maxStreams}`} warn={st.playing.length >= st.maxStreams} />
            <Stat label="Spectateurs" value={String(viewers)} />
            <Stat label="Débit total" value={mbps(total)} />
          </View>
        ) : null}
        {st ? (
          <Text style={styles.dim}>
            {st.name || 'IPTV'} · {st.host} · {st.vpn ? '🛡 par le VPN' : '🌐 sans VPN'} · {st.channels.toLocaleString('fr-FR')} chaînes
            {st.error ? `\n⚠︎ ${st.error}` : ''}
          </Text>
        ) : null}

        {st && !st.playing.length ? (
          <View style={styles.card}>
            <Text style={styles.dim}>Personne ne regarde de chaîne en ce moment.</Text>
          </View>
        ) : null}

        {(st?.playing ?? []).map((p) => (
          <View key={p.name + p.since} style={styles.card}>
            <View style={styles.row}>
              {p.logo ? <Image source={{ uri: p.logo }} style={styles.logo} contentFit="contain" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.chan}>{p.name}</Text>
                <Text style={styles.dim}>
                  {p.group ? `${p.group} · ` : ''}ouverte depuis {dur(p.since)} · {size(p.bytes)}
                </Text>
              </View>
              <Text style={styles.rate}>{mbps(p.rate)}</Text>
            </View>
            {p.watchers.map((w, i) => (
              <View key={i} style={styles.watcher}>
                <Ionicons name={/TV|Android/.test(w.device) ? 'tv-outline' : 'phone-portrait-outline'} size={18} color={C.textDim} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.user}>{w.user}</Text>
                  <Text style={styles.dim}>
                    {w.device} · {w.ip || 'adresse inconnue'} · depuis {hour(w.since)} ({dur(w.since)})
                  </Text>
                </View>
                <Text style={styles.small}>{mbps(w.rate)}</Text>
              </View>
            ))}
          </View>
        ))}

        {st?.history?.length ? <Text style={styles.h}>Dernières séances</Text> : null}
        {(st?.history ?? []).map((h, i) => (
          <View key={i} style={styles.hist}>
            <Text style={styles.user} numberOfLines={1}>
              {h.user} · {h.channel}
            </Text>
            <Text style={styles.dim}>
              {h.device} · {hour(h.since)} → {hour(h.end)} ({dur(h.since, h.end)}) · {size(h.bytes)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, warn && { color: C.danger }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 28, fontWeight: '800' },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: C.surface, borderRadius: R.lg, padding: 12, gap: 2 },
  statValue: { color: C.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: C.textDim, fontSize: 12 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 48, height: 30 },
  chan: { color: C.text, fontSize: 16, fontWeight: '700' },
  rate: { color: C.text, fontSize: 15, fontWeight: '800' },
  watcher: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.surfaceHigh },
  user: { color: C.text, fontSize: 14, fontWeight: '700' },
  small: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  h: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  hist: { backgroundColor: C.surface, borderRadius: R.md, padding: 12, gap: 2 },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
