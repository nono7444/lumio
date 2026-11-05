// Transmet l'adresse du serveur Lumio au widget iOS (via l'App Group) et lui demande de se rafraîchir.
// Si l'App Group n'est pas disponible (réinstallation via FlareStore qui le retire), le widget utilise l'adresse par défaut.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { serverBase, serverCall } from './chat';
import { useSettings } from './settings';

const APP_GROUP = 'group.lol.wawanono.lumio';

export function useWidgetSync() {
  const { settings } = useSettings();
  useEffect(() => {
    if (Platform.OS !== 'ios' || Platform.isTV) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ExtensionStorage } = require('@bacons/apple-targets') as typeof import('@bacons/apple-targets');
      const store = new ExtensionStorage(APP_GROUP);
      if (settings.chatUrl) store.set('serverUrl', serverBase(settings.chatUrl));
      else store.remove('serverUrl');
      ExtensionStorage.reloadWidget();
      // Admin : clé propre au widget (lecture seule) pour afficher le partage et qui regarde quoi ; jamais pour les autres
      if (settings.chatUrl && settings.jellyfin?.isAdmin) {
        serverCall<{ key: string }>(settings, '/api/widget/key')
          .then((r) => {
            if (!r?.key) return;
            store.set('widgetKey', r.key);
            ExtensionStorage.reloadWidget();
          })
          .catch(() => {});
      } else store.remove('widgetKey');
    } catch {}
  }, [settings.chatUrl, settings.jellyfin?.isAdmin, settings.jellyfin?.token]);

  // Widget plus réactif : rafraîchi à chaque ouverture et fermeture de Lumio
  useEffect(() => {
    if (Platform.OS !== 'ios' || Platform.isTV) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && st !== 'background') return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ExtensionStorage } = require('@bacons/apple-targets') as typeof import('@bacons/apple-targets');
        ExtensionStorage.reloadWidget();
      } catch {}
    });
    return () => sub.remove();
  }, []);
}
