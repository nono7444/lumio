// Live TV : ajouter / retirer des sources (liste M3U, compte Xtream Codes, addon Stremio de chaînes).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { forgetChannels, newSourceId, probeSource, xtreamM3u } from '@/lib/live';
import { useSettings, type LiveSource } from '@/lib/settings';

type Kind = 'm3u' | 'xtream' | 'stremio';

const KIND_LABEL: Record<LiveSource['kind'], string> = { m3u: 'Liste IPTV', stremio: 'Addon Stremio' };

export default function LiveSources() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>('m3u');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const finalUrl = kind === 'xtream' ? xtreamM3u(server, user, pass) : url.trim();
    if (!finalUrl || (kind === 'xtream' && (!server.trim() || !user.trim()))) return;
    const src: LiveSource = {
      id: newSourceId(),
      name: name.trim() || (kind === 'stremio' ? 'Addon Stremio' : kind === 'xtream' ? 'IPTV' : 'Liste IPTV'),
      kind: kind === 'stremio' ? 'stremio' : 'm3u',
      url: finalUrl,
    };
    setBusy(true);
    try {
      const r = await probeSource(src);
      if (!r.count) throw new Error('Aucune chaîne trouvée dans cette source');
      if (!name.trim() && r.name) src.name = r.name;
      await update({ liveSources: [...settings.liveSources, src] });
      toast(`${src.name} : ${r.count.toLocaleString('fr-FR')} chaînes`);
      setName('');
      setUrl('');
      setServer('');
      setUser('');
      setPass('');
    } catch (e: any) {
      Alert.alert('Source impossible à lire', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (s: LiveSource) =>
    Alert.alert('Retirer cette source ?', s.name, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Retirer',
        style: 'destructive',
        onPress: () => {
          forgetChannels(s);
          update({
            liveSources: settings.liveSources.filter((x) => x.id !== s.id),
            liveFavorites: settings.liveFavorites.filter((k) => !k.startsWith(`${s.id}:`)),
          });
        },
      },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.h1}>Sources Live TV</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
        {settings.liveSources.length ? (
          <View style={styles.card}>
            {settings.liveSources.map((s) => (
              <View key={s.id} style={styles.srcRow}>
                <Ionicons name={s.kind === 'stremio' ? 'extension-puzzle' : 'list'} size={18} color={C.textDim} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.srcName}>{s.name}</Text>
                  <Text style={styles.dim} numberOfLines={1}>
                    {KIND_LABEL[s.kind]} · {s.url.replace(/(password=)[^&]+/i, '$1•••')}
                  </Text>
                </View>
                <Pressable onPress={() => remove(s)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={C.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.section}>Ajouter une source</Text>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <SegChip label="Lien M3U" icon="list-outline" on={kind === 'm3u'} onPress={() => setKind('m3u')} />
            <SegChip label="Xtream Codes" icon="key-outline" on={kind === 'xtream'} onPress={() => setKind('xtream')} />
            <SegChip label="Addon Stremio" icon="extension-puzzle-outline" on={kind === 'stremio'} onPress={() => setKind('stremio')} />
          </View>
          <Text style={styles.dim}>
            {kind === 'm3u'
              ? 'Colle le lien de ta liste IPTV (.m3u / .m3u8) fourni par ton abonnement.'
              : kind === 'xtream'
                ? 'Adresse du serveur, identifiant et mot de passe de ton abonnement IPTV (format Xtream Codes).'
                : 'Lien d’un addon Stremio qui propose des chaînes en direct (catalogue « tv »).'}
          </Text>
          <TextInput value={name} onChangeText={setName} placeholder="Nom (facultatif)" placeholderTextColor={C.textFaint} style={styles.input} />
          {kind === 'xtream' ? (
            <>
              <TextInput
                value={server}
                onChangeText={setServer}
                placeholder="http://serveur:port"
                placeholderTextColor={C.textFaint}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TextInput value={user} onChangeText={setUser} placeholder="Identifiant" placeholderTextColor={C.textFaint} style={styles.input} autoCapitalize="none" autoCorrect={false} />
              <TextInput
                value={pass}
                onChangeText={setPass}
                placeholder="Mot de passe"
                placeholderTextColor={C.textFaint}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </>
          ) : (
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder={kind === 'stremio' ? 'https://…/manifest.json' : 'https://…/playlist.m3u'}
              placeholderTextColor={C.textFaint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          )}
          <Button title="Ajouter" icon="add" onPress={add} loading={busy} />
        </View>
        <Text style={styles.dim}>
          Les sources sont enregistrées avec tes réglages. Chaque membre de la famille ajoute les siennes dans son appli.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  h1: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  section: { color: C.text, fontSize: 17, fontWeight: '800' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  srcName: { color: C.text, fontSize: 15, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: C.surfaceHigh, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});
