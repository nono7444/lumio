// Mode développeur : la famille propose des idées ou signale des bugs, vote pour celles des autres ;
// l'admin les envoie à Claude avec un prompt prêt à l'emploi (contexte du projet compris).
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { claudePrompt, claudeUrl, IDEA_STATUS, ideasApi, type Idea, type IdeaStatus } from '@/lib/ideas';
import { requestsApi, timeAgo } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

type Filter = 'open' | 'done' | 'all';
const OPEN: IdeaStatus[] = ['new', 'planned', 'sent'];

async function sendToClaude(ideas: Idea[], s: ReturnType<typeof useSettings>['settings'], onDone: () => void) {
  const prompt = claudePrompt(ideas);
  await Clipboard.setStringAsync(prompt).catch(() => {});
  await Promise.all(ideas.filter((i) => i.status !== 'sent').map((i) => ideasApi.update(s, i.id, { status: 'sent' }).catch(() => null)));
  onDone();
  toast('Prompt copié · ouverture de Claude');
  Linking.openURL(claudeUrl(prompt)).catch(() => toast('Impossible d’ouvrir Claude : colle le prompt copié dans claude.ai', 'error'));
}

function IdeaCard({ idea, admin, onChange, onRemoved }: { idea: Idea; admin: boolean; onChange: (i: Idea) => void; onRemoved: () => void }) {
  const { settings } = useSettings();
  const st = IDEA_STATUS[idea.status];

  const setStatus = () => {
    const opts = (Object.keys(IDEA_STATUS) as IdeaStatus[]).filter((k) => k !== idea.status);
    Alert.alert('Changer le statut', idea.title, [
      ...opts.map((k) => ({
        text: IDEA_STATUS[k].label,
        onPress: () => ideasApi.update(settings, idea.id, { status: k }).then(onChange, (e) => toast(e.message, 'error')),
      })),
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  };

  const remove = () =>
    Alert.alert('Supprimer cette idée ?', idea.title, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => ideasApi.remove(settings, idea.id).then(onRemoved, (e) => toast(e.message, 'error')) },
    ]);

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          onPress={() => {
            tap();
            ideasApi.vote(settings, idea.id).then(onChange, (e) => toast(e.message, 'error'));
          }}
          style={[styles.vote, idea.voted && { backgroundColor: C.accentSoft, borderColor: C.accent }]}>
          <Ionicons name={idea.voted ? 'arrow-up-circle' : 'arrow-up-circle-outline'} size={20} color={idea.voted ? C.accent : C.textDim} />
          <Text style={[styles.voteText, idea.voted && { color: C.accent }]}>{idea.votes}</Text>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <View style={[styles.badge, { backgroundColor: st.color + '26' }]}>
              <Ionicons name={st.icon as any} size={11} color={st.color} />
              <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
            </View>
            {idea.kind === 'bug' ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(255,69,58,0.15)' }]}>
                <Ionicons name="bug" size={11} color={C.danger} />
                <Text style={[styles.badgeText, { color: C.danger }]}>Bug</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.ideaTitle}>{idea.title}</Text>
          {idea.details ? <Text style={styles.details}>{idea.details}</Text> : null}
          {idea.note ? (
            <Text style={[styles.details, { color: C.text }]}>
              <Text style={{ fontWeight: '700' }}>Réponse : </Text>
              {idea.note}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {idea.createdBy.name} · {timeAgo(idea.createdAt)}
          </Text>
        </View>
      </View>
      {admin || idea.mine ? (
        <View style={styles.actions}>
          {admin ? (
            <>
              <Pressable onPress={() => sendToClaude([idea], settings, () => onChange({ ...idea, status: 'sent' }))} style={[styles.action, { backgroundColor: 'rgba(217,119,87,0.18)' }]}>
                <Ionicons name="code-slash" size={14} color="#D97757" />
                <Text style={[styles.actionText, { color: '#D97757' }]}>Envoyer à Claude</Text>
              </Pressable>
              <Pressable onPress={setStatus} style={styles.action}>
                <Ionicons name="swap-horizontal" size={14} color={C.text} />
                <Text style={styles.actionText}>Statut</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.prompt?.(
                    'Réponse à la famille',
                    undefined,
                    (note) => ideasApi.update(settings, idea.id, { note }).then(onChange, (e) => toast(e.message, 'error')),
                    'plain-text',
                    idea.note ?? ''
                  )
                }
                style={styles.action}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={C.text} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={remove} style={styles.action}>
            <Ionicons name="trash-outline" size={14} color={C.danger} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function Ideas() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [kind, setKind] = useState<Idea['kind']>('feature');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, me] = await Promise.all([ideasApi.list(settings), requestsApi.me(settings).catch(() => null)]);
      setIdeas(list);
      setAdmin(Boolean(me?.admin));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const submit = async () => {
    if (!title.trim()) return;
    setSending(true);
    try {
      const i = await ideasApi.create(settings, { title: title.trim(), details: details.trim(), kind });
      setIdeas((l) => [i, ...(l ?? [])]);
      setTitle('');
      setDetails('');
      toast(admin ? 'Idée ajoutée' : 'Merci ! Idée envoyée à l’admin');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const replace = (i: Idea) => setIdeas((l) => (l ?? []).map((x) => (x.id === i.id ? i : x)));
  const shown = (ideas ?? [])
    .filter((i) => (filter === 'all' ? true : filter === 'open' ? OPEN.includes(i.status) : !OPEN.includes(i.status)))
    .sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt));
  const fresh = (ideas ?? []).filter((i) => i.status === 'new' || i.status === 'planned');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Idées & bugs</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <Text style={styles.dim}>
          {admin
            ? 'Les idées de la famille arrivent ici (et en notification). « Envoyer à Claude » ouvre claude.ai avec un prompt prêt, qui contient le contexte du projet : Claude propose et code la fonctionnalité, tu relis puis tu publies.'
            : 'Une idée pour Lumio ou un bug ? Décris-le ici : l’admin le reçoit et peut le faire développer par Claude. Vote pour les idées des autres.'}
        </Text>

        <View style={styles.card}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SegChip label="Idée" icon="bulb-outline" on={kind === 'feature'} onPress={() => setKind('feature')} />
            <SegChip label="Bug" icon="bug-outline" on={kind === 'bug'} onPress={() => setKind('bug')} />
          </View>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={kind === 'bug' ? 'Ce qui ne marche pas' : 'Ton idée en une phrase'}
            placeholderTextColor={C.textFaint}
            style={styles.input}
            maxLength={120}
          />
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder={kind === 'bug' ? 'Où, quand, ce qui se passe…' : 'Détails (facultatif)'}
            placeholderTextColor={C.textFaint}
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            multiline
            maxLength={4000}
          />
          <Button title="Envoyer" icon="paper-plane" onPress={submit} loading={sending} disabled={!title.trim()} />
        </View>

        {admin && fresh.length > 1 ? (
          <Button
            title={`Envoyer les ${fresh.length} idées en attente à Claude`}
            icon="code-slash"
            variant="secondary"
            onPress={() => sendToClaude(fresh, settings, load)}
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <SegChip label="En cours" on={filter === 'open'} onPress={() => setFilter('open')} />
          <SegChip label="Terminées" on={filter === 'done'} onPress={() => setFilter('done')} />
          <SegChip label="Toutes" on={filter === 'all'} onPress={() => setFilter('all')} />
        </View>

        {error ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 20 }}>
            <Text style={[styles.dim, { textAlign: 'center' }]}>{error}</Text>
            <Button title="Réessayer" variant="secondary" onPress={load} />
          </View>
        ) : !ideas ? (
          <ActivityIndicator color={C.text} style={{ marginTop: 20 }} />
        ) : !shown.length ? (
          <Text style={[styles.dim, { textAlign: 'center', marginTop: 20 }]}>Rien ici pour l’instant.</Text>
        ) : (
          shown.map((i) => (
            <IdeaCard key={i.id} idea={i} admin={admin} onChange={replace} onRemoved={() => setIdeas((l) => (l ?? []).filter((x) => x.id !== i.id))} />
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  input: { backgroundColor: C.surfaceHigh, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  vote: {
    width: 46,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: 'flex-start',
  },
  voteText: { color: C.textDim, fontSize: 13, fontWeight: '800' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  ideaTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  details: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  meta: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: C.text, fontSize: 13, fontWeight: '700' },
});
