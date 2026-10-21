// Admin : disques du serveur — parcourir, rechercher, créer un dossier, renommer, déplacer (même vers un autre disque,
// un ou plusieurs éléments à la fois), supprimer. Peut s'ouvrir directement sur un dossier (« Voir dans le disque »).
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePrompt } from '@/components/prompt-modal';
import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { filesApi, formatSize, joinPath, parentPath, type Disk, type FileEntry, type MoveJob } from '@/lib/files';
import { useSettings } from '@/lib/settings';

type Item = { root: string; path: string; name: string };
type Hit = Item & { dir: boolean; size: number };

export default function Files() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { prompt, element } = usePrompt();
  const params = useLocalSearchParams<{ root?: string; folder?: string; highlight?: string }>();
  const [disks, setDisks] = useState<Disk[] | null>(null);
  const [root, setRoot] = useState<string | null>(params.root ?? null);
  const [path, setPath] = useState(params.folder ?? '');
  const [highlight, setHighlight] = useState<string | null>(params.highlight ?? null);
  // Recherche par nom
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Sélection de plusieurs éléments
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<Item[] | null>(null);
  const [jobs, setJobs] = useState<MoveJob[]>([]);
  const loadRef = useRef<() => void>(() => {});

  // Déplacements vers un autre disque : progression en direct
  useEffect(() => {
    let alive = true;
    const tick = () =>
      filesApi
        .moveJobs(settings)
        .then((j) => {
          if (!alive) return;
          setJobs((prev) => {
            if (prev.some((p) => p.status === 'moving') && !j.some((x) => x.status === 'moving')) loadRef.current();
            return j;
          });
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (!root) setDisks(await filesApi.disks(settings));
      else setEntries(await filesApi.list(settings, root, path));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [settings, root, path]);

  loadRef.current = load;
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
    setHighlight(null);
    setPicked(new Set());
  };

  // Recherche (0,4 s après la dernière lettre), dans le disque ouvert ou dans tous
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      filesApi
        .search(settings, term, root)
        .then(setHits)
        .catch((e) => setError(e?.message ?? String(e)))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, root]);

  const togglePick = (name: string) => {
    tap();
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };
  const pickedItems = (): Item[] => (root ? [...picked].map((name) => ({ root, path: joinPath(path, name), name })) : []);

  const removePicked = () => {
    const items = pickedItems();
    if (!items.length) return;
    Alert.alert(`Supprimer ${items.length} élément${items.length > 1 ? 's' : ''} ?`, 'Ils seront supprimés définitivement.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          for (const it of items) await filesApi.remove(settings, it.root, it.path).catch((e) => toast(`${it.name} : ${e?.message ?? e}`, 'error'));
          toast(`${items.length} élément${items.length > 1 ? 's' : ''} supprimé${items.length > 1 ? 's' : ''}`);
          setSelecting(false);
          setPicked(new Set());
          load();
        },
      },
    ]);
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
          setMoving([{ root, path: p, name: e.name }]);
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

  // Déplace un ou plusieurs éléments dans le dossier ouvert (un par un)
  const moveHere = async () => {
    if (!moving?.length || !root) return;
    let background = false;
    let done = 0;
    for (const m of moving) {
      try {
        const r = await filesApi.move(settings, m.root, m.path, joinPath(path, m.name), root);
        if (r?.job) background = true;
        done++;
      } catch (e: any) {
        Alert.alert('Déplacement impossible', `${m.name} : ${e?.message ?? String(e)}`);
      }
    }
    toast(background ? 'Déplacement vers l’autre disque en cours…' : `${done} élément${done > 1 ? 's' : ''} déplacé${done > 1 ? 's' : ''}`, background ? 'info' : 'ok');
    setMoving(null);
    load();
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
          <Pressable
            onPress={() => {
              tap();
              setSelecting((v) => !v);
              setPicked(new Set());
            }}
            hitSlop={10}
            style={[styles.round, selecting && { backgroundColor: C.accent }]}
            accessibilityLabel="Sélectionner plusieurs">
            <Ionicons name="checkmark-done" size={19} color={C.text} />
          </Pressable>
        ) : null}
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

      <View style={styles.search}>
        <Ionicons name="search" size={16} color={C.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={root ? `Chercher dans ${root}…` : 'Chercher dans tous les disques…'}
          placeholderTextColor={C.textFaint}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searching ? <ActivityIndicator size="small" color={C.textDim} /> : null}
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={C.textDim} />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {jobs.filter((j) => j.status !== 'done').map((j) => {
        const pct = j.total ? Math.min(1, j.done / j.total) : 0;
        return (
          <View key={j.id} style={styles.job}>
            <Text style={styles.file} numberOfLines={1}>
              {j.status === 'error' ? '⚠️ ' : '📦 '}
              {j.name} → {j.dest}
            </Text>
            {j.status === 'error' ? (
              <Text style={[styles.dim, { color: C.danger }]}>{j.error}</Text>
            ) : (
              <>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: C.accent }]} />
                </View>
                <Text style={styles.dim}>
                  {Math.round(pct * 100)} % · {formatSize(j.done)} / {formatSize(j.total)}
                </Text>
              </>
            )}
          </View>
        );
      })}

      {hits ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => `${h.root}:${h.path}`}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}
          ListEmptyComponent={<Text style={styles.dim}>Rien trouvé pour « {query} ».</Text>}
          ListHeaderComponent={<Text style={[styles.dim, { marginBottom: 6 }]}>{hits.length >= 300 ? '300 premiers résultats' : `${hits.length} résultat${hits.length > 1 ? 's' : ''}`}</Text>}
          renderItem={({ item: h }) => (
            <Pressable
              onPress={() => {
                // Ouvre le dossier qui contient le résultat (ou le dossier lui-même)
                setQuery('');
                setHits(null);
                if (h.dir) open(h.root, h.path);
                else {
                  open(h.root, parentPath(h.path));
                  setHighlight(h.name);
                }
              }}
              style={styles.row}>
              <Ionicons name={h.dir ? 'folder' : 'film-outline'} size={22} color={h.dir ? '#FFC93C' : C.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={styles.file} numberOfLines={2}>
                  {h.name}
                </Text>
                <Text style={styles.dim} numberOfLines={1}>
                  {[h.root, ...parentPath(h.path).split('/').filter(Boolean)].join(' › ')}
                  {!h.dir ? ` · ${formatSize(h.size)}` : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : !root ? (
        <FlatList
          data={disks ?? []}
          keyExtractor={(d) => d.name}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}
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
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + (moving || selecting ? 120 : 30) }}
          refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}
          ListEmptyComponent={entries ? <Text style={styles.dim}>Dossier vide</Text> : <ActivityIndicator color={C.text} style={{ margin: 30 }} />}
          renderItem={({ item: e }) => (
            <Pressable
              onPress={() => (selecting ? togglePick(e.name) : e.dir ? open(root, joinPath(path, e.name)) : menu(e))}
              onLongPress={() => {
                // Appui long : passe en sélection multiple avec cet élément
                if (!selecting) {
                  setSelecting(true);
                  setPicked(new Set([e.name]));
                } else togglePick(e.name);
              }}
              style={[styles.row, (picked.has(e.name) || highlight === e.name) && styles.rowOn]}>
              {selecting ? (
                <Ionicons name={picked.has(e.name) ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={picked.has(e.name) ? C.accent : C.textDim} />
              ) : null}
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

      {selecting && !moving ? (
        <View style={[styles.moveBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.dim}>
            {picked.size ? `${picked.size} sélectionné${picked.size > 1 ? 's' : ''}` : 'Touche les éléments à sélectionner'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              title="Tout"
              variant="secondary"
              onPress={() => setPicked(picked.size === (entries?.length ?? 0) ? new Set() : new Set((entries ?? []).map((x) => x.name)))}
              style={{ flex: 0.8 }}
            />
            <Button
              title="Déplacer"
              icon="arrow-redo"
              disabled={!picked.size}
              onPress={() => {
                setMoving(pickedItems());
                setSelecting(false);
                setPicked(new Set());
              }}
              style={{ flex: 1.2 }}
            />
            <Button title="" icon="trash-outline" variant="danger" disabled={!picked.size} onPress={removePicked} style={{ width: 54, paddingHorizontal: 0 }} />
          </View>
        </View>
      ) : null}

      {moving ? (
        <View style={[styles.moveBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.dim} numberOfLines={1}>
            {moving.length === 1 ? `Déplacer « ${moving[0].name} »` : `Déplacer ${moving.length} éléments`} : ouvre le dossier de destination
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
  rowOn: { backgroundColor: 'rgba(61,139,255,0.14)', borderRadius: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, color: C.text, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  file: { color: C.text, fontSize: 15 },
  job: { marginHorizontal: 16, marginBottom: 8, backgroundColor: C.surface, borderRadius: R.md, padding: 12, gap: 6 },
  moveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface, padding: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
});
