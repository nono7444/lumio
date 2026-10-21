// Admin : corriger un film / une série mal reconnu par Jellyfin.
// « Identifier » cherche la bonne fiche (TMDB, IMDb…) et l'applique ; « Modifier » change titre / année / résumé à la main.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { jf, type JfItem, type JfRemoteResult } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

type Tab = 'identify' | 'edit';

export function MetadataEditor({ item, visible, onClose, onDone }: { item: JfItem; visible: boolean; onClose: () => void; onDone: () => void }) {
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>('identify');
  // Identifier
  const [name, setName] = useState(item.Name);
  const [year, setYear] = useState(item.ProductionYear ? String(item.ProductionYear) : '');
  const [tmdb, setTmdb] = useState('');
  const [results, setResults] = useState<JfRemoteResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  // Modifier
  const [title, setTitle] = useState(item.Name);
  const [eyear, setEyear] = useState(item.ProductionYear ? String(item.ProductionYear) : '');
  const [overview, setOverview] = useState(item.Overview ?? '');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTab('identify');
    setName(item.Name);
    setYear(item.ProductionYear ? String(item.ProductionYear) : '');
    setTmdb('');
    setResults(null);
    setTitle(item.Name);
    setEyear(item.ProductionYear ? String(item.ProductionYear) : '');
    setOverview(item.Overview ?? '');
  }, [visible, item]);

  const search = async () => {
    setSearching(true);
    setResults(null);
    try {
      // Lien ou numéro TMDB / IMDb collé directement : recherche exacte
      const t = tmdb.trim();
      const imdb = t.match(/tt\d{5,}/)?.[0];
      const tmdbId = imdb ? undefined : t.match(/(\d+)/)?.[1];
      const r = await jf.remoteSearch(settings, item, {
        name: name.trim(),
        year: Number(year) || undefined,
        tmdb: tmdbId,
        imdb,
      });
      setResults(r);
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setSearching(false);
    }
  };

  const apply = async (r: JfRemoteResult, i: number) => {
    setApplying(i);
    try {
      await jf.applyMatch(settings, item.Id, r);
      toast(`Corrigé : ${r.Name}${r.ProductionYear ? ` (${r.ProductionYear})` : ''}`);
      onClose();
      onDone();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setApplying(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await jf.editMetadata(settings, item.Id, {
        Name: title.trim() || item.Name,
        ProductionYear: Number(eyear) || null,
        Overview: overview.trim(),
      });
      toast('Infos enregistrées');
      onClose();
      onDone();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const [fetchingImg, setFetchingImg] = useState(false);
  const fetchImages = async () => {
    setFetchingImg(true);
    try {
      await jf.ensureImages(settings, item.Id, undefined, true);
      toast('Affiche et fond récupérés');
      onClose();
      onDone();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setFetchingImg(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await jf.refreshMetadata(settings, item.Id);
      toast('Actualisation lancée');
      onClose();
      setTimeout(onDone, 4000);
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Corriger les infos</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={C.textDim} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SegChip label="Identifier" on={tab === 'identify'} onPress={() => setTab('identify')} />
            <SegChip label="Modifier" on={tab === 'edit'} onPress={() => setTab('edit')} />
          </View>

          {tab === 'identify' ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
              <Text style={styles.dim}>
                Le film ou la série ne correspond pas ? Cherche le bon titre, puis touche le bon résultat : titre, résumé et affiche seront remplacés.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={name} onChangeText={setName} placeholder="Titre" placeholderTextColor={C.textFaint} style={[styles.input, { flex: 1 }]} returnKeyType="search" onSubmitEditing={search} />
                <TextInput value={year} onChangeText={setYear} placeholder="Année" keyboardType="number-pad" maxLength={4} placeholderTextColor={C.textFaint} style={[styles.input, { width: 80 }]} />
              </View>
              <TextInput
                value={tmdb}
                onChangeText={setTmdb}
                placeholder="Optionnel : lien ou n° TMDB / IMDb (tt…)"
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={C.textFaint}
                style={styles.input}
                returnKeyType="search"
                onSubmitEditing={search}
              />
              <Button title="Chercher" icon="search" loading={searching} onPress={search} />

              {results && results.length === 0 ? <Text style={styles.dim}>Aucun résultat. Essaie sans l'année, ou colle le lien TMDB.</Text> : null}
              {results?.map((r, i) => (
                <Pressable key={`${r.SearchProviderName}-${i}`} onPress={() => apply(r, i)} disabled={applying !== null} style={({ pressed }) => [styles.result, { opacity: pressed ? 0.7 : 1 }]}>
                  <View style={styles.thumb}>
                    {r.ImageUrl ? <Image source={{ uri: r.ImageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="image-outline" size={20} color={C.textFaint} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rTitle} numberOfLines={2}>
                      {r.Name}
                      {r.ProductionYear ? <Text style={styles.dim}> ({r.ProductionYear})</Text> : null}
                    </Text>
                    {r.Overview ? (
                      <Text style={styles.dim} numberOfLines={2}>
                        {r.Overview}
                      </Text>
                    ) : null}
                    <Text style={styles.faint}>{r.SearchProviderName}</Text>
                  </View>
                  {applying === i ? <ActivityIndicator color={C.text} /> : <Ionicons name="checkmark-circle-outline" size={22} color={C.textDim} />}
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
              <Text style={styles.label}>Titre</Text>
              <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholderTextColor={C.textFaint} />
              <Text style={styles.label}>Année</Text>
              <TextInput value={eyear} onChangeText={setEyear} keyboardType="number-pad" maxLength={4} style={styles.input} placeholderTextColor={C.textFaint} />
              <Text style={styles.label}>Résumé</Text>
              <TextInput value={overview} onChangeText={setOverview} multiline style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} placeholderTextColor={C.textFaint} />
              <Text style={styles.faint}>Ces champs sont verrouillés : une actualisation ne les écrasera pas.</Text>
              <Button title="Enregistrer" icon="save-outline" loading={saving} onPress={save} />
              <Button title="Récupérer l'affiche et le fond" icon="image-outline" variant="secondary" loading={fetchingImg} onPress={fetchImages} />
              <Button title="Tout actualiser depuis Internet" icon="refresh" variant="secondary" loading={refreshing} onPress={refresh} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: 18, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.text, fontSize: 18, fontWeight: '800' },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 4 },
  dim: { color: C.textDim, fontSize: 13 },
  faint: { color: C.textFaint, fontSize: 11 },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 8 },
  thumb: { width: 46, height: 69, borderRadius: 6, overflow: 'hidden', backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  rTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
});
