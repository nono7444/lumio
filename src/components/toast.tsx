// Petits messages éphémères (ex. résultat d'un téléchargement lancé pendant qu'on regarde).
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/constants/theme';

type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info' };

let items: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Toast['kind'] = 'ok', ms = 6000) {
  const t = { id: ++seq, text, kind };
  items = [...items, t].slice(-3);
  emit();
  setTimeout(() => {
    items = items.filter((x) => x.id !== t.id);
    emit();
  }, ms);
}

/** À placer dans les écrans (y compris les modales plein écran, qui recouvrent la racine). */
export function Toasts() {
  const insets = useSafeAreaInsets();
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!items.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Platform.isTV ? 30 : insets.bottom + 86 }]}>
      {items.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => {
            items = items.filter((x) => x.id !== t.id);
            emit();
          }}
          style={[styles.toast, t.kind === 'error' && { borderColor: 'rgba(255,69,58,0.6)' }]}>
          <Ionicons
            name={t.kind === 'error' ? 'alert-circle' : t.kind === 'info' ? 'information-circle' : 'cloud-download'}
            size={20}
            color={t.kind === 'error' ? C.danger : t.kind === 'info' ? C.text : C.success}
          />
          <Text style={styles.text}>{t.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, gap: 8, alignItems: 'center', zIndex: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  text: { color: C.text, fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 19 },
});
