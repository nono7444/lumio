// Profil : recevoir les notifications de la famille (messages, demandes, titres disponibles) via l'appli gratuite ntfy.
// Pour l'admin : aussi le sujet « admin » (demandes à valider, téléchargements, signalements).
import { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Info = { server: string; topic: string; enabled: boolean; adminTopic?: string };

const STORE = Platform.OS === 'ios' ? 'https://apps.apple.com/app/ntfy/id1625396347' : 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';

function subscribe(server: string, topic: string) {
  const host = server.replace(/^https?:\/\//, '');
  if (Platform.OS === 'ios') {
    // L'appli ntfy pour iPhone ne sait pas s'ouvrir depuis un lien : on copie le nom du sujet et on explique
    Clipboard.setStringAsync(topic).catch(() => {});
    Alert.alert(
      'Nom copié ✅',
      `Dans l'appli ntfy :\n\n1. Touche « + » en haut à droite\n2. Colle le nom du sujet :\n${topic}\n3. Touche « Subscribe »${host !== 'ntfy.sh' ? `\n\n(Serveur : ${server} — active « Use another server »)` : ''}`,
      [
        { text: 'OK', style: 'cancel' },
        { text: 'Installer ntfy', onPress: () => Linking.openURL(STORE).catch(() => {}) },
      ]
    );
    return;
  }
  // Android : l'appli ntfy s'ouvre directement sur l'abonnement
  Linking.openURL(`ntfy://${host}/${topic}`).catch(() => Linking.openURL(`${server}/${topic}`).catch(() => {}));
}

export function NotifySubscribeSection() {
  const { settings } = useSettings();
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    if (!settings.chatUrl || !settings.jellyfin) return;
    serverCall<Info>(settings, '/api/notify/family')
      .then(setInfo)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
  if (!info) return null;
  return (
    <Section title="Notifications">
      <View style={{ gap: 10 }}>
        <Text style={styles.help}>
          Reçois une notification pour chaque message du chat, chaque nouvelle demande et chaque film ou série disponible. Installe l’appli gratuite
          ntfy, puis touche « S’abonner ».
        </Text>
        <Button title="Installer ntfy" icon="download-outline" variant="secondary" onPress={() => Linking.openURL(STORE).catch(() => {})} />
        <Button title="S’abonner : famille" icon="notifications-outline" onPress={() => subscribe(info.server, info.topic)} />
        {info.adminTopic ? (
          <Button
            title="S’abonner : admin"
            icon="shield-checkmark-outline"
            variant="secondary"
            onPress={() => subscribe(info.server, info.adminTopic!)}
          />
        ) : null}
        {info.adminTopic ? (
          <Text style={styles.help}>Admin : demandes à valider, téléchargements lancés et importés, signalements de problème.</Text>
        ) : null}
        {!info.enabled ? <Text style={[styles.help, { color: C.warning }]}>Les notifications sont coupées sur le serveur (Utilisateurs, droits et notifications).</Text> : null}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
