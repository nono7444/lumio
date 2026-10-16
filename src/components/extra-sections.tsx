import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Picker } from '@/components/arr-section';
import { Button, Field, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { chat } from '@/lib/chat';
import { lumio, useServerArr } from '@/lib/lumio-server';
import { InviteButton } from '@/components/seerr-section';
import { SEASONS, seasonAt } from '@/lib/seasons';
import { isManager, useSettings } from '@/lib/settings';

/** Thème de saison : automatique selon la date, désactivé, ou forcé. */
export function ThemeSection() {
  const { settings, update } = useSettings();
  const now = seasonAt();
  return (
    <Section title="Thème">
      <Picker
        label="Thème de saison"
        options={[
          { value: 'auto', label: 'Automatique', hint: now ? `${now.emoji} ${now.name}` : 'aucune période' },
          { value: 'off', label: 'Désactivé' },
          ...SEASONS.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` })),
        ]}
        value={settings.seasonTheme}
        onChange={(v) => update({ seasonTheme: String(v) })}
      />
      <Text style={{ color: C.textFaint, fontSize: 12, lineHeight: 17 }}>
        Couleurs, emoji et sélections spéciales sur l'accueil (ex. films d'horreur pour Halloween) selon la période.
      </Text>
    </Section>
  );
}

/** Serveur Lumio : chat famille, téléchargements pour tous, état des services. */
export function ChatSection() {
  const { settings, update } = useSettings();
  const [url, setUrl] = useState(settings.chatUrl);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const manager = isManager(settings);
  const serverArr = useServerArr();
  const hasArr = Boolean((settings.radarr.url && settings.radarr.apiKey) || (settings.sonarr.url && settings.sonarr.apiKey));
  return (
    <Section title="Serveur Lumio">
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        {manager
          ? 'Chat famille et demandes façon Seerr : tes clés Radarr et Sonarr restent sur ce serveur, jamais sur les téléphones de la famille.'
          : 'Chat famille et demandes de films et séries.'}
      </Text>
      <Field label="Adresse du serveur" value={url} onChangeText={setUrl} placeholder="https://lumio.mondomaine.fr" keyboardType="url" />
      <Button
        title="Enregistrer et tester"
        icon="flash-outline"
        loading={busy}
        disabled={!url.trim()}
        onPress={async () => {
          setBusy(true);
          try {
            const clean = url.trim().replace(/\/+$/, '');
            const h = await chat.health(clean);
            await update({ chatUrl: clean });
            const ready = h?.radarr || h?.sonarr;
            Alert.alert(
              'Serveur Lumio connecté ✅',
              ready
                ? 'Chat et demandes prêts.'
                : manager
                  ? 'Chat prêt. Envoie maintenant ta config Radarr/Sonarr au serveur pour activer les demandes.'
                  : 'Chat prêt.'
            );
          } catch (e: any) {
            Alert.alert('Serveur injoignable', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {manager && settings.chatUrl && settings.jellyfin && serverArr === false ? (
        <View style={{ marginTop: 10 }}>
          <Button
            title="Envoyer la config au serveur"
            icon="cloud-upload-outline"
            variant="secondary"
            loading={pushing}
            disabled={!hasArr}
            onPress={async () => {
              setPushing(true);
              try {
                const st = await lumio.pushArr(settings);
                const line = (n: string, x?: { ok: boolean; error?: string }) => `${n} : ${x?.ok ? 'OK ✅' : (x?.error ?? 'non configuré')}`;
                Alert.alert(
                  'Config envoyée',
                  [line('Radarr', st.radarr), line('Sonarr', st.sonarr)].join('\n')
                );
              } catch (e: any) {
                Alert.alert('Envoi impossible', e?.message ?? String(e));
              } finally {
                setPushing(false);
              }
            }}
          />
          <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
            {hasArr
              ? 'À refaire si tu changes d’adresse, de clé ou de profil de qualité. Les adresses doivent être joignables depuis le serveur (ex. http://192.168.1.71:7878).'
              : 'Connecte d’abord Radarr et/ou Sonarr plus bas.'}
          </Text>
        </View>
      ) : null}
      {settings.chatUrl ? <InviteButton /> : null}
      {manager && !settings.chatUrl ? (
        <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
          Le serveur s'installe en Docker à côté de Jellyfin (dossier server/lumio du dépôt).
        </Text>
      ) : null}
    </Section>
  );
}
