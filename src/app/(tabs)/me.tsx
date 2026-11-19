// Lumio Audio et Lumio Livres → onglet « Profil » : compte Jellyfin, serveur Lumio, statistiques, déconnexion.
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAudioLibrary } from '@/components/audio-ui';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { stop, useAudio } from '@/lib/audio-player';
import { logout as logoutJellyfin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { folderApi, useEbooks, type FolderInfo } from '@/lib/ebooks';
import { FocusPressable as Pressable } from '@/components/tv';
import { IS_AUDIO, IS_BOOKS } from '@/lib/variant';

export default function MeRoute() {
  return IS_AUDIO ? <MeAudio /> : IS_BOOKS ? <MeBooks /> : null;
}

function MeAudio() {
  const { lib, reload } = useAudioLibrary();
  const a = useAudio();
  return (
    <Me
      books={lib?.books ?? []}
      reload={() => reload(true)}
      bottom={a.book ? 70 : 0}
      labels={['livres', 'commencés', 'terminés']}
      kind="audio"
      about="Lumio Audio, l'appli des livres audio de la maison. Lecture en arrière-plan et sur l'écran verrouillé, vitesse, minuterie, reprise là où tu t'étais arrêté sur tous tes appareils."
    />
  );
}

function MeBooks() {
  const { lib, reload } = useEbooks();
  return (
    <Me
      books={lib?.books ?? []}
      reload={reload}
      bottom={0}
      labels={['livres', 'en cours', 'lus']}
      kind="books"
      about="Lumio Livres, la bibliothèque de livres, BD et mangas de la maison. Liseuse intégrée (EPUB, BD, PDF), thème et taille du texte, reprise à la bonne page sur tous tes appareils."
    />
  );
}

type Item = { progress: { done: boolean } | null };
function Me({
  books,
  reload,
  bottom,
  labels,
  about,
  kind,
}: {
  books: Item[];
  reload: () => void;
  bottom: number;
  labels: [string, string, string];
  about: string;
  kind: 'audio' | 'books';
}) {
  const { settings, update } = useSettings();
  const [url, setUrl] = useState(settings.chatUrl ?? '');
  const started = books.filter((b) => b.progress).length;
  const done = books.filter((b) => b.progress?.done).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE + bottom }} keyboardShouldPersistTaps="handled">
        <ScreenTitle title="Profil" />
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(settings.jellyfin?.userName ?? 'L').slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{settings.jellyfin?.userName ?? 'Non connecté'}</Text>
              <Text style={styles.s}>{settings.jellyfin?.isAdmin ? 'Administrateur' : 'Membre de la famille'}</Text>
            </View>
          </View>
          <View style={styles.stats}>
            <Stat n={books.length} label={labels[0]} />
            <Stat n={started} label={labels[1]} />
            <Stat n={done} label={labels[2]} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.h}>Serveur Lumio</Text>
          <Field
            label="Adresse"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://lumio.wawanono.lol"
            hint="La bibliothèque, la position d'écoute et la recherche passent par ce serveur."
          />
          <Button
            title="Enregistrer et recharger"
            icon="refresh"
            variant="secondary"
            onPress={async () => {
              await update({ chatUrl: url.trim().replace(/\/+$/, '') || undefined });
              setTimeout(reload, 100);
            }}
          />
        </View>

        {settings.jellyfin?.isAdmin ? <FolderCard kind={kind} onMoved={reload} /> : null}

        <View style={[styles.card, { gap: 10 }]}>
          <Text style={styles.s}>
            {about}
          </Text>
          <Button
            title="Se déconnecter"
            icon="log-out-outline"
            variant="danger"
            onPress={async () => {
              stop();
              await logoutJellyfin(settings).catch(() => {});
              await update({ jellyfin: null, household: null, skipJellyfin: false });
              router.replace('/login');
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const go = (n: number | null) => (n == null ? '?' : n >= 1e12 ? `${(n / 1e12).toFixed(1)} To` : `${Math.round(n / 1e9)} Go`);
/** Admin : sur quel disque du serveur sont rangés les livres, et déplacement vers un autre disque. */
function FolderCard({ kind, onMoved }: { kind: 'audio' | 'books'; onMoved: () => void }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Fonction gardée dans une référence : sinon le suivi se relancerait à chaque affichage
  const moved = useRef(onMoved);
  moved.current = onMoved;
  const load = useCallback(() => {
    folderApi
      .get(settings, kind)
      .then((r) => {
        setInfo((old) => {
          if (old?.move?.status === 'running' && r.move?.status === 'done') moved.current();
          return r;
        });
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [settings, kind]);
  useEffect(() => {
    load();
  }, [load]);
  // Déplacement en cours : on suit toutes les 5 s
  useEffect(() => {
    if (info?.move?.status !== 'running') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [info?.move?.status, load]);

  const label = kind === 'audio' ? 'livres audio' : 'livres';
  const move = (root: string) =>
    Alert.alert(
      `Déplacer les ${label} sur ${root} ?`,
      `Le dossier « ${info?.dir?.folder} » (${go(info?.size ?? null)}) est copié sur ${root}, puis effacé de ${info?.dir?.root}. Les positions de lecture sont gardées.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déplacer',
          onPress: () =>
            folderApi
              .move(settings, kind, root)
              .then(setInfo)
              .catch((e) => Alert.alert('Déplacement impossible', e instanceof Error ? e.message : String(e))),
        },
      ]
    );
  const m = info?.move;
  return (
    <View style={styles.card}>
      <Text style={styles.h}>Dossier sur le serveur</Text>
      {err ? <Text style={[styles.s, { color: C.danger }]}>{err}</Text> : null}
      {info?.dir ? (
        <Text style={styles.s}>
          « {info.dir.folder || 'racine'} » sur le disque <Text style={{ color: C.text, fontWeight: '700' }}>{info.dir.root}</Text>
          {info.size != null ? ` · ${go(info.size)}` : ''}
        </Text>
      ) : null}
      {m?.status === 'running' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={C.text} />
          <Text style={styles.s}>
            Déplacement vers {m.to} en cours ({go(m.size)})… Les {label} reviennent dès que c'est fini.
          </Text>
        </View>
      ) : m?.status === 'error' ? (
        <Text style={[styles.s, { color: C.danger }]}>Déplacement vers {m.to} échoué : {m.error}</Text>
      ) : m?.status === 'done' ? (
        <Text style={[styles.s, { color: C.success }]}>Déplacé sur {m.to}.</Text>
      ) : null}
      {info && info.disks.length > 1 && m?.status !== 'running' ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.s}>Déplacer vers :</Text>
          {info.disks
            .filter((d) => d.name !== info.dir?.root)
            .map((d) => (
              <Pressable key={d.name} onPress={() => move(d.name)} style={styles.disk}>
                <Ionicons name="server-outline" size={18} color={C.text} />
                <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{d.name}</Text>
                <Text style={styles.s}>{go(d.free)} libres</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
              </Pressable>
            ))}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{n}</Text>
      <Text style={styles.s}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 14, padding: 16, borderRadius: 18, backgroundColor: C.surface, gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.text, fontSize: 22, fontWeight: '800' },
  name: { color: C.text, fontSize: 19, fontWeight: '800' },
  h: { color: C.text, fontSize: 16, fontWeight: '800' },
  s: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  disk: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.surfaceHigh },
  stats: { flexDirection: 'row', paddingTop: 6 },
});
