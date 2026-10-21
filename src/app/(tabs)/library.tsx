// Bibliothèque : uniquement les bibliothèques Jellyfin, en grandes cartes (affiches récentes en éventail, nombre de titres).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/tv';
import { Button, ScreenTitle, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { libraryRowDefs, orderLibraryRows } from '@/lib/home-layout';
import { jf, jfBackdrop, jfImage, jfPoster, JellyfinError, type JfItem } from '@/lib/jellyfin';
import { useLumioCollections } from '@/lib/collections';
import { useSettings } from '@/lib/settings';

type Lib = { view: JfItem; count: number | null; posters: string[]; backdrops: string[] };

const TYPES: Record<string, string> = {
  movies: 'Movie',
  tvshows: 'Series',
  boxsets: 'BoxSet',
};

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  movies: 'film',
  tvshows: 'tv',
  boxsets: 'albums',
  homevideos: 'videocam',
  mixed: 'folder-open',
};

const UNIT: Record<string, [string, string]> = {
  movies: ['film', 'films'],
  tvshows: ['série', 'séries'],
  boxsets: ['collection', 'collections'],
};

// Teinte de chaque carte, selon le type de bibliothèque
const TINT: Record<string, [string, string]> = {
  movies: ['#1B2A4A', '#0B1220'],
  tvshows: ['#2A1B4A', '#120B20'],
  boxsets: ['#3A2A12', '#1A120B'],
};

function LibraryCard({ lib, width, onChooseCover }: { lib: Lib; width: number; onChooseCover: () => void }) {
  const { settings } = useSettings();
  // Image de la carte : celle choisie, sinon l'image large du dernier titre ajouté
  const cover = settings.libraryCovers?.[lib.view.Id] ?? lib.backdrops[0];
  const type = lib.view.CollectionType ?? 'mixed';
  const height = Math.round(width * 0.62);
  const [a, b] = TINT[type] ?? ['#1C1C1E', '#0E0E10'];
  const unit = UNIT[type] ?? ['titre', 'titres'];
  const own = cover ?? (lib.view.ImageTags?.Primary
    ? jfImage(settings, lib.view.Id, 'Primary', { tag: lib.view.ImageTags.Primary, maxWidth: 900 })
    : undefined);
  const pw = Math.round(height * 0.62);

  return (
    <Pressable
      onPress={() => {
        tap();
        router.push({ pathname: '/jellyfin/[id]', params: { id: lib.view.Id } });
      }}
      // Appui long : choisir l'image de la carte
      onLongPress={onChooseCover}
      delayLongPress={400}
      style={({ pressed }) => [styles.card, { width, height, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <LinearGradient colors={[a, b]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      {own ? (
        <Image source={own} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        // Éventail des dernières sorties
        <View style={[StyleSheet.absoluteFill, { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 18 }]}>
          {lib.posters.slice(0, 3).map((p, i, arr) => (
            <Image
              key={p}
              source={p}
              contentFit="cover"
              transition={200}
              style={[
                styles.poster,
                {
                  width: pw,
                  height: Math.round(pw * 1.5),
                  position: 'absolute',
                  right: 18 + (arr.length - 1 - i) * pw * 0.42,
                  transform: [{ rotate: `${(i - (arr.length - 1) / 2) * 7}deg` }, { scale: i === arr.length - 1 ? 1 : 0.9 }],
                  zIndex: i,
                },
              ]}
            />
          ))}
        </View>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']}
        start={{ x: 0, y: 0.25 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.cardText}>
        <View style={styles.iconWrap}>
          <Ionicons name={ICON[type] ?? 'folder'} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {lib.view.Name}
          </Text>
          {lib.count != null ? (
            <Text style={styles.count}>
              {lib.count.toLocaleString('fr-FR')} {lib.count > 1 ? unit[1] : unit[0]}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
      </View>
    </Pressable>
  );
}

/** Carte « Collections » (sagas rangées par Lumio). */
function CollectionsCard({ data, width }: { data: { building: boolean; collections: { poster: string | null }[] }; width: number }) {
  const height = Math.round(width * 0.62);
  const pw = Math.round(height * 0.62);
  const posters = data.collections.map((c) => c.poster).filter((p): p is string => Boolean(p)).slice(0, 3);
  return (
    <Pressable
      onPress={() => {
        tap();
        router.push('/collections');
      }}
      style={({ pressed }) => [styles.card, { width, height, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <LinearGradient colors={TINT.boxsets} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 18 }]}>
        {posters.map((p, i, arr) => (
          <Image
            key={p}
            source={p}
            contentFit="cover"
            style={[
              styles.poster,
              {
                width: pw,
                height: Math.round(pw * 1.5),
                position: 'absolute',
                right: 18 + (arr.length - 1 - i) * pw * 0.42,
                transform: [{ rotate: `${(i - (arr.length - 1) / 2) * 7}deg` }, { scale: i === arr.length - 1 ? 1 : 0.9 }],
                zIndex: i,
              },
            ]}
          />
        ))}
      </View>
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} start={{ x: 0, y: 0.25 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.cardText}>
        <View style={styles.iconWrap}>
          <Ionicons name="albums" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Collections</Text>
          <Text style={styles.count}>
            {data.collections.length
              ? `${data.collections.length} saga${data.collections.length > 1 ? 's' : ''}`
              : data.building
                ? 'Rangement en cours…'
                : 'Aucune saga'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
      </View>
    </Pressable>
  );
}

export default function Library() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [libs, setLibs] = useState<Lib[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    if (!settings.jellyfin) return;
    setError(null);
    try {
      const views = await jf.views(settings);
      const out = await Promise.all(
        views.map(async (v): Promise<Lib> => {
          const r = await jf
            .items(settings, {
              parentId: v.Id,
              types: TYPES[v.CollectionType ?? ''] ?? 'Movie,Series',
              sort: 'PremiereDate,ProductionYear,SortName',
              order: 'Descending',
              limit: 12,
            })
            .catch(() => null);
          const items = r?.Items ?? [];
          return {
            view: v,
            count: r?.TotalRecordCount ?? null,
            posters: items.slice(0, 3).map((i) => jfPoster(settings, i, 420)).filter((x): x is string => Boolean(x)).reverse(),
            backdrops: items.filter((i) => i.BackdropImageTags?.length).map((i) => jfBackdrop(settings, i, 1280)!),
          };
        })
      );
      setLibs(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setExpired(e instanceof JellyfinError && e.status === 401);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Choix de l'image d'une carte (appui long)
  const [choosing, setChoosing] = useState<Lib | null>(null);

  // Collections propres de Lumio : remplacent les collections Jellyfin (souvent en vrac)
  const lumioColl = useLumioCollections(settings);

  // Ordre et visibilité choisis dans Personnaliser
  const ordered = orderLibraryRows(
    libraryRowDefs(libs.map((l) => l.view)).map((d) => ({ ...d, lib: libs.find((l) => `lib:${l.view.Id}` === d.id)! })),
    settings.libraryLayout
  ).filter((r) => !r.hidden && r.lib && !(lumioColl && r.lib.view.CollectionType === 'boxsets'));

  // 2 colonnes sur iPad / TV, 1 sur téléphone
  const cols = Platform.isTV ? 3 : width >= 700 ? 2 : 1;
  const cardW = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 14) / cols);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: TAB_SPACE }}
      refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
      <ScreenTitle
        title="Bibliothèque"
        right={
          <Pressable onPress={() => router.push('/customize')} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="options-outline" size={20} color={C.text} />
          </Pressable>
        }
      />
      {loading && !libs.length ? (
        <ActivityIndicator color={C.text} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={{ alignItems: 'center', gap: 12, padding: 24 }}>
          <Ionicons name="cloud-offline-outline" size={36} color={C.textFaint} />
          <Text style={{ color: C.textDim, textAlign: 'center' }}>{error}</Text>
          {expired ? (
            <Button
              title="Se reconnecter"
              icon="log-in-outline"
              onPress={async () => {
                await update({ jellyfin: null });
                router.replace('/login');
              }}
            />
          ) : (
            <Button title="Réessayer" variant="secondary" onPress={load} />
          )}
        </View>
      ) : (
        <View style={styles.grid}>
          {ordered.map((r) => (
            <LibraryCard key={r.id} lib={r.lib} width={cardW} onChooseCover={() => setChoosing(r.lib)} />
          ))}
          {lumioColl ? <CollectionsCard data={lumioColl} width={cardW} /> : null}
          {!ordered.length ? <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 40, width: '100%' }}>Aucune bibliothèque.</Text> : null}
        </View>
      )}
      <Modal visible={Boolean(choosing)} transparent animationType="slide" onRequestClose={() => setChoosing(null)}>
        <View style={styles.sheetBg}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Image de « {choosing?.view.Name} »</Text>
            <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 10 }}>
              {(choosing?.backdrops ?? []).map((b) => {
                const on = settings.libraryCovers?.[choosing!.view.Id] === b;
                return (
                  <Pressable
                    key={b}
                    onPress={() => {
                      tap();
                      update({ libraryCovers: { ...(settings.libraryCovers ?? {}), [choosing!.view.Id]: b } });
                      setChoosing(null);
                    }}
                    style={[styles.choice, on && { borderColor: C.accent }]}>
                    <Image source={b} style={StyleSheet.absoluteFill} contentFit="cover" />
                  </Pressable>
                );
              })}
              {!choosing?.backdrops.length ? <Text style={{ color: C.textDim }}>Aucune image large dans cette bibliothèque.</Text> : null}
            </ScrollView>
            <Button
              title="Image automatique"
              variant="secondary"
              onPress={() => {
                const next = { ...(settings.libraryCovers ?? {}) };
                if (choosing) delete next[choosing.view.Id];
                update({ libraryCovers: next });
                setChoosing(null);
              }}
            />
            <Button title="Fermer" variant="secondary" onPress={() => setChoosing(null)} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 34 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  choice: { height: 150, borderRadius: R.md, overflow: 'hidden', borderWidth: 3, borderColor: 'transparent', backgroundColor: C.surfaceHigh },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 16, maxWidth: 1132, alignSelf: 'center', width: '100%' },
  card: {
    borderRadius: R.lg,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  poster: {
    borderRadius: 8,
    backgroundColor: C.surfaceHigh,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardText: { position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  count: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', marginTop: 1 },
  headerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
});
