// Profil → « Connecter une TV » : valide le code affiché par Lumio TV (Jellyfin Quick Connect).
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { jf } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export function ConnectTvButton() {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!settings.jellyfin || Platform.isTV) return null;

  const send = async () => {
    setBusy(true);
    try {
      await jf.authorizeTv(settings, code);
      toast('TV connectée ! Elle s’ouvre toute seule.');
      setOpen(false);
      setCode('');
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      toast(/404|400|401|403/.test(msg) ? 'Code invalide ou expiré : demande un nouveau code sur la TV.' : msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button title="Connecter une TV" icon="tv-outline" variant="secondary" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.title}>Connecter une TV</Text>
            <Text style={styles.dim}>Tape le code affiché sur Lumio TV. La TV utilisera ton compte Jellyfin.</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="123 456"
              placeholderTextColor={C.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              keyboardType={Platform.OS === 'ios' ? 'default' : 'visible-password'}
              style={styles.input}
              onSubmitEditing={send}
            />
            <Button title="Valider" icon="checkmark" onPress={send} loading={busy} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, gap: 14 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 14, lineHeight: 20 },
  input: {
    color: C.text,
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
  },
});
