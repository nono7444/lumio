// TV, façon Nuvio : un grand bouton ovale (Lecture / Reprendre / Demander) suivi de boutons ronds à icône.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { C } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type Focusable = { focused?: boolean };

/** Bouton principal ovale : blanc, icône + texte noirs. */
export function TvPill({ icon, label, onPress, loading, disabled, hasTVPreferredFocus }: { icon: IconName; label: string; onPress: () => void; loading?: boolean; disabled?: boolean; hasTVPreferredFocus?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={(st) => [styles.pill, (st as Focusable).focused ? styles.pillFocused : null, disabled ? { opacity: 0.5 } : null]}>
      {loading ? <ActivityIndicator color="#222" /> : <Ionicons name={icon} size={20} color="#222" />}
      <Text style={styles.pillText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Bouton rond à icône (vu, note, j'aime…) ; « on » = rempli. */
export function TvRound({ icon, iconOn, on, onPress, label, color }: { icon: IconName; iconOn?: IconName; on?: boolean; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={(st) => [styles.round, on ? styles.roundOn : null, (st as Focusable).focused ? styles.roundFocused : null]}>
      {(st) => {
        const f = (st as Focusable).focused;
        return <Ionicons name={on && iconOn ? iconOn : icon} size={22} color={f ? '#111' : on ? (color ?? '#fff') : '#fff'} />;
      }}
    </Pressable>
  );
}

export function TvActionRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const SIZE = 50;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 6 },
  pill: {
    height: SIZE,
    minWidth: 190,
    paddingHorizontal: 28,
    borderRadius: SIZE / 2,
    backgroundColor: 'rgba(232,232,238,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pillFocused: { backgroundColor: '#fff' },
  pillText: { color: '#222', fontSize: 17, fontWeight: '500' },
  round: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: 'rgba(28,28,30,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { backgroundColor: 'rgba(48,48,52,0.9)' },
  roundFocused: { backgroundColor: '#fff' },
});

export const TV_GOLD = C.warning;
