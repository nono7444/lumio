// Petits boutons − / + pour agrandir ou réduire une carte (statistiques, supervision). Le choix est mémorisé par carte.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';

/** 0 = compact, 1 = normal, 2 = grand */
export type SizeLevel = 0 | 1 | 2;

export function useCardSize(key: string, initial: SizeLevel = 1): [SizeLevel, (l: SizeLevel) => void] {
  const [level, setLevel] = useState<SizeLevel>(initial);
  useEffect(() => {
    AsyncStorage.getItem(`lumio-size:${key}`)
      .then((v) => {
        const n = Number(v);
        if (v != null && (n === 0 || n === 1 || n === 2)) setLevel(n);
      })
      .catch(() => {});
  }, [key]);
  const set = (l: SizeLevel) => {
    setLevel(l);
    AsyncStorage.setItem(`lumio-size:${key}`, String(l)).catch(() => {});
  };
  return [level, set];
}

export function SizeStepper({ level, onChange }: { level: SizeLevel; onChange: (l: SizeLevel) => void }) {
  // « − » réduit d'un coup au minimum ; « + » agrandit d'un cran
  const step = (d: number) => {
    const n = (d < 0 ? 0 : Math.min(2, level + d)) as SizeLevel;
    if (n === level) return;
    tap();
    onChange(n);
  };
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => step(-1)} hitSlop={8} style={[styles.btn, level === 0 && styles.off]} accessibilityLabel="Réduire">
        <Ionicons name="remove" size={15} color={C.text} />
      </Pressable>
      <View style={styles.sep} />
      <Pressable onPress={() => step(1)} hitSlop={8} style={[styles.btn, level === 2 && styles.off]} accessibilityLabel="Agrandir">
        <Ionicons name="add" size={15} color={C.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' },
  btn: { width: 34, height: 28, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.3 },
  sep: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: 'rgba(255,255,255,0.25)' },
});
