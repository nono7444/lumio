import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { FolderPickerHost } from '@/components/folder-picker';
import { Toasts } from '@/components/toast';
import { C } from '@/constants/theme';
import { SettingsProvider, useSettings } from '@/lib/settings';

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, primary: C.accent, text: C.text, border: C.border },
};

function Root() {
  const { ready } = useSettings();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
    // Portrait partout, sauf le lecteur qui déverrouille la rotation
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
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
      <Stack.Screen name="invite" options={{ animation: 'fade' }} />
      <Stack.Screen name="watch" options={{ animation: 'fade', presentation: 'fullScreenModal' }} />
      <Stack.Screen name="streams" options={{ presentation: 'modal' }} />
      <Stack.Screen name="player" options={{ animation: 'fade', presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <SettingsProvider>
        <StatusBar style="light" />
        <Root />
        <FolderPickerHost />
        <Toasts />
      </SettingsProvider>
    </ThemeProvider>
  );
}
