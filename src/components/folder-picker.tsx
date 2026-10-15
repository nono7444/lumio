// Choix du dossier de téléchargement (Films, Kids, Anime…) au moment d'ajouter un titre.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { formatBytes } from '@/lib/arr';
import type { FolderChoice } from '@/lib/grab';

type Pending = FolderChoice & { resolve: (path: string | null) => void };

let open: ((p: Pending) => void) | null = null;

/** Ouvre le sélecteur ; renvoie le dossier choisi, ou null si on ne télécharge pas. */
export function askFolder(choice: FolderChoice): Promise<string | null> {
  if (!open) return Promise.resolve(choice.suggested ?? choice.folders[0]?.path ?? null);
  return new Promise((resolve) => open!({ ...choice, resolve }));
}

const NAMES: [RegExp, string, keyof typeof Ionicons.glyphMap][] = [
  [/anim[eé]/i, 'Anime', 'sparkles-outline'],
  [/kid|enfant|jeunesse|famil|dessin/i, 'Enfants', 'happy-outline'],
  [/s[eé]rie|tv|show/i, 'Séries', 'tv-outline'],
  [/film|movie/i, 'Films', 'film-outline'],
  [/doc/i, 'Documentaires', 'earth-outline'],
  [/4k|uhd/i, '4K', 'diamond-outline'],
];

function describe(path: string) {
  const last = path.replace(/\/+$/, '').split('/').pop() || path;
  const hit = NAMES.find(([re]) => re.test(last));
  return { name: last.charAt(0).toUpperCase() + last.slice(1), icon: hit?.[2] ?? ('folder-outline' as const) };
}

/** À monter une fois à la racine de l'appli. */
export function FolderPickerHost() {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    open = setPending;
    return () => {
      open = null;
    };
  }, []);

  const done = (path: string | null) => {
    tap();
    pending?.resolve(path);
    setPending(null);
  };

  return (
    <Modal visible={!!pending} transparent animationType="slide" onRequestClose={() => done(null)}>
      <Pressable style={styles.backdrop} onPress={() => done(null)} />
      {pending && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grip} />
          <Text style={styles.title}>Où télécharger ?</Text>
          {pending.title ? (
            <Text style={styles.sub} numberOfLines={1}>
              {pending.title}
            </Text>
          ) : null}
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8, paddingTop: 14 }}>
            {pending.folders.map((f) => {
              const d = describe(f.path);
              const suggested = f.path === pending.suggested;
              return (
                <Pressable
                  key={f.path}
                  onPress={() => done(f.path)}
                  style={({ pressed }) => [styles.row, suggested && styles.rowOn, { opacity: pressed ? 0.7 : 1 }]}>
                  <View style={[styles.icon, suggested && { backgroundColor: C.text }]}>
                    <Ionicons name={d.icon} size={20} color={suggested ? '#000' : C.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{d.name}</Text>
                    <Text style={styles.path} numberOfLines={1}>
                      {f.path}
                      {f.freeSpace ? ` · ${formatBytes(f.freeSpace)} libres` : ''}
                    </Text>
                  </View>
                  {suggested && <Text style={styles.badge}>Suggéré</Text>}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => done(null)} style={styles.skip} hitSlop={8}>
            <Text style={styles.skipText}>{pending.streaming ? 'Regarder sans télécharger' : 'Annuler'}</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#161618',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 14 },
  title: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: C.textDim, fontSize: 14, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surfaceHigh, borderRadius: R.lg, padding: 12 },
  rowOn: { borderWidth: 1.5, borderColor: C.text },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  name: { color: C.text, fontSize: 16, fontWeight: '700' },
  path: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  badge: { color: '#000', backgroundColor: C.text, fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  skip: { alignItems: 'center', paddingVertical: 16 },
  skipText: { color: C.textDim, fontSize: 15, fontWeight: '600' },
});
