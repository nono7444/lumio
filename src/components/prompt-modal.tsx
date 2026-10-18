// Petite fenêtre de saisie qui marche sur iPhone et Android (Alert.prompt n'existe que sur iOS).
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button } from '@/components/ui';
import { C, R } from '@/constants/theme';

type Ask = { title: string; message?: string; value?: string; ok?: string };

export function usePrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [text, setText] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const prompt = (a: Ask) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setText(a.value ?? '');
      setAsk(a);
    });

  const close = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setAsk(null);
  };

  const element = (
    <Modal visible={Boolean(ask)} transparent animationType="fade" onRequestClose={() => close(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close(null)} />
        <View style={styles.box}>
          <Text style={styles.title}>{ask?.title}</Text>
          {ask?.message ? <Text style={styles.dim}>{ask.message}</Text> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            autoCorrect={false}
            style={styles.input}
            placeholderTextColor={C.textFaint}
            onSubmitEditing={() => close(text.trim() || null)}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Annuler" variant="secondary" onPress={() => close(null)} style={{ flex: 1 }} />
            <Button title={ask?.ok ?? 'OK'} onPress={() => close(text.trim() || null)} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
  return { prompt, element };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 420, backgroundColor: C.surface, borderRadius: R.lg, padding: 18, gap: 12 },
  title: { color: C.text, fontSize: 18, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13 },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
});
