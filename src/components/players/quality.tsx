// Choix de la qualité de lecture (débit / définition), comme dans les clients Jellyfin.
import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { C } from '@/constants/theme';
import { QUALITIES } from '@/lib/jellyfin';

export function QualitySheet({
  visible,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Pressable focusRing={false} style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.title}>Qualité</Text>
        <Text style={styles.hint}>« Original » lit le fichier tel quel. Les autres font transcoder le serveur, utile en 4G ou avec une connexion lente.</Text>
        {QUALITIES.map((q) => {
          const on = q.id === current;
          return (
            <Pressable key={q.id} onPress={() => onPick(q.id)} style={[styles.row, on && styles.rowOn]}>
              <Text style={[styles.label, on && { color: '#000' }]}>{q.label}</Text>
              {on ? <Ionicons name="checkmark" size={20} color="#000" /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignSelf: 'center',
    maxWidth: 520,
    width: '100%',
    backgroundColor: '#161618',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    gap: 8,
  },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  hint: { color: C.textDim, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowOn: { backgroundColor: C.text },
  label: { color: C.text, fontSize: 15, fontWeight: '700' },
});
