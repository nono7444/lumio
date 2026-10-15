import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Button, Field, Section } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { seerr } from '@/lib/seerr';
import { Addon, DEFAULT_ADDON, useSettings } from '@/lib/settings';
import {
  catalogKey,
  fetchManifest,
  isBrowsable,
  normalizeAddonUrl,
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
            {err ? `Erreur : ${err}` : `${catalogs.length - [...hidden].filter((h) => catalogs.some((c) => catalogKey(c) === h)).length}/${catalogs.length} catalogues affichés`}
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
                  trackColor={{ true: C.accent, false: C.border }}
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
  const [url, setUrl] = useState(settings.seerrUrl);
  const [key, setKey] = useState(settings.seerrApiKey);
  const [tmdb, setTmdb] = useState(settings.tmdbKey);
  const [testing, setTesting] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const dirty = url !== settings.seerrUrl || key !== settings.seerrApiKey || tmdb !== settings.tmdbKey;

  async function saveAndTest() {
    const seerrUrl = url.trim().replace(/\/+$/, '');
    setUrl(seerrUrl);
    await update({ seerrUrl, seerrApiKey: key.trim(), tmdbKey: tmdb.trim() });
    setTesting(true);
    try {
      const st = await seerr.status({ ...settings, seerrUrl, seerrApiKey: key.trim() });
      // /status est public : on vérifie aussi que la clé API est acceptée
      await seerr.requests({ ...settings, seerrUrl, seerrApiKey: key.trim() }, 1);
      Alert.alert('Connecté ✅', `Seerr v${st.version}`);
    } catch (e: any) {
      Alert.alert('Échec de connexion', e?.message ?? String(e));
    } finally {
      setTesting(false);
    }
  }

  async function addAddon() {
    if (!addonUrl.trim()) return;
    const base = normalizeAddonUrl(addonUrl);
    if (settings.addons.some((a) => a.base === base)) {
      Alert.alert('Déjà ajouté', 'Cet addon est déjà dans ta liste.');
      return;
    }
    setAdding(true);
    try {
      const m = await fetchManifest(base);
      const browsable = (m.catalogs ?? []).filter(isBrowsable);
      if (browsable.length === 0) {
        Alert.alert('Aucun catalogue', `« ${m.name} » ne propose pas de catalogue affichable sur l'accueil.`);
        return;
      }
      await update({ addons: [...settings.addons, { base, name: m.name }] });
      setAddonUrl('');
    } catch (e: any) {
      Alert.alert('Addon invalide', `Impossible de lire le manifest : ${e?.message ?? e}`);
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
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Section title="Serveur Seerr">
          <Field label="URL" value={url} onChangeText={setUrl} placeholder="https://seerr.mondomaine.fr" keyboardType="url" />
          <Field
            label="Clé API"
            value={key}
            onChangeText={setKey}
            placeholder="Seerr → Paramètres → Général"
            secureTextEntry
          />
          <Field
            label="Clé TMDB (optionnel)"
            value={tmdb}
            onChangeText={setTmdb}
            placeholder="Clé v3 ou jeton v4"
            secureTextEntry
            hint="Sert à relier les catalogues Stremio (IMDb) aux fiches Seerr. Sans clé, l'appli cherche par titre et année."
          />
          <Button title={dirty ? 'Enregistrer et tester' : 'Tester la connexion'} icon="flash-outline" onPress={saveAndTest} loading={testing} />
        </Section>

        <Section title="Accueil">
          <View style={styles.catRow}>
            <Text style={styles.catName}>Ligne « Tendances » de Seerr</Text>
            <Switch
              value={settings.showTrending}
              trackColor={{ true: C.accent, false: C.border }}
              onValueChange={(v) => update({ showTrending: v })}
            />
          </View>
        </Section>

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

        <Text style={styles.version}>Lumio · v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  help: { color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  addon: { backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: C.border },
  addonHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addonName: { color: C.text, fontSize: 15, fontWeight: '700' },
  addonUrl: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  catName: { color: C.text, fontSize: 14, flex: 1 },
  order: { justifyContent: 'center', gap: 6 },
  version: { color: C.textFaint, textAlign: 'center', fontSize: 12, marginTop: 10 },
});
