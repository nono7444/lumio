// En tout premier : fetch plus robuste (requêtes coupées par iOS relancées)
import '@/lib/net';
// TV : taille de l'interface (doit passer avant les écrans)
import { TvScaleRoot } from '@/lib/tv-ui';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import '@/lib/web-dialogs';
import { AnimatedSplash } from '@/components/animated-splash';
import { FolderPickerHost } from '@/components/folder-picker';
import { Toasts } from '@/components/toast';
import { UpdateBanner } from '@/components/update-banner';
import { C } from '@/constants/theme';
import { SettingsProvider, useSettings } from '@/lib/settings';
import { useSharedTmdbKey } from '@/lib/shared-config';
import { useAppBadge } from '@/lib/badge';
import { useWidgetSync } from '@/lib/widget';

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, primary: C.accent, text: C.text, border: C.border },
};

function Root() {
  const { ready, settings } = useSettings();
  useWidgetSync();
  useAppBadge();
  useSharedTmdbKey();
  useEffect(() => {
    // L'écran de démarrage natif laisse la place au logo animé, qui reste affiché jusqu'à ce que l'appli soit prête
    SplashScreen.hideAsync().catch(() => {});
    // Portrait partout, sauf le lecteur qui déverrouille la rotation
    if (!Platform.isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <TvScaleRoot value={settings.tvScale}>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
      }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
      <Stack.Screen name="media/[type]/[id]" options={{ animation: 'fade_from_bottom' }} />
      <Stack.Screen name="jellyfin/[id]" options={{ animation: 'fade_from_bottom' }} />
      <Stack.Screen name="customize" options={{ presentation: 'modal' }} />
      <Stack.Screen name="customize-tabs" options={{ presentation: 'modal' }} />
      <Stack.Screen name="rewards" options={{ presentation: 'modal' }} />
      <Stack.Screen name="users" options={{ presentation: 'modal' }} />
      <Stack.Screen name="ideas" options={{ presentation: 'modal' }} />
      <Stack.Screen name="sessions" options={{ presentation: 'modal' }} />
      <Stack.Screen name="downloads" options={{ presentation: 'modal' }} />
      <Stack.Screen name="secour" options={{ presentation: 'modal' }} />
      <Stack.Screen name="files" options={{ presentation: 'modal' }} />
      <Stack.Screen name="live-sources" options={{ presentation: 'modal' }} />
      <Stack.Screen name="invite" options={{ animation: 'fade' }} />
      <Stack.Screen name="connect-tv" options={{ presentation: 'modal' }} />
      <Stack.Screen name="watch" options={{ animation: 'fade', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="player" options={{ animation: 'fade', presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
    </TvScaleRoot>
  );
}

/** Logo animé au lancement. */
function LaunchOverlays() {
  const { ready } = useSettings();
  return <AnimatedSplash ready={ready} />;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <SettingsProvider>
        <StatusBar style="light" />
        <Root />
        <FolderPickerHost />
        <UpdateBanner />
        <Toasts />
        <LaunchOverlays />
      </SettingsProvider>
    </ThemeProvider>
  );
}
