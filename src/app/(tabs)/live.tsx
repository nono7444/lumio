// Onglet Live TV : chaînes en direct des sources IPTV / addons Stremio, par groupe, avec recherche et favoris.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, SegChip, tap } from '@/components/ui';
import { VpnButton } from '@/components/vpn-button';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { channelStreams, COUNTRIES, countryOf, FRENCH, loadChannels, THEMES, themeOf, type Channel, type Theme, syncLiveSources } from '@/lib/live';
import { useSettings } from '@/lib/settings';

const ALL = 'Tous les groupes';
type ThemeFilter = 'all' | 'fav' | Theme;

function ChannelTile({ ch, width, fav, onPress, onLong }: { ch: Channel; width: number; fav: boolean; onPress: () => void; onLong: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <Pressable onPress={onPress} onLongPress={onLong} style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.logoBox, { height: Math.round(width * 0.62) }]}>
        {ch.logo && !broken ? (
          <Image source={ch.logo} style={styles.logo} contentFit="contain" transition={150} onError={() => setBroken(true)} recyclingKey={ch.key} />
        ) : (
          <Text style={styles.initials} numberOfLines={2}>
            {ch.name.slice(0, 12)}
          </Text>
        )}
        {fav ? <Ionicons name="star" size={13} color={C.warning} style={styles.star} /> : null}
      </View>
      <Text style={styles.chName} numberOfLines={1}>
        {ch.name}
      </Text>
    </Pressable>
  );
}

export default function Live() {
  const { settings, update } = useSettings();
  // Lumio TV : les sources suivent sur la TV (via le serveur Lumio)
  useEffect(() => syncLiveSources(settings), [settings.liveSources, settings.chatUrl, settings.jellyfin?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const sources = settings.liveSources;
  const [sourceId, setSourceId] = useState<string | null>(sources[0]?.id ?? null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(ALL);
  const [theme, setTheme] = useState<ThemeFilter>('all');
  const lang = settings.liveLang || 'fr';
  const setLang = (l: string) => {
    tap();
    setGroup(ALL);
    update({ liveLang: l });
  };
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const source = sources.find((s) => s.id === sourceId) ?? sources[0];

  const load = (force = false) => {
    if (!source) return;
    setError(null);
    if (force) setChannels(null);
    loadChannels(source, force)
      .then(setChannels)
      .catch((e) => {
        setChannels([]);
        setError(e?.message ?? String(e));
      });
  };

  useEffect(() => {
    setChannels(null);
    setGroup(ALL);
    setTheme('all');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, source?.url]);

  const favs = useMemo(() => new Set(settings.liveFavorites), [settings.liveFavorites]);

  // Classement de chaque chaîne (pays / langue, thème), calculé une fois par liste
  const tagged = useMemo(
    () => (channels ?? []).map((c) => ({ c, country: countryOf(c), theme: themeOf(c) })),
    [channels]
  );

  // Langues présentes : Français d'abord, puis les pays les plus fournis
  const langs = useMemo(() => {
    const n = new Map<string, number>();
    for (const t of tagged) if (t.country && !FRENCH.has(t.country)) n.set(t.country, (n.get(t.country) ?? 0) + 1);
    const hasFr = tagged.some((t) => t.country && FRENCH.has(t.country));
    return [...(hasFr ? ['fr'] : []), 'all', ...[...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)];
  }, [tagged]);
  const effLang = langs.includes(lang) ? lang : langs[0] ?? 'all';

  const byLang = useMemo(
    () =>
      tagged.filter((t) =>
        effLang === 'all' ? true : effLang === 'fr' ? Boolean(t.country && FRENCH.has(t.country)) : t.country === effLang
      ),
    [tagged, effLang]
  );

  // Thèmes présents dans cette langue (avec leur nombre de chaînes)
  const themeCounts = useMemo(() => {
    const n = new Map<Theme, number>();
    for (const t of byLang) n.set(t.theme, (n.get(t.theme) ?? 0) + 1);
    return n;
  }, [byLang]);
  const hasFav = byLang.some((t) => favs.has(t.c.key));

  const byTheme = useMemo(
    () => byLang.filter((t) => (theme === 'all' ? true : theme === 'fav' ? favs.has(t.c.key) : t.theme === theme)),
    [byLang, theme, favs]
  );

  // Groupes d'origine de la liste, restreints à la langue et au thème choisis
  const groups = useMemo(() => {
    const g = new Map<string, number>();
    for (const t of byTheme) if (t.c.group) g.set(t.c.group, (g.get(t.c.group) ?? 0) + 1);
    return [ALL, ...[...g.keys()].sort((a, b) => a.localeCompare(b, 'fr'))];
  }, [byTheme]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return byTheme
      .filter((t) => (group === ALL || t.c.group === group) && (!q || t.c.name.toLowerCase().includes(q)))
      .map((t) => t.c);
  }, [byTheme, group, query]);

  const cols = width >= 1000 ? 7 : width >= 700 ? 5 : 3;
  const gap = 12;
  const tileW = Math.floor((width - 32 - gap * (cols - 1)) / cols);

  const play = async (ch: Channel) => {
    tap();
    setOpening(ch.key);
    try {
      const [first, ...rest] = await channelStreams(ch);
      router.push({
        pathname: '/player',
        params: {
          kind: 'url',
          uri: first.uri,
          title: ch.name,
          subtitle: first.label ?? ch.group ?? 'En direct',
          headers: first.headers ? JSON.stringify(first.headers) : undefined,
          // Autres sources de la chaîne : le lecteur essaie la suivante si celle-ci ne marche pas
          alts: rest.length ? JSON.stringify(rest.slice(0, 15)) : undefined,
        },
      });
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setOpening(null);
    }
  };

  const toggleFav = (ch: Channel) => {
    tap();
    const on = favs.has(ch.key);
    update({ liveFavorites: on ? settings.liveFavorites.filter((k) => k !== ch.key) : [...settings.liveFavorites, ch.key] });
    toast(on ? `${ch.name} retirée des favoris` : `${ch.name} ajoutée aux favoris`, 'info', 2000);
  };

  const header = (
    <View>
      <ScreenTitle
        title="Live TV"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <VpnButton />
            <Pressable onPress={() => router.push('/live-sources')} hitSlop={10} style={styles.headerBtn}>
              <Ionicons name="add" size={22} color={C.text} />
            </Pressable>
          </View>
        }
      />
      {sources.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {sources.map((s) => (
            <SegChip key={s.id} label={s.name} on={s.id === source?.id} onPress={() => setSourceId(s.id)} />
          ))}
        </ScrollView>
      ) : null}
      {source ? (
        <>
          <View style={styles.search}>
            <Ionicons name="search" size={17} color={C.textDim} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Chercher une chaîne"
              placeholderTextColor={C.textFaint}
              style={styles.searchInput}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          {/* Langue / pays */}
          {langs.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {langs.map((l) => (
                <SegChip
                  key={l}
                  label={l === 'fr' ? '🇫🇷 Français' : l === 'all' ? '🌐 Toutes les langues' : `${COUNTRIES[l]?.flag ?? ''} ${COUNTRIES[l]?.label ?? l}`}
                  on={l === effLang}
                  onPress={() => setLang(l)}
                />
              ))}
            </ScrollView>
          ) : null}
          {/* Thème : sport, info, cinéma… */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <SegChip label="Tout" icon="apps" on={theme === 'all'} onPress={() => { setTheme('all'); setGroup(ALL); }} />
            {hasFav ? <SegChip label="Favoris" icon="star" on={theme === 'fav'} onPress={() => { setTheme('fav'); setGroup(ALL); }} /> : null}
            {THEMES.filter((t) => themeCounts.get(t.id)).map((t) => (
              <SegChip
                key={t.id}
                label={`${t.label} · ${themeCounts.get(t.id)}`}
                icon={t.icon as keyof typeof Ionicons.glyphMap}
                on={theme === t.id}
                onPress={() => {
                  setTheme(t.id);
                  setGroup(ALL);
                }}
              />
            ))}
          </ScrollView>
          {/* Groupes d'origine de la liste (affinage) */}
          {groups.length > 2 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {groups.map((g) => (
                <SegChip key={g} label={g} on={g === group} onPress={() => setGroup(g)} />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  );

  if (!source)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        {header}
        <View style={styles.empty}>
          <Ionicons name="tv-outline" size={44} color={C.textFaint} />
          <Text style={styles.emptyTitle}>Aucune chaîne pour l’instant</Text>
          <Text style={styles.dim}>
            Ajoute ta liste IPTV (lien M3U ou compte Xtream Codes) ou un addon Stremio de chaînes en direct.
          </Text>
          <Button title="Ajouter une source" icon="add" onPress={() => router.push('/live-sources')} />
        </View>
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        key={cols}
        data={shown}
        numColumns={cols}
        keyExtractor={(c) => c.key}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: TAB_SPACE }}
        columnWrapperStyle={{ gap, paddingHorizontal: 16, marginBottom: 14 }}
        initialNumToRender={30}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={C.text} />}
        renderItem={({ item }) => (
          <View>
            <ChannelTile ch={item} width={tileW} fav={favs.has(item.key)} onPress={() => play(item)} onLong={() => toggleFav(item)} />
            {opening === item.key ? <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} /> : null}
          </View>
        )}
        ListEmptyComponent={
          channels == null ? (
            <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.dim}>{error ?? (query ? 'Aucune chaîne ne correspond.' : 'Aucune chaîne dans ce groupe.')}</Text>
              {error ? <Button title="Réessayer" variant="secondary" onPress={() => load(true)} /> : null}
            </View>
          )
        }
        ListFooterComponent={
          channels?.length ? (
            <Text style={[styles.dim, { textAlign: 'center', marginTop: 6 }]}>
              {shown.length.toLocaleString('fr-FR')} chaîne{shown.length > 1 ? 's' : ''} · appui long pour les favoris
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: R.md,
    backgroundColor: C.surfaceHigh,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 10 },
  logoBox: {
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  logo: { width: '100%', height: '100%' },
  initials: { color: C.textDim, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  star: { position: 'absolute', top: 6, right: 6 },
  chName: { color: C.text, fontSize: 12, fontWeight: '600', marginTop: 6 },
  empty: { alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
