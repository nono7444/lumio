import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toasts } from '@/components/toast';
import { Button, Fade } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { requestsApi } from '@/lib/requests';
import { secourStreamApi } from '@/lib/secour';
import { resolveWatch } from '@/lib/smart-play';
import { tmdb, tmdbImg } from '@/lib/tmdb';

type Params = {
  type: 'movie' | 'tv';
  tmdbId: string;
  imdb?: string;
  title: string;
  season?: string;
  episode?: string;
};

/**
 * Écran de transition du bouton « Lire » : trouve quoi lire sur Jellyfin
 * (le film, ou le premier épisode non vu), puis ouvre le lecteur.
 */
export default function Watch() {
  const p = useLocalSearchParams<Params>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState('Recherche dans ta bibliothèque…');
  const [failure, setFailure] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<string | undefined>();
  const cancelled = useRef(false);

  const tmdbId = Number(p.tmdbId);
  const type = p.type === 'tv' ? 'tv' : 'movie';

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      try {
        const details = type === 'movie' ? await tmdb.movie(settings, tmdbId) : await tmdb.tv(settings, tmdbId);
        setBackdrop(tmdbImg(details.backdrop_path, 'w1280'));
        const imdb = p.imdb || (type === 'movie' ? (details as any).imdb_id : (details as any).external_ids?.imdb_id);

        const res = await resolveWatch(settings, {
          type,
          tmdbId,
          imdb,
          title: p.title,
          season: p.season ? Number(p.season) : undefined,
          episode: p.episode ? Number(p.episode) : undefined,
        });
        if (cancelled.current) return;

        // ——— Disponible sur Jellyfin ———
        if (res.kind === 'jellyfin') {
          const it = res.item;
          router.replace({
            pathname: '/player',
            params: {
              kind: 'jellyfin',
              itemId: it.Id,
              title: it.Type === 'Episode' ? `${it.SeriesName ?? p.title} · S${it.ParentIndexNumber}E${it.IndexNumber}` : it.Name,
              subtitle: it.Type === 'Episode' ? it.Name : String(it.ProductionYear ?? ''),
              start: res.resume ? String((it.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000) : '0',
            },
          });
          return;
        }

        // ——— Pas (encore) sur Jellyfin : demande à Radarr / Sonarr, et lecture tout de suite via Lumio Secour ———
        if (settings.chatUrl && settings.jellyfin) {
          const season = type === 'tv' ? res.season ?? 1 : undefined;
          const episode = type === 'tv' ? res.episode ?? 1 : undefined;
          // Demande (déjà demandé, quota… : ignoré, la lecture n'en dépend pas)
          requestsApi
            .create(settings, {
              type,
              tmdbId,
              tvdbId: type === 'tv' ? (details as any).external_ids?.tvdb_id ?? undefined : undefined,
              seasons: type === 'tv' ? [season!] : undefined,
              title: p.title,
              year: ((details as any).release_date ?? (details as any).first_air_date ?? '').slice(0, 4) || undefined,
              poster: tmdbImg(details.poster_path, 'w342') ?? undefined,
              backdrop: tmdbImg(details.backdrop_path, 'w780') ?? undefined,
            })
            .catch(() => {});
          setStep('Pas encore sur le serveur : recherche d’un lien de lecture…');
          try {
            const st = await secourStreamApi.get(settings, { type, tmdbId, imdb, season, episode });
            if (cancelled.current) return;
            const ep = type === 'tv' ? `S${season}E${episode}` : '';
            router.replace({
              pathname: '/player',
              params: {
                kind: 'url',
                uri: st.url,
                title: type === 'tv' ? `${p.title} · ${ep}` : p.title,
                subtitle: `Lumio Secour${st.quality && st.quality !== 'Unknown' ? ` · ${st.quality}` : ''} · en attendant le téléchargement`,
                // Épisode suivant : le lecteur repasse par cet écran
                ...(type === 'tv' ? { tmdbId: String(tmdbId), imdb, series: p.title, season: String(season), episode: String(episode) } : {}),
              },
            });
            return;
          } catch (e: any) {
            throw new Error(
              `${e?.message ?? String(e)}\n\nLa demande est envoyée : ${type === 'tv' ? 'l’épisode' : 'le film'} arrivera sur le serveur dès qu’il sera téléchargé.`
            );
          }
        }
        throw new Error(
          type === 'tv' && res.season != null
            ? `L’épisode S${res.season}E${res.episode} n’est pas encore sur ton serveur. Demande-le depuis la fiche.`
            : 'Pas encore sur ton serveur. Demande-le depuis la fiche.'
        );
      } catch (e: any) {
        if (!cancelled.current) setFailure(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      {backdrop && <Image source={backdrop} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={18} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      <Fade height={400} />

      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={2}>
          {p.title}
        </Text>
        {failure ? (
          <View style={{ alignItems: 'center', gap: 14, width: '100%', maxWidth: 420 }}>
            <Ionicons name="alert-circle-outline" size={40} color={C.text} />
            <Text style={styles.msg}>{failure}</Text>
            <Button title="Fermer" variant="glass" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.msg}>{step}</Text>
          </>
        )}
      </View>

      <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + 8 }]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
      <Toasts />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5, marginBottom: 8 },
  msg: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  close: {
    position: 'absolute',
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
