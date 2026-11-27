// Univers TV → onglet « Matchs » : les matchs du jour trouvés dans le guide des programmes de l'IPTV du serveur,
// avec les chaînes qui les diffusent. Toucher une chaîne lance le direct (relayé par le serveur Lumio).
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { ScreenTitle, SegChip, tap } from '@/components/ui';
import { UniverseSwitch } from '@/components/universe-switch';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type MatchChannel = { id: string; name: string; logo: string | null; url: string };
type Match = { id: string; title: string; sport: string; start: number; end: number; hour: string; live: boolean; desc?: string; channels: MatchChannel[] };

const SPORT_ICON: Record<string, string> = {
  Football: '⚽',
  Rugby: '🏉',
  Basket: '🏀',
  Tennis: '🎾',
  'Sport auto': '🏎️',
  Combat: '🥊',
  Hand: '🤾',
  Hockey: '🏒',
  'Football US': '🏈',
  Cyclisme: '🚴',
};
let memo: Match[] | null = null;

export default function MatchesRoute() {
  const { settings } = useSettings();
  const [list, setList] = useState<Match[] | null>(memo);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sport, setSport] = useState<string | null>(null);

  const load = (refresh = false) => {
    setBusy(true);
    setErr(null);
    serverCall<{ matches: Match[] }>(settings, `/api/iptv/matches${refresh ? '?refresh=1' : ''}`)
      .then((r) => {
        memo = r.matches;
        setList(r.matches);
      })
      .catch((e) => setErr(e?.message ?? String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);

  const sports = useMemo(() => [...new Set((list ?? []).map((m) => m.sport))], [list]);
  const shown = (list ?? []).filter((m) => !sport || m.sport === sport);
  const live = shown.filter((m) => m.live);
  const later = shown.filter((m) => !m.live);

  const play = (m: Match, c: MatchChannel) => {
    tap();
    if (!c.url) return toast('Chaîne indisponible', 'error');
    router.push({ pathname: '/player', params: { kind: 'url', uri: c.url, title: m.title, subtitle: `${c.name} · ${m.live ? 'en direct' : m.hour}` } });
  };

  const card = (m: Match) => (
    <View key={m.id} style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.hour, m.live && { color: C.danger }]}>{m.live ? '● DIRECT' : m.hour}</Text>
        <Text style={styles.sport}>
          {SPORT_ICON[m.sport] ?? '🏆'} {m.sport}
        </Text>
      </View>
      <Text style={styles.title}>{m.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {m.channels.map((c) => (
          <Pressable key={c.id} onPress={() => play(m, c)} style={styles.chan} accessibilityLabel={`Regarder sur ${c.name}`}>
            {c.logo ? <Image source={{ uri: c.logo }} style={styles.logo} contentFit="contain" /> : null}
            <Text style={styles.chanText} numberOfLines={1}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_SPACE }}
        refreshControl={<RefreshControl refreshing={busy && !!list} onRefresh={() => load(true)} tintColor={C.text} />}>
        <UniverseSwitch style={{ marginLeft: 16, marginTop: 8 }} />
        <ScreenTitle title="Matchs du jour" />
        {sports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
            <SegChip label="Tous" on={!sport} onPress={() => setSport(null)} />
            {sports.map((s) => (
              <SegChip key={s} label={`${SPORT_ICON[s] ?? '🏆'} ${s}`} on={sport === s} onPress={() => setSport(sport === s ? null : s)} />
            ))}
          </ScrollView>
        ) : null}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {!list && !err ? <ActivityIndicator color={C.text} style={{ marginTop: 40 }} /> : null}
          {err ? <Text style={styles.dim}>{err}</Text> : null}
          {list && !shown.length ? (
            <Text style={styles.dim}>
              Aucun match trouvé pour aujourd’hui dans le guide des programmes. Tire vers le bas pour actualiser.
            </Text>
          ) : null}
          {live.length ? <Text style={styles.h}>En direct</Text> : null}
          {live.map(card)}
          {later.length ? <Text style={styles.h}>À venir</Text> : null}
          {later.map(card)}
          {list?.length ? (
            <Text style={styles.dim}>D’après le guide des programmes de ton IPTV. Une chaîne déjà regardée par quelqu’un d’autre peut être occupée.</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hour: { color: C.text, fontSize: 14, fontWeight: '800' },
  sport: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  title: { color: C.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  chan: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 36, borderRadius: 18, backgroundColor: C.surfaceHigh },
  logo: { width: 28, height: 18 },
  chanText: { color: C.text, fontSize: 13, fontWeight: '700', maxWidth: 160 },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
