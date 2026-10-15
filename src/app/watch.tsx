import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { askFolder } from '@/components/folder-picker';
import { Button, Fade } from '@/components/ui';
import { C } from '@/constants/theme';
import { grab } from '@/lib/grab';
import { useSettings } from '@/lib/settings';
import { resolveWatch } from '@/lib/smart-play';
import { bestStream, collectStreams } from '@/lib/streams';
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
 * Écran de transition du bouton « Lire » : trouve quoi lire (Jellyfin ou streaming),
 * lance le téléchargement si besoin, puis ouvre le lecteur.
 */
export default function Watch() {
  const p = useLocalSearchParams<Params>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState('Recherche dans ta bibliothèque…');
  const [failure, setFailure] = useState<string | null>(null);
  const [grabNote, setGrabNote] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<string | undefined>();
  const [ep, setEp] = useState<{ season?: number; episode?: number }>({});
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

        // ——— Streaming + téléchargement en arrière-plan ———
        setEp({ season: res.season, episode: res.episode });
        // Série absente de Jellyfin : on la télécharge entièrement ; sinon juste la saison manquante
        // Le lecteur attend que le dossier soit choisi (sinon il s'ouvrirait sous la fenêtre de choix)
        let release: () => void = () => {};
        const folderGate = new Promise<void>((r) => (release = r));
        grab(
          settings,
          { type, tmdbId, season: res.season, allSeasons: type === 'tv' && !res.seriesInJellyfin },
          {
            streaming: true,
            chooseFolder: async (c) => {
              const f = await askFolder(c);
              release();
              return f;
            },
          }
        )
          .then(setGrabNote)
          .catch((e) => setGrabNote(`Téléchargement non lancé : ${e?.message ?? e}`))
          .finally(release);

        if (!imdb) throw new Error('Identifiant IMDb introuvable pour ce titre : impossible de chercher des sources.');
        if (!settings.addons.length) throw new Error('Aucun addon de streams configuré (Profil → Addons Stremio).');
        setStep(type === 'tv' ? `Recherche d'une source pour S${res.season}E${res.episode}…` : 'Recherche de la meilleure source…');

        const stremioId = type === 'tv' ? `${imdb}:${res.season}:${res.episode}` : imdb;
        const { streams, errors } = await collectStreams(settings, type === 'tv' ? 'series' : 'movie', stremioId, { timeoutMs: 15000 });
        if (cancelled.current) return;
        const best = bestStream(streams);
        if (!best?.url) throw new Error(errors.length ? errors.join('\n') : 'Aucune source lisible trouvée par tes addons.');
        setStep('Lancement…');
        await folderGate;
        if (cancelled.current) return;

        router.replace({
          pathname: '/player',
          params: {
            kind: 'url',
            uri: best.url,
            title: type === 'tv' ? `${p.title} · S${res.season}E${res.episode}` : p.title,
            subtitle: [best.quality, best.fr ? 'VF' : null, best.addon].filter(Boolean).join(' · '),
            headers: best.behaviorHints?.proxyHeaders?.request ? JSON.stringify(best.behaviorHints.proxyHeaders.request) : undefined,
            // Contexte pour l'épisode suivant
            tmdbId: String(tmdbId),
            imdb,
            series: p.title,
            season: res.season != null ? String(res.season) : undefined,
            episode: res.episode != null ? String(res.episode) : undefined,
          },
        });
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
            {grabNote && <Text style={[styles.msg, { color: C.success }]}>{grabNote}</Text>}
            <Button
              title="Choisir une source"
              icon="list"
              onPress={() =>
                router.replace({
                  pathname: '/streams',
                  params: {
                    type,
                    tmdbId: String(tmdbId),
                    imdb: p.imdb ?? '',
                    title: p.title,
                    season: ep.season != null ? String(ep.season) : undefined,
                    episode: ep.episode != null ? String(ep.episode) : undefined,
                  },
                })
              }
              style={{ alignSelf: 'stretch' }}
            />
            <Button title="Fermer" variant="glass" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.msg}>{step}</Text>
            {grabNote && <Text style={[styles.msg, { color: C.success }]}>{grabNote}</Text>}
          </>
        )}
      </View>

      <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + 8 }]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Pressable>
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
