import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Redirect, Tabs } from 'expo-router';
import { Platform, StyleSheet, type ColorValue } from 'react-native';

import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';

type IconName = keyof typeof Ionicons.glyphMap;

const icon =
  (on: IconName, off: IconName) =>
  ({ focused, color }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? on : off} color={color} size={24} />
  );

export default function TabsLayout() {
  const { settings } = useSettings();
  // Premier lancement : écran de connexion Jellyfin (on peut le passer)
  if (!settings.jellyfin && !settings.skipJellyfin) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        // Barre flottante en verre dépoli, le contenu défile dessous
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          backgroundColor: Platform.OS === 'android' ? 'rgba(10,10,10,0.94)' : 'transparent',
          elevation: 0,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView tint="systemChromeMaterialDark" intensity={90} style={StyleSheet.absoluteFill} />
          ) : null,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Bibliothèque',
          tabBarIcon: icon('albums', 'albums-outline'),
          href: settings.jellyfin ? undefined : null,
        }}
      />
      <Tabs.Screen name="search" options={{ title: 'Recherche', tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activité', tabBarIcon: icon('cloud-download', 'cloud-download-outline') }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Réglages', tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
