// Bouton « Passer l'intro / le récap / le générique » (segments détectés par Jellyfin), en bas à droite du lecteur.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';

import type { SkipSegment } from './types';

const LABEL: Record<SkipSegment['type'], string> = {
  intro: 'Passer l’intro',
  recap: 'Passer le récap',
  outro: 'Passer le générique',
  preview: 'Passer l’aperçu',
};

export function SkipButton({ segments, position, onSkip }: { segments?: SkipSegment[]; position: number; onSkip: (to: number) => void }) {
  const insets = useSafeAreaInsets();
  const [skipped, setSkipped] = useState<string | null>(null);
  // Segment en cours (on laisse 2 s de marge à la fin pour ne pas sauter dans le vide)
  const seg = segments?.find((x) => position >= x.start && position < x.end - 2);
  if (!seg) return null;
  const key = `${seg.type}:${seg.start}`;
  if (skipped === key) return null;
  return (
    <Pressable
      hasTVPreferredFocus
      onPress={() => {
        tap();
        setSkipped(key);
        onSkip(seg.end);
      }}
      style={[styles.btn, { bottom: insets.bottom + 96, right: insets.right + 20 }]}>
      <Text style={styles.text}>{LABEL[seg.type]}</Text>
      <Ionicons name="play-skip-forward" size={17} color="#000" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute',
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { color: '#000', fontSize: 15, fontWeight: '800' },
});
