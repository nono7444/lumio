// Message épinglé par l'admin (mise à jour, info…) : pop-up sur l'accueil, masquable une fois lu.
// L'admin l'écrit depuis le Profil (AnnouncementEditor).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, Field, Section, SegChip } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Kind = 'update' | 'info' | 'warning';
export type Announcement = { id: string; title: string; text: string; kind: Kind; by: string; at: string };

const READ_KEY = 'lumio-announcement:read';
const KIND: Record<Kind, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  update: { label: 'Mise à jour', icon: 'arrow-down-circle', color: '#3D8BFF' },
  info: { label: 'Info', icon: 'information-circle', color: '#30D158' },
  warning: { label: 'Important', icon: 'warning', color: '#FF9F0A' },
};

export const announcementApi = {
  get: (s: Parameters<typeof serverCall>[0]) => serverCall<{ announcement: Announcement | null }>(s, '/api/announcement'),
  put: (s: Parameters<typeof serverCall>[0], body: { title: string; text: string; kind: Kind; notify: boolean }) =>
    serverCall<{ announcement: Announcement }>(s, '/api/announcement', { method: 'PUT', body: JSON.stringify(body) }),
  remove: (s: Parameters<typeof serverCall>[0]) => serverCall(s, '/api/announcement', { method: 'DELETE' }),
};

/** Pop-up sur l'accueil tant que le message n'a pas été lu. */
export function AnnouncementPopup() {
  const { settings } = useSettings();
  const [a, setA] = useState<Announcement | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!settings.chatUrl || !settings.jellyfin) return;
      let alive = true;
      Promise.all([announcementApi.get(settings), AsyncStorage.getItem(READ_KEY).catch(() => null)])
        .then(([r, read]) => alive && setA(r.announcement && r.announcement.id !== read ? r.announcement : null))
        .catch(() => {});
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.chatUrl, settings.jellyfin?.token])
  );

  if (!a) return null;
  const k = KIND[a.kind] ?? KIND.info;
  const close = () => {
    AsyncStorage.setItem(READ_KEY, a.id).catch(() => {});
    setA(null);
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.badge, { backgroundColor: `${k.color}22` }]}>
            <Ionicons name={k.icon} size={15} color={k.color} />
            <Text style={[styles.badgeText, { color: k.color }]}>{k.label}</Text>
          </View>
          <Text style={styles.title}>{a.title}</Text>
          <Text style={styles.text}>{a.text}</Text>
          <Text style={styles.by}>
            {a.by} · {new Date(a.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </Text>
          <Button title="J'ai lu" icon="checkmark" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

/** Profil (admin) : écrire, publier ou retirer le message épinglé. */
export function AnnouncementEditor() {
  const { settings } = useSettings();
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('info');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    announcementApi
      .get(settings)
      .then((r) => setCurrent(r.announcement))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = async () => {
    setBusy(true);
    try {
      const r = await announcementApi.put(settings, { title, text, kind, notify: true });
      setCurrent(r.announcement);
      setTitle('');
      setText('');
      toast('Message épinglé sur l’accueil de toute la famille');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Message sur l’accueil">
      <View style={{ gap: 10 }}>
        {current ? (
          <View style={styles.current}>
            <View style={{ flex: 1 }}>
              <Text style={styles.currentTitle}>📌 {current.title}</Text>
              <Text style={styles.currentText} numberOfLines={2}>
                {current.text}
              </Text>
            </View>
            <Pressable
              onPress={() =>
                announcementApi
                  .remove(settings)
                  .then(() => (setCurrent(null), toast('Message retiré')))
                  .catch((e) => toast(e?.message ?? String(e), 'error'))
              }
              hitSlop={8}>
              <Ionicons name="trash-outline" size={19} color={C.danger} />
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <SegChip key={k} label={KIND[k].label} on={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <Field label="Titre" value={title} onChangeText={setTitle} placeholder="Ex. Nouvelle version de Lumio" />
        <Field label="Message" value={text} onChangeText={setText} placeholder="Ce que la famille doit savoir…" multiline style={{ minHeight: 80 }} />
        <Button title={current ? 'Remplacer le message' : 'Épingler sur l’accueil'} icon="pin-outline" onPress={publish} loading={busy} disabled={!text.trim()} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 440, backgroundColor: C.surface, borderRadius: R.lg, padding: 20, gap: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  text: { color: C.text, fontSize: 15, lineHeight: 21 },
  by: { color: C.textDim, fontSize: 12 },
  current: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 12 },
  currentTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  currentText: { color: C.textDim, fontSize: 13 },
});
