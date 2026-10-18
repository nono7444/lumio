// Admin : supervision façon UptimeRobot (barres des dernières 24 h par service) et machine en direct (processeur, chaleur, mémoire).
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Section } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { formatSize } from '@/lib/files';
import { useSettings } from '@/lib/settings';

type Service = { key: string; name: string; ok: boolean; ms: number | null; version: string | null; error: string | null; uptime: number | null; bars: number[] };
type System = {
  cpu: number | null;
  temp: number | null;
  cores: number;
  load: number[] | null;
  uptime: number | null;
  mem: { total: number; used: number } | null;
  disks: { name: string; free: number | null; total: number | null }[];
  history: { cpu: number; temp: number | null }[];
};

const GREEN = '#4ADE80';
const DESC: Record<string, string> = {
  lumio: 'Demandes, chat, notes et téléchargements de la famille.',
  jellyfin: 'Ta vidéothèque : lecture des films et séries.',
  radarr: 'Récupère les films demandés.',
  sonarr: 'Récupère les séries demandées.',
};
const ICON: Record<string, keyof typeof Ionicons.glyphMap> = { lumio: 'sparkles', jellyfin: 'play-circle', radarr: 'film', sonarr: 'tv' };

const barColor = (v: number) => (v === 1 ? GREEN : v === 0.5 ? '#FFB340' : v === 0 ? '#FF453A' : '#2C2C30');
const tempColor = (t: number) => (t >= 80 ? '#FF453A' : t >= 65 ? '#FFB340' : GREEN);
const cpuColor = (c: number) => (c >= 85 ? '#FF453A' : c >= 60 ? '#FFB340' : C.accent);

function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d ? `${d} j ${h} h` : `${h} h ${Math.floor((sec % 3600) / 60)} min`;
}

function ServiceCard({ s }: { s: Service }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.iconBox}>
          <Ionicons name={ICON[s.key] ?? 'server'} size={22} color={C.text} />
          <View style={[styles.dot, { backgroundColor: s.ok ? GREEN : '#FF453A' }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.desc} numberOfLines={2}>
            {s.ok ? DESC[s.key] : `Hors ligne : ${s.error ?? 'injoignable'}`}
          </Text>
        </View>
      </View>
      <View style={styles.sep} />
      <View style={styles.row}>
        <Text style={styles.small}>HISTORIQUE</Text>
        <Text style={[styles.mono, { color: s.uptime == null || s.uptime >= 99 ? GREEN : s.uptime >= 95 ? '#FFB340' : '#FF453A' }]}>
          {s.uptime == null ? '— uptime' : `${s.uptime.toLocaleString('fr-FR')}% uptime`}
        </Text>
      </View>
      <View style={styles.bars}>
        {s.bars.map((b, i) => (
          <View key={i} style={[styles.bar, { backgroundColor: barColor(b) }]} />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.faint}>il y a 24h</Text>
        <Text style={styles.faint}>
          {[s.version ? `v${s.version}` : null, s.ms != null ? `${s.ms} ms` : null, 'maintenant'].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

function Gauge({ label, value, unit, color, max = 100 }: { label: string; value: number | null; unit: string; color: string; max?: number }) {
  return (
    <View style={styles.gauge}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.big, { color }]}>
        {value == null ? '—' : value}
        <Text style={styles.unit}>{value == null ? '' : unit}</Text>
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, ((value ?? 0) / max) * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function SystemCard({ sys }: { sys: System }) {
  const memPct = sys.mem ? Math.round((sys.mem.used / sys.mem.total) * 100) : null;
  const hist = sys.history.slice(-45);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.iconBox}>
          <Ionicons name="hardware-chip-outline" size={22} color={C.text} />
          <View style={[styles.dot, { backgroundColor: GREEN }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Machine</Text>
          <Text style={styles.desc}>
            En direct · {sys.cores} cœurs{sys.uptime ? ` · allumée depuis ${duration(sys.uptime)}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.gauges}>
        <Gauge label="PROCESSEUR" value={sys.cpu} unit=" %" color={cpuColor(sys.cpu ?? 0)} />
        <Gauge label="CHALEUR" value={sys.temp} unit=" °C" color={tempColor(sys.temp ?? 0)} max={100} />
        <Gauge label="MÉMOIRE" value={memPct} unit=" %" color={C.accent} />
      </View>
      {/* Charge du processeur sur les 90 dernières secondes */}
      <View style={styles.spark}>
        {hist.map((h, i) => (
          <View key={i} style={{ flex: 1, height: `${Math.max(4, h.cpu)}%`, backgroundColor: cpuColor(h.cpu), borderRadius: 2, opacity: 0.85 }} />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.faint}>il y a 90 s</Text>
        <Text style={styles.faint}>
          {sys.load ? `charge ${sys.load.map((l) => l.toFixed(2)).join(' · ')}` : ''}
          {sys.mem ? ` · ${formatSize(sys.mem.used)} / ${formatSize(sys.mem.total)}` : ''}
        </Text>
      </View>
      {sys.disks.map((d) => {
        const used = d.total && d.free != null ? 1 - d.free / d.total : 0;
        return (
          <View key={d.name} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Text style={styles.desc}>💾 {d.name}</Text>
              <Text style={styles.faint}>
                {formatSize(d.free)} libres / {formatSize(d.total)}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${used * 100}%`, backgroundColor: used > 0.9 ? '#FF453A' : C.accent }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function UptimeSection() {
  const { settings } = useSettings();
  const [services, setServices] = useState<Service[] | null>(null);
  const [sys, setSys] = useState<System | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const loadServices = () =>
      serverCall<{ services: Service[] }>(settings, '/api/uptime')
        .then((r) => alive && (setServices(r.services), setError(null)))
        .catch((e) => alive && setError(e?.message ?? String(e)));
    const loadSys = () => serverCall<System>(settings, '/api/system').then((r) => alive && setSys(r)).catch(() => {});
    loadServices();
    loadSys();
    const a = setInterval(loadServices, 30_000);
    const b = setInterval(loadSys, 2000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);

  const allOk = services?.every((s) => s.ok);
  return (
    <Section title={services ? (allOk ? '✅ Tout est en ligne' : '⚠️ Un service ne répond pas') : 'Serveurs'}>
      <View style={{ gap: 12 }}>
        {error ? <Text style={[styles.desc, { color: '#FF453A' }]}>{error}</Text> : null}
        {sys ? <SystemCard sys={sys} /> : null}
        {(services ?? []).map((s) => (
          <ServiceCard key={s.key} s={s} />
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#14141F', borderRadius: R.lg, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2A2A3A' },
  head: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  iconBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#1F1F2C', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#14141F' },
  name: { color: C.text, fontSize: 18, fontWeight: '700' },
  desc: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#2A2A3A' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  small: { color: C.textDim, fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  mono: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  faint: { color: C.textFaint, fontSize: 11 },
  bars: { flexDirection: 'row', gap: 3, height: 24 },
  bar: { flex: 1, borderRadius: 3 },
  gauges: { flexDirection: 'row', gap: 10 },
  gauge: { flex: 1, gap: 4 },
  big: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 13, fontWeight: '600', color: C.textDim },
  track: { height: 5, borderRadius: 3, backgroundColor: '#2C2C30', overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 46 },
});
