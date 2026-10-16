// Admin : utilisateurs et droits de demande (comme « Utilisateurs » dans Seerr).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { requestsApi, type AdminSettings, type AdminUser } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

function NumberBox({ value, onChange, width = 52 }: { value: number; onChange: (n: number) => void; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onEndEditing={() => onChange(Math.max(0, Number(text) || 0))}
      keyboardType="number-pad"
      style={[styles.num, { width }]}
      selectTextOnFocus
    />
  );
}

/** « 0 film tous les 7 jours » : 0 = illimité */
function QuotaRow({
  label,
  limit,
  days,
  onChange,
}: {
  label: string;
  limit: number;
  days: number;
  onChange: (limit: number, days: number) => void;
}) {
  return (
    <View style={styles.quota}>
      <Text style={styles.qLabel}>{label}</Text>
      <NumberBox value={limit} onChange={(n) => onChange(n, days)} />
      <Text style={styles.qText}>tous les</Text>
      <NumberBox value={days} onChange={(n) => onChange(limit, Math.max(1, n))} />
      <Text style={styles.qText}>jours</Text>
    </View>
  );
}

export default function Users() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [global, setGlobal] = useState<AdminSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    requestsApi
      .users(settings)
      .then((r) => {
        setGlobal(r.settings);
        setUsers(r.users);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings]);

  useEffect(load, [load]);

  async function saveGlobal(patch: Partial<AdminSettings> & { newNtfyTopic?: boolean }) {
    tap();
    try {
      setGlobal(await requestsApi.updateSettings(settings, patch));
      load();
    } catch (e: any) {
      Alert.alert('Enregistrement impossible', e?.message ?? String(e));
    }
  }

  async function saveUser(id: string, patch: Record<string, number | boolean | null>) {
    tap();
    try {
      await requestsApi.updateUser(settings, id, patch);
      load();
    } catch (e: any) {
      Alert.alert('Enregistrement impossible', e?.message ?? String(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title}>Utilisateurs</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }} keyboardShouldPersistTaps="handled">
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
        {!global && !error ? <ActivityIndicator color={C.text} style={{ margin: 30 }} /> : null}

        {global && (
          <>
            <Text style={styles.section}>Notifications push</Text>
            <View style={styles.card}>
              <View style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Me prévenir des demandes</Text>
                  <Text style={styles.dim}>
                    Notification sur ton iPhone pour chaque demande, avec les boutons Valider / Refuser, et quand un titre devient disponible.
                  </Text>
                </View>
                <Switch value={global.ntfyEnabled !== false} onValueChange={(v) => saveGlobal({ ntfyEnabled: v })} trackColor={{ true: C.success, false: C.border }} />
              </View>
              <Text style={styles.dim}>
                1. Installe l’appli gratuite « ntfy » (App Store).{'\n'}2. Dans ntfy, touche « + » et abonne-toi au sujet ci-dessous (serveur {global.ntfyServer?.replace('https://', '')}).
              </Text>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(global.ntfyTopic ?? '');
                  Alert.alert('Sujet copié', 'Colle-le dans ntfy → « + » → Sujet.');
                }}
                style={styles.topic}>
                <Text style={styles.topicText} selectable>
                  {global.ntfyTopic}
                </Text>
                <Ionicons name="copy-outline" size={18} color={C.textDim} />
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() =>
                    Linking.openURL(`ntfy://${(global.ntfyServer ?? 'https://ntfy.sh').replace(/^https?:\/\//, '')}/${global.ntfyTopic}`).catch(() =>
                      Linking.openURL('https://apps.apple.com/app/ntfy/id1625396347')
                    )
                  }
                  style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>Ouvrir ntfy</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    try {
                      await requestsApi.notifyTest(settings);
                      Alert.alert('Envoyée', 'Tu devrais recevoir une notification de test.');
                    } catch (e: any) {
                      Alert.alert('Échec', e?.message ?? String(e));
                    }
                  }}
                  style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>Tester</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert('Nouveau sujet ?', 'L’ancien ne recevra plus rien : il faudra te réabonner dans ntfy.', [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Changer', onPress: () => saveGlobal({ newNtfyTopic: true }) },
                    ])
                  }
                  style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>Changer</Text>
                </Pressable>
              </View>
              {!global.publicUrl ? (
                <Text style={[styles.dim, { color: C.warning }]}>
                  Les boutons Valider / Refuser des notifications ne marcheront qu’une fois l’appli ouverte via l’adresse publique du serveur (ex. https://lumio.wawanono.lol).
                </Text>
              ) : null}
            </View>

            <Text style={[styles.section, { marginTop: 12 }]}>Par défaut</Text>
            <View style={styles.card}>
              <View style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Validation automatique</Text>
                  <Text style={styles.dim}>Les demandes partent directement dans Radarr / Sonarr, sans ton accord.</Text>
                </View>
                <Switch
                  value={global.defaultAutoApprove}
                  onValueChange={(v) => saveGlobal({ defaultAutoApprove: v })}
                  trackColor={{ true: C.success, false: C.border }}
                />
              </View>
              <View style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Voir les demandes des autres</Text>
                  <Text style={styles.dim}>Sinon, chacun ne voit que les siennes (comme Seerr).</Text>
                </View>
                <Switch
                  value={global.usersSeeAllRequests}
                  onValueChange={(v) => saveGlobal({ usersSeeAllRequests: v })}
                  trackColor={{ true: C.success, false: C.border }}
                />
              </View>
              <Text style={[styles.dim, { marginTop: 4 }]}>Quotas (0 = illimité)</Text>
              <QuotaRow
                label="Films"
                limit={global.defaultMovieQuotaLimit}
                days={global.defaultMovieQuotaDays}
                onChange={(l, d) => saveGlobal({ defaultMovieQuotaLimit: l, defaultMovieQuotaDays: d })}
              />
              <QuotaRow
                label="Saisons"
                limit={global.defaultTvQuotaLimit}
                days={global.defaultTvQuotaDays}
                onChange={(l, d) => saveGlobal({ defaultTvQuotaLimit: l, defaultTvQuotaDays: d })}
              />
            </View>

            <Text style={[styles.section, { marginTop: 12 }]}>Comptes Jellyfin</Text>
            {users.map((u) => {
              const isOpen = open === u.id;
              const custom = Object.keys(u.custom).length > 0;
              return (
                <View key={u.id} style={styles.card}>
                  <Pressable
                    onPress={() => {
                      tap();
                      setOpen(isOpen ? null : u.id);
                    }}
                    style={styles.userHead}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{u.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{u.name}</Text>
                      <Text style={styles.dim}>
                        {u.admin ? 'Admin · tous les droits' : u.permissions.autoApprove ? 'Validation automatique' : 'Validation par l’admin'}
                        {` · ${u.requestCount} demande${u.requestCount > 1 ? 's' : ''}`}
                        {custom && !u.admin ? ' · personnalisé' : ''}
                      </Text>
                    </View>
                    {!u.admin && <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.textDim} />}
                  </Pressable>
                  {isOpen && !u.admin && (
                    <View style={{ gap: 10, marginTop: 12 }}>
                      <View style={styles.line}>
                        <Text style={[styles.name, { flex: 1, fontSize: 14 }]}>Validation automatique</Text>
                        <Switch
                          value={u.permissions.autoApprove}
                          onValueChange={(v) => saveUser(u.id, { autoApprove: v })}
                          trackColor={{ true: C.success, false: C.border }}
                        />
                      </View>
                      <QuotaRow
                        label="Films"
                        limit={u.permissions.movieQuotaLimit}
                        days={u.permissions.movieQuotaDays}
                        onChange={(l, d) => saveUser(u.id, { movieQuotaLimit: l, movieQuotaDays: d })}
                      />
                      <QuotaRow
                        label="Saisons"
                        limit={u.permissions.tvQuotaLimit}
                        days={u.permissions.tvQuotaDays}
                        onChange={(l, d) => saveUser(u.id, { tvQuotaLimit: l, tvQuotaDays: d })}
                      />
                      <Text style={styles.dim}>
                        Utilisé : {u.quota.movie.used} film(s) en {u.quota.movie.days} j · {u.quota.tv.used} saison(s) en {u.quota.tv.days} j
                      </Text>
                      {custom ? (
                        <Pressable
                          onPress={() =>
                            saveUser(u.id, { autoApprove: null, movieQuotaLimit: null, movieQuotaDays: null, tvQuotaLimit: null, tvQuotaDays: null })
                          }
                          style={{ paddingVertical: 6 }}>
                          <Text style={{ color: C.accent, fontWeight: '700' }}>Revenir aux réglages par défaut</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  section: { color: C.text, fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: C.text, fontSize: 15, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  userHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#3D6BFF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qLabel: { color: C.text, fontSize: 14, fontWeight: '600', width: 64 },
  qText: { color: C.textDim, fontSize: 13 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topicText: { color: C.text, fontSize: 15, fontWeight: '700', flex: 1, fontVariant: ['tabular-nums'] },
  smallBtn: { flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  smallBtnText: { color: C.text, fontSize: 13, fontWeight: '700' },
  num: {
    backgroundColor: C.surfaceHigh,
    color: C.text,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
