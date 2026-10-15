import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Field, Section } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { arr, formatBytes, invalidateLibrary, type QualityProfile, type RootFolder } from '@/lib/arr';
import type { ArrConfig } from '@/lib/settings';

type Option<T> = { value: T; label: string; hint?: string };

export function Picker<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value?: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              style={[styles.chip, on && { borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.06)' }]}>
              {on && <Ionicons name="checkmark" size={14} color={C.text} />}
              <Text style={[styles.chipText, on && { color: C.text }]}>{o.label}</Text>
              {o.hint ? <Text style={styles.chipHint}>{o.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.success, false: C.border }} />
    </View>
  );
}

/**
 * Bloc de configuration commun Radarr / Sonarr :
 * URL + clé → « Connecter » récupère profils et dossiers, puis choix.
 */
export function ArrSection<T extends ArrConfig>({
  title,
  placeholder,
  config,
  onSave,
  withLanguageProfile,
  children,
}: {
  title: string;
  placeholder: string;
  config: T;
  onSave: (c: T) => Promise<void>;
  withLanguageProfile?: boolean;
  children?: React.ReactNode;
}) {
  const [url, setUrl] = useState(config.url);
  const [key, setKey] = useState(config.apiKey);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [folders, setFolders] = useState<RootFolder[]>([]);

  async function connect(draft: ArrConfig, silent = false) {
    setBusy(true);
    try {
      const [st, qp, rf, lp] = await Promise.all([
        arr.status(draft),
        arr.qualityProfiles(draft),
        arr.rootFolders(draft),
        withLanguageProfile ? arr.languageProfiles(draft) : Promise.resolve([] as QualityProfile[]),
      ]);
      setVersion(st.version);
      setProfiles(qp);
      setFolders(rf);
      // Pré-sélection : on garde le choix existant s'il est encore valide, sinon le premier
      const next = {
        ...config,
        url: draft.url,
        apiKey: draft.apiKey,
        qualityProfileId: qp.some((p) => p.id === config.qualityProfileId) ? config.qualityProfileId : qp[0]?.id,
        rootFolderPath: rf.some((f) => f.path === config.rootFolderPath) ? config.rootFolderPath : rf[0]?.path,
        languageProfileId: lp.length ? (lp.some((p) => p.id === config.languageProfileId) ? config.languageProfileId : lp[0].id) : undefined,
      };
      await onSave(next);
      invalidateLibrary();
    } catch (e: any) {
      setVersion(null);
      if (!silent) Alert.alert(`${title} injoignable`, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // Recharge profils/dossiers à l'ouverture si déjà configuré
  useEffect(() => {
    if (config.url && config.apiKey) connect(config, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = version !== null;

  return (
    <Section title={title}>
      {connected && (
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: C.success }]} />
          <Text style={styles.statusText}>Connecté · v{version}</Text>
        </View>
      )}
      <Field label="URL" value={url} onChangeText={setUrl} placeholder={placeholder} keyboardType="url" />
      <Field label="Clé API" value={key} onChangeText={setKey} placeholder="Paramètres → Général → Sécurité" secureTextEntry />
      <Button
        title={connected ? 'Reconnecter' : 'Connecter'}
        icon="flash-outline"
        variant={connected ? 'secondary' : 'primary'}
        loading={busy}
        disabled={!url.trim() || !key.trim()}
        onPress={() => {
          const clean = url.trim().replace(/\/+$/, '');
          setUrl(clean);
          connect({ ...config, url: clean, apiKey: key.trim() });
        }}
        style={{ marginBottom: connected ? 18 : 0 }}
      />

      {connected && (
        <>
          <Picker
            label="Profil de qualité"
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            value={config.qualityProfileId}
            onChange={(v) => onSave({ ...config, qualityProfileId: v })}
          />
          <Picker
            label="Dossier racine"
            options={folders.map((f) => ({ value: f.path, label: f.path, hint: f.freeSpace ? `${formatBytes(f.freeSpace)} libres` : undefined }))}
            value={config.rootFolderPath}
            onChange={(v) => onSave({ ...config, rootFolderPath: v })}
          />
          <Toggle label="Lancer la recherche dès l'ajout" value={config.searchOnAdd} onChange={(v) => onSave({ ...config, searchOnAdd: v })} />
          {children}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { color: C.textDim, fontSize: 14, fontWeight: '600' },
  chipHint: { color: C.textFaint, fontSize: 12 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 6 },
  toggleLabel: { color: C.text, fontSize: 14, flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: C.success, fontSize: 13, fontWeight: '600' },
});
