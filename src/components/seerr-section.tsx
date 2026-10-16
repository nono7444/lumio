import { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';

import { Button, Field, Section } from '@/components/ui';
import { ADDONS_ENABLED } from '@/constants/features';
import { C } from '@/constants/theme';
import { seerr } from '@/lib/seerr';
import { isManager, useSettings } from '@/lib/settings';

/** Serveur de demandes (Seerr / Jellyseerr) + lien d'invitation pour l'admin. */
export function SeerrSection() {
  const { settings, update } = useSettings();
  const [url, setUrl] = useState(settings.seerr?.url ?? '');
  const [apiKey, setApiKey] = useState(settings.seerr?.apiKey ?? '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const manager = isManager(settings);
  const userName = settings.jellyfin?.userName;

  async function connect() {
    const clean = url.trim().replace(/\/+$/, '');
    if (!clean) return;
    setBusy(true);
    try {
      let name = settings.seerr?.userName;
      if (userName && pass) {
        const me = await seerr.login(clean, userName, pass);
        name = me.displayName ?? me.jellyfinUsername ?? userName;
      }
      const cfg = { url: clean, apiKey: manager && apiKey.trim() ? apiKey.trim() : undefined, userName: name };
      await update({ seerr: cfg });
      await seerr.me({ ...settings, seerr: cfg });
      setPass('');
      Alert.alert('Connecté ✅', `Serveur de demandes prêt${name ? ` (${name})` : ''}.`);
    } catch (e: any) {
      Alert.alert('Connexion impossible', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Demandes Seerr (facultatif)">
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        {manager
          ? 'Les utilisateurs non-admins envoient leurs demandes à Seerr ; tu les valides dans l’onglet Activité.'
          : 'Tes demandes de films et séries passent par ce serveur, puis l’admin les valide.'}
      </Text>
      {settings.seerr?.userName ? (
        <Text style={{ color: C.success, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>
          ● Connecté en tant que {settings.seerr.userName}
        </Text>
      ) : null}
      <Field label="URL Seerr / Jellyseerr" value={url} onChangeText={setUrl} placeholder="https://seerr.mondomaine.fr" keyboardType="url" />
      {userName ? (
        <Field
          label={`Mot de passe Jellyfin de ${userName}`}
          value={pass}
          onChangeText={setPass}
          placeholder="Pour ouvrir la session Seerr"
          secureTextEntry
        />
      ) : null}
      {manager && (
        <Field
          label="Clé API Seerr (facultatif)"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Seerr → Paramètres → Général"
          secureTextEntry
          hint="Utile si la session expire : l'admin garde l'accès aux demandes."
        />
      )}
      <Button title="Connecter" icon="flash-outline" onPress={connect} loading={busy} disabled={!url.trim()} />
      {!settings.chatUrl ? <InviteButton /> : null}
    </Section>
  );
}

/** Lien d'invitation pour un proche (admin) : serveurs, clé TMDB, addons — jamais les clés Radarr/Sonarr. */
export function InviteButton() {
  const { settings } = useSettings();
  const userName = settings.jellyfin?.userName;
  async function invite() {
    const q = new URLSearchParams();
    if (settings.jellyfin?.url) q.set('jf', settings.jellyfin.url);
    if (settings.seerr?.url) q.set('seerr', settings.seerr.url);
    if (settings.chatUrl) q.set('chat', settings.chatUrl);
    if (settings.tmdbKey) q.set('tmdb', settings.tmdbKey);
    if (ADDONS_ENABLED && settings.addons.length) q.set('addons', settings.addons.map((a) => a.base).join('|'));
    if (userName) q.set('name', userName);
    const link = `lumio://invite?${q}`;
    await Share.share({
      message:
        `Installe Lumio puis ouvre ce lien pour tout configurer automatiquement (connexion avec ton compte Jellyfin) :\n\n${link}`,
    });
  }

  if (!isManager(settings) || !settings.jellyfin) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <Button title="Inviter quelqu'un" icon="share-outline" variant="secondary" onPress={invite} />
      <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
        Le lien contient les adresses de tes serveurs, ta clé TMDB et tes addons, jamais tes clés Radarr ou Sonarr.
      </Text>
    </View>
  );
}
