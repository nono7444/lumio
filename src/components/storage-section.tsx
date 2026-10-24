// Profil → Stockage (admin) : place sur les disques, titres jamais / plus regardés à supprimer, plus gros titres.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, Section, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { formatBytes } from '@/lib/arr';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Disk = { path: string; label: string; free: number; total: number };
type Item = {
  kind: 'radarr' | 'sonarr';
  id: number;
  type: 'movie' | 'tv';
  title: string;
  year?: number;
  size: number;
  added?: string;
  watched: boolean;
  lastPlayed: string | null;
  poster: string | null;
};
type Report = { disks: Disk[]; candidates: Item[]; biggest: Item[]; totalCandidates: number };

const since = (iso?: string | null) => {
  if (!iso) return '';
  const months = Math.floor((Date.now() - Date.parse(iso)) / (30 * 86400e3));
  return months >= 12 ? `${Math.floor(months / 12)} an${months >= 24 ? 's' : ''}` : `${Math.max(1, months)} mois`;
};

export function StorageSection() {
  const { settings } = useSettings();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await serverCall<Report>(settings, '/api/admin/storage'));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);

  if (!settings.chatUrl || settings.jellyfin?.isAdmin !== true || Platform.isTV) return null;

  // Plus de liste « À nettoyer » (titres jamais / plus regardés) : seulement les plus gros, supprimés à la main
  const list = report ? report.biggest : [];
  const keyOf = (x: Item) => `${x.kind}:${x.id}`;
  const chosen = list.filter((x) => selected.has(keyOf(x)));
  const chosenSize = chosen.reduce((n, x) => n + x.size, 0);

  const remove = () => {
    if (!chosen.length) return;
    Alert.alert(
      `Supprimer ${chosen.length} titre${chosen.length > 1 ? 's' : ''} ?`,
      `${formatBytes(chosenSize)} libérés. Les fichiers sont effacés du disque et retirés de Radarr / Sonarr et de Jellyfin. On pourra les redemander.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            let ok = 0;
            for (const x of chosen) {
              try {
                await serverCall(settings, `/api/admin/storage/${x.kind}/${x.id}`, { method: 'DELETE' });
                ok++;
              } catch (e: any) {
                toast(`${x.title} : ${e?.message ?? e}`, 'error');
              }
            }
            setBusy(false);
            setSelected(new Set());
            toast(`${ok} titre${ok > 1 ? 's' : ''} supprimé${ok > 1 ? 's' : ''}`);
            load();
          },
        },
      ]
    );
  };

  return (
    <Section title="Stockage">
      {!report ? (
        loading ? (
          <ActivityIndicator color={C.text} style={{ marginVertical: 12 }} />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={styles.help}>Place sur les disques et plus gros fichiers.</Text>
            {error ? <Text style={[styles.help, { color: C.danger }]}>{error}</Text> : null}
            <Button title="Analyser le stockage" icon="pie-chart-outline" variant="secondary" onPress={load} />
          </View>
        )
      ) : (
        <View style={{ gap: 14 }}>
          {report.disks.map((d) => {
            const used = 1 - d.free / d.total;
            const color = used > 0.9 ? C.danger : used > 0.8 ? C.warning : C.success;
            return (
              <View key={d.path} style={{ gap: 6 }}>
                <View style={styles.row}>
                  <Ionicons name="server-outline" size={16} color={C.textDim} />
                  <Text style={styles.diskName} numberOfLines={1}>
                    {d.label}
                  </Text>
                  <Text style={styles.dim}>
                    {formatBytes(d.free)} libres / {formatBytes(d.total)}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(used * 100)}%`, backgroundColor: color }]} />
                </View>
              </View>
            );
          })}

          <Text style={[styles.diskName, { flex: 0 }]}>Les plus gros</Text>

          {list.length === 0 ? <Text style={styles.help}>Rien à signaler 👌</Text> : null}
          {list.map((x) => {
            const on = selected.has(keyOf(x));
            return (
              <Pressable
                key={keyOf(x)}
                onPress={() => {
                  tap();
                  const next = new Set(selected);
                  if (on) next.delete(keyOf(x));
                  else next.add(keyOf(x));
                  setSelected(next);
                }}
                style={[styles.item, on && styles.itemOn]}>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? C.danger : C.textFaint} />
                {x.poster ? <Image source={x.poster} style={styles.poster} contentFit="cover" cachePolicy="memory-disk" /> : <View style={styles.poster} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {x.title}
                    {x.year ? ` (${x.year})` : ''}
                  </Text>
                  <Text style={styles.dim} numberOfLines={1}>
                    {x.type === 'tv' ? 'Série' : 'Film'} · {x.watched ? `vu il y a ${since(x.lastPlayed)}` : `jamais regardé · ajouté il y a ${since(x.added)}`}
                  </Text>
                </View>
                <Text style={styles.size}>{formatBytes(x.size)}</Text>
              </Pressable>
            );
          })}

          {chosen.length ? (
            <Button
              title={`Supprimer ${chosen.length} titre${chosen.length > 1 ? 's' : ''} (${formatBytes(chosenSize)})`}
              icon="trash-outline"
              variant="danger"
              loading={busy}
              onPress={remove}
            />
          ) : null}
          <Button title="Actualiser" icon="refresh" variant="secondary" small loading={loading} onPress={load} />
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  dim: { color: C.textDim, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diskName: { color: C.text, fontSize: 14, fontWeight: '700', flex: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: R.md },
  itemOn: { backgroundColor: 'rgba(255,69,58,0.12)' },
  poster: { width: 34, height: 51, borderRadius: 6, backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 14, fontWeight: '700' },
  size: { color: C.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
