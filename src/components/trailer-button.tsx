// « Bande-annonce » sous Lire : la bande-annonce YouTube (en français si elle existe), lue dans le lecteur mpv de Lumio.
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { Button } from '@/components/ui';
import { hasTmdb, useSettings } from '@/lib/settings';
import { trailerKey } from '@/lib/tmdb';
import { trailerStream } from '@/lib/youtube';

export function openTrailer(key: string) {
  const web = `https://www.youtube.com/watch?v=${key}`;
  if (Platform.OS === 'android') {
    // Appli YouTube (téléphone ou TV), sinon le navigateur
    Linking.openURL(`vnd.youtube:${key}`).catch(() => Linking.openURL(web).catch(() => {}));
  } else {
    WebBrowser.openBrowserAsync(web, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN }).catch(() =>
      Linking.openURL(web).catch(() => {})
    );
  }
}

/** Ouvre la bande-annonce dans mpv ; si YouTube refuse les flux directs, dans YouTube. */
export async function playTrailer(key: string, title?: string) {
  if (Platform.OS === 'web') return openTrailer(key);
  const s = await trailerStream(key).catch(() => null);
  if (!s) return openTrailer(key);
  router.push({
    pathname: '/player',
    params: {
      kind: 'url',
      uri: s.video,
      audio: s.audio,
      headers: JSON.stringify(s.headers),
      title: 'Bande-annonce',
      subtitle: [title, s.height ? `${s.height}p` : null].filter(Boolean).join(' · '),
      start: '0',
    },
  });
}

export function TrailerButton({ type, tmdbId, title, style }: { type: 'movie' | 'tv'; tmdbId?: number; title?: string; style?: object }) {
  const { settings } = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tmdbId || !hasTmdb(settings)) return;
    let alive = true;
    trailerKey(settings, type, tmdbId).then((k) => alive && setKey(k));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tmdbId, settings.tmdbKey]);

  if (!key) return null;
  return (
    <Button
      title="Bande-annonce"
      icon="film-outline"
      variant="glass"
      loading={busy}
      onPress={async () => {
        setBusy(true);
        try {
          await playTrailer(key, title);
        } finally {
          setBusy(false);
        }
      }}
      style={style}
    />
  );
}
