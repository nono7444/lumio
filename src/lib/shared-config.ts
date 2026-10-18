// Clé TMDB partagée par le serveur Lumio : l'admin la confie au serveur, les autres comptes (frère, TV…) la reçoivent.
import { useEffect } from 'react';

import { serverCall } from './chat';
import { useSettings } from './settings';

export function useSharedTmdbKey() {
  const { settings, update } = useSettings();
  const admin = settings.jellyfin?.isAdmin === true;
  useEffect(() => {
    if (!settings.chatUrl || !settings.jellyfin) return;
    const key = settings.tmdbKey.trim();
    if (key && admin) {
      serverCall(settings, '/api/config/tmdb', { method: 'PUT', body: JSON.stringify({ key }) }).catch(() => {});
    } else if (!key) {
      serverCall<{ key: string | null }>(settings, '/api/config/tmdb')
        .then((r) => {
          if (r?.key) update({ tmdbKey: r.key });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token, settings.tmdbKey, admin]);
}
