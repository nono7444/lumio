import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast, Toasts } from '@/components/toast';
import { Button, Fade } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { resolveWatch } from '@/lib/smart-play';
import { tmdb, tmdbImg } from '@/lib/tmdb';
import { serverCall } from '@/lib/chat';
import { jf } from '@/lib/jellyfin';

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

        const ask = () =>
          resolveWatch(settings, {
            type,
            tmdbId,
            imdb,
            title: p.title,
            season: p.season ? Number(p.season) : undefined,
            episode: p.episode ? Number(p.episode) : undefined,
          });
        let res = await ask();
        // Titre tout juste arrivé sur le serveur : Jellyfin finit parfois de l'indexer, on réessaie quelques secondes
        for (let i = 0; i < 4 && res.kind !== 'jellyfin' && !cancelled.current; i++) {
          setStep('Arrivée dans ta bibliothèque…');
          jf.invalidateIndex();
          await new Promise((r) => setTimeout(r, 4000));
          res = await ask();
        }
        if (cancelled.current) return;

        // ——— Disponible sur Jellyfin (bouton « Lire ») ———
        if (res.kind === 'jellyfin') {
          const it = res.item;
          // Commencé en streaming avant l'arrivée du fichier : on reprend à la position gardée par le serveur
          let streamPos = 0;
          if (!res.resume && settings.chatUrl) {
            const qs = new URLSearchParams({ type, tmdbId: String(tmdbId) });
            if (it.Type === 'Episode') (qs.set('season', String(it.ParentIndexNumber ?? 1)), qs.set('episode', String(it.IndexNumber ?? 1)));
            streamPos = await serverCall<{ position: number }>(settings, `/api/watch/progress?${qs}`)
              .then((r) => r.position || 0)
              .catch(() => 0);
          }
          router.replace({
            pathname: '/player',
            params: {
              kind: 'jellyfin',
              itemId: it.Id,
              title: it.Type === 'Episode' ? `${it.SeriesName ?? p.title} · S${it.ParentIndexNumber}E${it.IndexNumber}` : it.Name,
              subtitle: it.Type === 'Episode' ? it.Name : String(it.ProductionYear ?? ''),
              start: res.resume ? String((it.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000) : String(streamPos),
            },
          });
          return;
        }

        // ——— Pas (encore) sur Jellyfin ———
        throw new Error(
          type === 'tv' && (res as any).season != null
            ? `L’épisode S${(res as any).season}E${(res as any).episode} n’est pas encore sur ton serveur. Télécharge-le ou demande-le depuis la fiche.`
            : 'Pas encore sur ton serveur. Télécharge-le ou demande-le depuis la fiche.'
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
