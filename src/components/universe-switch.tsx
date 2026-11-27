// Lumio : bouton « univers » en haut de l'accueil, des livres audio et des livres. Il ouvre un petit menu
// (Films & séries, Lumio Auto pour l'admin, Livres, Livres audio, TV) ; les onglets du bas suivent l'univers choisi.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { setUniverse, UNIVERSES, useUniverse, type Universe } from '@/lib/universe';
import { useSettings } from '@/lib/settings';
import { IS_AUDIO, IS_AUTO, IS_BOOKS } from '@/lib/variant';

export function goUniverse(u: Universe) {
  setUniverse(u);
  const home = UNIVERSES.find((x) => x.id === u)!.home;
  // Laisse la barre d'onglets se mettre à jour avant d'aller au premier onglet de l'univers
  setTimeout(() => router.navigate(home === 'index' ? '/' : (`/${home}` as '/listen')), 0);
}

export function UniverseSwitch({ style }: { style?: object }) {
  const u = useUniverse();
  const { settings } = useSettings();
  const list = UNIVERSES.filter((x) => !x.admin || settings.jellyfin?.isAdmin);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Pas d'univers dans Lumio Auto, les anciennes applis séparées et sur la TV
  if (IS_AUTO || IS_AUDIO || IS_BOOKS || Platform.isTV) return null;
  const cur = UNIVERSES.find((x) => x.id === u)!;
  return (
    <>
      <Pressable onPress={() => (tap(), setOpen(true))} style={[styles.btn, style]} accessibilityLabel={`Univers : ${cur.label}. Changer`}>
        <Ionicons name={cur.icon} size={15} color={C.text} />
        <Text style={styles.btnText}>{cur.label}</Text>
        <Ionicons name="chevron-down" size={14} color={C.textDim} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.menu, { top: insets.top + 54 }]}>
          {list.map((x) => {
            const on = x.id === u;
            return (
              <Pressable
                key={x.id}
                onPress={() => {
                  tap();
                  setOpen(false);
                  if (!on) goUniverse(x.id);
                }}
                style={[styles.item, on && styles.itemOn]}>
                <View style={[styles.icon, on && { backgroundColor: '#000' }]}>
                  <Ionicons name={x.icon} size={18} color={on ? '#fff' : C.text} />
                </View>
                <Text style={[styles.itemText, on && { color: '#000' }]}>{x.label}</Text>
                {on ? <Ionicons name="checkmark" size={18} color="#000" /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  btnText: { color: C.text, fontSize: 14, fontWeight: '700' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  menu: {
    position: 'absolute',
    left: 16,
    width: 250,
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
    gap: 2,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14 },
  itemOn: { backgroundColor: '#fff' },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, color: C.text, fontSize: 16, fontWeight: '700' },
});
