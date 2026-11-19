// Lumio Audio et Lumio Livres → onglet « Profil » : compte Jellyfin, serveur Lumio, statistiques, déconnexion.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAudioLibrary } from '@/components/audio-ui';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { stop, useAudio } from '@/lib/audio-player';
import { logout as logoutJellyfin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { useEbooks } from '@/lib/ebooks';
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
      about="Lumio Livres, la bibliothèque de livres, BD et mangas de la maison. Liseuse intégrée (EPUB, BD, PDF), thème et taille du texte, reprise à la bonne page sur tous tes appareils."
    />
  );
}

type Item = { progress: { done: boolean } | null };
function Me({ books, reload, bottom, labels, about }: { books: Item[]; reload: () => void; bottom: number; labels: [string, string, string]; about: string }) {
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
  stats: { flexDirection: 'row', paddingTop: 6 },
});
