import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Picker } from '@/components/arr-section';
import { Button, Field, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { chat } from '@/lib/chat';
import { lumio } from '@/lib/lumio-server';
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
  const [adKey, setAdKey] = useState(settings.alldebridKey);
  const manager = isManager(settings);
  const hasArr = Boolean((settings.radarr.url && settings.radarr.apiKey) || (settings.sonarr.url && settings.sonarr.apiKey));
  return (
    <Section title="Serveur Lumio">
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        {manager
          ? 'Chat famille, et téléchargements pour les comptes non-admins : tes clés Radarr et Sonarr restent sur ce serveur, jamais sur leurs téléphones.'
          : 'Chat famille et téléchargements : tu choisis un film ou une série, il part sur le serveur.'}
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
            const grabs = h?.radarr || h?.sonarr;
            Alert.alert(
              'Serveur Lumio connecté ✅',
              grabs
                ? 'Chat et téléchargements prêts.'
                : manager
                  ? 'Chat prêt. Envoie maintenant ta config Radarr/Sonarr au serveur pour activer les téléchargements des autres comptes.'
                  : 'Chat prêt.'
            );
          } catch (e: any) {
            Alert.alert('Serveur injoignable', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {manager && settings.chatUrl && settings.jellyfin ? (
        <View style={{ marginTop: 10 }}>
          <Field
            label="Clé API AllDebrid (facultatif)"
            value={adKey}
            onChangeText={setAdKey}
            onEndEditing={() => update({ alldebridKey: adKey.trim() })}
            placeholder="alldebrid.com → Apikeys"
            secureTextEntry
            hint="Permet de lancer le stream du torrent choisi par Radarr / Sonarr (celui envoyé à rdt-client) pendant qu'il se télécharge."
          />
          <Button
            title="Envoyer la config au serveur"
            icon="cloud-upload-outline"
            variant="secondary"
            loading={pushing}
            disabled={!hasArr}
            onPress={async () => {
              setPushing(true);
              try {
                const st = await lumio.pushArr({ ...settings, alldebridKey: adKey.trim() });
                if (adKey.trim() !== settings.alldebridKey) update({ alldebridKey: adKey.trim() });
                const line = (n: string, x?: { ok: boolean; error?: string }) => `${n} : ${x?.ok ? 'OK ✅' : (x?.error ?? 'non configuré')}`;
                Alert.alert(
                  'Config envoyée',
                  [line('Radarr', st.radarr), line('Sonarr', st.sonarr), st.alldebrid ? line('AllDebrid', st.alldebrid) : null]
                    .filter(Boolean)
                    .join('\n')
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
      {manager && !settings.chatUrl ? (
        <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
          Le serveur s'installe en Docker à côté de Jellyfin (dossier server/lumio du dépôt).
        </Text>
      ) : null}
    </Section>
  );
}

/** Source du calendrier des sorties. */
export function CalendarSection() {
  const { settings, update } = useSettings();
  const [url, setUrl] = useState(settings.calendarAddon);
  return (
    <Section title="Calendrier">
      <Field
        label="Addon des sorties numériques"
        value={url}
        onChangeText={setUrl}
        onEndEditing={() => url.trim() && update({ calendarAddon: url.trim().replace(/\/manifest\.json$/i, '') })}
        keyboardType="url"
        hint="Par défaut : Digital Releases (Releasio)."
      />
    </Section>
  );
}
