// Admin : disques du serveur — parcourir, créer un dossier, renommer, déplacer (même vers un autre disque), supprimer.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePrompt } from '@/components/prompt-modal';
import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { filesApi, formatSize, joinPath, parentPath, type Disk, type FileEntry } from '@/lib/files';
import { useSettings } from '@/lib/settings';

type Moving = { root: string; path: string; name: string };

export default function Files() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { prompt, element } = usePrompt();
  const [disks, setDisks] = useState<Disk[] | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!root) setDisks(await filesApi.disks(settings));
      else setEntries(await filesApi.list(settings, root, path));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [settings, root, path]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = (r: string | null, p: string) => {
    tap();
    setEntries(null);
    setRoot(r);
    setPath(p);
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      load();
    } catch (e: any) {
      Alert.alert('Action impossible', e?.message ?? String(e));
    }
  };

  const menu = (e: FileEntry) => {
    if (!root) return;
    const p = joinPath(path, e.name);
    Alert.alert(e.name, e.dir ? 'Dossier' : formatSize(e.size), [
      {
        text: 'Renommer',
        onPress: async () => {
          const name = await prompt({ title: 'Renommer', value: e.name, ok: 'Renommer' });
          if (name && name !== e.name) act(() => filesApi.move(settings, root, p, joinPath(path, name)), 'Renommé');
        },
      },
      {
        text: 'Déplacer…',
        onPress: () => {
          setMoving({ root, path: p, name: e.name });
          toast('Va dans le dossier de destination puis touche « Déplacer ici »', 'info', 4000);
        },
      },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Supprimer ?', `« ${e.name} » sera supprimé définitivement${e.dir ? ' avec tout son contenu' : ''}.`, [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Supprimer', style: 'destructive', onPress: () => act(() => filesApi.remove(settings, root, p), 'Supprimé') },
          ]),
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const newFolder = async () => {
    if (!root) return;
    const name = await prompt({ title: 'Nouveau dossier', value: '', ok: 'Créer' });
    if (name) act(() => filesApi.mkdir(settings, root, joinPath(path, name)), 'Dossier créé');
  };

  const moveHere = () => {
    if (!moving || !root) return;
    const to = joinPath(path, moving.name);
    act(() => filesApi.move(settings, moving.root, moving.path, to, root), 'Déplacé').then(() => setMoving(null));
  };

  const crumbs = path ? path.split('/') : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {element}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        {root ? (
          <Pressable onPress={() => open(path ? root : null, parentPath(path))} hitSlop={10} style={styles.round}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {root ? (crumbs[crumbs.length - 1] ?? root) : 'Disques'}
        </Text>
        {root ? (
          <Pressable onPress={newFolder} hitSlop={10} style={styles.round} accessibilityLabel="Nouveau dossier">
            <Ionicons name="folder-open-outline" size={19} color={C.text} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>
      {root ? <Text style={styles.crumb} numberOfLines={1}>{[root, ...crumbs].join(' › ')}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!root ? (
        <FlatList
          data={disks ?? []}
          keyExtractor={(d) => d.name}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}
          ListEmptyComponent={
            disks ? (
              <Text style={styles.dim}>
                Aucun disque. Ajoute-les au serveur Lumio (variable LUMIO_DISKS et volumes dans le compose).
              </Text>
            ) : (
              <ActivityIndicator color={C.text} style={{ margin: 30 }} />
            )
          }
          renderItem={({ item: d }) => {
            const used = d.total && d.free != null ? 1 - d.free / d.total : 0;
            return (
              <Pressable onPress={() => open(d.name, '')} style={styles.disk}>
                <Ionicons name="server-outline" size={26} color={C.text} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.name}>{d.name}</Text>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${used * 100}%`, backgroundColor: used > 0.9 ? C.danger : C.accent }]} />
                  </View>
                  <Text style={styles.dim}>
                    {formatSize(d.free)} libres sur {formatSize(d.total)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textDim} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(e) => e.name}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + (moving ? 110 : 30) }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}
          ListEmptyComponent={entries ? <Text style={styles.dim}>Dossier vide</Text> : <ActivityIndicator color={C.text} style={{ margin: 30 }} />}
          renderItem={({ item: e }) => (
            <Pressable
              onPress={() => (e.dir ? open(root, joinPath(path, e.name)) : menu(e))}
              onLongPress={() => menu(e)}
              style={styles.row}>
              <Ionicons name={e.dir ? 'folder' : /\.(mkv|mp4|avi|mov|m4v|ts)$/i.test(e.name) ? 'film-outline' : 'document-outline'} size={22} color={e.dir ? '#FFC93C' : C.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={styles.file} numberOfLines={2}>
                  {e.name}
                </Text>
                {!e.dir ? <Text style={styles.dim}>{formatSize(e.size)}</Text> : null}
              </View>
              <Pressable onPress={() => menu(e)} hitSlop={10}>
                <Ionicons name="ellipsis-horizontal" size={18} color={C.textDim} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      {moving ? (
        <View style={[styles.moveBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.dim} numberOfLines={1}>
            Déplacer « {moving.name} »
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Annuler" variant="secondary" onPress={() => setMoving(null)} style={{ flex: 1 }} />
            <Button title="Déplacer ici" icon="arrow-down" onPress={moveHere} style={{ flex: 1.4 }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6 },
  title: { flex: 1, color: C.text, fontSize: 24, fontWeight: '800' },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  crumb: { color: C.textDim, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  error: { color: C.danger, padding: 16 },
  dim: { color: C.textDim, fontSize: 12 },
  disk: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: R.lg, padding: 16 },
  name: { color: C.text, fontSize: 17, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  file: { color: C.text, fontSize: 15 },
  moveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface, padding: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
});
