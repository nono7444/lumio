// Profil → Serveur (admin) : scan des bibliothèques, redémarrage de Jellyfin, mise à jour du serveur Lumio et des conteneurs, redémarrage du PC.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { toast } from '@/components/toast';
import { Button, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Action = 'scan' | 'intro' | 'jellyfin' | 'reboot' | 'update' | 'containers';

const ASK: Record<Action, { title: string; text: string; ok: string; path: string }> = {
  scan: { title: 'Scanner les bibliothèques ?', text: 'Jellyfin va chercher les nouveaux fichiers sur les disques.', ok: 'Scanner', path: '/api/admin/jellyfin/scan' },
  intro: {
    title: 'Installer Intro Skipper ?',
    text: 'L’extension Jellyfin qui repère intros, récaps et génériques (bouton « Passer l’intro »). Jellyfin redémarre une fois (environ 1 minute), puis analyse la bibliothèque en arrière-plan.',
    ok: 'Installer',
    path: '/api/admin/jellyfin/intro-skipper',
  },
  jellyfin: { title: 'Redémarrer Jellyfin ?', text: 'Les lectures en cours seront coupées environ 1 minute.', ok: 'Redémarrer', path: '/api/admin/jellyfin/restart' },
  update: {
    title: 'Mettre à jour le serveur Lumio ?',
    text: 'Le serveur télécharge sa dernière version et redémarre (environ 1 minute de coupure).',
    ok: 'Mettre à jour',
    path: '/api/admin/server/update',
  },
  containers: {
    title: 'Mettre à jour les conteneurs ?',
    text: 'La machine télécharge les dernières versions de tes conteneurs (Jellyfin…), puis redémarre ceux qui ont changé. Quelques minutes, avec de courtes coupures.',
    ok: 'Mettre à jour',
    path: '/api/admin/server/containers',
  },
  reboot: {
    title: 'Redémarrer le PC serveur ?',
    text: 'Tout sera coupé 2 à 3 minutes (Jellyfin, Lumio, téléchargements), puis tout redémarre tout seul.',
    ok: 'Redémarrer le PC',
    path: '/api/admin/host/reboot',
  },
};

type ContainersResult = { at: string; running: boolean; ok: boolean; updated: string[]; tail: string };
type HostStatus = {
  rebootPending: boolean;
  updatePending?: boolean;
  containersPending?: boolean;
  helperInstalled: boolean;
  containersHelper?: boolean;
  containers?: ContainersResult | null;
  version?: string;
};

type RefreshStatus = { active: boolean; progress: number; libraries: { name: string; active: boolean; progress: number }[] };

export function ServerActionsSection() {
  const { settings } = useSettings();
  const [busy, setBusy] = useState<Action | null>(null);
  const allowed = Boolean(settings.chatUrl) && settings.jellyfin?.isAdmin === true && !Platform.isTV;
  // Avancement de Jellyfin (scan des bibliothèques) : vérifié toutes les 3 s tant qu'il travaille
  const [refresh, setRefresh] = useState<RefreshStatus | null>(null);
  // Intro Skipper déjà installé dans Jellyfin ?
  const [intro, setIntro] = useState<{ installed: boolean; version?: string } | null>(null);
  useEffect(() => {
    if (!allowed) return;
    serverCall<{ installed: boolean; version?: string }>(settings, '/api/admin/jellyfin/intro-skipper').then(setIntro).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, busy]);
  const [host, setHost] = useState<HostStatus | null>(null);
  const loadHost = useCallback(() => serverCall<HostStatus>(settings, '/api/admin/host/status').then((h) => (setHost(h), h)).catch(() => null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.chatUrl, settings.jellyfin?.token]);
  useEffect(() => {
    if (allowed) loadHost();
  }, [allowed, loadHost]);
  const [watch, setWatch] = useState(0);
  const sawActive = useRef(false);
  const poll = useCallback(async () => {
    try {
      const st = await serverCall<RefreshStatus>(settings, '/api/admin/jellyfin/refresh-status');
      setRefresh(st);
      if (st.active) sawActive.current = true;
      else if (sawActive.current) {
        sawActive.current = false;
        toast('Jellyfin a terminé : métadonnées et images à jour');
      }
      return st.active;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    let tries = 0;
    const tick = async () => {
      const active = await poll();
      tries++;
      // Juste après le lancement, Jellyfin met parfois quelques secondes à démarrer : on insiste un peu
      if (alive && (active || (watch > 0 && tries < 10))) t = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [allowed, poll, watch]);
  if (!allowed) return null;

  const run = async (a: Action) => {
    setBusy(a);
    try {
      const r = await serverCall<{ message?: string }>(settings, ASK[a].path, { method: 'POST', body: '{}' });
      toast(r.message ?? 'C’est parti');
      if (a === 'scan') setWatch((n) => n + 1);
      if (a === 'containers') {
        // Suivi toutes les 10 s jusqu'à la fin (au plus 30 min)
        const started = Date.now();
        const follow = async () => {
          const h = await loadHost();
          const done = h && !h.containersPending && h.containers && !h.containers.running && Date.parse(h.containers.at) >= started - 5000;
          if (done) {
            toast(h!.containers!.ok ? `Conteneurs à jour${h!.containers!.updated.length ? ` : ${h!.containers!.updated.join(', ')}` : ' (rien de nouveau)'}` : 'Mise à jour des conteneurs : erreur, voir le détail', h!.containers!.ok ? 'ok' : 'error');
          } else if (Date.now() - started < 30 * 60_000) setTimeout(follow, 10_000);
        };
        setTimeout(follow, 10_000);
      }
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
      { text: ASK[a].ok, style: a === 'scan' || a === 'intro' ? 'default' : 'destructive', onPress: () => run(a) },
    ]);

  return (
    <Section title="Serveur">
      <Text style={styles.help}>Actions réservées à l’admin.</Text>
      <View style={{ gap: 10 }}>
        <Button title="Scanner les bibliothèques" icon="refresh" variant="secondary" loading={busy === 'scan'} onPress={() => confirm('scan')} />
        {refresh?.active ? (
          <View style={styles.progressBox}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>Jellyfin actualise les bibliothèques</Text>
              <Text style={styles.progressPct}>{refresh.progress} %</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${refresh.progress}%` }]} />
            </View>
            {refresh.libraries
              .filter((l) => l.active)
              .map((l) => (
                <Text key={l.name} style={[styles.help, { marginBottom: 0 }]}>
                  {l.name} : {l.progress} %
                </Text>
              ))}
          </View>
        ) : null}
        <Button
          title={intro?.installed ? `Intro Skipper installé${intro.version ? ` (${intro.version})` : ''} · relancer l’analyse` : 'Installer Intro Skipper (passer l’intro)'}
          icon="play-skip-forward-outline"
          variant="secondary"
          loading={busy === 'intro'}
          onPress={() => confirm('intro')}
        />
        <Button title="Redémarrer Jellyfin" icon="reload-circle-outline" variant="secondary" loading={busy === 'jellyfin'} onPress={() => confirm('jellyfin')} />
        <Button title="Mettre à jour le serveur Lumio" icon="cloud-download-outline" variant="secondary" loading={busy === 'update'} onPress={() => confirm('update')} />
        <Button
          title={host?.containersPending || host?.containers?.running ? 'Mise à jour des conteneurs en cours…' : 'Mettre à jour les conteneurs'}
          icon="layers-outline"
          variant="secondary"
          loading={busy === 'containers'}
          disabled={Boolean(host?.containersPending || host?.containers?.running)}
          onPress={() => confirm('containers')}
        />
        {host && !host.containersHelper ? (
          <Text style={[styles.help, { marginBottom: 0 }]}>
            Pour ce bouton, relance une fois sur le serveur : sudo sh /data/lumio-server/host/install-host-actions.sh
          </Text>
        ) : host?.containers && !host.containers.running ? (
          <Text style={[styles.help, { marginBottom: 0, color: host.containers.ok ? C.textDim : C.danger }]} numberOfLines={3}>
            Dernière mise à jour des conteneurs : {new Date(host.containers.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {host.containers.ok ? (host.containers.updated.length ? ` · mis à jour : ${host.containers.updated.join(', ')}` : ' · rien de nouveau') : ` · erreur : ${host.containers.tail.split('\n').slice(-2).join(' ')}`}
          </Text>
        ) : null}
        <Button title="Redémarrer le PC serveur" icon="power" variant="danger" loading={busy === 'reboot'} onPress={() => confirm('reboot')} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  progressBox: { backgroundColor: C.surface, borderRadius: 14, padding: 14, gap: 8 },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressTitle: { color: C.text, fontSize: 14, fontWeight: '700', flex: 1 },
  progressPct: { color: C.accent, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surfaceHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.accent },
});
