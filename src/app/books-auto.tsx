// Lumio Livres (admin) : compléter les séries tout seul. Le serveur repère les tomes manquants (trous entre le 1 et
// le dernier, et le tome suivant), les cherche sur C411, Tr4ker et Wawacity toutes les 6 h et les télécharge.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { Button, ScreenTitle } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, type BooksAuto } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const when = (iso: string | null) => {
  if (!iso) return 'jamais';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const tomes = (l: number[]) => (l.length > 8 ? `${l.slice(0, 8).map((n) => `T${n}`).join(', ')}… (${l.length})` : l.map((n) => `T${n}`).join(', '));

export default function BooksAutoScreen() {
  const { settings } = useSettings();
  const [st, setSt] = useState<BooksAuto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    ebookApi
      .auto(settings)
      .then((r) => (setSt(r), setErr(null)))
      .catch((e) => setErr(/404|inconnue/.test(e?.message ?? '') ? 'Mets le serveur Lumio à jour (3.142.0).' : (e?.message ?? String(e))));
  }, [settings]);
  useFocusEffect(load);
  const toggle = (v: boolean) => {
    setSt((x) => (x ? { ...x, enabled: v } : x));
    ebookApi
      .setAuto(settings, v)
      .then((r) => (setSt(r), toast(v ? 'Séries complétées automatiquement' : 'Complétion automatique arrêtée')))
      .catch((e) => (toast(e?.message ?? String(e), 'error'), load()));
  };
  const run = () => {
    setBusy(true);
    ebookApi
      .autoRun(settings)
      .then((r) => (setSt(r), toast('Vérification lancée : les tomes trouvés partent en téléchargement')))
      .catch((e) => toast(e?.message ?? String(e), 'error'))
      .finally(() => (setBusy(false), setTimeout(load, 8000)));
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
        <ScreenTitle title="Séries à compléter" onBack={() => router.back()} />
        {err ? <Text style={[styles.s, { color: C.danger, paddingHorizontal: 16 }]}>{err}</Text> : null}
        {st ? (
          <View style={{ paddingHorizontal: 16, gap: 14 }}>
            <View style={[styles.card, { borderColor: st.enabled ? C.success : C.border }]}>
              <Ionicons name="sparkles" size={22} color={st.enabled ? C.success : C.textDim} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.t}>Compléter mes séries</Text>
                <Text style={styles.s}>Toutes les 6 h, le serveur cherche les tomes qui manquent et le tome suivant, puis les télécharge (12 au plus à chaque fois, en français, au même format que la série). Les tomes manquants apparaissent aussi dans chaque collection.</Text>
              </View>
              <Switch value={st.enabled} onValueChange={toggle} />
            </View>
            <Text style={styles.s}>
              Dernière vérification : {when(st.lastRun)}
              {st.running ? ' · en cours…' : ''}
            </Text>
            <Button title="Vérifier maintenant" icon="refresh" variant="secondary" loading={busy || st.running} onPress={run} />

            <Text style={styles.h}>Tomes manquants</Text>
            {!st.missing.length ? (
              <Text style={styles.s}>{st.lastRun ? 'Aucun trou dans tes séries.' : 'Lance une vérification pour voir les tomes manquants.'}</Text>
            ) : (
              st.missing.map((m) => (
                <View key={m.name} style={styles.row}>
                  <Text style={styles.t} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.s}>
                    Manque {tomes(m.gaps)}{m.max ? ` · tu as jusqu’au T${m.max}` : ' · sortis, pas encore chez toi'}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.h}>Journal</Text>
            {!st.log.length ? <Text style={styles.s}>Rien pour l’instant.</Text> : null}
            {st.log.map((l, i) => (
              <View key={`${l.at}-${i}`} style={styles.row}>
                <Text style={[styles.t, { color: l.status === 'started' ? C.success : l.status === 'error' ? C.danger : C.text }]} numberOfLines={2}>
                  {l.series ? `${l.series} · T${l.tome}` : l.message}
                </Text>
                <Text style={styles.s} numberOfLines={2}>
                  {when(l.at)}
                  {l.status === 'started' ? ` · téléchargé depuis ${l.source}` : l.status === 'error' ? ` · ${l.message}` : ''}
                </Text>
                {l.title ? (
                  <Text style={[styles.s, { color: C.textFaint }]} numberOfLines={1}>
                    {l.title}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, backgroundColor: C.surface },
  h: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 10 },
  t: { color: C.text, fontSize: 15, fontWeight: '700' },
  s: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  row: { gap: 2, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
});
