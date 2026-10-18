// Android TV : connexion sans clavier. Le serveur Lumio donne l'adresse de Jellyfin, la TV affiche un code,
// on le valide sur le téléphone (Profil → Connecter une TV). Identifiant / mot de passe en secours.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { serverBase } from '@/lib/chat';
import { quickConnectLogin, quickConnectReady, quickConnectStart } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export function TvLogin({ onPassword }: { onPassword: (jellyfinUrl: string) => void }) {
  const { settings, update } = useSettings();
  const [lumio, setLumio] = useState(settings.chatUrl ? settings.chatUrl.replace(/^https?:\/\//, '') : 'lumio.wawanono.lol');
  const [jfUrl, setJfUrl] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  async function connectServer() {
    setBusy(true);
    setError(null);
    try {
      const base = serverBase(lumio);
      const r = await fetch(`${base}/tv/setup`).then((x) => x.json());
      if (!r?.jellyfinUrl) throw new Error("Le serveur Lumio ne connaît pas encore l'adresse de Jellyfin : ouvre une fois l'appli Lumio sur ton téléphone, puis réessaie.");
      await update({ chatUrl: base });
      setJfUrl(r.jellyfinUrl);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // Code Quick Connect, renouvelé si besoin, et attente de la validation sur le téléphone
  useEffect(() => {
    if (!jfUrl) return;
    const id = ++run.current;
    (async () => {
      try {
        setCode(null);
        const { code: c, secret } = await quickConnectStart(jfUrl, settings.deviceId);
        if (run.current !== id) return;
        setCode(c);
        for (let i = 0; i < 100 && run.current === id; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          if (await quickConnectReady(jfUrl, settings.deviceId, secret).catch(() => false)) {
            const session = await quickConnectLogin(jfUrl, settings.deviceId, secret);
            await update({ jellyfin: session, skipJellyfin: false });
            router.replace('/');
            return;
          }
        }
        if (run.current === id) setError('Le code a expiré.');
      } catch {
        if (run.current === id)
          setError('La connexion par code est désactivée sur Jellyfin (Tableau de bord → Général → Quick Connect). Utilise le mot de passe.');
      }
    })();
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jfUrl]);

  if (!jfUrl)
    return (
      <View style={styles.box}>
        <Text style={styles.title}>Bienvenue sur Lumio TV</Text>
        <Text style={styles.dim}>Adresse du serveur Lumio (la même que sur le téléphone)</Text>
        <TextInput value={lumio} onChangeText={setLumio} autoCapitalize="none" autoCorrect={false} style={styles.input} onSubmitEditing={connectServer} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Continuer" icon="arrow-forward" onPress={connectServer} loading={busy} />
        <Button title="Se connecter avec un mot de passe" variant="secondary" onPress={() => onPassword('')} />
      </View>
    );

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Connecte la TV avec ton téléphone</Text>
      <View style={styles.codeBox}>
        {code ? <Text style={styles.code}>{code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}</Text> : <ActivityIndicator color="#fff" size="large" />}
      </View>
      <Text style={styles.dim}>Sur ton téléphone : Lumio → Profil → « Connecter une TV », puis tape ce code.</Text>
      <Text style={[styles.dim, { color: C.accent }]}>La TV se connecte toute seule dès que le code est validé.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <Button title="Nouveau code" icon="refresh" variant="secondary" onPress={() => { setError(null); const u = jfUrl; setJfUrl(null); setTimeout(() => setJfUrl(u), 50); }} style={{ flex: 1 }} />
        <Button title="Mot de passe" icon="key-outline" variant="secondary" onPress={() => onPassword(jfUrl)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 16, alignItems: 'stretch' },
  title: { color: C.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  dim: { color: C.textDim, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  error: { color: C.danger, fontSize: 15, textAlign: 'center' },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18 },
  codeBox: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 22, paddingHorizontal: 44, paddingVertical: 18, minWidth: 320, alignItems: 'center' },
  code: { color: '#fff', fontSize: 64, fontWeight: '900', letterSpacing: 6 },
});
