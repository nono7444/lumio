// Ouvert par le QR code de Lumio TV (lumio://connect-tv?code=…) : valide la connexion de la TV en un appui.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { toast } from '@/components/toast';
import { Button } from '@/components/ui';
import { C } from '@/constants/theme';
import { jf } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export default function ConnectTvScreen() {
  const { code = '' } = useLocalSearchParams<{ code?: string }>();
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const clean = String(code).replace(/[^A-Za-z0-9]/g, '');

  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const send = async () => {
    setBusy(true);
    try {
      await jf.authorizeTv(settings, clean);
      toast('TV connectée ! Elle s’ouvre toute seule.');
      done();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      toast(/404|400|401|403/.test(msg) ? 'Code invalide ou expiré : demande un nouveau code sur la TV.' : msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Ionicons name="tv-outline" size={56} color={C.text} />
      <Text style={styles.title}>Connecter la TV</Text>
      {settings.jellyfin ? (
        <>
          <Text style={styles.dim}>La TV utilisera ton compte Jellyfin ({settings.jellyfin.userName}).</Text>
          <Text style={styles.code}>{clean.replace(/(.{3})/g, '$1 ').trim()}</Text>
          <Button title="Connecter la TV" icon="checkmark" onPress={send} loading={busy} disabled={!clean} />
          <Button title="Annuler" variant="secondary" onPress={done} />
        </>
      ) : (
        <>
          <Text style={styles.dim}>Connecte-toi d’abord à Jellyfin dans Lumio, puis scanne à nouveau le QR code.</Text>
          <Button title="Se connecter" icon="log-in-outline" onPress={() => router.replace('/login')} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'stretch', justifyContent: 'center', padding: 28, gap: 14 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  dim: { color: C.textDim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  code: { color: C.text, fontSize: 40, fontWeight: '900', letterSpacing: 6, textAlign: 'center', marginVertical: 10 },
});
