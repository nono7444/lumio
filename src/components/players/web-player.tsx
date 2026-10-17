// Lecteur de l'appli Mac (et du web) : balise <video> du navigateur, HLS via hls.js quand il le faut.
// Jellyfin envoie directement ce que le Mac sait lire (MP4 / WebM, H.264, HEVC, VP9, AV1) et convertit le reste en HLS.
import { Ionicons } from '@expo/vector-icons';
import { createElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';

import type { PlayerProps } from './types';

type HlsInstance = { destroy: () => void; loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void; on: (e: string, cb: (...a: any[]) => void) => void };

export function WebPlayer({ uri, isHls, title, subtitle, startAt, onTime, onReady, onError, onClose, onEnded, extra, statsInfo }: PlayerProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [chrome, setChrome] = useState(true);
  const [stats, setStats] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef({ onTime, onReady, onError, onEnded });
  cb.current = { onTime, onReady, onError, onEnded };

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: HlsInstance | null = null;
    let ready = false;
    let alive = true;

    const markReady = () => {
      if (ready) return;
      ready = true;
      if (startAt > 5 && v.currentTime < startAt - 5) v.currentTime = startAt;
      cb.current.onReady(v.currentTime);
      v.play().catch(() => {});
    };
    const onMeta = () => markReady();
    const onTimeUpdate = () => cb.current.onTime(v.currentTime, v.paused);
    const onEnd = () => cb.current.onEnded();
    const onErr = () => {
      const code = v.error?.code;
      cb.current.onError(
        code === 4 ? 'Format non pris en charge par le lecteur du Mac. Essaie une qualité plus basse.' : `Erreur de lecture (${code ?? '?'})`
      );
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnd);
    v.addEventListener('error', onErr);

    const native = v.canPlayType('application/vnd.apple.mpegurl');
    if ((isHls || /\.m3u8(\?|$)/i.test(uri)) && !native) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (!alive) return;
          if (!Hls.isSupported()) {
            cb.current.onError('HLS non pris en charge');
            return;
          }
          const h = new Hls({ startPosition: startAt > 5 ? startAt : -1, maxBufferLength: 60 }) as unknown as HlsInstance;
          hls = h;
          h.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; details?: string }) => {
            if (data?.fatal) cb.current.onError(`Erreur HLS : ${data.details ?? 'inconnue'}`);
          });
          h.loadSource(uri);
          h.attachMedia(v);
        })
        .catch((e) => cb.current.onError(String(e)));
    } else {
      v.src = uri;
    }

    return () => {
      alive = false;
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('error', onErr);
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  // Clavier : Échap pour quitter, espace pour pause, flèches pour avancer / reculer, F pour plein écran
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = ref.current;
      if (!v) return;
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      else if (e.key === ' ') {
        e.preventDefault();
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      } else if (e.key === 'ArrowRight') v.currentTime += 10;
      else if (e.key === 'ArrowLeft') v.currentTime -= 10;
      else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else v.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // La barre du haut s'efface après 3 s sans bouger la souris
  const poke = () => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 3000);
  };
  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root} onPointerMove={poke}>
      {createElement('video', {
        ref,
        controls: true,
        autoPlay: true,
        playsInline: true,
        style: { width: '100%', height: '100%', backgroundColor: '#000', objectFit: 'contain' },
      })}
      {chrome ? (
        <View style={styles.top} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.btn} accessibilityLabel="Fermer">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }} pointerEvents="none">
            {title ? (
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text style={styles.sub} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {extra}
          {statsInfo?.length ? (
            <Pressable onPress={() => setStats((s) => !s)} hitSlop={10} style={styles.btn} accessibilityLabel="Statistiques">
              <Ionicons name="stats-chart" size={18} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {stats && statsInfo?.length ? (
        <View style={styles.stats} pointerEvents="none">
          {statsInfo.map((l, i) => (
            <Text key={i} style={styles.statsText}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  btn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  stats: { position: 'absolute', top: 76, left: 16, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 10, gap: 2 },
  statsText: { color: '#fff', fontSize: 12, fontFamily: 'monospace' },
});
