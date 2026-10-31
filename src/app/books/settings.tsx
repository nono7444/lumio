// Réglages de Book (admin) : clés C411 / Tr4ker (gardées sur le serveur), dossier des livres, adresse de Wawacity.
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Button, Field, ScreenTitle, Section, SegChip } from '@/components/ui';
import { C } from '@/constants/theme';
import { booksApi, type BookSettings } from '@/lib/books';
import { useSettings } from '@/lib/settings';

export default function BookSettingsScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<BookSettings | null>(null);
  const [c411, setC411] = useState('');
  const [tr4ker, setTr4ker] = useState('');
  const [wawa, setWawa] = useState('');
  const [root, setRoot] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    booksApi
      .settings(settings)
      .then((c) => {
        setCfg(c);
        setWawa(c.wawacity);
        setRoot(c.dir?.root ?? c.disks[0] ?? '');
        setFolder(c.dir?.folder ?? 'Livres');
      })
      .catch((e) => Alert.alert('Erreur', e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await booksApi.saveSettings(settings, {
        ...(c411.trim() ? { c411Key: c411.trim() } : {}),
        ...(tr4ker.trim() ? { tr4kerKey: tr4ker.trim() } : {}),
        wawacity: wawa.trim(),
        root,
        folder: folder.trim(),
      });
      setC411('');
      setTr4ker('');
      await load();
      Alert.alert('Book', 'Réglages enregistrés.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Réglages Book" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Section title="Sources">
          <Text style={st.help}>Les clés restent sur le serveur Lumio et ne s’affichent jamais. Ce sont les clés API de C411 et Tr4ker (les mêmes que dans Prowlarr).</Text>
          <Field label={`C411 ${cfg?.c411 ? '· enregistrée ✓' : '· absente'}`} value={c411} onChangeText={setC411} placeholder="Coller pour remplacer" secureTextEntry />
          <Field label={`Tr4ker ${cfg?.tr4ker ? '· enregistrée ✓' : '· absente'}`} value={tr4ker} onChangeText={setTr4ker} placeholder="Coller pour remplacer" secureTextEntry />
          <Field label="Adresse de Wawacity" value={wawa} onChangeText={setWawa} placeholder="https://www.wawacity…" autoCapitalize="none" />
          {!cfg?.alldebrid ? <Text style={[st.help, { color: C.warning }]}>La clé AllDebrid n’est pas réglée sur le serveur : les téléchargements ne marcheront pas.</Text> : null}
        </Section>
        <Section title="Dossier des livres">
          <Text style={st.help}>Les livres téléchargés sont rangés ici (un sous-dossier par collection).</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(cfg?.disks ?? []).map((d) => <SegChip key={d} label={d} on={root === d} onPress={() => setRoot(d)} />)}
          </View>
          <Field label="Dossier" value={folder} onChangeText={setFolder} placeholder="Livres" autoCapitalize="none" />
        </Section>
        <Button title="Enregistrer" icon="checkmark" onPress={save} loading={busy} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({ help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 } });
