import { useState } from 'react';
import { Alert, Text } from 'react-native';

import { Picker } from '@/components/arr-section';
import { Button, Field, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { chat } from '@/lib/chat';
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

/** Adresse du serveur de chat famille et du calendrier. */
export function ChatSection() {
  const { settings, update } = useSettings();
  const [url, setUrl] = useState(settings.chatUrl);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Chat famille">
      <Field label="Serveur de chat" value={url} onChangeText={setUrl} placeholder="https://chat.mondomaine.fr" keyboardType="url" />
      <Button
        title="Enregistrer et tester"
        icon="flash-outline"
        loading={busy}
        disabled={!url.trim()}
        onPress={async () => {
          setBusy(true);
          try {
            const clean = url.trim().replace(/\/+$/, '');
            await chat.health(clean);
            await update({ chatUrl: clean });
            Alert.alert('Chat connecté ✅');
          } catch (e: any) {
            Alert.alert('Serveur injoignable', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {isManager(settings) && (
        <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
          Le serveur s'installe en Docker à côté de Jellyfin (dossier server/chat du dépôt).
        </Text>
      )}
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
