import { Redirect, router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { FloatingTabBar } from '@/components/tab-bar';
import { C } from '@/constants/theme';
import { fetchIsAdmin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

// « Qui regarde ? » proposé une fois par ouverture de l'appli (si des profils existent)
let askedThisLaunch = false;

export default function TabsLayout() {
  const { settings, update } = useSettings();

  useEffect(() => {
    const h = settings.household;
    if (askedThisLaunch || Platform.isTV || !h || !h.askOnLaunch || !h.count || !settings.jellyfin) return;
    askedThisLaunch = true;
    const t = setTimeout(() => router.push('/profiles'), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.household?.count]);

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

  // Serveur Lumio pas renseigné (ex. TV connectée par code) : on prend celui de la maison s'il répond,
  // sinon les demandes, la file et les messages restent vides
  useEffect(() => {
    if (!settings.jellyfin || settings.chatUrl) return;
    const home = 'https://lumio.wawanono.lol';
    fetch(`${home}/health`)
      .then((r) => (r.ok ? update({ chatUrl: home }) : null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, settings.chatUrl]);

  // Premier lancement : écran de connexion Jellyfin (on peut le passer)
  if (!settings.jellyfin && !settings.skipJellyfin) return <Redirect href="/login" />;

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      // TV : menu latéral à gauche (façon Nuvio)
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
        tabBarPosition: Platform.isTV ? 'left' : 'bottom',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="search" options={{ title: 'Recherche' }} />
      <Tabs.Screen name="library" options={{ title: 'Bibliothèque', href: settings.jellyfin ? undefined : null }} />
      <Tabs.Screen name="live" options={{ title: 'Live TV' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendrier' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', href: settings.jellyfin ? undefined : null }} />
      <Tabs.Screen name="activity" options={{ title: 'Demandes' }} />
      <Tabs.Screen name="watchlist" options={{ title: 'À voir', href: Platform.isTV ? null : undefined }} />
      <Tabs.Screen name="settings" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
