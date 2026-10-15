import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  currentTabPrefs,
  libraryRowDefs,
  MOVABLE_TABS,
  orderLibraryRows,
  orderRows,
  TAB_LABELS,
  useAvailableRows,
} from '@/lib/home-layout';
import { jf, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

function ReorderRow({
  label,
  hidden,
  first,
  last,
  onUp,
  onDown,
  onToggle,
}: {
  label: string;
  hidden: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
}) {
  return (
    <View style={[styles.row, hidden && { opacity: 0.5 }]}>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.eye} accessibilityLabel={hidden ? 'Afficher' : 'Masquer'}>
        <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={hidden ? C.textFaint : C.text} />
      </Pressable>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Pressable onPress={onUp} disabled={first} hitSlop={6} style={styles.arrow}>
        <Ionicons name="chevron-up" size={20} color={first ? C.border : C.textDim} />
      </Pressable>
      <Pressable onPress={onDown} disabled={last} hitSlop={6} style={styles.arrow}>
        <Ionicons name="chevron-down" size={20} color={last ? C.border : C.textDim} />
      </Pressable>
    </View>
  );
}

/** Personnalisation : ordre / visibilité des rangées de l'accueil et des onglets. */
export default function Customize() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const { rows, loading } = useAvailableRows();
  const ordered = orderRows(rows, settings.homeLayout);
  const layout = ordered.map((r) => ({ id: r.id, hidden: r.hidden }));
  const tabs = currentTabPrefs(settings);
  const [views, setViews] = useState<JfItem[]>([]);

  useEffect(() => {
    if (settings.jellyfin) jf.views(settings).then(setViews).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token]);

  const libRows = orderLibraryRows(libraryRowDefs(views), settings.libraryLayout);
  const libLayout = libRows.map((r) => ({ id: r.id, hidden: r.hidden }));

  function moveLib(i: number, d: -1 | 1) {
    const next = [...libLayout];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    tap();
    update({ libraryLayout: next });
  }

  function saveRows(next: { id: string; hidden?: boolean }[]) {
    tap();
    update({ homeLayout: next });
  }

  function moveRow(i: number, d: -1 | 1) {
    const next = [...layout];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    saveRows(next);
  }

  function moveTab(i: number, d: -1 | 1) {
    const next = [...tabs];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    tap();
    update({ tabsLayout: next });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Personnaliser</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }}>
        <Text style={styles.section}>Accueil</Text>
        <Text style={styles.help}>L'œil masque une rangée, les flèches la déplacent.</Text>
        {loading ? (
          <ActivityIndicator color={C.text} style={{ margin: 20 }} />
        ) : (
          ordered.map((r, i) => (
            <ReorderRow
              key={r.id}
              label={r.label}
              hidden={r.hidden}
              first={i === 0}
              last={i === ordered.length - 1}
              onUp={() => moveRow(i, -1)}
              onDown={() => moveRow(i, 1)}
              onToggle={() => saveRows(layout.map((x) => (x.id === r.id ? { ...x, hidden: !x.hidden } : x)))}
            />
          ))
        )}

        {settings.jellyfin ? (
          <>
            <Text style={[styles.section, { marginTop: 22 }]}>Bibliothèque</Text>
            <Text style={styles.help}>Masque par exemple « Reprendre » ou une bibliothèque que tu n'utilises pas.</Text>
            {libRows.map((r, i) => (
              <ReorderRow
                key={r.id}
                label={r.label}
                hidden={r.hidden}
                first={i === 0}
                last={i === libRows.length - 1}
                onUp={() => moveLib(i, -1)}
                onDown={() => moveLib(i, 1)}
                onToggle={() => {
                  tap();
                  update({ libraryLayout: libLayout.map((x) => (x.id === r.id ? { ...x, hidden: !x.hidden } : x)) });
                }}
              />
            ))}
          </>
        ) : null}

        <Text style={[styles.section, { marginTop: 22 }]}>Onglets</Text>
        <Text style={styles.help}>Accueil et Profil restent toujours visibles.</Text>
        {tabs.map((t, i) => (
          <ReorderRow
            key={t.name}
            label={TAB_LABELS[t.name]}
            hidden={Boolean(t.hidden)}
            first={i === 0}
            last={i === tabs.length - 1}
            onUp={() => moveTab(i, -1)}
            onDown={() => moveTab(i, 1)}
            onToggle={() => {
              tap();
              update({ tabsLayout: tabs.map((x) => (x.name === t.name ? { ...x, hidden: !x.hidden } : x)) });
            }}
          />
        ))}
        {MOVABLE_TABS.length > 0 && (
          <Button
            title="Réinitialiser"
            icon="refresh"
            variant="secondary"
            onPress={() => update({ homeLayout: [], tabsLayout: [], libraryLayout: [] })}
            style={{ marginTop: 18 }}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  section: { color: C.text, fontSize: 18, fontWeight: '700' },
  help: { color: C.textDim, fontSize: 13, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 12 },
  eye: { width: 32, alignItems: 'center' },
  label: { flex: 1, color: C.text, fontSize: 14, fontWeight: '500' },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
