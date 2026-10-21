import { HomeShortcuts } from '@/components/home-shortcuts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnnouncementPopup } from '@/components/announcement';
import { TvFocusHero } from '@/components/tv-backdrop';
import { tvInfoFromJf, type TvFocusInfo } from '@/lib/tv-focus';
import { Hero, heroFromTmdb, HeroTopBar, type HeroItem } from '@/components/hero';
import { JfRow, openJellyfin, playJellyfin } from '@/components/jf-cards';
import { isAnime, jf, jfImage, jfLogo, type JfItem } from '@/lib/jellyfin';
import { useSeason } from '@/lib/seasons';

import { PosterItem, Row } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { openMedia, openStremioMeta } from '@/lib/navigation';
import { orderRows, useAvailableRows } from '@/lib/home-layout';
import { nextMovieNight, type Reco } from '@/lib/recommend';
import { ratingsApi, type TopRated } from '@/lib/ratings';
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

  const season = useSeason();
  if (part === 'hero')
    return loading ? (
      <View style={{ height: 420 }} />
    ) : (
      <Hero items={all.slice(0, 6).map((r) => heroFromTmdb(r, badge(r.media_type as MediaType, r.id)))} season={season} />
    );

  const items: PosterItem[] = all.slice(6).map((r) => {
    const type = r.media_type as MediaType;
    return {
      key: `${type}:${r.id}`,
      title: itemTitle(r),
      poster: tmdbImg(r.poster_path),
      backdrop: r.backdrop_path ? tmdbImg(r.backdrop_path, 'w1280') : undefined,
      ids: { tmdb: r.id, type },
      subtitle: itemYear(r),
      badge: badge(type, r.id),
      onPress: () => openMedia(type, r.id),
    };
  });
  return <Row title="Tendances de la semaine" items={items} loading={loading} error={error} />;
}

/** Hero alimenté par les derniers ajouts du serveur Jellyfin. */
function JfHero({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const season = useSeason();
  const [items, setItems] = useState<HeroItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    // Uniquement les sorties récentes (année en cours et suivantes), dans l'ordre d'ajout
    jf.recentReleases(settings, { kind: 'both', limit: 24 })
      .then((Items) => {
        if (!alive) return;
        // Nouveautés films, séries et enfants : sans les animés
        const withArt = Items.filter((i) => i.ImageTags?.Primary && !isAnime(i)).slice(0, 7);
        setItems(
          withArt.map((i) => {
            const tmdbId = i.ProviderIds?.Tmdb ? Number(i.ProviderIds.Tmdb) : undefined;
            return {
              key: i.Id,
              title: i.Name,
              // Grande image d'accueil : pleine définition de l'écran (Retina ×3), compression minimale
              posterUrl: jfImage(settings, i.Id, 'Primary', { tag: i.ImageTags?.Primary, maxHeight: 2600, quality: 97 }),
              logoUrl: jfLogo(settings, i),
              tmdb: tmdbId ? { type: i.Type === 'Movie' ? 'movie' : 'tv', id: tmdbId } : undefined,
              genres: (i.Genres ?? []).slice(0, 3),
              meta: [i.Type === 'Movie' ? 'Film' : 'Série', i.ProductionYear, i.CommunityRating ? `★ ${i.CommunityRating.toFixed(1)}` : null]
                .filter(Boolean)
                .join('  •  '),
              badge: { state: 'available', label: 'Nouveau sur ton serveur', color: C.success },
              primary: { label: 'Lire', icon: 'play', onPress: () => (i.Type === 'Movie' ? playJellyfin(i) : openJellyfin(i)) },
              onOpen: () => openJellyfin(i),
            } as HeroItem;
          })
        );
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, nonce]);

  if (items === null) return <View style={{ height: 420 }} />;
  return <Hero items={items} season={season} />;
}

/** Sélection de saison tirée du serveur Jellyfin (ex. films d'horreur pour Halloween), du plus récent au plus ancien. */
function SeasonJfRow({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const season = useSeason();
  const [items, setItems] = useState<JfItem[]>([]);

  useEffect(() => {
    if (!season || !settings.jellyfin) return;
    let alive = true;
    (async () => {
      let found: JfItem[] = [];
      if (season.jfGenre) {
        const genres = (await jf.genres(settings).catch(() => [])).map((g) => g.Name).filter((n) => season.jfGenre!.test(n));
        if (genres.length) {
          const r = await jf.items(settings, {
            types: 'Movie,Series',
            genres: genres.join('|'),
            sort: 'PremiereDate,ProductionYear,SortName',
            order: 'Descending',
            limit: 40,
          });
          found = r.Items;
        }
      }
      if (season.jfSearch) {
        const res = await Promise.all(
          season.jfSearch.map((q) => jf.items(settings, { types: 'Movie,Series', search: q, limit: 20 }).catch(() => ({ Items: [] as JfItem[] })))
        );
        const seen = new Set(found.map((i) => i.Id));
        for (const r of res) for (const i of r.Items) if (!seen.has(i.Id)) (seen.add(i.Id), found.push(i));
        found.sort((a, b) => (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0));
      }
      if (alive) setItems(found);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season?.id, settings.jellyfin?.token, nonce]);

  if (!season) return null;
  return <JfRow title={`${season.emoji} ${season.name} · Sur ton serveur`} items={items} accent={season.accent} />;
}

/** Sélection de saison à découvrir (TMDB), du plus récent au plus ancien. */
function SeasonTmdbRow({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const season = useSeason();
  const badge = useLibrary();
  const { data, loading, error } = useAsync(async () => {
    if (!season) return [];
    const pages = await Promise.all(
      [1, 2].map((page) => tmdb.discover(settings, 'movie', { genres: season.tmdbGenres, keyword: season.tmdbKeyword, page }))
    );
    return pages.flatMap((p) => p.results).filter((r) => r.poster_path);
  }, [season?.id, settings.tmdbKey, nonce]);
  if (!season) return null;
  const items: PosterItem[] = (data ?? []).map((r) => ({
    key: `movie:${r.id}`,
    title: itemTitle(r),
    poster: tmdbImg(r.poster_path),
    backdrop: r.backdrop_path ? tmdbImg(r.backdrop_path, 'w1280') : undefined,
    ids: { tmdb: r.id, type: 'movie' },
    subtitle: itemYear(r),
    badge: badge('movie', r.id),
    onPress: () => openMedia('movie', r.id),
  }));
  return (
    <Row
      title={`${season.emoji} ${season.name} · À découvrir`}
      subtitle={season.tagline}
      items={items}
      loading={loading}
      error={error}
      accent={season.accent}
    />
  );
}

/** Titres les mieux notés par la famille (notes en étoiles du serveur Lumio). */
function FamilyTopRow({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const [items, setItems] = useState<TopRated[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!settings.chatUrl || !settings.jellyfin) return;
      ratingsApi.top(settings).then(setItems).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.chatUrl, settings.jellyfin?.token, nonce])
  );
  if (!items.length) return null;
  const posters: PosterItem[] = items.map((r) => ({
    key: `${r.type}:${r.tmdbId}`,
    title: r.title,
    poster: r.poster,
    ids: { tmdb: r.tmdbId, type: r.type },
    subtitle: `Notes ${r.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/10 · ${r.count} avis`,
    onPress: () => openMedia(r.type, r.tmdbId),
  }));
  return <Row title="⭐ Coups de cœur de la famille" items={posters} />;
}

/** « Prochaine soirée cinéma » : films pas encore vus, choisis d'après tes genres préférés (calcul local). */
function MovieNightRow({ nonce }: { nonce: number }) {
  const { settings } = useSettings();
  const [reco, setReco] = useState<Reco | null>(null);
  useEffect(() => {
    if (!settings.jellyfin) return;
    nextMovieNight(settings).then(setReco).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, nonce]);
  if (!reco?.items.length) return null;
  return (
    <JfRow
      title={reco.because.length ? `🍿 Prochaine soirée cinéma · ${reco.because.slice(0, 2).join(', ')}` : '🍿 Prochaine soirée cinéma'}
      items={reco.items}
    />
  );
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
              : jf.recentReleases(settings, {
                  parentId: view!.Id,
                  kind: view?.CollectionType === 'movies' ? 'movies' : view?.CollectionType === 'tvshows' ? 'series' : 'both',
                });
      p.then(setItems).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.jellyfin?.token, kind, view?.Id, nonce])
  );
  const title =
    kind === 'continue' ? 'Reprendre' : kind === 'nextup' ? 'À suivre' : kind === 'favorites' ? 'Favoris' : `Derniers ajouts · ${view?.Name ?? ''}`;
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
  const withHero = ordered[0]?.kind === 'hero';
  const season = useSeason();

  // ——— TV : accueil façon Nuvio — fond plein écran du titre sélectionné, infos en haut à gauche, rangées dessous ———
  const { height: screenH } = useWindowDimensions();
  const [tvInitial, setTvInitial] = useState<TvFocusInfo | null>(null);
  useEffect(() => {
    if (!Platform.isTV || !settings.jellyfin) return;
    jf.recentReleases(settings, { kind: 'both', limit: 8 })
      .then((items) => {
        const first = items.find((i) => !isAnime(i) && (i.BackdropImageTags?.length || i.ImageTags?.Primary));
        if (first) setTvInitial(tvInfoFromJf(settings, first));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.jellyfin?.token, nonce]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNonce((n) => n + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  if (Platform.isTV)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TvFocusHero initial={tvInitial} top={Math.round(screenH * 0.1)} />
        <ScrollView style={{ flex: 1, marginTop: Math.round(screenH * 0.48) }} contentContainerStyle={{ paddingBottom: 60 }}>
          {ordered
            .filter((r) => r.kind !== 'hero')
            .map((r) => {
              let el: React.ReactNode = null;
              switch (r.kind) {
                case 'season-jf':
                  el = <SeasonJfRow nonce={nonce} />;
                  break;
                case 'season-tmdb':
                  el = <SeasonTmdbRow nonce={nonce} />;
                  break;
                case 'trending':
                  el = <Trending part="row" nonce={nonce} />;
                  break;
                case 'family-top':
                  el = <FamilyTopRow nonce={nonce} />;
                  break;
                case 'jf-reco':
                  el = <MovieNightRow nonce={nonce} />;
                  break;
                case 'catalog':
                  el = r.addon && r.catalog ? <CatalogRow addon={r.addon} catalog={r.catalog} nonce={nonce} /> : null;
                  break;
                default:
                  el = <JfDynamicRow kind={r.kind as 'continue' | 'nextup' | 'favorites' | 'jf-latest'} view={r.view} nonce={nonce} />;
              }
              return <View key={r.id}>{el}</View>;
            })}
        </ScrollView>
        <AnnouncementPopup />
      </View>
    );

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
              el = settings.jellyfin ? <JfHero nonce={nonce} /> : <Trending part="hero" nonce={nonce} />;
              break;
            case 'season-jf':
              el = <SeasonJfRow nonce={nonce} />;
              break;
            case 'season-tmdb':
              el = <SeasonTmdbRow nonce={nonce} />;
              break;
            case 'trending':
              el = <Trending part="row" nonce={nonce} />;
              break;
            case 'family-top':
              el = <FamilyTopRow nonce={nonce} />;
              break;
            case 'jf-reco':
              el = <MovieNightRow nonce={nonce} />;
              break;
            case 'catalog':
              el = r.addon && r.catalog ? <CatalogRow addon={r.addon} catalog={r.catalog} nonce={nonce} /> : null;
              break;
            default:
              el = <JfDynamicRow kind={r.kind as 'continue' | 'nextup' | 'favorites' | 'jf-latest'} view={r.view} nonce={nonce} />;
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

      {/* Barre du haut : toujours transparente (plus de bandeau noir en défilant) */}
      <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <HeroTopBar title="Lumio" season={season} right={<HomeShortcuts onCustomize={() => router.push('/customize')} />} />
      </View>
      {/* Message épinglé par l'admin, tant qu'il n'a pas été lu */}
      <AnnouncementPopup />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 10 },
});
