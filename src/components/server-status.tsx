// État des serveurs : Jellyfin, Radarr, Sonarr, serveur Lumio, Seerr (en ligne, version, latence, disques).
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';

import { C, R } from '@/constants/theme';
import { arr, formatBytes } from '@/lib/arr';
import { serverBase } from '@/lib/chat';
import { lumio, type ServerFolder, type ServiceStatus } from '@/lib/lumio-server';
import { isManager, useSettings, type ArrConfig } from '@/lib/settings';

type Row = { key: string; name: string; icon: keyof typeof Ionicons.glyphMap; status: ServiceStatus | null };

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number; error: string }> {
  const start = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 8000)),
    ]);
    return { ok: true, ms: Date.now() - start, value };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ok: false, ms: Date.now() - start, error: /network request failed/i.test(msg) ? 'injoignable' : msg };
  }
}

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function probeArr(c: ArrConfig): Promise<ServiceStatus> {
  const r = await timed(() => arr.status(c));
  if (!r.ok) return { ok: false, ms: r.ms, error: r.error, configured: true };
  const disks = await arr.rootFolders(c).catch(() => [] as ServerFolder[]);
  return { ok: true, ms: r.ms, version: r.value.version, configured: true, disks };
}

function Disk({ d }: { d: ServerFolder }) {
  const name = d.path.replace(/\/+$/, '').split('/').pop() || d.path;
  return (
    <View style={styles.disk}>
      <Ionicons name="folder-outline" size={14} color={C.textFaint} />
      <Text style={styles.diskName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.diskFree, d.freeSpace != null && d.freeSpace < 50e9 && { color: C.warning }]}>
        {d.freeSpace != null ? `${formatBytes(d.freeSpace)} libres` : ''}
      </Text>
    </View>
  );
}

export function ServerStatusSection() {
  const { settings } = useSettings();
  const manager = isManager(settings);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const out: Row[] = [];

    // Vu depuis le téléphone
    const jfP = settings.jellyfin
      ? timed(() => getJson(`${settings.jellyfin!.url}/System/Info/Public`)).then(
          (r): ServiceStatus => (r.ok ? { ok: true, ms: r.ms, version: r.value.Version, name: r.value.ServerName } : { ok: false, ms: r.ms, error: r.error })
        )
      : Promise.resolve(null);
    const lumioP = settings.chatUrl
      ? timed(() => getJson(`${serverBase(settings.chatUrl)}/health`)).then(
          (r): ServiceStatus => (r.ok ? { ok: true, ms: r.ms, version: r.value.version } : { ok: false, ms: r.ms, error: r.error })
        )
      : Promise.resolve(null);
    const seerrP = settings.seerr?.url
      ? timed(() => getJson(`${serverBase(settings.seerr!.url)}/api/v1/status`)).then(
          (r): ServiceStatus => (r.ok ? { ok: true, ms: r.ms, version: r.value.version } : { ok: false, ms: r.ms, error: r.error })
        )
      : Promise.resolve(null);

    // Radarr / Sonarr : en direct pour l'admin, sinon via le serveur Lumio
    const direct = manager && (settings.radarr.apiKey || settings.sonarr.apiKey);
    const viaServerP = settings.chatUrl && settings.jellyfin ? lumio.status(settings).catch(() => null) : Promise.resolve(null);
    const radarrP = direct && settings.radarr.url && settings.radarr.apiKey ? probeArr(settings.radarr) : Promise.resolve(null);
    const sonarrP = direct && settings.sonarr.url && settings.sonarr.apiKey ? probeArr(settings.sonarr) : Promise.resolve(null);

    const [jfS, lumioS, seerrS, viaServer, radarrS, sonarrS] = await Promise.all([jfP, lumioP, seerrP, viaServerP, radarrP, sonarrP]);

    if (settings.jellyfin) out.push({ key: 'jf', name: 'Jellyfin', icon: 'albums-outline', status: jfS });
    const r = radarrS ?? viaServer?.radarr ?? null;
    const so = sonarrS ?? viaServer?.sonarr ?? null;
    if (r || direct || viaServer?.radarr) out.push({ key: 'radarr', name: 'Radarr', icon: 'film-outline', status: r });
    if (so || direct || viaServer?.sonarr) out.push({ key: 'sonarr', name: 'Sonarr', icon: 'tv-outline', status: so });
    if (settings.chatUrl) out.push({ key: 'lumio', name: 'Serveur Lumio', icon: 'server-outline', status: lumioS });
    if (viaServer?.alldebrid)
      out.push({
        key: 'alldebrid',
        name: 'AllDebrid',
        icon: 'flash-outline',
        status: { ...viaServer.alldebrid, name: viaServer.alldebrid.premium === false ? 'compte non premium' : viaServer.alldebrid.name },
      });
    if (settings.seerr?.url) out.push({ key: 'seerr', name: 'Seerr', icon: 'paper-plane-outline', status: seerrS });

    setRows(out);
    setAt(new Date());
    setLoading(false);
  }, [settings, manager]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!settings.jellyfin && !settings.chatUrl && !manager) return null;

  const allOk = rows.length > 0 && rows.every((x) => x.status?.ok);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: loading && !rows.length ? C.textFaint : allOk ? C.success : C.warning }]} />
        <Text style={styles.title}>{loading && !rows.length ? 'Vérification…' : allOk ? 'Tout est en ligne' : 'État des serveurs'}</Text>
        <Pressable onPress={load} hitSlop={10} style={styles.refresh} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color={C.textDim} /> : <Ionicons name="refresh" size={18} color={C.textDim} />}
        </Pressable>
      </View>

      {rows.map((row) => {
        const st = row.status;
        const ok = Boolean(st?.ok);
        const detail = !st
          ? 'non configuré'
          : ok
            ? [st.name, st.version ? `v${st.version}` : null, st.ms != null ? `${st.ms} ms` : null].filter(Boolean).join(' · ')
            : st.configured === false
              ? 'non configuré sur le serveur Lumio'
              : st.error ?? 'hors ligne';
        return (
          <View key={row.key} style={styles.row}>
            <Ionicons name={row.icon} size={18} color={C.textDim} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.name}>{row.name}</Text>
                <View style={[styles.badge, { backgroundColor: ok ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)' }]}>
                  <View style={[styles.dotSm, { backgroundColor: ok ? C.success : C.danger }]} />
                  <Text style={[styles.badgeText, { color: ok ? C.success : C.danger }]}>{ok ? 'En ligne' : 'Hors ligne'}</Text>
                </View>
                {st?.queue ? <Text style={styles.detail}>{st.queue} en cours</Text> : null}
              </View>
              <Text style={styles.detail} numberOfLines={1}>
                {detail}
              </Text>
              {ok && st?.disks?.length ? (
                <View style={{ marginTop: 4, gap: 3 }}>
                  {st.disks.map((d) => (
                    <Disk key={d.path} d={d} />
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      {at && (
        <Text style={styles.at}>
          Vérifié à {String(at.getHours()).padStart(2, '0')}:{String(at.getMinutes()).padStart(2, '0')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, gap: 14, marginBottom: 22 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 17, fontWeight: '800', flex: 1 },
  refresh: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotSm: { width: 6, height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  detail: { color: C.textDim, fontSize: 12 },
  disk: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diskName: { color: C.textDim, fontSize: 12, flex: 1 },
  diskFree: { color: C.textDim, fontSize: 12, fontWeight: '600' },
  at: { color: C.textFaint, fontSize: 11, textAlign: 'right' },
});
