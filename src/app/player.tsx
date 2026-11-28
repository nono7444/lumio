import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CastIcon, CastingScreen, guessContentType, useCasting } from '@/components/players/cast';
import { MpvPlayer } from '@/components/players/mpv-player';
import { NativePlayer } from '@/components/players/native-player';
import { Toasts } from '@/components/toast';
import { GOOGLE_COLORS, GoogleSpinner } from '@/components/google-spinner';
import { noteTwitchProgress, twitchApi } from '@/lib/twitch';
import { Button } from '@/components/ui';
import { C } from '@/constants/theme';
import { getPlayback, jf, jfImage, playback, QUALITIES, type PlaybackTarget } from '@/lib/jellyfin';
import { QualitySheet } from '@/components/players/quality';
import type { SkipSegment, SubtitleFinder } from '@/components/players/types';
import { serverCall } from '@/lib/chat';
import { watchNowApi } from '@/lib/watch-now';
import { tmdbNextEpisode } from '@/lib/smart-play';
import { useSettings } from '@/lib/settings';

type Params = {
  kind: 'jellyfin' | 'url';
  itemId?: string;
  uri?: string;
  headers?: string;
  /** Piste audio séparée (bande-annonce YouTube), lue par mpv */
  audio?: string;
  /** Autres sources (JSON [{uri, headers, label}]) essayées une par une si la lecture échoue */
  alts?: string;
  title?: string;
  subtitle?: string;
  start?: string;
  /** « 1 » : streaming d'un titre absent du serveur → la position est gardée sur le serveur Lumio */
  stream?: string;
  /** « 1 » : flux HLS dont l'adresse ne finit pas par .m3u8 (LooStream) */
  hls?: string;
  /** Rediffusion Twitch : son id et sa durée (position gardée sur le serveur Lumio) */
  twitch?: string;
  twitchLen?: string;
  // Contexte d'une série en streaming (pour l'épisode suivant)
  tmdbId?: string;
  imdb?: string;
  series?: string;
  season?: string;
  episode?: string;
};

type NextUp = { label: string; go: () => void };

const NEXT_DELAY = 8;

type Source = { uri: string; headers?: Record<string, string>; isHls: boolean };

/** Ouvre un lien direct dans un lecteur externe. */
function openExternal(app: 'vlc' | 'infuse', uri: string) {
  const enc = encodeURIComponent(uri);
  const url =
    app === 'vlc'
      ? Platform.OS === 'ios'
        ? `vlc-x-callback://x-callback-url/stream?url=${enc}`
        : `vlc://${uri}`
      : `infuse://x-callback-url/play?url=${enc}`;
  Linking.openURL(url).catch(() => Linking.openURL(uri).catch(() => {}));
}

export default function Player() {
  useKeepAwake();
  const p = useLocalSearchParams<Params>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [engine, setEngine] = useState<'mpv' | 'native'>(
    // TV (Shield…) : le lecteur Android natif décode l'image en matériel ; mpv y donnait le son sans l'image
    Platform.isTV ? 'native' : (settings.player ?? 'mpv')
  );
  // Toujours la qualité d'origine : la conversion par le serveur prenait trop de processeur
  const [quality, setQuality] = useState('original');
  const [qualityOpen, setQualityOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Live TV par le serveur : la réserve anti-coupure se remplit avant d'ouvrir le lecteur (animation + progression)
  const iptv = p.kind === 'url' && /\/api\/iptv\/r\/[^/]+\/c\/[0-9a-f]{12}\.ts$/.test(p.uri ?? '');
  const [warm, setWarm] = useState<{ buffered: number; want: number; ready: boolean } | null>(iptv ? { buffered: 0, want: 15, ready: false } : null);
  useEffect(() => {
    if (!iptv || !p.uri) return;
    let alive = true;
    const base = p.uri.replace(/\.ts$/, '');
    (async () => {
      try {
        const w = await fetch(`${base}/warm`);
        if (!w.ok) throw new Error(((await w.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${w.status}`);
        const t0 = Date.now();
        while (alive) {
          const st = (await (await fetch(`${base}/state`)).json()) as { buffered: number; want: number; ready: boolean; open: boolean; error: string | null };
          if (!alive) return;
          if (st.error) throw new Error(st.error);
          setWarm({ buffered: st.buffered, want: st.want, ready: st.ready });
          if (st.ready || (!st.open && Date.now() - t0 > 3000) || Date.now() - t0 > 60000) break;
          await new Promise((r) => setTimeout(r, 400));
        }
        if (alive) setWarm((w2) => (w2 ? { ...w2, ready: true } : w2));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iptv, p.uri]);
  // Liste des sources directes : la principale puis les alternatives
  const [altIdx, setAltIdx] = useState(0);
  // Image dans l'image demandée depuis mpv : le lecteur natif démarre directement en PiP
  const pipRequested = useRef(false);
  const sources = useRef<{ uri: string; headers?: Record<string, string>; label?: string }[] | null>(null);
  if (sources.current == null && p.uri) {
    let main: Record<string, string> | undefined;
    try {
      main = p.headers ? JSON.parse(p.headers) : undefined;
    } catch {}
    let alts: { uri: string; headers?: Record<string, string>; label?: string }[] = [];
    try {
      alts = p.alts ? JSON.parse(p.alts) : [];
    } catch {}
    sources.current = [{ uri: p.uri, headers: main }, ...alts];
  }
  const sourceCount = sources.current?.length ?? 0;
  const [nextUp, setNextUp] = useState<NextUp | null>(null);
  const [countdown, setCountdown] = useState(NEXT_DELAY);

  const target = useRef<PlaybackTarget | null>(null);
  const position = useRef(0);
  const lastReport = useRef(0);
  const startAt = Number(p.start ?? 0) || 0;
  const { client: castClient, deviceName } = useCasting();
  const casting = Boolean(castClient);

  // Rotation libre dans le lecteur, retour en portrait à la sortie
  useEffect(() => {
    if (Platform.isTV) return;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Prépare la source (le profil Jellyfin dépend du moteur choisi)
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    (async () => {
      try {
        if (p.kind === 'jellyfin' && p.itemId) {
          // Changement de qualité ou de lecteur : l'ancienne lecture (et sa conversion) est arrêtée d'abord
          if (target.current) {
            playback.stop(settings, { target: target.current, positionSeconds: position.current });
            target.current = null;
          }
          const t = await getPlayback(
            settings,
            p.itemId,
            Math.max(position.current, startAt),
            engine,
            QUALITIES.find((x) => x.id === quality)
          );
          if (cancelled) return;
          target.current = t;
          setSource({ uri: t.uri, isHls: t.isHls });
        } else if (sources.current?.length) {
          const cur = sources.current[Math.min(altIdx, sources.current.length - 1)];
          setSource({ uri: cur.uri, headers: cur.headers, isHls: (p.hls === '1' && cur.uri === p.uri) || /\.m3u8(\?|$)|\/proxy\/manifest\?/i.test(cur.uri) });
        } else {
          throw new Error('Aucune source à lire');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, attempt, quality, altIdx]);

  // Erreur de lecture : on passe à la source suivante s'il y en a une, sinon on affiche l'erreur
  const onPlayError = (msg: string) => {
    if (p.kind !== 'jellyfin' && altIdx < sourceCount - 1) {
      setAltIdx((i) => i + 1);
      return;
    }
    setError(msg);
  };

  // Streaming d'un titre absent : position envoyée au serveur Lumio (reprise, puis recopie dans Jellyfin)
  const reportStream = (pos: number) => {
    if (p.stream !== '1' || !p.tmdbId || pos < 5) return;
    watchNowApi.progress(settings, {
      type: p.season ? 'tv' : 'movie',
      tmdbId: Number(p.tmdbId),
      season: p.season ? Number(p.season) : undefined,
      episode: p.episode ? Number(p.episode) : undefined,
      position: pos,
      title: p.series ?? p.title,
    });
  };

  // Fin de lecture signalée à Jellyfin à la fermeture
  useEffect(() => {
    return () => {
      if (target.current) playback.stop(settings, { target: target.current, positionSeconds: position.current });
      reportStream(position.current);
      reportTwitch(position.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportTwitch = (pos: number) => {
    if (!p.twitch || pos < 5) return;
    const len = Number(p.twitchLen) || 0;
    noteTwitchProgress(p.twitch, pos, len);
    twitchApi.progress(settings, p.twitch, pos, len).catch(() => {});
  };
  const onTime = (pos: number, paused: boolean) => {
    position.current = pos;
    const now = Date.now();
    if (p.twitch && now - lastReport.current >= 20_000) {
      lastReport.current = now;
      reportTwitch(pos);
      return;
    }
    if (p.stream === '1' && now - lastReport.current >= 20_000) {
      lastReport.current = now;
      reportStream(pos);
      return;
    }
    if (!target.current || now - lastReport.current < 10_000) return;
    lastReport.current = now;
    playback.progress(settings, { target: target.current, positionSeconds: pos, isPaused: paused });
  };

  // Chaîne en direct avec plusieurs sources : si rien ne démarre en 20 s, on essaie la suivante
  const ready = useRef(false);
  useEffect(() => {
    ready.current = false;
    if (!source || p.kind === 'jellyfin' || altIdx >= sourceCount - 1) return;
    const t = setTimeout(() => {
      if (!ready.current) setAltIdx((i) => i + 1);
    }, 20000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const onReady = (pos: number) => {
    ready.current = true;
    position.current = pos;
    if (target.current) playback.start(settings, { target: target.current, positionSeconds: pos });
  };

  // ——— Épisode suivant ———
  async function findNext(): Promise<NextUp | null> {
    if (!settings.autoNext) return null;
    if (p.kind === 'jellyfin' && p.itemId) {
      const cur = await jf.item(settings, p.itemId).catch(() => null);
      if (cur?.Type !== 'Episode') return null;
      const nxt = await jf.nextEpisode(settings, cur).catch(() => null);
      if (!nxt) return null;
      return {
        label: `S${nxt.ParentIndexNumber}E${nxt.IndexNumber} · ${nxt.Name}`,
        go: () =>
          router.replace({
            pathname: '/player',
            params: {
              kind: 'jellyfin',
              itemId: nxt.Id,
              title: `${nxt.SeriesName ?? ''} · S${nxt.ParentIndexNumber}E${nxt.IndexNumber}`,
              subtitle: nxt.Name,
              start: '0',
            },
          }),
      };
    }
    if (p.tmdbId && p.season && p.episode) {
      const nxt = await tmdbNextEpisode(settings, Number(p.tmdbId), Number(p.season), Number(p.episode)).catch(() => null);
      if (!nxt) return null;
      return {
        label: `S${nxt.season}E${nxt.episode}`,
        go: () =>
          router.replace({
            pathname: '/watch',
            params: {
              type: 'tv',
              tmdbId: p.tmdbId!,
              imdb: p.imdb,
              title: p.series ?? p.title ?? '',
              season: String(nxt.season),
              episode: String(nxt.episode),
            },
          }),
      };
    }
    return null;
  }

  const onEnded = async () => {
    const n = await findNext();
    if (n) {
      setCountdown(NEXT_DELAY);
      setNextUp(n);
    } else router.back();
  };

  useEffect(() => {
    if (!nextUp) return;
    if (countdown <= 0) {
      nextUp.go();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextUp, countdown]);

  const resumeFrom = Math.max(position.current, startAt);
  const other = engine === 'mpv' ? 'native' : 'mpv';

  // Média à envoyer au Chromecast : Jellyfin avec un profil compatible (transcodage si besoin), sinon le lien direct
  const castMedia = async () => {
    if (p.kind === 'jellyfin' && p.itemId) {
      const t = await getPlayback(settings, p.itemId, position.current, 'cast');
      if (target.current) playback.stop(settings, { target: target.current, positionSeconds: position.current });
      target.current = t;
      playback.start(settings, { target: t, positionSeconds: position.current });
      return {
        uri: t.uri,
        contentType: guessContentType(t.uri, t.isHls),
        title: p.title,
        subtitle: p.subtitle,
        image: jfImage(settings, p.itemId, 'Primary', { maxWidth: 600 }),
      };
    }
    if (!source) throw new Error('Aucune source');
    return { uri: source.uri, contentType: guessContentType(source.uri, source.isHls), title: p.title, subtitle: p.subtitle };
  };
  const qualityLabel = QUALITIES.find((x) => x.id === quality)?.label.split(' ')[0] ?? 'Auto';
  // Statistiques : méthode de lecture côté serveur et qualité demandée
  const METHOD: Record<string, string> = {
    DirectPlay: 'Lecture directe (fichier d’origine)',
    DirectStream: 'Flux direct (remuxé par le serveur)',
    Transcode: 'Conversion par le serveur',
  };
  // Intro / générique à passer (segments Jellyfin)
  const [segments, setSegments] = useState<SkipSegment[]>([]);
  useEffect(() => {
    if (p.kind !== 'jellyfin' || !p.itemId) return;
    jf.mediaSegments(settings, p.itemId).then(setSegments).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.itemId]);

  // Sous-titres français à télécharger (Jellyfin + plugin Open Subtitles, via le serveur Lumio)
  const subtitleFinder: SubtitleFinder | undefined =
    p.kind === 'jellyfin' && p.itemId && settings.chatUrl && settings.jellyfin
      ? {
          search: async () => {
            const r = await serverCall<{ results: { id: string; name: string; provider: string; format: string; downloads: number; hearingImpaired: boolean; perfect: boolean }[] }>(
              settings,
              `/api/subtitles/search?itemId=${encodeURIComponent(p.itemId!)}`
            );
            return r.results.map((x) => ({
              id: x.id,
              label: x.name,
              detail: [x.perfect ? 'correspond au fichier' : null, x.provider, x.format?.toUpperCase(), x.downloads ? `${x.downloads} téléchargements` : null, x.hearingImpaired ? 'sourds et malentendants' : null]
                .filter(Boolean)
                .join(' · '),
            }));
          },
          pick: async (id) => {
            const r = await serverCall<{ mediaSourceId: string | null; index: number | null; title?: string }>(settings, '/api/subtitles/download', {
              method: 'POST',
              body: JSON.stringify({ itemId: p.itemId, subtitleId: id }),
            });
            if (r.index == null || !r.mediaSourceId || !settings.jellyfin) return null;
            const url = `${settings.jellyfin.url}/Videos/${p.itemId}/${r.mediaSourceId}/Subtitles/${r.index}/0/Stream.srt?api_key=${settings.jellyfin.token}`;
            return { url, title: r.title ?? 'Français' };
          },
        }
      : undefined;
  const statsInfo = [
    p.kind === 'jellyfin'
      ? `Méthode : ${METHOD[target.current?.playMethod ?? ''] ?? '…'}`
      : `Source : lien direct${sourceCount > 1 ? ` (${altIdx + 1}/${sourceCount})` : ''}`,
    ...(p.kind === 'jellyfin' ? [`Qualité demandée : ${QUALITIES.find((x) => x.id === quality)?.label ?? 'Original'}`] : []),
  ];
  const castBtn = (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {Platform.isTV ? null : <CastIcon />}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {casting && (source || p.kind === 'jellyfin') ? (
        <CastingScreen
          media={castMedia}
          startAt={resumeFrom}
          deviceName={deviceName}
          onPosition={onTime}
          onEnded={onEnded}
          onClose={() => router.back()}
        />
      ) : warm && !warm.ready && !error ? (
        <View style={styles.center}>
          <GoogleSpinner size={72} stroke={6} />
          {p.title ? <Text style={styles.loadingTitle}>{p.title}</Text> : null}
          <Text style={styles.warmText}>
            Mise en réserve contre les coupures… {Math.floor(warm.buffered)} / {warm.want} s
          </Text>
          <View style={styles.warmBar}>
            {GOOGLE_COLORS.map((c, i) => {
              // Barre en quatre couleurs Google qui se remplit avec la réserve
              const part = Math.min(1, Math.max(0, (warm.buffered / Math.max(1, warm.want)) * 4 - i));
              return (
                <View key={c} style={styles.warmSeg}>
                  <View style={{ width: `${part * 100}%`, height: '100%', backgroundColor: c, borderRadius: 3 }} />
                </View>
              );
            })}
          </View>
          <Pressable onPress={() => router.back()} style={styles.warmCancel}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Annuler</Text>
          </Pressable>
        </View>
      ) : source && !error ? (
        engine === 'mpv' || p.audio ? (
          <MpvPlayer
            key={`mpv-${attempt}`}
            uri={source.uri}
            audioUri={p.audio}
            headers={source.headers}
            isHls={source.isHls}
            title={p.title}
            subtitle={p.subtitle}
            startAt={resumeFrom}
            onTime={onTime}
            onReady={onReady}
            onError={onPlayError}
            onClose={() => router.back()}
            onEnded={onEnded}
            extra={castBtn}
            statsInfo={statsInfo}
            subtitleFinder={subtitleFinder}
            segments={segments}
            onPip={
              Platform.OS === 'ios' && !p.audio
                ? () => {
                    pipRequested.current = true;
                    setEngine('native');
                  }
                : undefined
            }
          />
        ) : (
          <NativePlayer
            key={`native-${attempt}`}
            segments={segments}
            uri={source.uri}
            headers={source.headers}
            isHls={source.isHls}
            title={p.title}
            subtitle={p.subtitle}
            startAt={resumeFrom}
            onTime={onTime}
            onReady={onReady}
            onError={onPlayError}
            onClose={() => router.back()}
            onEnded={onEnded}
            extra={castBtn}
            statsInfo={statsInfo}
            autoPip={pipRequested.current}
          />
        )
      ) : !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#fff" />
          {p.title ? <Text style={styles.loadingTitle}>{p.title}</Text> : null}
        </View>
      ) : null}

      {error && (
        <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.9)', padding: 28 }]}>
          <Ionicons name="alert-circle-outline" size={42} color={C.text} />
          <Text style={styles.errorTitle}>Lecture impossible</Text>
          <Text style={styles.errorText}>{error}</Text>
          {sourceCount > 1 ? (
            <Text style={styles.errorText}>
              {sourceCount} sources essayées, aucune ne fonctionne pour le moment.
            </Text>
          ) : null}
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 16, maxWidth: 420, width: '100%', alignItems: 'stretch' }}>
            <Button
              title={`Essayer avec le lecteur ${other === 'mpv' ? 'mpv' : 'natif'}`}
              icon="swap-horizontal"
              onPress={() => {
                setError(null);
                setEngine(other);
              }}
            />
            <Button
              title="Réessayer"
              icon="refresh"
              variant="glass"
              onPress={() => {
                setAltIdx(0);
                setAttempt((a) => a + 1);
              }}
            />
            {source?.uri ? (
              <>
                <Button title="Ouvrir dans VLC" icon="open-outline" variant="glass" onPress={() => openExternal('vlc', source.uri)} />
                {Platform.OS === 'ios' && (
                  <Button title="Ouvrir dans Infuse" icon="open-outline" variant="glass" onPress={() => openExternal('infuse', source.uri)} />
                )}
              </>
            ) : null}
          </View>
        </View>
      )}

      {nextUp && (
        <View style={styles.nextWrap}>
          <View style={styles.next}>
            <Text style={styles.nextLabel}>Épisode suivant dans {countdown} s</Text>
            <Text style={styles.nextTitle} numberOfLines={2}>
              {nextUp.label}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title="Lire" icon="play" onPress={nextUp.go} style={{ flex: 1 }} />
              <Button title="Fermer" variant="glass" onPress={() => router.back()} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}

      {/* TV : pas de bouton fermer pendant le chargement (il prenait le focus et l'appui « OK » refermait le lecteur) ; le bouton Retour suffit */}
      {(!source || error) && (!Platform.isTV || error) && (
        <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      )}
      <QualitySheet
        visible={qualityOpen}
        current={quality}
        onClose={() => setQualityOpen(false)}
        onPick={(id) => {
          setQualityOpen(false);
          if (id !== quality) setQuality(id);
        }}
      />
      <Toasts />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  qualityBtn: { paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  qualityText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  warmText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
  warmBar: { flexDirection: 'row', gap: 4, width: 220, height: 6, marginTop: 4 },
  warmSeg: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' },
  warmCancel: { marginTop: 14, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)' },
  errorTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  errorText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  nextWrap: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  next: { backgroundColor: '#161618', borderRadius: 20, padding: 20, width: '100%', maxWidth: 420 },
  nextLabel: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  nextTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  close: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
