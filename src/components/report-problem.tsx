// Fiche : « Signaler un problème » (vidéo, son, sous-titres, mauvais titre…) → arrive chez l'admin.
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { ideasApi } from '@/lib/ideas';
import { useSettings } from '@/lib/settings';

const CATEGORIES = ['Vidéo', 'Son', 'Sous-titres', 'Mauvais film / épisode', 'Épisode manquant', 'Autre'];

export function ReportProblemButton({ type, tmdbId, title, poster }: { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await ideasApi.create(settings, {
        kind: 'bug',
        title: `${cat} · ${title}`,
        details: details.trim(),
        category: cat,
        media: { type, tmdbId, title, poster },
      });
      toast('Merci ! Le problème est signalé à l’admin.');
      setOpen(false);
      setDetails('');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.link} hitSlop={8}>
        <Ionicons name="flag-outline" size={15} color={C.textDim} />
        <Text style={styles.linkText}>Signaler un problème</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.title}>Signaler un problème</Text>
            <Text style={styles.dim} numberOfLines={1}>
              {title}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map((c) => (
                <SegChip key={c} label={c} on={c === cat} onPress={() => setCat(c)} />
              ))}
            </View>
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Ce qui ne va pas (épisode, minute, langue…)"
              placeholderTextColor={C.textFaint}
              style={styles.input}
              multiline
              maxLength={2000}
            />
            <Button title="Envoyer" icon="paper-plane" onPress={send} loading={busy} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 6 },
  linkText: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: 20, paddingBottom: 36, gap: 12 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13 },
  input: { backgroundColor: C.surfaceHigh, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
});
