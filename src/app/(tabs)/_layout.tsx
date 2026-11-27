import { Redirect, router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { FloatingTabBar } from '@/components/tab-bar';
import { C } from '@/constants/theme';
import { fetchIsAdmin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { IS_AUDIO, IS_AUTO, IS_BOOKS } from '@/lib/variant';
import { AutoAdminOnly } from '@/components/auto-server';
import { MiniPlayer } from '@/components/audio-ui';
import { UNIVERSE_TABS, useUniverse } from '@/lib/universe';

// « Qui regarde ? » proposé une fois par ouverture de l'appli (si des profils existent)
let askedThisLaunch = false;

export default function TabsLayout() {
  const { settings, update } = useSettings();
  const rawUniverse = useUniverse();
  // Lumio Auto (avec Twitch) est réservé à l'admin : un membre retombe sur Films & séries
  const universe = rawUniverse === 'auto' && !settings.jellyfin?.isAdmin ? 'media' : rawUniverse;

  useEffect(() => {
    const h = settings.household;
    if (askedThisLaunch || IS_AUTO || IS_AUDIO || IS_BOOKS || Platform.isTV || !h || !h.askOnLaunch || !h.count || !settings.jellyfin) return;
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

  // Lumio Livres : la bibliothèque de livres, BD et mangas (Bibliothèque, Trouver pour l'admin, Profil)
  if (IS_BOOKS) {
    return (
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        initialRouteName="shelf"
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
        <Tabs.Screen name="shelf" options={{ title: 'Bibliothèque' }} />
        <Tabs.Screen name="findbook" options={{ title: 'Trouver', href: settings.jellyfin?.isAdmin ? undefined : null }} />
        <Tabs.Screen name="booktop" options={{ href: null }} />
        <Tabs.Screen name="me" options={{ title: 'Profil' }} />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="search" options={{ href: null }} />
        <Tabs.Screen name="library" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="activity" options={{ href: null }} />
        <Tabs.Screen name="auto" options={{ href: null }} />
        <Tabs.Screen name="qbit" options={{ href: null }} />
        <Tabs.Screen name="disks" options={{ href: null }} />
        <Tabs.Screen name="server" options={{ href: null }} />
        <Tabs.Screen name="playing" options={{ href: null }} />
        <Tabs.Screen name="watchlist" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="listen" options={{ href: null }} />
        <Tabs.Screen name="find" options={{ href: null }} />
        <Tabs.Screen name="twitch" options={{ href: null }} />
        <Tabs.Screen name="perf" options={{ href: null }} />
        <Tabs.Screen name="seed" options={{ href: null }} />
        <Tabs.Screen name="demandes" options={{ href: null }} />
      </Tabs>
    );
  }

  // Lumio Audio : les livres audio de la maison (Bibliothèque, Trouver pour l'admin, Profil) + mini-lecteur
  if (IS_AUDIO) {
    return (
      <Tabs
        tabBar={(props) => (
          <>
            <MiniPlayer />
            <FloatingTabBar {...props} />
          </>
        )}
        initialRouteName="listen"
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
        <Tabs.Screen name="listen" options={{ title: 'Bibliothèque' }} />
        <Tabs.Screen name="find" options={{ title: 'Trouver', href: settings.jellyfin?.isAdmin ? undefined : null }} />
        <Tabs.Screen name="me" options={{ title: 'Profil' }} />
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="search" options={{ href: null }} />
        <Tabs.Screen name="library" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="activity" options={{ href: null }} />
        <Tabs.Screen name="auto" options={{ href: null }} />
        <Tabs.Screen name="qbit" options={{ href: null }} />
        <Tabs.Screen name="disks" options={{ href: null }} />
        <Tabs.Screen name="server" options={{ href: null }} />
        <Tabs.Screen name="playing" options={{ href: null }} />
        <Tabs.Screen name="watchlist" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="shelf" options={{ href: null }} />
        <Tabs.Screen name="findbook" options={{ href: null }} />
        <Tabs.Screen name="booktop" options={{ href: null }} />
        <Tabs.Screen name="twitch" options={{ href: null }} />
        <Tabs.Screen name="perf" options={{ href: null }} />
        <Tabs.Screen name="seed" options={{ href: null }} />
        <Tabs.Screen name="demandes" options={{ href: null }} />
      </Tabs>
    );
  }

  // Lumio Auto : appli de l'admin, quatre onglets
  if (IS_AUTO) {
    if (settings.jellyfin && settings.jellyfin.isAdmin === false) return <AutoAdminOnly />;
    return (
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        initialRouteName="index"
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
        {/* Gestion du serveur seulement : Performance, Seed, Demandes, qBittorrent, Disques, Serveur, Lecture (réglages : roue en haut à droite) */}
        <Tabs.Screen name="index" options={{ title: 'Performance' }} />
        <Tabs.Screen name="auto" options={{ title: 'Seed' }} />
        <Tabs.Screen name="activity" options={{ title: 'Demandes' }} />
        <Tabs.Screen name="qbit" options={{ title: 'qBittorrent' }} />
        <Tabs.Screen name="disks" options={{ title: 'Disques' }} />
        <Tabs.Screen name="server" options={{ title: 'Serveur' }} />
        <Tabs.Screen name="playing" options={{ title: 'Lecture' }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="library" options={{ href: null }} />
        <Tabs.Screen name="search" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="watchlist" options={{ href: null }} />
        <Tabs.Screen name="listen" options={{ href: null }} />
        <Tabs.Screen name="shelf" options={{ href: null }} />
        <Tabs.Screen name="findbook" options={{ href: null }} />
        <Tabs.Screen name="booktop" options={{ href: null }} />
        <Tabs.Screen name="twitch" options={{ href: null }} />
        <Tabs.Screen name="perf" options={{ href: null }} />
        <Tabs.Screen name="seed" options={{ href: null }} />
        <Tabs.Screen name="demandes" options={{ href: null }} />
        <Tabs.Screen name="find" options={{ href: null }} />
        <Tabs.Screen name="me" options={{ href: null }} />
      </Tabs>
    );
  }

  // Univers choisi (Films & séries, Livres audio, Livres, Twitch, Lumio Auto) : seuls ses onglets sont affichés ; TV : Films & séries
  const shown = UNIVERSE_TABS[Platform.isTV ? 'media' : universe];
  const isAdmin = settings.jellyfin?.isAdmin === true;
  const tab = (name: string, href: null | undefined) => (shown.includes(name) ? href : null);
  return (
    <Tabs
      tabBar={(props) => (
        <>
          {Platform.isTV ? null : <MiniPlayer />}
          <FloatingTabBar {...props} />
        </>
      )}
      // TV : menu latéral à gauche (façon Nuvio)
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
        tabBarPosition: Platform.isTV ? 'left' : 'bottom',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil', href: tab('index', undefined) }} />
      <Tabs.Screen name="search" options={{ title: 'Recherche', href: tab('search', undefined) }} />
      <Tabs.Screen name="library" options={{ title: 'Bibliothèque', href: tab('library', settings.jellyfin ? undefined : null) }} />
      <Tabs.Screen name="live" options={{ title: 'Live TV', href: tab('live', undefined) }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendrier', href: tab('calendar', undefined) }} />
      {/* Plus de Chat ni de Demandes dans Lumio : les demandes se gèrent dans l'univers Lumio Auto */}
      <Tabs.Screen name="chat" options={{ title: 'Chat', href: null }} />
      <Tabs.Screen name="activity" options={{ title: 'Demandes', href: null }} />
      <Tabs.Screen name="auto" options={{ title: 'Auto', href: null }} />
      {/* Univers Lumio Auto (admin seulement, jamais sur la TV) */}
      <Tabs.Screen name="perf" options={{ title: 'Perf', href: tab('perf', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="seed" options={{ title: 'Seed', href: tab('seed', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="demandes" options={{ title: 'Demandes', href: tab('demandes', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="qbit" options={{ title: 'qBittorrent', href: tab('qbit', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="disks" options={{ title: 'Disques', href: tab('disks', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="server" options={{ title: 'Serveur', href: tab('server', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="playing" options={{ title: 'Lecture', href: tab('playing', isAdmin ? undefined : null) }} />
      <Tabs.Screen name="watchlist" options={{ title: 'À voir', href: tab('watchlist', Platform.isTV ? null : undefined) }} />
      <Tabs.Screen name="settings" options={{ title: 'Profil', href: tab('settings', undefined) }} />
      <Tabs.Screen name="listen" options={{ title: 'Livres audio', href: tab('listen', undefined) }} />
      <Tabs.Screen name="shelf" options={{ title: 'Livres', href: tab('shelf', undefined) }} />
      <Tabs.Screen name="findbook" options={{ title: 'Trouver', href: tab('findbook', settings.jellyfin?.isAdmin ? undefined : null) }} />
      <Tabs.Screen name="booktop" options={{ title: 'Top', href: tab('booktop', undefined) }} />
      <Tabs.Screen name="twitch" options={{ title: 'Twitch', href: tab('twitch', settings.jellyfin?.isAdmin ? undefined : null) }} />
      <Tabs.Screen name="find" options={{ title: 'Trouver', href: tab('find', settings.jellyfin?.isAdmin ? undefined : null) }} />
      <Tabs.Screen name="me" options={{ href: null }} />
    </Tabs>
  );
}
