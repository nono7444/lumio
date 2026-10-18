// « Bande-annonce » à côté de Lire, lue dans le lecteur mpv de Lumio.
// Source : iTunes Store France (lien vidéo direct d'Apple), sinon YouTube (flux direct), sinon l'appli YouTube.
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { Button } from '@/components/ui';
import { hasTmdb, useSettings } from '@/lib/settings';
import { trailerKey } from '@/lib/tmdb';
import { itunesTrailer } from '@/lib/itunes-trailer';
import { toast } from '@/components/toast';
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

/** Ouvre un lien vidéo direct (iTunes) dans le lecteur. */
function playDirect(uri: string, title?: string) {
  router.push({ pathname: '/player', params: { kind: 'url', uri, title: 'Bande-annonce', subtitle: title ?? '', start: '0' } });
}

/** Ouvre la bande-annonce YouTube dans mpv ; si YouTube refuse les flux directs, dans YouTube. */
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

export function TrailerButton({
  type,
  tmdbId,
  title,
  year,
  style,
  small,
}: {
  type: 'movie' | 'tv';
  tmdbId?: number;
  title?: string;
  year?: number | string | null;
  style?: object;
  small?: boolean;
}) {
  const { settings } = useSettings();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [direct, setDirect] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setKey(null);
    setDirect(null);
    if (tmdbId && hasTmdb(settings)) trailerKey(settings, type, tmdbId).then((k) => alive && setKey(k));
    if (title && Platform.OS !== 'web') itunesTrailer(type, title, year).then((u) => alive && setDirect(u));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tmdbId, title, year, settings.tmdbKey]);

  if (!key && !direct) return null;
  return (
    <Button
      title="Bande-annonce"
      icon="film-outline"
      variant="glass"
      small={small}
      loading={busy}
      onPress={async () => {
        if (direct) return playDirect(direct, title);
        if (!key) return toast('Pas de bande-annonce trouvée', 'info');
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
