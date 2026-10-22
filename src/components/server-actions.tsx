// Profil → Serveur (admin) : scan des bibliothèques, redémarrage de Jellyfin, mise à jour du serveur Lumio, redémarrage du PC.
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { Button, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Action = 'scan' | 'jellyfin' | 'reboot' | 'update';

const ASK: Record<Action, { title: string; text: string; ok: string; path: string }> = {
  scan: { title: 'Scanner les bibliothèques ?', text: 'Jellyfin va chercher les nouveaux fichiers sur les disques.', ok: 'Scanner', path: '/api/admin/jellyfin/scan' },
  jellyfin: { title: 'Redémarrer Jellyfin ?', text: 'Les lectures en cours seront coupées environ 1 minute.', ok: 'Redémarrer', path: '/api/admin/jellyfin/restart' },
  update: {
    title: 'Mettre à jour le serveur Lumio ?',
    text: 'Le serveur télécharge sa dernière version et redémarre (environ 1 minute de coupure).',
    ok: 'Mettre à jour',
    path: '/api/admin/server/update',
  },
  reboot: {
    title: 'Redémarrer le PC serveur ?',
    text: 'Tout sera coupé 2 à 3 minutes (Jellyfin, Lumio, téléchargements), puis tout redémarre tout seul.',
    ok: 'Redémarrer le PC',
    path: '/api/admin/host/reboot',
  },
};

export function ServerActionsSection() {
  const { settings } = useSettings();
  const [busy, setBusy] = useState<Action | null>(null);
  if (!settings.chatUrl || settings.jellyfin?.isAdmin !== true || Platform.isTV) return null;

  const run = async (a: Action) => {
    setBusy(a);
    try {
      const r = await serverCall<{ message?: string }>(settings, ASK[a].path, { method: 'POST', body: '{}' });
      toast(r.message ?? 'C’est parti');
      if (a === 'reboot' || a === 'update') {
        // Si le service de la machine n'est pas installé, la demande reste en attente : on prévient
        setTimeout(async () => {
          try {
            const st = await serverCall<{ rebootPending: boolean; updatePending?: boolean; helperInstalled: boolean; version?: string }>(settings, '/api/admin/host/status');
            if (a === 'update' && !st.updatePending) toast(`Serveur Lumio à jour${st.version ? ` (version ${st.version})` : ''}`);
            if (a === 'reboot' ? st.rebootPending : st.updatePending)
              Alert.alert(
                a === 'reboot' ? 'Redémarrage en attente' : 'Mise à jour en attente',
                st.helperInstalled
                  ? 'La machine n’a pas encore pris la demande.'
                  : 'Le petit service de la machine n’est pas installé : lance une fois la commande d’installation donnée par Claude (install-host-actions.sh).'
              );
          } catch {
            // Serveur injoignable : il est sans doute déjà en train de redémarrer
          }
        }, a === 'update' ? 75000 : 20000);
      }
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirm = (a: Action) =>
    Alert.alert(ASK[a].title, ASK[a].text, [
      { text: 'Annuler', style: 'cancel' },
      { text: ASK[a].ok, style: a === 'scan' ? 'default' : 'destructive', onPress: () => run(a) },
    ]);

  return (
    <Section title="Serveur">
      <Text style={styles.help}>Actions réservées à l’admin.</Text>
      <View style={{ gap: 10 }}>
        <Button title="Scanner les bibliothèques" icon="refresh" variant="secondary" loading={busy === 'scan'} onPress={() => confirm('scan')} />
        <Button title="Redémarrer Jellyfin" icon="reload-circle-outline" variant="secondary" loading={busy === 'jellyfin'} onPress={() => confirm('jellyfin')} />
        <Button title="Mettre à jour le serveur Lumio" icon="cloud-download-outline" variant="secondary" loading={busy === 'update'} onPress={() => confirm('update')} />
        <Button title="Redémarrer le PC serveur" icon="power" variant="danger" loading={busy === 'reboot'} onPress={() => confirm('reboot')} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
});
