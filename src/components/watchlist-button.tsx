// Bouton « À voir » des fiches : ajoute / retire le titre de la liste personnelle.
import { Platform } from 'react-native';

import { toast } from '@/components/toast';
import { Button, tap } from '@/components/ui';
import { useInWatchlist, type WatchItem } from '@/lib/watchlist';

export function WatchlistButton({ item }: { item: Omit<WatchItem, 'addedAt' | 'status'> | null }) {
  const { on, toggle, available } = useInWatchlist(item);
  if (!available || Platform.isTV) return null;
  return (
    <Button
      title={on ? 'Dans « À voir »' : 'Ajouter à « À voir »'}
      icon={on ? 'bookmark' : 'bookmark-outline'}
      variant="secondary"
      onPress={async () => {
        tap();
        try {
          await toggle();
          toast(on ? 'Retiré de « À voir »' : 'Ajouté à « À voir »');
        } catch (e: any) {
          toast(e?.message ?? String(e), 'error');
        }
      }}
    />
  );
}
