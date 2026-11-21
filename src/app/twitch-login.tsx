// Lumio → Twitch : connexion du compte Twitch de l'admin. La page de connexion officielle de twitch.tv s'ouvre ici ;
// une fois connecté, le jeton de session du site est envoyé au serveur Lumio (gardé seulement là-bas) pour lire
// les rediffusions réservées aux abonnés des chaînes auxquelles ce compte est abonné.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { loadTwitch, twitchApi } from '@/lib/twitch';

// Lit le cookie « auth-token » de twitch.tv toutes les secondes, une fois la connexion faite
const WATCH = `
(function(){
  function look(){
    var m = document.cookie.match(/(?:^|; )auth-token=([^;]+)/);
    if (m) window.ReactNativeWebView.postMessage(JSON.stringify({ token: decodeURIComponent(m[1]) }));
  }
  look(); setInterval(look, 1000);
})(); true;`;

export default function TwitchLogin() {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [token, setToken] = useState('');
  const sent = useRef(false);

  const connect = async (t: string) => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    try {
      const r = await twitchApi.connect(settings, t);
      await loadTwitch(settings, true);
      Alert.alert('Compte Twitch connecté', `Connecté en tant que ${r.account.name}.`);
      router.back();
    } catch (e) {
      sent.current = false;
      Alert.alert('Connexion refusée', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.token) connect(m.token);
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title="Compte Twitch" onBack={() => router.back()} />
      <Text style={styles.hint}>
        Connecte-toi avec le compte Twitch abonné à la chaîne. Le jeton de connexion part seulement sur ton serveur Lumio ; il donne accès aux rediffusions réservées aux abonnés.
      </Text>
      {manual ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={styles.hint}>
            Sur un ordinateur connecté à twitch.tv : outils de développement → Stockage → Cookies → twitch.tv → valeur de « auth-token ».
          </Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="auth-token"
            placeholderTextColor={C.textFaint}
            style={styles.input}
          />
          <Button title="Connecter" icon="log-in-outline" loading={busy} onPress={() => token.trim() && connect(token.trim())} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: 'https://www.twitch.tv/login' }}
            injectedJavaScript={WATCH}
            onMessage={onMessage}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            style={{ flex: 1, backgroundColor: '#0e0e10' }}
          />
          {busy ? (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              <ActivityIndicator color="#fff" />
              <Text style={[styles.hint, { color: '#fff' }]}>Vérification du compte…</Text>
            </View>
          ) : null}
        </View>
      )}
      <Pressable onPress={() => setManual((v) => !v)} style={styles.switch}>
        <Ionicons name={manual ? 'globe-outline' : 'key-outline'} size={16} color={C.textDim} />
        <Text style={styles.switchText}>{manual ? 'Revenir à la page de connexion Twitch' : 'Coller un jeton à la place'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.textDim, fontSize: 13, paddingHorizontal: 16, marginBottom: 10, lineHeight: 18 },
  input: { height: 46, borderRadius: 12, backgroundColor: C.surfaceHigh, color: C.text, paddingHorizontal: 12, fontSize: 15 },
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  switchText: { color: C.textDim, fontSize: 13, fontWeight: '600' },
});
