// Lumio Livres (admin) : changer la couverture d'un livre ou d'un tome. Propositions trouvées en ligne (Apple Books FR,
// Google Books en français, Open Library, recherche modifiable), lien d'une image collé, ou photo du téléphone.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, ebookById, loadEbooks } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

export default function EbookCoverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const { width } = useWindowDimensions();
  const book = ebookById(String(id));
  const [link, setLink] = useState('');
  const [q, setQ] = useState('');
  const [covers, setCovers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const size = Math.floor((Math.min(width, 700) - 32 - 2 * 12) / 3);

  const search = useCallback(
    async (query?: string) => {
      setBusy(true);
      try {
        if (!book) return;
        const r = await ebookApi.coverChoices(settings, book.token, query);
        setCovers(r.covers);
        if (!query) setQ(r.query);
      } catch (e) {
        Alert.alert('Recherche impossible', e instanceof Error ? e.message : String(e));
        setCovers([]);
      } finally {
        setBusy(false);
      }
    },
    [book?.token, settings]
  );
  useEffect(() => {
    search();
  }, [search]);

  const save = async (key: string, body: { url: string } | { data: string }) => {
    setSaving(key);
    try {
      if (!book) return;
      await ebookApi.setCover(settings, book.token, body);
      await loadEbooks(settings);
      router.back();
    } catch (e) {
      Alert.alert('Couverture non enregistrée', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [2, 3], quality: 0.85, base64: true });
    const a = r.canceled ? null : r.assets[0];
    if (a?.base64) save('photo', { data: a.base64 });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScreenTitle title="Couverture" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {book ? <Text style={styles.hint}>{book.title}</Text> : null}
        <View style={{ paddingHorizontal: 16, marginBottom: 14, gap: 10 }}>
          <Button title="Choisir une image du téléphone" icon="images-outline" variant="secondary" loading={saving === 'photo'} onPress={pick} />
          <View style={styles.searchBox}>
            <Ionicons name="link" size={17} color={C.textDim} />
            <TextInput
              value={link}
              onChangeText={setLink}
              onSubmitEditing={() => /^https?:\/\//i.test(link.trim()) && save('link', { url: link.trim() })}
              placeholder="Coller le lien d’une image (https://…)"
              placeholderTextColor={C.textFaint}
              style={styles.search}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
            />
          </View>
          {link.trim() ? (
            <Button title="Utiliser ce lien" icon="checkmark" loading={saving === 'link'} disabled={!/^https?:\/\//i.test(link.trim())} onPress={() => save('link', { url: link.trim() })} />
          ) : null}
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={C.textDim} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => search(q.trim())}
            placeholder="Titre, auteur…"
            placeholderTextColor={C.textFaint}
            style={styles.search}
            returnKeyType="search"
            autoCorrect={false}
          />
          {busy ? <ActivityIndicator color={C.text} /> : null}
        </View>
        <Text style={styles.hint}>Touche une image pour la garder. Elle est gardée sur le serveur (« Recharger les infos » la remplace).</Text>
        <View style={styles.grid}>
          {covers?.map((u) => (
            <Pressable key={u} onPress={() => (tap(), save(u, { url: u }))} disabled={!!saving} style={{ width: size, height: Math.round(size * 1.5), borderRadius: 10, overflow: 'hidden', backgroundColor: C.surfaceHigh }}>
              <Image source={{ uri: u }} style={{ width: size, height: Math.round(size * 1.5) }} contentFit="cover" transition={150} />
              {saving === u ? (
                <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
        {covers && !covers.length && !busy ? <Text style={styles.hint}>Aucune image trouvée. Essaie avec juste le titre.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.textDim, fontSize: 13, paddingHorizontal: 16, marginVertical: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: C.surfaceHigh },
  search: { flex: 1, color: C.text, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginTop: 6 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
