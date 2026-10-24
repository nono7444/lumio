// Signet « À voir » des fiches : un appui ajoute le titre à la liste, un autre le retire.
// « icon » : bouton rond à côté de Lire / J'aime ; « pill » : petite pastille avec le libellé.
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, Text } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { useInWatchlist, type WatchItem } from '@/lib/watchlist';

export function WatchlistButton({ item, variant = 'pill' }: { item: Omit<WatchItem, 'addedAt' | 'status'> | null; variant?: 'icon' | 'pill' }) {
  const { on, toggle, available } = useInWatchlist(item);
  if (!available || Platform.isTV) return null;
  const press = async () => {
    tap();
    try {
      await toggle();
      toast(on ? 'Retiré de « À voir »' : 'Ajouté à « À voir »');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };
  if (variant === 'icon')
    return (
      <Button
        title=""
        icon={on ? 'bookmark' : 'bookmark-outline'}
        variant="glass"
        small
        onPress={press}
        style={{ width: 46, paddingHorizontal: 0 }}
      />
    );
  return (
    <Pressable onPress={press} style={[styles.pill, on && styles.pillOn]} accessibilityLabel={on ? 'Retirer de « À voir »' : 'Ajouter à « À voir »'}>
      <Ionicons name={on ? 'bookmark' : 'bookmark-outline'} size={17} color={on ? '#000' : C.text} />
      <Text style={[styles.text, on && { color: '#000' }]}>{on ? 'Dans « À voir »' : 'À voir'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.surface },
  pillOn: { backgroundColor: '#fff' },
  text: { color: C.text, fontSize: 14, fontWeight: '700' },
});
