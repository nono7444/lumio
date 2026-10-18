// « Bande-annonce » sous Lire : la bande-annonce YouTube (en français si elle existe).
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Button } from '@/components/ui';
import { hasTmdb, useSettings } from '@/lib/settings';
import { trailerKey } from '@/lib/tmdb';

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

export function TrailerButton({ type, tmdbId, style }: { type: 'movie' | 'tv'; tmdbId?: number; style?: object }) {
  const { settings } = useSettings();
  const [key, setKey] = useState<string | null>(null);

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
  return <Button title="Bande-annonce" icon="film-outline" variant="glass" onPress={() => openTrailer(key)} style={style} />;
}
