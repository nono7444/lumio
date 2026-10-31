import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JfPosterCard, JfRow, playJellyfin } from '@/components/jf-cards';
import { Button, Fade, Pill, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import {
  formatRuntime,
  jf,
  jfBackdrop,
  jfImage,
  jfLogo,
  jfPoster,
  tmdbArtFor,
  ticksToSeconds,
  type JfItem,
} from '@/lib/jellyfin';
import { TvBackdropLayer } from '@/components/tv-backdrop';
import { toast } from '@/components/toast';
import { filesApi } from '@/lib/files';
import { tmdb, tmdbImg, type TmdbTv } from '@/lib/tmdb';
import { EpisodePicker, useSeriesEpisodes } from '@/components/jf-episodes';
import { SeasonRequests } from '@/components/season-requests';
import { WatchlistButton } from '@/components/watchlist-button';
import { TvActionRow, TvPill, TvRound, TV_GOLD } from '@/components/tv-actions';
import { MetadataEditor } from '@/components/metadata-editor';
import { FamilyRating } from '@/components/family-rating';
import { ReportProblemButton } from '@/components/report-problem';
import { useServerRequests } from '@/lib/requests';
import { hasTmdb, useSettings } from '@/lib/settings';

const FOLDER_TYPES = ['CollectionFolder', 'UserView', 'Folder', 'BoxSet'];

function BackButton() {
  const insets = useSafeAreaInsets();
  return (
    <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + 8 }]} hitSlop={10}>
      <Ionicons name="chevron-back" size={24} color={C.text} />
    </Pressable>
  );
}

// ——— Grille d'une bibliothèque ———

const FILTERS = [
  { label: 'Tous', value: '' },
  { label: 'Non vus', value: 'IsUnplayed' },
  { label: 'Vus', value: 'IsPlayed' },
  { label: 'Favoris', value: 'IsFavorite' },
];

const SORTS = [
  // Par défaut : date de sortie, du plus récent au plus ancien
  { label: 'Sortie', sort: 'PremiereDate,ProductionYear,SortName', order: 'Descending' as const },
  { label: 'Ajouts', sort: 'DateCreated,SortName', order: 'Descending' as const },
  { label: 'A-Z', sort: 'SortName', order: 'Ascending' as const },
  { label: 'Note', sort: 'CommunityRating,SortName', order: 'Descending' as const },
];

function FolderGrid({ folder }: { folder: JfItem }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sortIdx, setSortIdx] = useState(0);
  const [filter, setFilter] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<JfItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const cols = width > 700 ? 5 : 3;
  const gap = 12;
  const cardW = Math.floor((width - 32 - gap * (cols - 1)) / cols);
  const types =
    folder.CollectionType === 'movies' ? 'Movie' : folder.CollectionType === 'tvshows' ? 'Series' : 'Movie,Series,BoxSet';

  // Pages chargées une seule fois : un verrou et un compteur en « ref » (l'état React arrive trop tard
  // quand la liste demande deux pages d'affilée), et chaque titre n'est gardé qu'une fois.
  const busy = useRef(false);
  const offset = useRef(0);
  const gen = useRef(0);
  const loadPage = useCallback(
    async (reset: boolean) => {
      if (busy.current && !reset) return;
      const my = ++gen.current;
      busy.current = true;
      setLoading(true);
      if (reset) offset.current = 0;
      try {
        const s = SORTS[sortIdx];
        const res = await jf.items(settings, {
          parentId: folder.Id,
          types,
          sort: s.sort,
          order: s.order,
          start: offset.current,
          limit: 60,
          filters: filter || undefined,
          genres: genre ?? undefined,
          search: search || undefined,
        });
        if (my !== gen.current) return; // une recherche ou un tri plus récent a pris le relais
        offset.current += res.Items.length;
        setTotal(res.TotalRecordCount);
        setItems((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map((i) => i.Id));
          return [...base, ...res.Items.filter((i) => !seen.has(i.Id) && seen.add(i.Id))];
        });
      } finally {
        if (my === gen.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, folder.Id, sortIdx, types, filter, genre, search]
  );

  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortIdx, filter, genre, search]);

  // Genres de cette bibliothèque
  useEffect(() => {
    jf.genres(settings, folder.Id)
      .then((g) => setGenres(g.map((x) => x.Name)))
      .catch(() => {});
  }, [settings, folder.Id]);

  // Recherche avec un léger délai de frappe
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        key={cols}
        data={items}
        numColumns={cols}
        keyExtractor={(i) => i.Id}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 18 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => offset.current < total && loadPage(false)}
        ListHeaderComponent={
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.screenTitle}>{folder.Name}</Text>
            <Text style={styles.dim}>{total} titres</Text>
            <View style={styles.sorts}>
              {SORTS.map((s, i) => (
                <SegChip key={s.label} label={s.label} on={i === sortIdx} onPress={() => setSortIdx(i)} />
              ))}
            </View>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={C.textDim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Rechercher dans ${folder.Name}`}
                placeholderTextColor={C.textFaint}
                style={styles.searchInput}
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
            <View style={[styles.sorts, { marginTop: 4 }]}>
              {FILTERS.map((f) => (
                <SegChip key={f.label} label={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />
              ))}
            </View>
            {genres.length > 0 && (
              <FlatList
                horizontal
                data={genres}
                keyExtractor={(g) => g}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                style={{ marginTop: 8, marginHorizontal: -16, flexGrow: 0 }}
                ListHeaderComponent={<View style={{ width: 8 }} />}
                ListFooterComponent={<View style={{ width: 8 }} />}
                renderItem={({ item: g }) => (
                  <SegChip label={g} on={genre === g} onPress={() => setGenre(genre === g ? null : g)} />
                )}
              />
            )}
          </View>
        }
        ListFooterComponent={loading ? <ActivityIndicator color={C.text} style={{ margin: 20 }} /> : null}
        renderItem={({ item }) => <JfPosterCard item={item} width={cardW} />}
      />
      <BackButton />
    </View>
  );
}

// ——— Fiche film / série ———

function ItemDetail({ item, reload }: { item: JfItem; reload: () => void }) {
  const serverReq = useServerRequests();
  const tmdbId = item.ProviderIds?.Tmdb ? Number(item.ProviderIds.Tmdb) : undefined;
  const { settings } = useSettings();
  const { width, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [similar, setSimilar] = useState<JfItem[]>([]);
  const [fav, setFav] = useState(Boolean(item.UserData?.IsFavorite));
  const [showRate, setShowRate] = useState(false);

  useEffect(() => {
    // TV : pas de rangée « Dans le même genre » (elle était coupée en bas de l'écran)
    if (Platform.isTV) return;
    jf.similar(settings, item.Id).then(setSimilar).catch(() => {});
  }, [settings, item.Id]);

  // TV : image de fond TMDB (nette, en 16:9, sans texte) plutôt que celle de Jellyfin, souvent petite ou recadrée
  const [tmdbBackdrop, setTmdbBackdrop] = useState<string | undefined>();
  useEffect(() => {
    if (!Platform.isTV || !tmdbId || !settings.tmdbKey) return;
    const get = item.Type === 'Series' ? tmdb.tv(settings, tmdbId) : tmdb.movie(settings, tmdbId);
    get
      .then((d: any) => {
        const clean = (d.images?.backdrops ?? []).find((b: { iso_639_1?: string | null }) => !b.iso_639_1)?.file_path;
        setTmdbBackdrop(tmdbImg(clean ?? d.backdrop_path, 'w1280') ?? jfBackdrop(settings, item, 1920));
      })
      .catch(() => setTmdbBackdrop(jfBackdrop(settings, item, 1920)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, item.Type]);


  // Liste « À voir » : signet à côté de J'aime
  const wlItem =
    tmdbId && (item.Type === 'Movie' || item.Type === 'Series')
      ? {
          type: (item.Type === 'Series' ? 'tv' : 'movie') as 'tv' | 'movie',
          tmdbId,
          title: item.Name,
          year: item.ProductionYear ? String(item.ProductionYear) : undefined,
          poster: tmdbArtFor(settings, item, 'poster') ?? jfPoster(settings, item, 342),
        }
      : null;

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    await jf.setFavorite(settings, item.Id, next).catch(() => setFav(!next));
  }

  const isSeries = item.Type === 'Series';
  // Sur TV (paysage), le hero ne dépasse pas l'écran
  // TV : image moins haute (elle remplissait tout l'écran)
  // Téléphone : l'affiche entière (son titre fait partie de l'image, on n'en rajoute pas par-dessus)
  const heroH = Platform.isTV ? Math.round(screenH * 0.94) : Math.round(width * 1.5);
  const logo = jfLogo(settings, item);
  const resumeAt = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const cast = (item.People ?? []).filter((p) => p.Type === 'Actor').slice(0, 15);
  const director = (item.People ?? []).filter((p) => p.Type === 'Director' || p.Type === 'Creator').slice(0, 2).map((p) => p.Name).join(', ');

  const eps = useSeriesEpisodes(isSeries ? item.Id : undefined);
  const episodes = eps.episodes;

  // Saisons qui manquent sur le serveur : proposées à la demande, saison par saison (fiche TMDB de la série)
  const [show, setShow] = useState<TmdbTv | null>(null);
  useEffect(() => {
    if (!isSeries || !tmdbId || !serverReq || !hasTmdb(settings)) return;
    tmdb.tv(settings, tmdbId).then(setShow).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeries, tmdbId, serverReq]);

  const nextEpisode = episodes.find((e) => !e.UserData?.Played) ?? episodes[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* TV, comme Nuvio : le fond reste fixe en plein écran, la page défile par-dessus */}
      {Platform.isTV ? (
        <TvBackdropLayer info={{ key: item.Id, title: item.Name, backdrop: tmdbBackdrop ?? (settings.tmdbKey && tmdbId ? undefined : jfBackdrop(settings, item, 1920)) }} />
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.isTV ? 120 : 40) }}>
        <View style={{ height: heroH }}>
          {Platform.isTV ? null : (
            <>
              <Image source={jfPoster(settings, item, 1400)} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" transition={250} />
              <Fade height={heroH * 0.3} top />
              <Fade height={heroH * 0.7} />
            </>
          )}
          {Platform.isTV ? (
            // TV, comme Nuvio : logo, boutons juste dessous, puis réalisateur, résumé et infos
            <View style={styles.heroContentTv}>
              {logo ? (
                <Image source={logo} style={{ width: 340, height: 120 }} contentFit="contain" contentPosition="left bottom" />
              ) : (
                <Text style={[styles.title, { textAlign: 'left' }]}>{item.Name}</Text>
              )}
                <TvActionRow>
                  {isSeries ? (
                    nextEpisode ? (
                      <TvPill hasTVPreferredFocus icon="play" label={`Regarder S${nextEpisode.ParentIndexNumber}E${nextEpisode.IndexNumber}`} onPress={() => playJellyfin(nextEpisode)} />
                    ) : null
                  ) : (
                    <TvPill
                      hasTVPreferredFocus
                      icon="play"
                      label={resumeAt > 30 ? `Reprendre · ${formatRuntime(item.UserData?.PlaybackPositionTicks)}` : 'Regarder'}
                      onPress={() => playJellyfin(item)}
                    />
                  )}
                  {!isSeries && resumeAt > 30 ? <TvRound icon="refresh" label="Depuis le début" onPress={() => playJellyfin(item, true)} /> : null}
                  <TvRound
                    icon="checkmark"
                    iconOn="checkmark-done"
                    on={item.UserData?.Played}
                    color={C.success}
                    label={item.UserData?.Played ? 'Vu' : 'Marquer vu'}
                    onPress={async () => {
                      await jf.setPlayed(settings, item.Id, !item.UserData?.Played).catch(() => {});
                      reload();
                    }}
                  />
                  {serverReq && tmdbId ? <TvRound icon="star-outline" iconOn="star" on={showRate} color={TV_GOLD} label="Noter" onPress={() => setShowRate((v) => !v)} /> : null}
                  <TvRound icon="heart-outline" iconOn="heart" on={fav} color="#FF375F" label="J'aime" onPress={toggleFav} />
                </TvActionRow>
              {director ? <Text style={styles.tvLine}>{isSeries ? 'Créée par' : 'Réalisateur'} : {director}</Text> : null}
              {item.Overview ? (
                <Text style={styles.overviewTv} numberOfLines={3}>
                  {item.Overview}
                </Text>
              ) : null}
              <Text style={styles.tvLine}>
                {[item.Genres?.slice(0, 2).join(' • '), item.PremiereDate ? new Date(item.PremiereDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : item.ProductionYear ? String(item.ProductionYear) : null, item.CommunityRating ? `Note ${item.CommunityRating.toFixed(1)}` : null]
                  .filter(Boolean)
                  .join('   •   ')}
              </Text>
              <Text style={styles.tvLine}>
                {[!isSeries && item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null, isSeries && item.ChildCount ? `${item.ChildCount} saison${item.ChildCount > 1 ? 's' : ''}` : null, item.OfficialRating]
                  .filter(Boolean)
                  .join('   •   ')}
              </Text>
            </View>
          ) : (
          <View style={styles.heroContent}>
              {!Platform.isTV ? null : logo ? (
                <Image
                  source={logo}
                  style={Platform.isTV ? { width: 320, height: 120 } : { width: Math.min(width * 0.7, 460), height: 100 }}
                  contentFit="contain"
                  contentPosition={Platform.isTV ? 'left bottom' : 'bottom'}
                />
              ) : (
                <Text style={[styles.title, Platform.isTV && { textAlign: 'left' }]}>{item.Name}</Text>
              )}
              <View style={[styles.pills, Platform.isTV && { justifyContent: 'flex-start' }]}>
                {item.ProductionYear ? <Pill>{String(item.ProductionYear)}</Pill> : null}
                {item.RunTimeTicks && !isSeries ? <Pill icon="time-outline">{formatRuntime(item.RunTimeTicks)}</Pill> : null}
                {item.OfficialRating ? <Pill>{item.OfficialRating}</Pill> : null}
                {item.CommunityRating ? <Pill icon="star">{item.CommunityRating.toFixed(1)}</Pill> : null}
                {isSeries && item.ChildCount ? <Pill>{`${item.ChildCount} saisons`}</Pill> : null}
              </View>
              {item.Genres?.length ? <Text style={styles.genres}>{item.Genres.slice(0, 3).join('  •  ')}</Text> : null}
            </View>
          )}
        </View>

        <View style={[{ paddingHorizontal: 16, gap: 18 }, Platform.isTV && styles.tvColumn]}>
          {Platform.isTV ? null : !isSeries ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  title={resumeAt > 30 ? `Reprendre à ${formatRuntime(item.UserData?.PlaybackPositionTicks)}` : 'Lire'}
                  icon="play"
                  small
                  onPress={() => playJellyfin(item)}
                  style={{ flex: 1.3 }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {resumeAt > 30 && (
                  <Button title="Depuis le début" icon="refresh" variant="glass" small onPress={() => playJellyfin(item, true)} style={{ flex: 1 }} />
                )}
                <Button title="" icon={fav ? 'heart' : 'heart-outline'} variant="glass" small onPress={toggleFav} style={{ width: 46, paddingHorizontal: 0 }} />
                {wlItem ? <WatchlistButton item={wlItem} variant="icon" /> : null}
                <Button
                  small
                  title={item.UserData?.Played ? 'Vu' : 'Marquer vu'}
                  icon={item.UserData?.Played ? 'checkmark-circle' : 'checkmark-circle-outline'}
                  variant="glass"
                  onPress={async () => {
                    await jf.setPlayed(settings, item.Id, !item.UserData?.Played).catch(() => {});
                    reload();
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {nextEpisode ? (
                  <Button
                    title={`Lire S${nextEpisode.ParentIndexNumber}E${nextEpisode.IndexNumber}`}
                    icon="play"
                    small
                    onPress={() => playJellyfin(nextEpisode)}
                    style={{ flex: 1.3 }}
                  />
                ) : null}
                <Button title="" icon={fav ? 'heart' : 'heart-outline'} variant="glass" small onPress={toggleFav} style={{ width: 46, paddingHorizontal: 0 }} />
                {wlItem ? <WatchlistButton item={wlItem} variant="icon" /> : null}
              </View>
            </View>
          )}


          {/* Admin : voir le fichier dans la gestion des disques, ou supprimer le titre */}
          {settings.jellyfin?.isAdmin === true && !Platform.isTV ? <AdminItemActions item={item} reload={reload} /> : null}

          {/* Notes de la famille et signalement d'un problème (serveur Lumio) */}
          {serverReq && tmdbId && Platform.isTV ? (
            showRate ? <FamilyRating type={isSeries ? 'tv' : 'movie'} tmdbId={tmdbId} title={item.Name} poster={jfPoster(settings, item, 342)} /> : null
          ) : serverReq && tmdbId ? (
            <View style={{ gap: 6 }}>
              <FamilyRating type={isSeries ? 'tv' : 'movie'} tmdbId={tmdbId} title={item.Name} poster={jfPoster(settings, item, 342)} />
              <ReportProblemButton type={isSeries ? 'tv' : 'movie'} tmdbId={tmdbId} title={item.Name} poster={jfPoster(settings, item, 342)} />
            </View>
          ) : null}

          {item.Overview && !Platform.isTV ? <Text style={styles.overview}>{item.Overview}</Text> : null}

          {isSeries ? <EpisodePicker {...eps} /> : null}

          {isSeries && show && tmdbId ? (
            <SeasonRequests tmdbId={tmdbId} show={show} onlyMissing title="Saisons manquantes" />
          ) : null}

          {similar.length > 0 && !Platform.isTV && (
            <View style={{ marginHorizontal: -16 }}>
              <JfRow title="Dans le même genre" items={similar} />
            </View>
          )}

          {cast.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Casting</Text>
              <FlatList
                horizontal
                data={cast}
                keyExtractor={(c) => c.Id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14 }}
                renderItem={({ item: c }) => (
                  <Pressable focusable={Platform.isTV} tvFocus="card" onPress={() => {}} style={styles.castItem}>
                    <View style={styles.castPhoto}>
                      {c.PrimaryImageTag ? (
                        <Image
                          source={jfImage(settings, c.Id, 'Primary', { tag: c.PrimaryImageTag, maxHeight: 200 })}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                        />
                      ) : (
                        <Ionicons name="person" size={28} color={C.textFaint} />
                      )}
                    </View>
                    <Text style={styles.castName} numberOfLines={2}>
                      {c.Name}
                    </Text>
                    {c.Role ? (
                      <Text style={styles.castRole} numberOfLines={1}>
                        {c.Role}
                      </Text>
                    ) : null}
                  </Pressable>
                )}
              />
            </View>
          )}
        </View>
      </ScrollView>
      <BackButton />
    </View>
  );
}

/** Admin : « Voir dans le disque » (ouvre la gestion des disques sur le dossier du titre) et « Supprimer ». */
function AdminItemActions({ item, reload }: { item: JfItem; reload: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const isSeries = item.Type === 'Series';

  const showOnDisk = async () => {
    if (!item.Path) return toast('Chemin du fichier inconnu', 'error');
    setBusy('disk');
    try {
      // Série : son dossier ; film : le dossier qui contient le fichier
      const loc = await filesApi.locate(settings, item.Path);
      router.push({ pathname: '/files', params: { root: loc.root, folder: loc.folder, highlight: loc.name ?? '' } });
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert(
      `Supprimer « ${item.Name} » ?`,
      isSeries
        ? 'La série, toutes ses saisons et leurs fichiers seront supprimés du disque. Pense à la retirer aussi de Sonarr pour qu’elle ne revienne pas.'
        : 'Le film et son fichier seront supprimés du disque. Pense à le retirer aussi de Radarr pour qu’il ne revienne pas.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              await jf.deleteItem(settings, item.Id);
              toast(`« ${item.Name} » supprimé`);
              router.back();
            } catch (e: any) {
              toast(e?.message ?? String(e), 'error');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Voir dans le disque" icon="folder-open-outline" variant="secondary" small loading={busy === 'disk'} onPress={showOnDisk} style={{ flex: 1 }} />
        <Button title="Supprimer" icon="trash-outline" variant="danger" small loading={busy === 'delete'} onPress={remove} style={{ flex: 1 }} />
      </View>
      <Button title="Corriger les infos" icon="create-outline" variant="secondary" small onPress={() => setEditing(true)} />
      <MetadataEditor item={item} visible={editing} onClose={() => setEditing(false)} onDone={reload} />
    </View>
  );
}

export default function JellyfinItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const [item, setItem] = useState<JfItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    jf.item(settings, id)
      .then(setItem)
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings, id]);

  // Recharge au retour du lecteur pour mettre à jour la progression
  useFocusEffect(load);

  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>{error}</Text>
        <BackButton />
      </View>
    );
  if (!item)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.text} size="large" />
      </View>
    );
  if (FOLDER_TYPES.includes(item.Type)) return <FolderGrid folder={item} />;
  return <ItemDetail item={item} reload={load} />;
}

const styles = StyleSheet.create({
  // TV : colonne alignée à gauche sous les infos (boutons Lire / Vu compacts), comme Nuvio
  tvColumn: { width: '100%', maxWidth: 1100, alignSelf: 'flex-start', paddingLeft: 48 },
  heroContentTv: { position: 'absolute', left: 48, bottom: 36, width: '48%', alignItems: 'flex-start', gap: 10 },
  tvLine: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  overviewTv: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 22 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  back: {
    position: 'absolute',
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  dim: { color: C.textDim, fontSize: 13 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceHigh,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 10 },
  sorts: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 6, flexWrap: 'wrap' },
  sort: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.surfaceHigh },
  sortText: { color: C.textDim, fontSize: 13, fontWeight: '700' },
  heroContent: { position: 'absolute', left: 20, right: 20, bottom: 12, alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -0.8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  genres: { color: C.text, fontSize: 13, fontWeight: '600', opacity: 0.85 },
  overview: { color: C.text, fontSize: 15, lineHeight: 23, opacity: 0.88 },
  sectionTitle: { color: C.text, fontSize: 20, fontWeight: '800', marginBottom: 12, letterSpacing: -0.3 },
  episode: { flexDirection: 'row', gap: 12 },
  epThumb: { width: 140, height: 79, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  epPlay: {
    position: 'absolute',
    left: 6,
    bottom: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  epBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  epBarFill: { height: 3, backgroundColor: C.text },
  epTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  epOverview: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  castItem: { width: Platform.isTV ? 130 : 84, alignItems: 'center' },
  castPhoto: {
    width: Platform.isTV ? 112 : 76,
    height: Platform.isTV ? 112 : 76,
    borderRadius: Platform.isTV ? 56 : 38,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  castName: { color: C.text, fontSize: Platform.isTV ? 15 : 12, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  castRole: { color: C.textDim, fontSize: Platform.isTV ? 13 : 11, textAlign: 'center', marginTop: 2 },
});
