import { Redirect, router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { FloatingTabBar } from '@/components/tab-bar';
import { C } from '@/constants/theme';
import { fetchIsAdmin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { IS_AUTO } from '@/lib/variant';
import { AutoAdminOnly } from '@/components/auto-server';

// « Qui regarde ? » proposé une fois par ouverture de l'appli (si des profils existent)
let askedThisLaunch = false;

export default function TabsLayout() {
  const { settings, update } = useSettings();

  useEffect(() => {
    const h = settings.household;
    if (askedThisLaunch || IS_AUTO || Platform.isTV || !h || !h.askOnLaunch || !h.count || !settings.jellyfin) return;
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

  // Lumio Auto : appli de l'admin, quatre onglets
  if (IS_AUTO) {
    if (settings.jellyfin && settings.jellyfin.isAdmin === false) return <AutoAdminOnly />;
    return (
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        initialRouteName="index"
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
        {/* Gestion du serveur seulement : Tableau, Torrents, Demandes, Réglages */}
        <Tabs.Screen name="index" options={{ title: 'Tableau' }} />
        <Tabs.Screen name="auto" options={{ title: 'Torrents' }} />
        <Tabs.Screen name="activity" options={{ title: 'Demandes' }} />
        <Tabs.Screen name="settings" options={{ title: 'Réglages' }} />
        <Tabs.Screen name="library" options={{ href: null }} />
        <Tabs.Screen name="search" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="watchlist" options={{ href: null }} />
      </Tabs>
    );
  }

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
      {/* Lumio Auto : admin seulement, jamais sur la TV */}
      {/* Lumio Auto est une appli à part (outils d'admin) */}
      <Tabs.Screen name="auto" options={{ title: 'Auto', href: null }} />
      <Tabs.Screen name="watchlist" options={{ title: 'À voir', href: Platform.isTV ? null : undefined }} />
      <Tabs.Screen name="settings" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
