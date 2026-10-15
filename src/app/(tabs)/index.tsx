import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Hero, HeroTopBar } from '@/components/hero';
import { JfRow } from '@/components/jf-cards';
import { jf, type JfItem } from '@/lib/jellyfin';

import { PosterItem, Row } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { openMedia, openStremioMeta } from '@/lib/navigation';
import { orderRows, useAvailableRows } from '@/lib/home-layout';
import { Addon, hasTmdb, useSettings } from '@/lib/settings';
import { itemTitle, itemYear, tmdb, tmdbImg, type MediaType } from '@/lib/tmdb';
import { useLibrary } from '@/lib/use-library';
import { catalogKey, fetchCatalog, metaYear, type StremioCatalog, type StremioMeta } from '@/lib/stremio';

const TYPE_LABEL: Record<string, string> = { movie: 'Films', series: 'Séries' };

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    set({ loading: true });
    fn()
      .then((data) => alive && set({ data, loading: false }))
      .catch((e) => alive && set({ error: String(e?.message ?? e), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function CatalogRow({ addon, catalog, nonce }: { addon: Addon; catalog: StremioCatalog; nonce: number }) {
  const { settings } = useSettings();
  const { data, error, loading } = useAsync(() => fetchCatalog(addon.base, catalog), [addon.base, catalogKey(catalog), nonce]);

  const items: PosterItem[] = (data ?? []).slice(0, 40).map((m: StremioMeta) => ({
    key: `${m.type}:${m.id}`,
    title: m.name,
    poster: m.poster,
    ids: {
      imdb: m.id.match(/^tt\d+/)?.[0] ?? m.imdb_id,
      tmdb: m.id.startsWith('tmdb:') ? Number(m.id.slice(5)) : m.moviedb_id ? Number(m.moviedb_id) : undefined,
      type: m.type === 'movie' ? 'movie' : 'tv',
    },
    subtitle: metaYear(m)?.toString(),
    onPress: () => openStremioMeta(settings, m),
  }));

  const title = catalog.name || catalog.id;
  const type = TYPE_LABEL[catalog.type] ?? catalog.type;
  return <Row title={`${title} · ${type}`} subtitle={addon.name} items={items} loading={loading} error={error} />;
}

function Trending({ nonce, part }: { nonce: number; part: 'hero' | 'row' }) {
  const { settings } = useSettings();
  const badge = useLibrary();
  const { data, error, loading } = useAsync(() => tmdb.trending(settings), [settings.tmdbKey, nonce]);
  const all = (data?.results ?? []).filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);

  if (part === 'hero') return loading ? <View style={{ height: 420 }} /> : <Hero items={all.slice(0, 6)} badge={badge} />;

  const items: PosterItem[] = all.slice(6).map((r) => {
    const type = r.media_type as MediaType;
    return {
      key: `${type}:${r.id}`,
      title: itemTitle(r),
      poster: tmdbImg(r.poster_path),
      ids: { tmdb: r.id, type },
      subtitle: itemYear(r),
      badge: badge(type, r.id),
      onPress: () => openMedia(type, r.id),
    };
  });
  return <Row title="Tendances de la semaine" items={items} loading={loading} error={error} />;
}

function JfDynamicRow({ kind, view, nonce }: { kind: 'continue' | 'nextup' | 'favorites' | 'jf-latest'; view?: JfItem; nonce: number }) {
  const { settings } = useSettings();
  const [items, setItems] = useState<JfItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!settings.jellyfin) return;
      const p =
        kind === 'continue'
          ? jf.resume(settings)
          : kind === 'nextup'
            ? jf.nextUp(settings)
            : kind === 'favorites'
              ? jf.favorites(settings)
              : jf.latest(settings, view!.Id);
      p.then(setItems).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.jellyfin?.token, kind, view?.Id, nonce])
  );
  const title =
    kind === 'continue' ? 'Reprendre' : kind === 'nextup' ? 'À suivre' : kind === 'favorites' ? 'Favoris' : `Ajouts récents · ${view?.Name ?? ''}`;
  return (
    <JfRow
      title={title}
      items={items}
      wide={kind === 'continue' || kind === 'nextup'}
      onSeeAll={kind === 'jf-latest' && view ? () => router.push({ pathname: '/jellyfin/[id]', params: { id: view.Id } }) : undefined}
    />
  );
}

export default function Home() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { rows } = useAvailableRows(nonce);
  const ordered = orderRows(rows, settings.homeLayout).filter((r) => !r.hidden);
  const withHero = settings.showTrending && ordered[0]?.kind === 'hero';

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNonce((n) => n + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: withHero ? 0 : insets.top + 60, paddingBottom: TAB_SPACE }}
        scrollEventThrottle={32}
        onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 40)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} progressViewOffset={insets.top} />
        }>
        {ordered.map((r, idx) => {
          const spacer = idx === 1 && withHero ? <View key="sp" style={{ height: 20 }} /> : null;
          let el: React.ReactNode = null;
          switch (r.kind) {
            case 'hero':
              el = settings.showTrending ? <Trending part="hero" nonce={nonce} /> : null;
              break;
            case 'trending':
              el = <Trending part="row" nonce={nonce} />;
              break;
            case 'catalog':
              el = r.addon && r.catalog ? <CatalogRow addon={r.addon} catalog={r.catalog} nonce={nonce} /> : null;
              break;
            default:
              el = <JfDynamicRow kind={r.kind} view={r.view} nonce={nonce} />;
          }
          return (
            <View key={r.id}>
              {spacer}
              {el}
            </View>
          );
        })}
        {settings.addons.length === 0 && !hasTmdb(settings) && !settings.jellyfin && (
          <View style={{ padding: 24 }}>
            <Text style={{ color: C.textDim, textAlign: 'center' }}>
              Ajoute un addon Stremio ou ta clé TMDB dans Profil pour remplir l'accueil.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Barre du haut : transparente sur le hero, voile noir une fois qu'on a défilé */}
      <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: scrolled || !withHero ? 'rgba(0,0,0,0.88)' : 'transparent' }]} />
        <HeroTopBar title="Lumio" onCustomize={() => router.push('/customize')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 10 },
});
