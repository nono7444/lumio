import { Ionicons } from '@expo/vector-icons';
import { ExpoMpvView, type ExpoMpvViewRef, type TrackInfo } from 'expo-mpv';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';

import { formatTime, type PlayerProps } from './types';

const HIDE_AFTER_MS = 3500;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
// Langues préférées : mpv choisit automatiquement la piste française si elle existe
const PREFERRED_LANGS = 'fre,fra,fr,french,vff,vfq,vf';

function trackLabel(t: TrackInfo) {
  const parts = [t.title, t.lang?.toUpperCase(), t.codec?.toUpperCase()].filter(Boolean);
  if (t.type === 'audio' && t.channelCount) parts.push(t.channelCount >= 6 ? `${t.channelCount - 1}.1` : `${t.channelCount}.0`);
  if (t.isExternal) parts.push('externe');
  return parts.join(' · ') || `Piste ${t.id}`;
}

/** Lecteur mpv avec contrôles maison (lecture, barre de progression, pistes, vitesse, zoom). */
export function MpvPlayer({ uri, headers, title, subtitle, startAt, onTime, onReady, onError, onClose, onEnded, extra }: PlayerProps) {
  const insets = useSafeAreaInsets();
  const ref = useRef<ExpoMpvViewRef>(null);
  const [source, setSource] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<string>('loading');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [visible, setVisible] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [sheet, setSheet] = useState<null | { audio: TrackInfo[]; subs: TrackInfo[] }>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyOnce = useRef(false);

  // Options mpv posées avant le chargement du fichier
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mpv = ref.current;
      const set = async (k: string, v: string) => {
        try {
          await mpv?.setPropertyString(k, v);
        } catch {}
      };
      await set('alang', PREFERRED_LANGS);
      await set('slang', PREFERRED_LANGS);
      await set('cache', 'yes');
      await set('demuxer-max-bytes', '200MiB');
      await set('demuxer-readahead-secs', '60');
      if (startAt > 5) await set('start', String(Math.floor(startAt)));
      if (headers && Object.keys(headers).length) {
        const ua = headers['User-Agent'] ?? headers['user-agent'];
        if (ua) await set('user-agent', ua);
        await set(
          'http-header-fields',
          Object.entries(headers)
            .filter(([k]) => k.toLowerCase() !== 'user-agent')
            .map(([k, v]) => `${k}: ${v.replace(/,/g, '\\,')}`)
            .join(',')
        );
      }
      if (!cancelled) setSource(uri);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Masque les contrôles après quelques secondes de lecture
  const bump = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    if (paused || sheet) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
    } else if (state === 'playing') bump();
  }, [paused, sheet, state, bump]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const seekBy = (s: number) => {
    tap();
    ref.current?.seekBy(s).catch(() => {});
    bump();
  };

  async function openTracks() {
    tap();
    try {
      const list = (await ref.current?.getTrackList()) ?? [];
      setSheet({ audio: list.filter((t) => t.type === 'audio'), subs: list.filter((t) => t.type === 'sub') });
    } catch {
      setSheet({ audio: [], subs: [] });
    }
  }

  // ——— Barre de progression (glisser pour chercher) ———
  const ratioAt = (e: GestureResponderEvent) => Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth));
  const shown = scrub ?? position;

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoMpvView
        ref={ref}
        source={source}
        paused={paused}
        speed={SPEEDS[speedIdx]}
        style={StyleSheet.absoluteFill}
        onLoad={({ nativeEvent }) => {
          setDuration(nativeEvent.duration);
          if (!readyOnce.current) {
            readyOnce.current = true;
            onReady(startAt > 5 ? startAt : 0);
          }
        }}
        onProgress={({ nativeEvent }) => {
          setPosition(nativeEvent.position);
          if (nativeEvent.duration) setDuration(nativeEvent.duration);
          setBuffered(nativeEvent.bufferedPosition || 0);
          onTime(nativeEvent.position, paused);
        }}
        onPlaybackStateChange={({ nativeEvent }) => setState(nativeEvent.state)}
        onError={({ nativeEvent }) => onError(nativeEvent.error || 'Lecture impossible')}
        onEnd={({ nativeEvent }) => {
          if (nativeEvent.reason === 'error') onError('Le fichier n’a pas pu être lu');
          else if (nativeEvent.reason === 'ended') onEnded();
        }}
      />

      {/* Zone de tap : affiche / masque les contrôles, double-tap sur les côtés = ±10 s */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => (visible ? setVisible(false) : bump())} />

      {(state === 'loading' || state === 'buffering') && (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {visible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.scrim} pointerEvents="none" />

          {/* Haut */}
          <View style={[styles.top, { paddingTop: insets.top + 8, paddingLeft: insets.left + 14, paddingRight: insets.right + 14 }]}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
              <Ionicons name="chevron-down" size={26} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {extra}
            <Pressable
              onPress={() => {
                tap();
                setSpeedIdx((i) => (i + 1) % SPEEDS.length);
                bump();
              }}
              hitSlop={8}
              style={styles.pillBtn}>
              <Text style={styles.pillText}>{SPEEDS[speedIdx]}×</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                const next = !zoom;
                setZoom(next);
                ref.current?.setPropertyString('panscan', next ? '1.0' : '0.0').catch(() => {});
                bump();
              }}
              hitSlop={8}
              style={styles.iconBtn}>
              <Ionicons name={zoom ? 'contract' : 'expand'} size={21} color="#fff" />
            </Pressable>
            <Pressable onPress={openTracks} hitSlop={8} style={styles.iconBtn}>
              <Ionicons name="chatbox-ellipses-outline" size={22} color="#fff" />
            </Pressable>
          </View>

          {/* Centre */}
          <View style={styles.middle} pointerEvents="box-none">
            <Pressable onPress={() => seekBy(-10)} hitSlop={16} style={styles.skip}>
              <Ionicons name="play-back" size={30} color="#fff" />
              <Text style={styles.skipText}>10</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                tap();
                setPaused((p) => !p);
              }}
              hitSlop={16}
              style={styles.play}>
              <Ionicons name={paused ? 'play' : 'pause'} size={40} color="#000" style={paused ? { marginLeft: 4 } : undefined} />
            </Pressable>
            <Pressable onPress={() => seekBy(10)} hitSlop={16} style={styles.skip}>
              <Ionicons name="play-forward" size={30} color="#fff" />
              <Text style={styles.skipText}>10</Text>
            </Pressable>
          </View>

          {/* Bas : progression */}
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 14, paddingLeft: insets.left + 18, paddingRight: insets.right + 18 }]}>
            <View
              style={styles.barHit}
              onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width || 1)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => {
                setScrub(ratioAt(e) * duration);
                if (hideTimer.current) clearTimeout(hideTimer.current);
              }}
              onResponderMove={(e) => setScrub(ratioAt(e) * duration)}
              onResponderRelease={(e) => {
                const target = ratioAt(e) * duration;
                setScrub(null);
                setPosition(target);
                ref.current?.seekTo(target).catch(() => {});
                bump();
              }}>
              <View style={styles.barTrack}>
                <View style={[styles.barBuffered, { width: `${duration ? Math.min(100, (buffered / duration) * 100) : 0}%` }]} />
                <View style={[styles.barFill, { width: `${duration ? Math.min(100, (shown / duration) * 100) : 0}%` }]} />
              </View>
              <View style={[styles.knob, { left: `${duration ? Math.min(100, (shown / duration) * 100) : 0}%` }, scrub != null && styles.knobActive]} />
            </View>
            <View style={styles.times}>
              <Text style={styles.time}>{formatTime(shown)}</Text>
              <Text style={styles.time}>-{formatTime(Math.max(0, duration - shown))}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Feuille des pistes audio / sous-titres */}
      {sheet && (
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheet(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              <Text style={styles.sheetTitle}>Audio</Text>
              {sheet.audio.length === 0 && <Text style={styles.sheetEmpty}>Aucune piste audio détectée</Text>}
              {sheet.audio.map((t) => (
                <Pressable
                  key={`a${t.id}`}
                  style={styles.trackRow}
                  onPress={async () => {
                    tap();
                    await ref.current?.setAudioTrack(t.id).catch(() => {});
                    openTracks();
                  }}>
                  <Ionicons name={t.selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={t.selected ? C.text : C.textFaint} />
                  <Text style={styles.trackText} numberOfLines={1}>
                    {trackLabel(t)}
                  </Text>
                </Pressable>
              ))}

              <Text style={[styles.sheetTitle, { marginTop: 14 }]}>Sous-titres</Text>
              <Pressable
                style={styles.trackRow}
                onPress={async () => {
                  tap();
                  await ref.current?.setPropertyString('sid', 'no').catch(() => {});
                  openTracks();
                }}>
                <Ionicons
                  name={!sheet.subs.some((t) => t.selected) ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={!sheet.subs.some((t) => t.selected) ? C.text : C.textFaint}
                />
                <Text style={styles.trackText}>Désactivés</Text>
              </Pressable>
              {sheet.subs.map((t) => (
                <Pressable
                  key={`s${t.id}`}
                  style={styles.trackRow}
                  onPress={async () => {
                    tap();
                    await ref.current?.setSubtitleTrack(t.id).catch(() => {});
                    openTracks();
                  }}>
                  <Ionicons name={t.selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={t.selected ? C.text : C.textFaint} />
                  <Text style={styles.trackText} numberOfLines={1}>
                    {trackLabel(t)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pillBtn: { paddingHorizontal: 10, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', justifyContent: 'center' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  middle: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 56 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' },
  skip: { alignItems: 'center', justifyContent: 'center' },
  skipText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  barHit: { height: 30, justifyContent: 'center' },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  barBuffered: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.4)' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#fff' },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', marginLeft: -7, top: 8 },
  knobActive: { width: 20, height: 20, borderRadius: 10, marginLeft: -10, top: 5 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: '#161618',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
  },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  sheetEmpty: { color: C.textDim, fontSize: 13 },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  trackText: { color: C.text, fontSize: 14, flex: 1 },
});
