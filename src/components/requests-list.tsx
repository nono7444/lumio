import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View, Platform } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, SegChip, tap } from '@/components/ui';
import { C, R, TAB_SPACE } from '@/constants/theme';
import { openMedia } from '@/lib/navigation';
import { REQUEST_STATUS, requestLabel, seerr, SeerrError, type SeerrRequest } from '@/lib/seerr';
import { useSettings, type Settings } from '@/lib/settings';
import { tmdb, tmdbImg } from '@/lib/tmdb';

type Info = { title: string; poster?: string; year?: string };
const cache = new Map<string, Info>();

async function info(s: Settings, r: SeerrRequest): Promise<Info> {
  const key = `${r.type}:${r.media.tmdbId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res =
    r.type === 'movie'
      ? await tmdb.movie(s, r.media.tmdbId).then((m) => ({ title: m.title, poster: tmdbImg(m.poster_path, 'w185'), year: m.release_date?.slice(0, 4) }))
      : await tmdb.tv(s, r.media.tmdbId).then((t) => ({ title: t.name, poster: tmdbImg(t.poster_path, 'w185'), year: t.first_air_date?.slice(0, 4) }));
  cache.set(key, res);
  return res;
}

function RequestRow({ r, admin, onChanged }: { r: SeerrRequest; admin: boolean; onChanged: () => void }) {
  const { settings } = useSettings();
  const [meta, setMeta] = useState<Info | null>(cache.get(`${r.type}:${r.media.tmdbId}`) ?? null);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);

  useEffect(() => {
    if (!meta && settings.tmdbKey) info(settings, r).then(setMeta).catch(() => {});
  }, [meta, r, settings]);

  const st = requestLabel(r.status);
  const who = r.requestedBy?.displayName ?? r.requestedBy?.jellyfinUsername ?? r.requestedBy?.username;
  const seasons = r.seasons?.length ? `Saisons ${r.seasons.map((x) => x.seasonNumber).join(', ')}` : null;
  const date = new Date(r.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  async function act(kind: 'approve' | 'decline') {
    tap();
    setBusy(kind);
    try {
      if (kind === 'approve') await seerr.approve(settings, r.id);
      else await seerr.decline(settings, r.id);
      onChanged();
    } catch (e: any) {
      Alert.alert('Action impossible', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Pressable
      onPress={() => openMedia(r.type, r.media.tmdbId)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={styles.thumb}>{meta?.poster && <Image source={meta.poster} style={StyleSheet.absoluteFill} contentFit="cover" />}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={2}>
          {meta?.title ?? '…'}
          {meta?.year ? <Text style={styles.dim}> ({meta.year})</Text> : null}
        </Text>
        <Text style={styles.dim}>
          {r.type === 'movie' ? 'Film' : 'Série'} · {date}
          {who ? ` · ${who}` : ''}
        </Text>
        {seasons ? <Text style={styles.dim}>{seasons}</Text> : null}
        <Chip label={st.label} color={st.color} />
        {admin && r.status === REQUEST_STATUS.PENDING && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Button title="Valider" icon="checkmark" onPress={() => act('approve')} loading={busy === 'approve'} style={styles.actBtn} />
            <Button title="Refuser" icon="close" variant="danger" onPress={() => act('decline')} loading={busy === 'decline'} style={styles.actBtn} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Liste des demandes Seerr : les siennes pour un utilisateur, toutes (avec validation) pour l'admin. */
export function Requests({ header, admin }: { header: React.ReactNode; admin: boolean }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SeerrRequest[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending'>(admin ? 'pending' : 'all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!settings.seerr?.url) return;
    setLoading(true);
    try {
      setItems(await seerr.requests(settings, filter));
      setError(null);
    } catch (e: any) {
      setError(e instanceof SeerrError && e.status === 401 ? 'Session expirée : reconnecte-toi au serveur de demandes dans Profil.' : (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  }, [settings, filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bg }}
      data={settings.seerr?.url ? items : []}
      keyExtractor={(r) => String(r.id)}
      renderItem={({ item }) => <RequestRow r={item} admin={admin} onChanged={load} />}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: TAB_SPACE, gap: 12 }}
      refreshControl={Platform.isTV ? undefined : <RefreshControl refreshing={loading} onRefresh={load} tintColor={C.text} />}
      ListHeaderComponent={
        <View style={{ marginHorizontal: -16 }}>
          {header}
          {settings.seerr?.url && (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 }}>
              <SegChip label="En attente" on={filter === 'pending'} onPress={() => setFilter('pending')} />
              <SegChip label={admin ? 'Toutes' : 'Mes demandes'} on={filter === 'all'} onPress={() => setFilter('all')} />
            </View>
          )}
          {error ? <Text style={[styles.dim, { color: C.danger, marginHorizontal: 16, marginBottom: 8 }]}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <View style={{ alignItems: 'center', marginTop: 50, gap: 12, paddingHorizontal: 24 }}>
            <Ionicons name="paper-plane-outline" size={36} color={C.textFaint} />
            <Text style={[styles.dim, { textAlign: 'center' }]}>
              {!settings.seerr?.url
                ? 'Connecte le serveur de demandes (Seerr) dans Profil pour envoyer et suivre des demandes.'
                : filter === 'pending'
                  ? 'Aucune demande en attente.'
                  : 'Aucune demande pour le moment.'}
            </Text>
            {!settings.seerr?.url && <Button title="Ouvrir Profil" variant="secondary" onPress={() => router.push('/settings')} />}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, backgroundColor: C.surface, borderRadius: R.lg, padding: 12 },
  thumb: { width: 66, height: 99, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  dim: { color: C.textDim, fontSize: 12, fontWeight: '400' },
  actBtn: { flex: 1, minHeight: 40, paddingVertical: 9 },
});
