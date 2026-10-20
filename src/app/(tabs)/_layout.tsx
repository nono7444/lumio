import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { FloatingTabBar } from '@/components/tab-bar';
import { C } from '@/constants/theme';
import { fetchIsAdmin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

/** Hauteur réservée à la barre flottante sur TV */
const TV_BAR = 74;

export default function TabsLayout() {
  const { settings, update } = useSettings();

  // Rôle Jellyfin rafraîchi à chaque lancement (un admin peut retirer ou donner les droits)
  useEffect(() => {
    if (!settings.jellyfin) return;
    fetchIsAdmin(settings)
      .then((isAdmin) => {
        if (settings.jellyfin && settings.jellyfin.isAdmin !== isAdmin)
          update({ jellyfin: { ...settings.jellyfin, isAdmin } });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token]);

  // Premier lancement : écran de connexion Jellyfin (on peut le passer)
  if (!settings.jellyfin && !settings.skipJellyfin) return <Redirect href="/login" />;

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      // TV : la barre flotte en haut ; les pages laissent sa place, sauf l'accueil dont l'image passe dessous
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg, paddingTop: Platform.isTV ? TV_BAR : 0 },
        tabBarPosition: Platform.isTV ? 'top' : 'bottom',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil', sceneStyle: { backgroundColor: C.bg, paddingTop: 0 } }} />
      <Tabs.Screen name="search" options={{ title: 'Recherche' }} />
      <Tabs.Screen name="library" options={{ title: 'Bibliothèque', href: settings.jellyfin ? undefined : null }} />
      <Tabs.Screen name="live" options={{ title: 'Live TV' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendrier' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', href: settings.jellyfin ? undefined : null }} />
      <Tabs.Screen name="activity" options={{ title: 'Demandes' }} />
      <Tabs.Screen name="settings" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
