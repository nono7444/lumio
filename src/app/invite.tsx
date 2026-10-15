import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { C } from '@/constants/theme';
import { useSettings, type Addon } from '@/lib/settings';
import { normalizeAddonUrl } from '@/lib/stremio';

/**
 * Lien d'invitation : lumio://invite?jf=…&seerr=…&tmdb=…&addons=url1|url2
 * Préremplit l'appli d'un proche (serveurs, clé TMDB, addons), sans jamais partager les clés Radarr/Sonarr.
 */
export default function Invite() {
  const p = useLocalSearchParams<{ jf?: string; seerr?: string; chat?: string; tmdb?: string; addons?: string; name?: string }>();
  const { settings, update } = useSettings();

  useEffect(() => {
    (async () => {
      const addons: Addon[] = [...settings.addons];
      for (const raw of (p.addons ?? '').split('|').filter(Boolean)) {
        const base = normalizeAddonUrl(raw);
        if (!addons.some((a) => a.base === base)) addons.push({ base, name: decodeURIComponent(base.split('/')[2] ?? 'Addon') });
      }
      await update({
        addons,
        tmdbKey: p.tmdb || settings.tmdbKey,
        seerr: p.seerr ? { url: p.seerr } : settings.seerr,
        chatUrl: p.chat || settings.chatUrl,
        // Nouvelle invitation : on repasse par l'écran de connexion
        jellyfin: p.jf && settings.jellyfin?.url !== p.jf ? null : settings.jellyfin,
        skipJellyfin: false,
      });
      router.replace({ pathname: '/login', params: p.jf ? { url: p.jf } : {} });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <ActivityIndicator color={C.text} />
      <Text style={{ color: C.textDim }}>Configuration de Lumio{p.name ? ` par ${p.name}` : ''}…</Text>
    </View>
  );
}
