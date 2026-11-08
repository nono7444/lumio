// Lumio Auto → onglet « Serveur » : tout ce qui sert à l'admin (état, mises à jour, stockage, utilisateurs,
// annonces, signalements, TMDB, compte). L'appli Lumio de la famille n'a plus rien de tout ça.
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnnouncementEditor } from '@/components/announcement';
import { AppVersionSection } from '@/components/app-version';
import { Button, Field, ScreenTitle, Section, SectionCollapse, SectionGroup } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { logout as logoutJellyfin } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';
import { tmdb as tmdbApi } from '@/lib/tmdb';

const COLLAPSE = { enabled: true, all: null, version: 0 };

export function AutoServerScreen() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [tmdb, setTmdb] = useState('');
  const [testing, setTesting] = useState(false);

  // La clé TMDB est gardée sur le serveur Lumio et partagée à tout le monde (jamais écrite dans l'appli)
  async function saveTmdb() {
    const key = tmdb.trim();
    setTesting(true);
    try {
      await tmdbApi.trending({ ...settings, tmdbKey: key });
      await serverCall(settings, '/api/config/tmdb', { method: 'PUT', body: JSON.stringify({ key }) });
      setTmdb('');
      Alert.alert('TMDB OK ✅', 'La clé fonctionne et est partagée par le serveur.');
    } catch (e: any) {
      Alert.alert('Clé TMDB refusée', e?.message ?? String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SectionCollapse.Provider value={COLLAPSE}>
        <ScrollView
          style={{ flex: 1, backgroundColor: C.bg }}
          contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE }}
          keyboardShouldPersistTaps="handled">
          <ScreenTitle title="Réglages" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <AppVersionSection />

          <SectionGroup title="Torrents" id="la-grp-torrents">
            <Section title="Lumio Auto" id="la-reglages">
              <Text style={styles.help}>Sites (C411, TR4KER…), qualité, langues, qBittorrent, partage, AllDebrid, dossiers.</Text>
              <Button title="Sites et réglages" icon="options-outline" variant="secondary" onPress={() => router.push('/lumio-auto')} />
            </Section>
            <Section title="Disques et téléchargements" id="la-disques">
              <Text style={styles.help}>Fichiers des disques, et téléchargements AllDebrid (liens, magnets, .torrent) vers un disque.</Text>
              <View style={{ gap: 8 }}>
                <Button title="Disques" icon="folder-open-outline" variant="secondary" onPress={() => router.push('/files')} />
                <Button title="Téléchargements AllDebrid" icon="cloud-download-outline" variant="secondary" onPress={() => router.push('/downloads')} />
              </View>
            </Section>
            <Section title="Lumio Secour" id="la-secour">
              <Text style={styles.help}>Recherche et téléchargement directs par AllDebrid, sans passer par Lumio Auto.</Text>
              <Button title="Ouvrir Lumio Secour" icon="medkit-outline" variant="secondary" onPress={() => router.push('/secour-admin')} />
            </Section>
          </SectionGroup>

          <SectionGroup title="Famille" id="la-grp-famille">
            <Section title="Utilisateurs et quotas" id="la-users">
              <Text style={styles.help}>Droits, validation automatique, quotas (2 films et 1 série par semaine…), notifications.</Text>
              <Button title="Utilisateurs et quotas" icon="people-outline" variant="secondary" onPress={() => router.push('/users')} />
            </Section>
            <AnnouncementEditor />
            <Section title="Idées et signalements" id="la-ideas">
              <Text style={styles.help}>Ce que la famille propose ou signale depuis Lumio.</Text>
              <Button title="Voir les idées et signalements" icon="bulb-outline" variant="secondary" onPress={() => router.push('/ideas')} />
            </Section>
          </SectionGroup>

          <SectionGroup title="Compte et clés" id="la-grp-compte">
          <Section title="TMDB" id="la-tmdb">
            <Field
              label="Nouvelle clé API"
              value={tmdb}
              onChangeText={setTmdb}
              placeholder="Clé v3 ou jeton de lecture v4"
              secureTextEntry
              hint="Gardée sur le serveur Lumio et partagée aux applis de la famille. Laisse vide pour garder l’actuelle."
            />
            <Button title="Enregistrer et tester" icon="flash-outline" onPress={saveTmdb} loading={testing} disabled={!tmdb.trim()} />
          </Section>
          <Section title="Compte" id="la-compte">
            <Text style={styles.help}>
              {settings.jellyfin ? `${settings.jellyfin.userName} · administrateur${settings.jellyfin.serverName ? ` · ${settings.jellyfin.serverName}` : ''}` : 'Pas connecté'}
            </Text>
            <Button
              title="Se déconnecter"
              icon="log-out-outline"
              variant="danger"
              onPress={async () => {
                await logoutJellyfin(settings);
                await update({ jellyfin: null, household: null, skipJellyfin: false });
                router.replace('/login');
              }}
            />
          </Section>
          </SectionGroup>
        </ScrollView>
      </SectionCollapse.Provider>
    </KeyboardAvoidingView>
  );
}

/** Lumio Auto ouverte avec un compte qui n'est pas admin. */
export function AutoAdminOnly() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 40, paddingHorizontal: 24, gap: 16 }}>
      <Text style={{ color: C.text, fontSize: 26, fontWeight: '900' }}>Réservé à l’admin</Text>
      <Text style={styles.help}>Lumio Auto sert à gérer le serveur. Connecte-toi avec le compte Jellyfin administrateur, ou utilise l’appli Lumio.</Text>
      <Button
        title="Changer de compte"
        icon="log-out-outline"
        onPress={async () => {
          await logoutJellyfin(settings);
          await update({ jellyfin: null, household: null, skipJellyfin: false });
          router.replace('/login');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
});
