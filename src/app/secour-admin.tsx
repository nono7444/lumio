// Administration → Lumio Secour : groupe de secours (relais de Radarr / Sonarr), AllDebrid, sources et réglages du moteur.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  CATEGORY_FR,
  FIELD_FR,
  secourAdminApi,
  secourApi,
  type AlldebridStatus,
  type SecourCategory,
  type SecourField,
  type SecourAuto,
  type SecourHealth,
  type SecourStatus,
  type SecourTarget,
} from '@/lib/secour';
import { useSettings } from '@/lib/settings';

const STATUS_COLOR: Record<string, string> = { online: C.success, offline: C.danger, unconfigured: C.textFaint, unknown: C.warning };
const STATUS_FR: Record<string, string> = { online: 'En ligne', offline: 'Hors ligne', unconfigured: 'Non configurée', unknown: 'Pas encore vérifiée' };

const RESULT_FR: Record<string, string> = {
  env_locked: 'fixé dans le docker-compose',
  invalid_value: 'valeur invalide',
  not_editable: 'non modifiable',
  error: 'erreur d’enregistrement',
};

/** Valeur d'un réglage → texte éditable. */
function toText(f: SecourField): string {
  if (f.sensitive) return '';
  if (Array.isArray(f.value)) return f.value.join('\n');
  return f.value == null ? '' : String(f.value);
}

/** Texte saisi → valeur attendue par le fork (nombre, liste…). */
function fromText(f: SecourField, text: string): unknown {
  if (f.kind === 'int') return Number(text.trim());
  if (f.kind === 'list') return text.split('\n').map((x) => x.trim()).filter(Boolean);
  return text.trim();
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export default function SecourAdmin() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const admin = settings.jellyfin?.isAdmin === true;

  const [status, setStatus] = useState<SecourStatus | null>(null);
  const [auto, setAuto] = useState<SecourAuto | null>(null);
  const [ad, setAd] = useState<AlldebridStatus | null>(null);
  const [health, setHealth] = useState<SecourHealth | null>(null);
  const [cats, setCats] = useState<SecourCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);

  // Connexion au fork
  const [url, setUrl] = useState('http://lumio-secour:7000');
  const [key, setKey] = useState('');
  // AllDebrid
  const [adKey, setAdKey] = useState('');
  // Réglages : brouillons (clé → texte ou booléen), rubriques ouvertes, avancés
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const [open, setOpen] = useState<Set<string>>(new Set(['Sources', 'TMDB']));
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const st = await secourApi.status(settings).catch((e) => {
      setError(e?.message ?? String(e));
      return null;
    });
    setStatus(st);
    setAuto(st?.auto ?? null);
    if (st?.url) setUrl(st.url);
    secourAdminApi.alldebrid(settings).then(setAd).catch(() => setAd(null));
    if (st?.configured && st.online) {
      secourAdminApi.health(settings).then(setHealth).catch(() => setHealth(null));
      secourAdminApi
        .settings(settings)
        .then((c) => {
          setCats(c);
          setDrafts({});
        })
        .catch((e) => setError(e?.message ?? String(e)));
    } else {
      setHealth(null);
      setCats(null);
    }
  }, [settings]);

  useEffect(() => {
    if (admin && settings.chatUrl) load();
  }, [admin, settings.chatUrl, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const saveConnection = async () => {
    try {
      await secourApi.configure(settings, url.trim(), key.trim() || undefined);
      setKey('');
      toast('Connexion à Lumio Secour enregistrée');
      load();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  const saveAdKey = async (value: string) => {
    try {
      await secourAdminApi.setAlldebridKey(settings, value);
      setAdKey('');
      toast(value ? 'Clé AllDebrid enregistrée sur le serveur' : 'Clé AllDebrid retirée');
      secourAdminApi.alldebrid(settings).then(setAd).catch(() => {});
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  const saveAuto = async (body: Partial<{ enabled: boolean; force: boolean; movie: SecourTarget; tv: SecourTarget }>) => {
    try {
      setAuto(await secourAdminApi.saveAuto(settings, body));
      toast('Groupe de secours enregistré');
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  const checkSources = async () => {
    setChecking(true);
    try {
      setHealth(await secourAdminApi.health(settings, true));
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setChecking(false);
    }
  };

  const fields = useMemo(() => new Map((cats ?? []).flatMap((c) => c.fields.map((f) => [f.key, f] as const))), [cats]);
  const changed = Object.keys(drafts).filter((k) => {
    const f = fields.get(k);
    if (!f) return false;
    const d = drafts[k];
    if (f.kind === 'bool') return d !== Boolean(f.value);
    if (f.sensitive) return String(d).trim() !== '';
    return String(d) !== toText(f);
  });

  const saveSettings = async () => {
    const updates: Record<string, unknown> = {};
    for (const k of changed) {
      const f = fields.get(k)!;
      const d = drafts[k];
      updates[k] = f.kind === 'bool' ? Boolean(d) : fromText(f, String(d));
      if (f.kind === 'int' && !Number.isFinite(updates[k] as number)) return toast(`${FIELD_FR[k]?.label ?? k} : nombre attendu`, 'error');
    }
    setSaving(true);
    try {
      const r = await secourAdminApi.saveSettings(settings, updates);
      const failed = Object.entries(r.results).filter(([, v]) => v !== 'ok' && v !== 'skipped');
      if (failed.length) Alert.alert('Certains réglages n’ont pas été enregistrés', failed.map(([k, v]) => `${FIELD_FR[k]?.label ?? k} : ${RESULT_FR[v] ?? v}`).join('\n'));
      else toast(`${changed.length} réglage${changed.length > 1 ? 's' : ''} enregistré${changed.length > 1 ? 's' : ''}`);
      load();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = (f: SecourField) => {
    Alert.alert('Remettre la valeur d’origine ?', FIELD_FR[f.key]?.label ?? f.key, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Remettre',
        style: 'destructive',
        onPress: () =>
          secourAdminApi
            .resetSetting(settings, f.key)
            .then(() => {
              toast('Valeur d’origine remise');
              load();
            })
            .catch((e) => toast(e?.message ?? String(e), 'error')),
      },
    ]);
  };

  if (!admin || !settings.chatUrl) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.dim}>Réservé à l’admin, avec le serveur Lumio configuré (Profil → Serveur Lumio).</Text>
      </View>
    );
  }

  const online = status?.configured && status.online;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 40 + insets.bottom, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} />}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }} accessibilityLabel="Retour">
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={{ color: C.accent, fontSize: 15, fontWeight: '600' }}>Profil</Text>
        </Pressable>
        <ScreenTitle
          title="Lumio Secour"
          right={
            <View style={[styles.pill, { backgroundColor: online ? 'rgba(48,209,88,0.15)' : 'rgba(255,69,58,0.15)' }]}>
              <View style={[styles.dot, { backgroundColor: status === null ? C.textFaint : online ? C.success : C.danger }]} />
              <Text style={styles.pillText}>{status === null ? '…' : online ? `En ligne · ${status.version}` : status.configured ? 'Hors ligne' : 'À configurer'}</Text>
            </View>
          }
        />
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}

        {/* ——— Groupe de secours ——— */}
        {auto ? <AutoCard auto={auto} onSave={saveAuto} /> : null}

        {/* ——— Moteur ——— */}
        {status?.embedded ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Moteur</Text>
            <Text style={styles.dim}>
              {online ? 'Intégré au serveur Lumio' : 'Intégré au serveur Lumio, pas encore prêt'}
              {status.sources?.length ? ` · sources : ${status.sources.join(', ')}` : ' · aucune source : renseigne-les dans Réglages → Sources'}
              {status.tmdb ? ' · TMDB ✓' : ' · TMDB manquant'}
            </Text>
            {status.error ? <Text style={[styles.dim, { color: C.danger }]}>{status.error}</Text> : null}
          </View>
        ) : null}

        {/* ——— Connexion au fork (service à part) ——— */}
        {status?.embedded ? null : <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion</Text>
          {status?.error ? <Text style={[styles.dim, { color: C.danger }]}>{status.error}</Text> : null}
          <Text style={styles.label}>Adresse (vue par le serveur Lumio)</Text>
          {status?.fromEnv ? (
            <Text style={styles.dim}>
              {status.url} · <Ionicons name="lock-closed" size={11} color={C.textDim} /> fixée dans le docker-compose
            </Text>
          ) : (
            <TextInput value={url} onChangeText={setUrl} placeholder="http://lumio-secour:7000" placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} style={styles.input} />
          )}
          <Text style={styles.label}>Clé (LUMIO_API_KEY)</Text>
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder={status?.configured ? '•••••• (inchangée)' : 'Clé de Lumio Secour'}
            placeholderTextColor={C.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
          <Button title="Enregistrer et tester" icon="link-outline" onPress={saveConnection} disabled={!status?.fromEnv && !url.trim()} />
        </View>}

        {/* ——— AllDebrid ——— */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.cardTitle, { flex: 1 }]}>AllDebrid</Text>
            <Pressable onPress={() => router.push('/downloads')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.dim, { color: C.accent }]}>Téléchargements</Text>
              <Ionicons name="chevron-forward" size={14} color={C.accent} />
            </Pressable>
          </View>
          {ad === null ? (
            <ActivityIndicator color={C.text} />
          ) : ad.configured ? (
            ad.account ? (
              <Text style={styles.dim}>
                <Text style={{ color: C.text, fontWeight: '700' }}>{ad.account.username ?? 'Compte'}</Text>
                {ad.account.premium ? (
                  <Text style={{ color: C.success }}> · Premium{ad.account.premiumUntil ? ` jusqu’au ${fmtDate(ad.account.premiumUntil)}` : ''}</Text>
                ) : (
                  <Text style={{ color: C.danger }}> · pas Premium</Text>
                )}
              </Text>
            ) : (
              <Text style={[styles.dim, { color: ad.error ? C.danger : C.textDim }]}>{ad.error ? `Clé enregistrée, mais : ${ad.error}` : 'Clé enregistrée'}</Text>
            )
          ) : (
            <Text style={styles.dim}>Aucune clé : alldebrid.com → Mon compte → Clés API. Elle reste sur le serveur Lumio, jamais sur le téléphone.</Text>
          )}
          {ad?.fromEnv ? (
            <Text style={styles.dim}>
              <Ionicons name="lock-closed" size={11} color={C.textDim} /> Clé fixée dans le docker-compose (ALLDEBRID_KEY).
            </Text>
          ) : (
            <>
              <TextInput
                value={adKey}
                onChangeText={setAdKey}
                placeholder={ad?.configured ? 'Nouvelle clé (remplace l’actuelle)' : 'Clé API AllDebrid'}
                placeholderTextColor={C.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Enregistrer" icon="key-outline" onPress={() => saveAdKey(adKey.trim())} disabled={!adKey.trim()} style={{ flex: 1 }} />
                {ad?.configured ? (
                  <Button
                    title="Retirer"
                    variant="danger"
                    onPress={() =>
                      Alert.alert('Retirer la clé AllDebrid ?', 'Les liens ne pourront plus être téléchargés.', [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Retirer', style: 'destructive', onPress: () => saveAdKey('') },
                      ])
                    }
                  />
                ) : null}
              </View>
            </>
          )}
        </View>

        {/* ——— Sources ——— */}
        {online ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[styles.cardTitle, { flex: 1 }]}>État des sources</Text>
              <Pressable onPress={checkSources} hitSlop={10} style={styles.round} accessibilityLabel="Vérifier les sources" disabled={checking}>
                {checking ? <ActivityIndicator size="small" color={C.text} /> : <Ionicons name="pulse" size={17} color={C.text} />}
              </Pressable>
            </View>
            {health ? (
              <>
                <Text style={styles.dim}>
                  {health.summary.online} en ligne · {health.summary.offline} hors ligne · {health.summary.unconfigured} non configurée{health.summary.unconfigured > 1 ? 's' : ''}
                </Text>
                {health.sources.map((s) => (
                  <View key={s.name} style={styles.sourceRow}>
                    <View style={[styles.dot, { backgroundColor: STATUS_COLOR[s.status] ?? C.textFaint }]} />
                    <Text style={[styles.dim, { flex: 1, color: C.text }]}>{s.name}</Text>
                    <Text style={styles.faint}>
                      {STATUS_FR[s.status] ?? s.status}
                      {s.response_time != null && s.status === 'online' ? ` · ${s.response_time} ms` : ''}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <ActivityIndicator color={C.text} />
            )}
          </View>
        ) : null}

        {/* ——— Réglages du fork ——— */}
        {online ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <Text style={[styles.cardTitle, { flex: 1 }]}>Réglages</Text>
              <Text style={styles.faint}>Avancés</Text>
              <Switch value={advanced} onValueChange={setAdvanced} trackColor={{ true: C.success, false: C.border }} />
            </View>
            <Text style={styles.faint}>
              Une valeur avec un cadenas est fixée dans le docker-compose de Lumio Secour : retire-la du compose pour la régler ici.
            </Text>
            {cats === null ? <ActivityIndicator color={C.text} /> : null}
            {(cats ?? []).map((c) => {
              const list = c.fields.filter((f) => advanced || !f.advanced);
              if (!list.length) return null;
              const isOpen = open.has(c.category);
              const nChanged = list.filter((f) => changed.includes(f.key)).length;
              return (
                <View key={c.category} style={styles.card}>
                  <Pressable
                    onPress={() => {
                      tap();
                      setOpen((o) => {
                        const n = new Set(o);
                        if (n.has(c.category)) n.delete(c.category);
                        else n.add(c.category);
                        return n;
                      });
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.cardTitle, { flex: 1, fontSize: 15 }]}>{CATEGORY_FR[c.category] ?? c.category}</Text>
                    {nChanged ? <Text style={[styles.faint, { color: C.warning }]}>{nChanged} modifié{nChanged > 1 ? 's' : ''}</Text> : null}
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.textDim} />
                  </Pressable>
                  {isOpen ? list.map((f) => <FieldRow key={f.key} f={f} draft={drafts[f.key]} onChange={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))} onReset={() => reset(f)} />) : null}
                </View>
              );
            })}
            {cats ? (
              <Button
                title={changed.length ? `Enregistrer ${changed.length} modification${changed.length > 1 ? 's' : ''}` : 'Aucune modification'}
                icon="save-outline"
                onPress={saveSettings}
                loading={saving}
                disabled={!changed.length}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Groupe de secours : activé ou non, disque et dossier des films et des séries. */
function AutoCard({ auto, onSave }: { auto: SecourAuto; onSave: (b: Partial<{ enabled: boolean; force: boolean; movie: SecourTarget; tv: SecourTarget }>) => void }) {
  const [movie, setMovie] = useState<SecourTarget>(auto.movie ?? { root: auto.disks[0] ?? '', folder: 'Films' });
  const [tv, setTv] = useState<SecourTarget>(auto.tv ?? { root: auto.disks[0] ?? '', folder: 'Séries' });
  const missing = [!auto.engine && 'moteur hors ligne', !auto.alldebrid && 'clé AllDebrid', !auto.disks.length && 'disques (LUMIO_DISKS)'].filter(Boolean);
  const same = (a: SecourTarget | null, b: SecourTarget) => Boolean(a) && a!.root === b.root && a!.folder === b.folder;
  const dirty = !same(auto.movie, movie) || !same(auto.tv, tv);

  // Fonction (pas un composant) : le champ garde le focus pendant la saisie
  const target = (label: string, value: SecourTarget, onChange: (t: SecourTarget) => void) => (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {auto.disks.map((d) => (
          <SegChip key={d} label={d} on={value.root === d} onPress={() => onChange({ ...value, root: d })} />
        ))}
      </View>
      <TextInput
        value={value.folder}
        onChangeText={(t) => onChange({ ...value, folder: t })}
        placeholder="Dossier sur ce disque"
        placeholderTextColor={C.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="medkit" size={18} color={C.success} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Groupe de secours</Text>
        <Switch value={auto.enabled} onValueChange={(v) => onSave({ enabled: v })} trackColor={{ true: C.success, false: C.border }} />
      </View>
      <Text style={styles.dim}>
        Si Radarr ou Sonarr ne marchent plus, les demandes validées passent par Lumio Secour : meilleur lien (AllDebrid, VF / Multi, 1080p),
        téléchargé sur le disque choisi, puis Jellyfin rescanne. Un fichier à la fois.
      </Text>
      <Text style={[styles.dim, { color: auto.ready ? C.success : auto.enabled ? C.warning : C.textFaint, fontWeight: '700' }]}>
        {!auto.enabled ? 'Désactivé' : auto.ready ? `Prêt${auto.queue ? ` · ${auto.queue} demande${auto.queue > 1 ? 's' : ''} en cours` : ''}` : `Pas prêt : ${missing.join(', ')}`}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { flex: 0 }]}>Simuler une panne de Radarr / Sonarr</Text>
          <Text style={styles.faint}>Pour tester : chaque demande validée passe directement par Lumio Secour. Pense à le couper après.</Text>
        </View>
        <Switch
          value={Boolean(auto.force)}
          onValueChange={(v) =>
            v
              ? Alert.alert('Simuler une panne ?', 'Les prochaines demandes validées (par toi ou en automatique) seront téléchargées par Lumio Secour au lieu de Radarr / Sonarr.', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Simuler', onPress: () => onSave({ force: true }) },
                ])
              : onSave({ force: false })
          }
          trackColor={{ true: C.warning, false: C.border }}
        />
      </View>
      {auto.force ? <Text style={[styles.dim, { color: C.warning, fontWeight: '700' }]}>⚠️ Simulation active : Radarr et Sonarr sont ignorés.</Text> : null}
      {auto.disks.length ? (
        <>
          {target('Films', movie, setMovie)}
          {target('Séries', tv, setTv)}
          <Text style={styles.faint}>Ce dossier doit faire partie d’une bibliothèque Jellyfin (Films ou Séries).</Text>
          <Button title="Enregistrer les dossiers" icon="folder-outline" variant="secondary" onPress={() => onSave({ movie, tv })} disabled={!dirty || !movie.root || !tv.root} />
        </>
      ) : null}
    </View>
  );
}

function FieldRow({ f, draft, onChange, onReset }: { f: SecourField; draft: string | boolean | undefined; onChange: (v: string | boolean) => void; onReset: () => void }) {
  const fr = FIELD_FR[f.key];
  const label = fr?.label ?? f.key;
  const hint = fr?.hint ?? f.description;
  const locked = !f.editable;

  return (
    <View style={styles.field}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {locked ? <Ionicons name="lock-closed" size={12} color={C.textDim} /> : null}
        <Text style={styles.fieldLabel} numberOfLines={2}>
          {label}
        </Text>
        {f.source === 'override' && !locked ? (
          <Pressable onPress={onReset} hitSlop={8} accessibilityLabel="Valeur d’origine">
            <Ionicons name="arrow-undo-outline" size={16} color={C.textDim} />
          </Pressable>
        ) : null}
        {f.kind === 'bool' ? (
          <Switch value={draft !== undefined ? Boolean(draft) : Boolean(f.value)} onValueChange={onChange} disabled={locked} trackColor={{ true: C.success, false: C.border }} />
        ) : null}
      </View>
      {hint ? <Text style={styles.faint}>{hint}</Text> : null}
      {f.kind === 'bool' ? null : f.choices ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {f.choices.map((ch) => (
            <SegChip key={ch} label={ch} on={(draft !== undefined ? draft : f.value) === ch} onPress={() => !locked && onChange(ch)} />
          ))}
        </View>
      ) : (
        <TextInput
          value={draft !== undefined ? String(draft) : toText(f)}
          onChangeText={onChange}
          editable={!locked}
          placeholder={f.sensitive ? (f.is_set ? '•••••• défini (laisser vide pour garder)' : 'Non défini') : f.default != null && f.default !== '' ? `Par défaut : ${Array.isArray(f.default) ? f.default.join(', ') : f.default}` : 'Vide'}
          placeholderTextColor={C.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={f.sensitive}
          keyboardType={f.kind === 'int' ? 'numbers-and-punctuation' : f.key.endsWith('_URL') ? 'url' : 'default'}
          multiline={f.kind === 'list'}
          style={[styles.input, locked && { opacity: 0.5 }, f.kind === 'list' && { minHeight: 70 }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  faint: { color: C.textFaint, fontSize: 11, lineHeight: 15 },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { color: C.text, fontSize: 12, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  field: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  fieldLabel: { flex: 1, color: C.text, fontSize: 14, fontWeight: '600' },
});
