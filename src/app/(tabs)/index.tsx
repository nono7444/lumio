import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { PosterItem, Row } from '@/components/ui';
import { C } from '@/constants/theme';
import { openMedia, openStremioMeta } from '@/lib/navigation';
import { mediaStatusLabel, seerr, tmdbImg, type SearchResult } from '@/lib/seerr';
import { Addon, isSeerrConfigured, useSettings } from '@/lib/settings';
import {
  catalogKey,
  fetchCatalog,
  fetchManifest,
  isBrowsable,
  metaYear,
  type StremioCatalog,
  type StremioMeta,
} from '@/lib/stremio';

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
    subtitle: metaYear(m)?.toString(),
    onPress: () => openStremioMeta(settings, m),
  }));

  const title = catalog.name || catalog.id;
  const type = TYPE_LABEL[catalog.type] ?? catalog.type;
  return <Row title={`${title} · ${type}`} subtitle={addon.name} items={items} loading={loading} error={error} />;
}

function AddonRows({ addon, nonce }: { addon: Addon; nonce: number }) {
  const { data, error, loading } = useAsync(() => fetchManifest(addon.base), [addon.base]);
  if (loading) return <Row title={addon.name} items={[]} loading />;
  if (error || !data) return <Row title={addon.name} items={[]} error={error ?? 'manifest illisible'} />;

  const catalogs = (data.catalogs ?? [])
    .filter(isBrowsable)
    .filter((c) => !addon.hidden?.includes(catalogKey(c)));

  return (
    <>
      {catalogs.map((c) => (
        <CatalogRow key={catalogKey(c)} addon={addon} catalog={c} nonce={nonce} />
      ))}
    </>
  );
}

function TrendingRow({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const { data, error, loading } = useAsync(() => seerr.trending(settings), [settings.seerrUrl, settings.seerrApiKey, nonce]);
  const items: PosterItem[] = (data?.results ?? [])
    .filter((r: SearchResult) => r.mediaType === 'movie' || r.mediaType === 'tv')
    .map((r) => ({
      key: `${r.mediaType}:${r.id}`,
      title: r.title ?? r.name ?? '',
      poster: tmdbImg(r.posterPath),
      subtitle: (r.releaseDate || r.firstAirDate || '').slice(0, 4),
      badge: mediaStatusLabel(r.mediaInfo?.status),
      onPress: () => openMedia(r.mediaType as 'movie' | 'tv', r.id),
    }));
  return <Row title="Tendances" subtitle="Seerr" items={items} loading={loading} error={error} />;
}

export default function Home() {
  const { settings } = useSettings();
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNonce((n) => n + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
      {settings.showTrending && isSeerrConfigured(settings) && <TrendingRow nonce={nonce} />}
      {settings.addons.map((a) => (
        <AddonRows key={a.base} addon={a} nonce={nonce} />
      ))}
      {settings.addons.length === 0 && !isSeerrConfigured(settings) && (
        <View style={{ padding: 24 }}>
          <Text style={{ color: C.textDim, textAlign: 'center' }}>
            Ajoute un addon Stremio ou connecte Seerr dans les réglages pour remplir l'accueil.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
