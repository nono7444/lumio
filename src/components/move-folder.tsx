// Déplacer un film ou une série (fichier ou dossier) n'importe où sur les disques du serveur (admin).
// Marche pour tout ce que Jellyfin voit, géré par Radarr / Sonarr ou ajouté à la main.
import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePrompt } from '@/components/prompt-modal';
import { toast } from '@/components/toast';
import { C } from '@/constants/theme';
import { filesApi, formatSize, joinPath, parentPath, type Disk, type FileEntry } from '@/lib/files';
import { jfLibraryFolders } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

type Src = { root: string; folder: string; name: string | null };
type What = { root: string; path: string; name: string; dir: boolean };

const last = (p: string) => p.split('/').filter(Boolean).pop() ?? '';

/** `children` reçoit (ouvrir, chargement) pour dessiner le bouton. `path` = chemin du fichier ou du dossier dans Jellyfin. */
export function MoveFolder({ path, title, children }: { path: string; title: string; children: (open: () => void, busy: boolean) => ReactNode }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState<Src | null>(null);
  const [what, setWhat] = useState<What | null>(null);
  const [disks, setDisks] = useState<Disk[]>([]);
  const [root, setRoot] = useState('');
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [moving, setMoving] = useState(false);
  const { prompt, element } = usePrompt();

  const browse = async (r: string, d: string) => {
    setRoot(r);
    setDir(d);
    setEntries(null);
    try {
      setEntries((await filesApi.list(settings, r, d)).filter((e) => e.dir).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
    } catch (e: any) {
      setEntries([]);
      toast(e?.message ?? String(e), 'error');
    }
  };

  const choose = (w: What) => {
    setWhat(w);
    // On commence là où il est rangé aujourd'hui (le dossier parent)
    browse(w.root, parentPath(w.path));
  };

  /** Le fichier ou dossier existe-t-il vraiment à cet endroit sur le disque ? */
  const exists = async (root: string, rel: string) => {
    try {
      const list = await filesApi.list(settings, root, parentPath(rel));
      return list.some((e) => e.name === last(rel));
    } catch {
      return false;
    }
  };

  /** Jellyfin n'est pas toujours à jour (titre déjà déplacé) : on cherche le vrai emplacement par son nom. */
  const relocate = async (loc: Src): Promise<Src | null> => {
    const target = loc.folder || loc.name || '';
    if (await exists(loc.root, loc.name ? joinPath(loc.folder, loc.name) : loc.folder)) return loc;
    const wanted = loc.folder ? last(loc.folder) : loc.name!;
    const words = wanted.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!target || !words) return null;
    const hits = (await filesApi.search(settings, words).catch(() => [])).filter((r) => r.name === wanted && r.dir === Boolean(loc.folder));
    const hit = hits[0];
    if (!hit) return null;
    return loc.folder ? { root: hit.root, folder: hit.path, name: loc.name } : { root: hit.root, folder: parentPath(hit.path), name: hit.name };
  };

  const open = async () => {
    setBusy(true);
    try {
      const [found, d] = await Promise.all([filesApi.locate(settings, path), filesApi.disks(settings)]);
      const loc = await relocate(found);
      if (!loc) {
        Alert.alert(
          'Introuvable sur le disque',
          `Jellyfin le range dans « ${found.folder || found.name} » sur ${found.root}, mais il n’y est plus et Lumio ne l’a trouvé nulle part.\n\nLance une analyse de la bibliothèque dans Jellyfin, puis réessaie.`
        );
        return;
      }
      if (loc.root !== found.root || loc.folder !== found.folder) {
        toast(`Jellyfin n’était pas à jour : il est en fait dans ${[loc.root, ...loc.folder.split('/').slice(0, -1)].filter(Boolean).join(' / ')}`);
      }
      // Jamais une bibliothèque entière (KIDS, FILMS…) ni un dossier du premier niveau d'un disque :
      // un film rangé directement dans sa bibliothèque se déplace seul.
      const libs = await jfLibraryFolders(settings).catch(() => [] as string[]);
      const abs = (path.replace(/\\/g, '/').replace(/\/+$/, ''));
      const absFolder = loc.name && loc.root === found.root && loc.folder === found.folder ? abs.split('/').slice(0, -1).join('/') : loc.name ? '' : abs;
      const isLib = (a: string) => !!a && libs.some((l) => l === a || l.startsWith(a + '/'));
      const safeFolder = !!loc.folder && loc.folder.includes('/') && !isLib(absFolder);
      setDisks(d);
      if (!loc.name) {
        // Série (ou film rangé dans un dossier) : on déplace tout le dossier
        if (!safeFolder) {
          Alert.alert('Déplacer', `« ${last(loc.folder)} » est un dossier de bibliothèque : Lumio ne le déplace pas en entier. Utilise Disques pour ça.`);
          return;
        }
        setSrc(loc);
        choose({ root: loc.root, path: loc.folder, name: last(loc.folder), dir: true });
      } else if (!safeFolder) {
        setSrc(loc);
        choose({ root: loc.root, path: joinPath(loc.folder, loc.name), name: loc.name, dir: false });
      } else {
        // Film dans son propre dossier : demander s'il faut déplacer le dossier entier ou le fichier seul
        setSrc(loc);
        setWhat(null);
      }
    } catch (e: any) {
      Alert.alert('Déplacer', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (moving) return;
    setSrc(null);
    setWhat(null);
    setEntries(null);
  };

  const here = what ? root === what.root && dir === parentPath(what.path) : false;
  const inside = what?.dir && root === what.root && (dir === what.path || dir.startsWith(what.path + '/'));

  const doMove = async () => {
    if (!what) return;
    if (what.dir && !what.path.includes('/')) {
      Alert.alert('Déplacer', 'Lumio ne déplace pas un dossier du premier niveau d’un disque (une bibliothèque entière).');
      return;
    }
    setMoving(true);
    try {
      const r = await filesApi.move(settings, what.root, what.path, joinPath(dir, what.name), root === what.root ? undefined : root);
      setMoving(false);
      close();
      if (r?.job) toast(`Copie vers ${root} lancée : suis-la dans Disques`);
      else toast(`« ${title} » déplacé dans ${last(dir) || root}`);
    } catch (e: any) {
      setMoving(false);
      Alert.alert('Déplacement impossible', e?.message ?? String(e));
    }
  };

  const newFolder = async () => {
    const n = (await prompt({ title: 'Nouveau dossier', message: `Dans ${last(dir) || root}`, value: '', ok: 'Créer' }))?.trim();
    if (!n) return;
    try {
      await filesApi.mkdir(settings, root, joinPath(dir, n));
      browse(root, joinPath(dir, n));
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  return (
    <>
      {children(open, busy)}
      <Modal visible={!!src} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={st.backdrop} onPress={close} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={st.head}>
            <Text style={st.title}>Déplacer</Text>
            <Pressable onPress={close} hitSlop={10}>
              <Ionicons name="close-circle" size={28} color={C.textDim} />
            </Pressable>
          </View>

          {src && !what ? (
            // 1. Quoi déplacer
            <View style={{ gap: 8 }}>
              <Text style={st.sub}>Que veux-tu déplacer ?</Text>
              <Pill
                icon="folder"
                label={`Le dossier « ${last(src.folder)} »`}
                hint="Avec le film, les sous-titres et les images"
                onPress={() => choose({ root: src.root, path: src.folder, name: last(src.folder), dir: true })}
              />
              <Pill
                icon="document"
                label="Le fichier seul"
                hint={src.name ?? ''}
                onPress={() => choose({ root: src.root, path: joinPath(src.folder, src.name!), name: src.name!, dir: false })}
              />
            </View>
          ) : null}

          {what ? (
            // 2. Où le mettre
            <View style={{ gap: 10, flexShrink: 1 }}>
              <Text style={st.sub} numberOfLines={2}>
                <Ionicons name={what.dir ? 'folder' : 'document'} size={13} color={C.textDim} /> {what.name}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {disks.map((d) => (
                  <Pressable key={d.name} onPress={() => browse(d.name, '')} style={[st.chip, root === d.name && st.chipOn]}>
                    <Ionicons name="server-outline" size={14} color={root === d.name ? '#fff' : C.text} />
                    <Text style={[st.chipTxt, root === d.name && { color: '#fff' }]}>{d.name}</Text>
                    {d.free != null ? <Text style={[st.chipFree, root === d.name && { color: '#dfe9ff' }]}>{formatSize(d.free)}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
              <View style={st.crumb}>
                <Pressable disabled={!dir} onPress={() => browse(root, parentPath(dir))} hitSlop={8} style={{ opacity: dir ? 1 : 0.3 }}>
                  <Ionicons name="arrow-up-circle" size={26} color={C.text} />
                </Pressable>
                <Text style={st.crumbTxt} numberOfLines={1}>
                  {root}
                  {dir ? ` / ${dir.split('/').join(' / ')}` : ''}
                </Text>
                <Pressable onPress={newFolder} hitSlop={8} accessibilityLabel="Nouveau dossier">
                  <Ionicons name="add-circle-outline" size={26} color={C.text} />
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 6 }}>
                {entries === null ? <ActivityIndicator color="#fff" style={{ margin: 20 }} /> : null}
                {entries?.map((e) => {
                  const self = what.dir && root === what.root && joinPath(dir, e.name) === what.path;
                  return (
                    <Pressable key={e.name} disabled={self} onPress={() => browse(root, joinPath(dir, e.name))} style={[st.row, self && { opacity: 0.4 }]}>
                      <Ionicons name="folder-outline" size={20} color={C.accent} />
                      <Text style={st.rowTxt} numberOfLines={1}>{e.name}</Text>
                      {self ? <Text style={st.chipFree}>lui-même</Text> : <Ionicons name="chevron-forward" size={16} color={C.textDim} />}
                    </Pressable>
                  );
                })}
                {entries?.length === 0 ? <Text style={[st.sub, { textAlign: 'center', padding: 14 }]}>Aucun sous-dossier</Text> : null}
              </ScrollView>
              <Pressable onPress={doMove} disabled={here || !!inside || moving} style={[st.go, (here || inside) && { opacity: 0.4 }]}>
                {moving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
                <Text style={st.goTxt} numberOfLines={1}>
                  {here ? 'Il est déjà ici' : inside ? 'Impossible dans lui-même' : `Déplacer dans ${last(dir) || root}`}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {element}
      </Modal>
    </>
  );
}

function Pill({ icon, label, hint, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={st.row}>
      <Ionicons name={icon} size={22} color={C.accent} />
      <View style={{ flex: 1 }}>
        <Text style={st.pillTxt} numberOfLines={1}>{label}</Text>
        <Text style={st.chipFree} numberOfLines={1}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textDim} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, gap: 12, maxHeight: '85%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 22, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 14, lineHeight: 20 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
  chipOn: { backgroundColor: C.accent },
  chipTxt: { color: C.text, fontWeight: '700', fontSize: 14 },
  chipFree: { color: C.textDim, fontSize: 12 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  crumbTxt: { color: C.text, fontWeight: '600', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999, backgroundColor: C.surfaceHigh },
  rowTxt: { color: C.text, fontSize: 15, fontWeight: '600', flex: 1 },
  pillTxt: { color: C.text, fontSize: 15, fontWeight: '600' },
  go: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 999, backgroundColor: C.accent },
  goTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
