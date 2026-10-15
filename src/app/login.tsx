import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { login, serverInfo } from '@/lib/jellyfin';
import { seerr } from '@/lib/seerr';
import { useSettings } from '@/lib/settings';

export default function Login() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(params.url ?? settings.jellyfin?.url ?? '');
  const [server, setServer] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  async function checkServer() {
    if (!url.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const info = await serverInfo(url, settings.deviceId);
      setServer(`${info.ServerName} · Jellyfin ${info.Version}`);
    } catch (e: any) {
      setServer(null);
      setError(e?.message ?? String(e));
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (!url.trim() || !user.trim()) {
      setError('Renseigne l’adresse du serveur et ton nom d’utilisateur.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await login(url, user.trim(), pass, settings.deviceId);
      // Serveur de demandes (Seerr) : même identifiants Jellyfin
      let seerrCfg = settings.seerr;
      if (seerrCfg?.url) {
        try {
          const me = await seerr.login(seerrCfg.url, user.trim(), pass);
          seerrCfg = { ...seerrCfg, userName: me.displayName ?? me.jellyfinUsername ?? user.trim() };
        } catch {
          // Non bloquant : l'utilisateur pourra se reconnecter depuis Profil
        }
      }
      await update({ jellyfin: session, skipJellyfin: false, seerr: seerrCfg });
      router.replace('/');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    tap();
    await update({ skipJellyfin: true });
    router.replace('/');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled">
        <View style={styles.brandWrap}>
          <View style={styles.mark}>
            <Ionicons name="play" size={30} color="#000" />
          </View>
          <Text style={styles.brand}>Lumio</Text>
          <Text style={styles.tagline}>Connecte-toi à ton serveur Jellyfin</Text>
        </View>

        <Text style={styles.label}>Serveur</Text>
        <View style={styles.inputRow}>
          <Ionicons name="server-outline" size={18} color={C.textDim} />
          <TextInput
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setServer(null);
            }}
            onBlur={checkServer}
            placeholder="https://jellyfin.mondomaine.fr"
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          {checking ? (
            <ActivityIndicator color={C.textDim} />
          ) : server ? (
            <Ionicons name="checkmark-circle" size={20} color={C.success} />
          ) : null}
        </View>
        {server ? <Text style={styles.server}>{server}</Text> : null}

        <Text style={styles.label}>Utilisateur</Text>
        <View style={styles.inputRow}>
          <Ionicons name="person-outline" size={18} color={C.textDim} />
          <TextInput
            value={user}
            onChangeText={setUser}
            placeholder="Nom d'utilisateur"
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            style={styles.input}
          />
        </View>

        <Text style={styles.label}>Mot de passe</Text>
        <View style={styles.inputRow}>
          <Ionicons name="lock-closed-outline" size={18} color={C.textDim} />
          <TextInput
            value={pass}
            onChangeText={setPass}
            placeholder="Mot de passe"
            placeholderTextColor={C.textFaint}
            secureTextEntry={!showPass}
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            style={styles.input}
          />
          <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10}>
            <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textDim} />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.error}>
            <Ionicons name="alert-circle" size={18} color={C.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button title="Se connecter" icon="log-in-outline" onPress={submit} loading={busy} style={{ marginTop: 22 }} />

        <Pressable onPress={skip} style={styles.skip} hitSlop={8}>
          <Text style={styles.skipText}>Continuer sans Jellyfin</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brandWrap: { alignItems: 'center', marginBottom: 36 },
  mark: { width: 64, height: 64, borderRadius: 18, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  brand: { color: C.text, fontSize: 36, fontWeight: '900', letterSpacing: -1, marginTop: 14 },
  tagline: { color: C.textDim, fontSize: 15, marginTop: 6 },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 7, marginTop: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
    paddingHorizontal: 14,
  },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 14 },
  server: { color: C.success, fontSize: 12, marginTop: 6, marginLeft: 4 },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,69,58,0.12)',
    borderRadius: R.md,
    padding: 12,
    marginTop: 16,
  },
  errorText: { color: C.text, fontSize: 13, flex: 1, lineHeight: 18 },
  skip: { alignSelf: 'center', marginTop: 18, padding: 6 },
  skipText: { color: C.textDim, fontSize: 14, fontWeight: '600' },
});
