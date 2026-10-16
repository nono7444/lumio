// Bannière « Nouvelle version disponible », en haut de l'écran, une fois par version (jusqu'à ce qu'on la ferme).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { ANDROID_APK_URL, APP_VERSION, cleanNotes, dismissedVersion, dismissVersion, useAppUpdate } from '@/lib/app-update';

export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const update = useAppUpdate();
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    dismissedVersion().then(setDismissed);
  }, []);

  if (Platform.isTV || !update || dismissed === undefined || dismissed === update.version) return null;
  const notes = cleanNotes(update.notes);
  const close = () => {
    setDismissed(update.version);
    dismissVersion(update.version);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <Pressable
        onPress={() => {
          tap();
          close();
          if (Platform.OS === 'android') Linking.openURL(ANDROID_APK_URL).catch(() => {});
          else router.push('/settings');
        }}
        style={styles.banner}>
        <View style={styles.icon}>
          <Ionicons name="arrow-down-circle" size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Lumio {update.version} est disponible</Text>
          <Text style={styles.text} numberOfLines={2}>
            {notes ? `${notes} · ` : ''}Tu as la {APP_VERSION}. {Platform.OS === 'android' ? 'Touche pour la télécharger.' : 'Mets à jour depuis FlareStore.'}
          </Text>
        </View>
        <Pressable onPress={close} hitSlop={12} style={styles.close}>
          <Ionicons name="close" size={16} color={C.textDim} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 50 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 520,
    padding: 12,
    borderRadius: R.lg,
    backgroundColor: 'rgba(28,28,30,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(61,139,255,0.6)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 15, fontWeight: '800' },
  text: { color: C.textDim, fontSize: 12, lineHeight: 16, marginTop: 1 },
  close: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
});
