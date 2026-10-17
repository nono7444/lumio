// Verrouillage de l'appli : Face ID / Touch ID (ou le code du téléphone) à l'ouverture,
// et au retour après plus d'une minute en arrière-plan.
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';

const RELOCK_AFTER_MS = 60_000;

export async function canUseAppLock() {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export function AppLock() {
  const { settings } = useSettings();
  const enabled = settings.appLock && !Platform.isTV;
  const [locked, setLocked] = useState(enabled);
  const busy = useRef(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Déverrouiller Lumio', cancelLabel: 'Annuler' });
      if (r.success) setLocked(false);
    } catch {
    } finally {
      busy.current = false;
    }
  }, []);

  // Verrou à l'ouverture
  useEffect(() => {
    if (enabled) {
      setLocked(true);
      unlock();
    } else setLocked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Re-verrouille après une minute en arrière-plan
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') leftAt.current = Date.now();
      if (st === 'active' && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
        leftAt.current = null;
        setLocked(true);
        unlock();
      }
    });
    return () => sub.remove();
  }, [enabled, unlock]);

  if (!enabled || !locked) return null;
  return (
    <View style={styles.wrap}>
      <Ionicons name="lock-closed" size={44} color={C.text} />
      <Text style={styles.title}>Lumio est verrouillé</Text>
      <Button title="Déverrouiller" icon="scan-outline" onPress={unlock} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
});
