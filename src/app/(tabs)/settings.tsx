import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';

import { Picker, Toggle } from '@/components/arr-section';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, ScreenTitle, Section } from '@/components/ui';
import { ADDONS_ENABLED } from '@/constants/features';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { AppVersionSection } from '@/components/app-version';
import { ConnectTvButton } from '@/components/connect-tv';
import { NowPlayingEntry } from '@/components/now-playing-entry';
import { useAppUpdate } from '@/lib/app-update';
import { ChatSection, ThemeSection } from '@/components/extra-sections';
import { ServerStatusSection, SimpleServerDot } from '@/components/server-status';
import { UptimeSection } from '@/components/uptime';
import { DEFAULT_TV_SCALE, TV_SCALES } from '@/lib/tv-ui';
import { AnnouncementEditor } from '@/components/announcement';
import { NotifySubscribeSection } from '@/components/notify-subscribe';
import { Addon, DEFAULT_ADDON, isManager, useSettings } from '@/lib/settings';
import { RATING_SOURCES } from '@/lib/better-posters';
import { logout as logoutJellyfin, QUALITIES } from '@/lib/jellyfin';
import { useServerRequests } from '@/lib/requests';
import { tmdb as tmdbApi } from '@/lib/tmdb';
import {
  catalogKey,
  fetchManifest,
  hasResource,
  isBrowsable,
  resolveAddon,
  type StremioManifest,
} from '@/lib/stremio';

function AddonCard({ addon, onChange, onRemove }: { addon: Addon; onChange: (a: Addon) => void; onRemove: () => void }) {
  const [manifest, setManifest] = useState<StremioManifest | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest(addon.base)
      .then(setManifest)
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [addon.base]);

  const catalogs = (manifest?.catalogs ?? []).filter(isBrowsable);
  const hidden = new Set(addon.hidden ?? []);

  return (
    <View style={styles.addon}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.addonHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.addonName}>{addon.name}</Text>
          <Text style={styles.addonUrl} numberOfLines={1}>
            {err
              ? `Erreur : ${err}`
              : [
                  catalogs.length
                    ? `${catalogs.length - [...hidden].filter((h) => catalogs.some((c) => catalogKey(c) === h)).length}/${catalogs.length} catalogues`
                    : null,
                  manifest && hasResource(manifest, 'stream') ? 'Streams' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '…'}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.textDim} />
      </Pressable>
      {open && (
        <View style={{ marginTop: 10, gap: 4 }}>
          {catalogs.map((c) => {
            const k = catalogKey(c);
            return (
              <View key={k} style={styles.catRow}>
                <Text style={styles.catName} numberOfLines={1}>
                  {c.name || c.id} <Text style={styles.addonUrl}>({c.type})</Text>
                </Text>
                <Switch
                  value={!hidden.has(k)}
                  trackColor={{ true: C.success, false: C.border }}
                  onValueChange={(v) => {
                    const next = new Set(hidden);
                    if (v) next.delete(k);
                    else next.add(k);
                    onChange({ ...addon, hidden: [...next] });
                  }}
                />
              </View>
            );
          })}
          <Text style={[styles.addonUrl, { marginTop: 6 }]} selectable>
            {addon.base}
          </Text>
          <Button title="Retirer l'addon" icon="trash-outline" variant="danger" onPress={onRemove} style={{ marginTop: 8 }} />
        </View>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const manager = isManager(settings);
  const serverReq = useServerRequests();
  const appUpdate = useAppUpdate();

  // Radarr / Sonarr sont configurés uniquement sur le serveur Lumio (docker-compose) :
  // on efface les anciennes clés qui seraient restées sur le téléphone
  useEffect(() => {
    if (settings.radarr.apiKey || settings.sonarr.apiKey)
      update({ radarr: { ...settings.radarr, url: '', apiKey: '' }, sonarr: { ...settings.sonarr, url: '', apiKey: '' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tmdb, setTmdb] = useState(settings.tmdbKey);
  const [testing, setTesting] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [adding, setAdding] = useState(false);

  async function saveTmdb() {
    const key = tmdb.trim();
    setTesting(true);
    try {
      await tmdbApi.trending({ ...settings, tmdbKey: key });
      await update({ tmdbKey: key });
      Alert.alert('TMDB OK ✅', 'La clé fonctionne.');
    } catch (e: any) {
      Alert.alert('Clé TMDB refusée', e?.message ?? String(e));
    } finally {
      setTesting(false);
    }
  }

  async function addAddon() {
    if (!addonUrl.trim()) return;
    setAdding(true);
    try {
      const { base, manifest: m } = await resolveAddon(addonUrl);
      if (settings.addons.some((a) => a.base === base)) {
        Alert.alert('Déjà ajouté', 'Cet addon est déjà dans ta liste.');
        return;
      }
      const browsable = (m.catalogs ?? []).filter(isBrowsable);
      const streams = hasResource(m, 'stream');
      if (browsable.length === 0 && !streams) {
        Alert.alert('Addon non pris en charge', `« ${m.name} » ne propose ni catalogue ni stream.`);
        return;
      }
      await update({ addons: [...settings.addons, { base, name: m.name }] });
      setAddonUrl('');
      Alert.alert(
        'Addon ajouté',
        [browsable.length ? `${browsable.length} catalogue(s) sur l'accueil` : null, null]
          .filter(Boolean)
          .join(' · ')
      );
    } catch (e: any) {
      Alert.alert('Addon introuvable', `Impossible de lire le manifest (${e?.message ?? e}).`);
    } finally {
      setAdding(false);
    }
  }

  function moveAddon(i: number, dir: -1 | 1) {
    const list = [...settings.addons];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ addons: list });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE }} keyboardShouldPersistTaps="handled">
        <View style={{ marginHorizontal: -16 }}>
          <ScreenTitle title="Profil" />
        </View>
        {appUpdate ? <AppVersionSection /> : null}
        {Platform.isTV ? null : <NowPlayingEntry />}
        {Platform.isTV ? null : settings.jellyfin?.isAdmin && settings.chatUrl ? <UptimeSection /> : isManager(settings) ? <ServerStatusSection /> : <SimpleServerDot />}
        <Section title="Jellyfin">
          {settings.jellyfin ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{settings.jellyfin.userName.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addonName}>{settings.jellyfin.userName}</Text>
                  <Text style={styles.addonUrl} numberOfLines={1}>
                    {settings.jellyfin.isAdmin === false ? 'Utilisateur' : 'Administrateur'}
                    {settings.jellyfin.serverName ? ` · ${settings.jellyfin.serverName}` : ''}
                  </Text>
                </View>
              </View>
              <ConnectTvButton />
              <Button
                title="Se déconnecter"
                icon="log-out-outline"
                variant="danger"
                onPress={async () => {
                  await logoutJellyfin(settings);
                  await update({ jellyfin: null, skipJellyfin: false });
                  router.replace('/login');
                }}
              />
            </View>
          ) : (
            <Button title="Se connecter à Jellyfin" icon="log-in-outline" onPress={() => router.push('/login')} />
          )}
        </Section>

        <ChatSection />

        {serverReq && !Platform.isTV ? <NotifySubscribeSection /> : null}
        {serverReq && settings.jellyfin?.isAdmin !== false && !Platform.isTV ? <AnnouncementEditor /> : null}

        {serverReq && settings.jellyfin?.isAdmin !== false ? (
          <Section title="Demandes">
            <Text style={styles.help}>Notifications push des demandes, validation automatique ou par toi, quotas de films et de saisons.</Text>
            <Button title="Utilisateurs, droits et notifications" icon="people-outline" variant="secondary" onPress={() => router.push('/users')} />
          </Section>
        ) : null}

        {serverReq ? (
          <Section title="Idées & signalements">
            <Text style={styles.help}>
              Propose une idée ou signale un bug. L’admin la reçoit en notification et peut la faire développer par Claude.
            </Text>
            <Button title="Idées & signalements" icon="bulb-outline" variant="secondary" onPress={() => router.push('/ideas')} />
          </Section>
        ) : null}


        <ThemeSection />

        {Platform.isTV ? (
          <Section title="Télévision">
            <Picker
              label="Taille de l’interface"
              options={TV_SCALES.map((o) => ({ value: o.value, label: o.label }))}
              value={settings.tvScale ?? DEFAULT_TV_SCALE}
              onChange={(v) => update({ tvScale: v })}
            />
            <Toggle label="Sons de navigation (comme sur Apple TV)" value={settings.tvSounds !== false} onChange={(v) => update({ tvSounds: v })} />
          </Section>
        ) : null}

        <Section title="Lecture">
          <Picker
            label="Lecteur vidéo"
            options={[
              { value: 'mpv', label: 'mpv (recommandé)', hint: 'lit tout, MKV inclus' },
              { value: 'native', label: 'Natif', hint: 'AirPlay' },
            ]}
            value={settings.player}
            onChange={(v) => update({ player: v as 'mpv' | 'native' })}
          />
          <Picker
            label="Qualité par défaut (Jellyfin)"
            options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
            value={settings.quality || 'original'}
            onChange={(v) => update({ quality: String(v) })}
          />
          <Toggle label="Enchaîner l'épisode suivant" value={settings.autoNext} onChange={(v) => update({ autoNext: v })} />
        </Section>

        <Section title="Personnalisation">
          <Button title="Accueil et onglets" icon="options-outline" variant="secondary" onPress={() => router.push('/customize')} />
        </Section>

        <Section title="Affiches">
          <Toggle
            label="Better Posters (note et tags sur les affiches)"
            value={settings.betterPosters.enabled}
            onChange={(v) => update({ betterPosters: { ...settings.betterPosters, enabled: v } })}
          />
          {settings.betterPosters.enabled && (
            <>
              <Toggle
                label="Afficher la note"
                value={settings.betterPosters.rating}
                onChange={(v) => update({ betterPosters: { ...settings.betterPosters, rating: v } })}
              />
              <Toggle
                label="Afficher le genre"
                value={settings.betterPosters.genre}
                onChange={(v) => update({ betterPosters: { ...settings.betterPosters, genre: v } })}
              />
              {settings.betterPosters.rating && (
                <View style={{ marginTop: 8 }}>
                  <Picker
                    label="Source de la note"
                    options={RATING_SOURCES}
                    value={settings.betterPosters.ratingSource}
                    onChange={(v) => update({ betterPosters: { ...settings.betterPosters, ratingSource: v } })}
                  />
                </View>
              )}
            </>
          )}
        </Section>

        <Section title="TMDB">
          <Field
            label="Clé API"
            value={tmdb}
            onChangeText={setTmdb}
            placeholder="Clé v3 ou jeton de lecture v4"
            secureTextEntry
            hint="Gratuite sur themoviedb.org → Paramètres → API. Sert à la recherche, aux fiches et à relier les catalogues Stremio."
          />
          <Button title="Enregistrer et tester" icon="flash-outline" onPress={saveTmdb} loading={testing} disabled={!tmdb.trim()} />
        </Section>

        <Section title="Accueil">
          <View style={styles.catRow}>
            <Text style={styles.catName}>Ligne « Tendances » TMDB</Text>
            <Switch
              value={settings.showTrending}
              trackColor={{ true: C.success, false: C.border }}
              onValueChange={(v) => update({ showTrending: v })}
            />
          </View>
        </Section>

        {ADDONS_ENABLED ? (
        <Section title="Addons Stremio">
          <Text style={styles.help}>
            Colle l'URL du manifest d'un addon de catalogue (stremio://… ou https://…/manifest.json). Ses catalogues
            apparaissent en lignes sur l'accueil.
          </Text>
          <Field label="URL de l'addon" value={addonUrl} onChangeText={setAddonUrl} placeholder="https://…/manifest.json" keyboardType="url" />
          <Button title="Ajouter" icon="add" onPress={addAddon} loading={adding} disabled={!addonUrl.trim()} />

          <View style={{ marginTop: 16, gap: 10 }}>
            {settings.addons.map((a, i) => (
              <View key={a.base} style={{ flexDirection: 'row', gap: 8 }}>
                <View style={styles.order}>
                  <Pressable onPress={() => moveAddon(i, -1)} hitSlop={6}>
                    <Ionicons name="chevron-up" size={18} color={i === 0 ? C.border : C.textDim} />
                  </Pressable>
                  <Pressable onPress={() => moveAddon(i, 1)} hitSlop={6}>
                    <Ionicons name="chevron-down" size={18} color={i === settings.addons.length - 1 ? C.border : C.textDim} />
                  </Pressable>
                </View>
                <View style={{ flex: 1 }}>
                  <AddonCard
                    addon={a}
                    onChange={(next) => update({ addons: settings.addons.map((x) => (x.base === a.base ? next : x)) })}
                    onRemove={() => update({ addons: settings.addons.filter((x) => x.base !== a.base) })}
                  />
                </View>
              </View>
            ))}
            {!settings.addons.some((a) => a.base === DEFAULT_ADDON.base) && (
              <Button title="Ajouter Cinemeta (catalogue officiel)" variant="secondary" icon="sparkles-outline" onPress={() => update({ addons: [...settings.addons, DEFAULT_ADDON] })} />
            )}
          </View>
        </Section>
        ) : null}

        {!appUpdate ? <AppVersionSection /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  addon: { backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 14 },
  addonHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addonName: { color: C.text, fontSize: 15, fontWeight: '700' },
  addonUrl: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  catName: { color: C.text, fontSize: 14, flex: 1 },
  order: { justifyContent: 'center', gap: 6 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#000', fontSize: 18, fontWeight: '800' },
});
