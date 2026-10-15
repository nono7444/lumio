import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ScreenTitle, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { chat, markChatRead, type ChatMe, type ChatMessage } from '@/lib/chat';
import { openMedia } from '@/lib/navigation';
import { useSeason } from '@/lib/seasons';
import { useSettings } from '@/lib/settings';

const POLL_MS = 4000;

function time(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function Bubble({ m, mine, me, accent, onDelete }: { m: ChatMessage; mine: boolean; me: ChatMe | null; accent: string; onDelete: () => void }) {
  return (
    <Pressable
      onLongPress={() => {
        if (!(mine || me?.admin)) return;
        Alert.alert('Supprimer ce message ?', undefined, [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Supprimer', style: 'destructive', onPress: onDelete },
        ]);
      }}
      style={[styles.bubbleWrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
      {!mine && (
        <Text style={styles.author}>
          {m.userName}
          {m.admin ? ' · admin' : ''}
        </Text>
      )}
      <View style={[styles.bubble, mine ? { backgroundColor: accent } : { backgroundColor: C.surfaceHigh }]}>
        {m.media && (
          <Pressable
            onPress={() => {
              tap();
              openMedia(m.media!.type, m.media!.tmdbId);
            }}
            style={styles.media}>
            <View style={styles.mediaPoster}>
              {m.media.poster ? <Image source={m.media.poster} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mediaTitle, mine && { color: '#000' }]} numberOfLines={2}>
                {m.media.title}
              </Text>
              <Text style={[styles.mediaMeta, mine && { color: 'rgba(0,0,0,0.6)' }]}>
                {m.media.type === 'movie' ? 'Film' : 'Série'}
                {m.media.year ? ` · ${m.media.year}` : ''} · Voir la fiche
              </Text>
            </View>
          </Pressable>
        )}
        {m.text ? <Text style={[styles.text, mine && { color: '#000' }]}>{m.text}</Text> : null}
      </View>
      <Text style={styles.time}>{time(m.createdAt)}</Text>
    </Pressable>
  );
}

/** Discussion familiale : remarques, propositions de films et séries. */
export default function Chat() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const season = useSeason();
  const accent = season?.accent ?? '#FFFFFF';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<ChatMe | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastId = useRef<string | undefined>(undefined);

  const poll = useCallback(async () => {
    try {
      const r = await chat.list(settings, lastId.current);
      setMe(r.me);
      if (r.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...r.messages.filter((m) => !seen.has(m.id))];
        });
        lastId.current = r.messages[r.messages.length - 1].id;
        markChatRead(lastId.current);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      if (!settings.chatUrl || !settings.jellyfin) return;
      poll();
      const t = setInterval(poll, POLL_MS);
      return () => clearInterval(t);
    }, [poll, settings.chatUrl, settings.jellyfin])
  );

  async function submit() {
    const t = text.trim();
    if (!t || sending) return;
    tap();
    setSending(true);
    try {
      const m = await chat.send(settings, t);
      setText('');
      setMessages((prev) => [...prev, m]);
      lastId.current = m.id;
      markChatRead(m.id);
    } catch (e: any) {
      Alert.alert('Message non envoyé', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  if (!settings.chatUrl || !settings.jellyfin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <ScreenTitle title="Chat" />
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={42} color={C.textFaint} />
          <Text style={styles.emptyTitle}>Discussion de la famille</Text>
          <Text style={styles.emptyText}>
            {!settings.jellyfin
              ? 'Connecte-toi à Jellyfin pour rejoindre la discussion.'
              : 'Renseigne l’adresse du serveur de chat dans Profil (ou ouvre le lien d’invitation de l’admin).'}
          </Text>
          <Button title="Ouvrir Profil" variant="secondary" onPress={() => router.push('/settings')} />
        </View>
      </View>
    );
  }

  const data = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenTitle title="Chat" />
        <Text style={styles.subtitle}>Remarques et propositions pour la vidéothèque</Text>
      </View>

      {loading && !messages.length ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
          renderItem={({ item }) => (
            <Bubble
              m={item}
              me={me}
              mine={item.userId === (me?.id ?? settings.jellyfin?.userId)}
              accent={accent}
              onDelete={async () => {
                await chat.remove(settings, item.id).catch(() => {});
                setMessages((prev) => prev.filter((x) => x.id !== item.id));
              }}
            />
          )}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { transform: [{ scaleY: -1 }], marginTop: 40 }]}>
              Pas encore de message. Lance la discussion !
            </Text>
          }
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 92 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Écris un message…"
          placeholderTextColor={C.textFaint}
          style={styles.input}
          multiline
          maxLength={2000}
        />
        <Pressable
          onPress={submit}
          disabled={!text.trim() || sending}
          style={[styles.send, { backgroundColor: text.trim() ? accent : C.surfaceHigh }]}>
          {sending ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Ionicons name="arrow-up" size={20} color={text.trim() ? '#000' : C.textFaint} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: C.textDim, fontSize: 13, marginTop: -8, marginBottom: 6, paddingHorizontal: 16 },
  bubbleWrap: { gap: 3 },
  author: { color: C.textDim, fontSize: 12, fontWeight: '600', marginLeft: 6 },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  text: { color: C.text, fontSize: 15, lineHeight: 21 },
  time: { color: C.textFaint, fontSize: 11, marginHorizontal: 6 },
  media: { flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 200 },
  mediaPoster: { width: 46, height: 69, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' },
  mediaTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  mediaMeta: { color: C.textDim, fontSize: 12, marginTop: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  input: { flex: 1, color: C.text, fontSize: 15, backgroundColor: C.surfaceHigh, borderRadius: R.lg, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, maxHeight: 120 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  error: { color: C.danger, fontSize: 12, textAlign: 'center', paddingHorizontal: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  emptyTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  emptyText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
