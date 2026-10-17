// Barre du bas : ajouter, retirer et ranger les raccourcis (appui long sur la barre pour venir ici).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { currentTabPrefs, TAB_LABELS } from '@/lib/home-layout';
import { useSettings, type TabPref } from '@/lib/settings';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  search: 'search',
  library: 'albums',
  live: 'tv',
  activity: 'file-tray-full',
  calendar: 'calendar',
  chat: 'chatbubbles',
};

const HELP: Record<string, string> = {
  calendar: 'Aussi en haut de l’accueil',
  chat: 'Aussi en haut de l’accueil',
};

export default function CustomizeTabs() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const tabs = currentTabPrefs(settings);
  const inBar = tabs.filter((t) => !t.hidden);
  const others = tabs.filter((t) => t.hidden);

  const save = (next: TabPref[]) => {
    tap();
    update({ tabsLayout: next });
  };
  // Les onglets visibles d'abord (dans leur ordre), puis les autres
  const rebuild = (visible: TabPref[], hidden: TabPref[]) => save([...visible.map((t) => ({ ...t, hidden: false })), ...hidden.map((t) => ({ ...t, hidden: true }))]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= inBar.length) return;
    const next = [...inBar];
    [next[i], next[j]] = [next[j], next[i]];
    rebuild(next, others);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Barre du bas</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }}>
        <Text style={styles.help}>Accueil et Profil restent toujours. Astuce : un appui long sur la barre ouvre cet écran.</Text>

        <Text style={styles.section}>Dans la barre</Text>
        {inBar.map((t, i) => (
          <View key={t.name} style={styles.row}>
            <Pressable onPress={() => rebuild(inBar.filter((x) => x.name !== t.name), [t, ...others])} hitSlop={8} accessibilityLabel={`Retirer ${TAB_LABELS[t.name]}`}>
              <Ionicons name="remove-circle" size={24} color="#FF453A" />
            </Pressable>
            <Ionicons name={ICONS[t.name]} size={20} color={C.text} />
            <Text style={styles.label}>{TAB_LABELS[t.name]}</Text>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={styles.arrow}>
              <Ionicons name="chevron-up" size={20} color={i === 0 ? C.border : C.textDim} />
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === inBar.length - 1} hitSlop={6} style={styles.arrow}>
              <Ionicons name="chevron-down" size={20} color={i === inBar.length - 1 ? C.border : C.textDim} />
            </Pressable>
          </View>
        ))}
        {inBar.length === 0 ? <Text style={styles.help}>Aucun raccourci : seuls Accueil et Profil sont affichés.</Text> : null}

        <Text style={[styles.section, { marginTop: 18 }]}>Raccourcis disponibles</Text>
        {others.map((t) => (
          <View key={t.name} style={styles.row}>
            <Pressable onPress={() => rebuild([...inBar, t], others.filter((x) => x.name !== t.name))} hitSlop={8} accessibilityLabel={`Ajouter ${TAB_LABELS[t.name]}`}>
              <Ionicons name="add-circle" size={24} color="#30D158" />
            </Pressable>
            <Ionicons name={ICONS[t.name]} size={20} color={C.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { flex: 0 }]}>{TAB_LABELS[t.name]}</Text>
              {HELP[t.name] ? <Text style={styles.small}>{HELP[t.name]}</Text> : null}
            </View>
          </View>
        ))}
        {others.length === 0 ? <Text style={styles.help}>Tous les raccourcis sont dans la barre.</Text> : null}
        {inBar.length > 6 ? <Text style={[styles.help, { color: C.warning }]}>Au-delà de 6 raccourcis, les libellés deviennent petits.</Text> : null}

        <Button title="Réinitialiser" icon="refresh" variant="secondary" onPress={() => save([])} style={{ marginTop: 18 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  section: { color: C.text, fontSize: 18, fontWeight: '700' },
  help: { color: C.textDim, fontSize: 13 },
  small: { color: C.textFaint, fontSize: 12, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 12 },
  label: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600' },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
