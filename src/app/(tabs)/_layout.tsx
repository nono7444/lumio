import { Redirect, Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/tab-bar';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';

export default function TabsLayout() {
  const { settings } = useSettings();
  // Premier lancement : écran de connexion Jellyfin (on peut le passer)
  if (!settings.jellyfin && !settings.skipJellyfin) return <Redirect href="/login" />;

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="search" options={{ title: 'Recherche' }} />
      <Tabs.Screen name="library" options={{ title: 'Bibliothèque', href: settings.jellyfin ? undefined : null }} />
      <Tabs.Screen name="activity" options={{ title: 'Activité' }} />
      <Tabs.Screen name="settings" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
