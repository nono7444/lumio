// Admin (Lumio, Lumio Audio, Lumio Livres) : disque où sont rangés les livres ou les livres audio, et déplacement.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { C } from '@/constants/theme';
import { folderApi, type FolderInfo } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const go = (n: number | null) => (n == null ? '?' : n >= 1e12 ? `${(n / 1e12).toFixed(1)} To` : `${Math.round(n / 1e9)} Go`);
/** Admin : sur quel disque du serveur sont rangés les livres, et déplacement vers un autre disque. */
export function FolderCard({ kind, onMoved, title, flat }: { kind: 'audio' | 'books'; onMoved?: () => void; title?: string; flat?: boolean }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Fonction gardée dans une référence : sinon le suivi se relancerait à chaque affichage
  const moved = useRef(onMoved);
  moved.current = onMoved;
  const load = useCallback(() => {
    folderApi
      .get(settings, kind)
      .then((r) => {
        setInfo((old) => {
          if (old?.move?.status === 'running' && r.move?.status === 'done') moved.current?.();
          return r;
        });
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [settings, kind]);
  useEffect(() => {
    load();
  }, [load]);
  // Déplacement en cours : on suit toutes les 5 s
  useEffect(() => {
    if (info?.move?.status !== 'running') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [info?.move?.status, load]);

  const label = kind === 'audio' ? 'livres audio' : 'livres';
  const move = (root: string) =>
    Alert.alert(
      `Déplacer les ${label} sur ${root} ?`,
      `Le dossier « ${info?.dir?.folder} » (${go(info?.size ?? null)}) est copié sur ${root}, puis effacé de ${info?.dir?.root}. Les positions de lecture sont gardées.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déplacer',
          onPress: () =>
            folderApi
              .move(settings, kind, root)
              .then(setInfo)
              .catch((e) => Alert.alert('Déplacement impossible', e instanceof Error ? e.message : String(e))),
        },
      ]
    );
  const m = info?.move;
  return (
    <View style={flat ? { gap: 12 } : styles.card}>
      <Text style={styles.h}>{title ?? 'Dossier sur le serveur'}</Text>
      {err ? <Text style={[styles.s, { color: C.danger }]}>{err}</Text> : null}
      {info?.dir ? (
        <Text style={styles.s}>
          « {info.dir.folder || 'racine'} » sur le disque <Text style={{ color: C.text, fontWeight: '700' }}>{info.dir.root}</Text>
          {info.size != null ? ` · ${go(info.size)}` : ''}
        </Text>
      ) : null}
      {m?.status === 'running' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={C.text} />
          <Text style={styles.s}>
            Déplacement vers {m.to} en cours ({go(m.size)})… Les {label} reviennent dès que c'est fini.
          </Text>
        </View>
      ) : m?.status === 'error' ? (
        <Text style={[styles.s, { color: C.danger }]}>Déplacement vers {m.to} échoué : {m.error}</Text>
      ) : m?.status === 'done' ? (
        <Text style={[styles.s, { color: C.success }]}>Déplacé sur {m.to}.</Text>
      ) : null}
      {info && info.disks.length > 1 && m?.status !== 'running' ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.s}>Déplacer vers :</Text>
          {info.disks
            .filter((d) => d.name !== info.dir?.root)
            .map((d) => (
              <Pressable key={d.name} onPress={() => move(d.name)} style={styles.disk}>
                <Ionicons name="server-outline" size={18} color={C.text} />
                <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{d.name}</Text>
                <Text style={styles.s}>{go(d.free)} libres</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
              </Pressable>
            ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 14, padding: 16, borderRadius: 18, backgroundColor: C.surface, gap: 12 },
  h: { color: C.text, fontSize: 16, fontWeight: '800' },
  s: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  disk: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.surfaceHigh },
});
