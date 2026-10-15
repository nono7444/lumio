import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button, Chip } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { MEDIA_STATUS, mediaLabel, requestLabel, seerr, SeerrError, type SeerrMediaInfo } from '@/lib/seerr';
import { useSettings } from '@/lib/settings';

/** Bloc « Demander » pour les utilisateurs non-admins (via Seerr). */
export function RequestBlock({ type, tmdbId }: { type: 'movie' | 'tv'; tmdbId: number }) {
  const { settings } = useSettings();
  const [info, setInfo] = useState<SeerrMediaInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!settings.seerr?.url) return;
    seerr
      .mediaInfo(settings, type, tmdbId)
      .then((i) => {
        setInfo(i);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings, type, tmdbId]);

  useEffect(load, [load]);

  if (!settings.seerr?.url) {
    return (
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={C.textDim} />
        <Text style={[styles.text, { flex: 1 }]}>
          Pour demander un titre, connecte le serveur de demandes dans Profil (lien d'invitation de l'admin).
        </Text>
      </View>
    );
  }

  const status = info?.status ?? MEDIA_STATUS.UNKNOWN;
  const media = mediaLabel(status);
  const myRequest = info?.requests?.[0];
  const canRequest = status === MEDIA_STATUS.UNKNOWN || (type === 'tv' && status === MEDIA_STATUS.PARTIAL);

  async function send() {
    setBusy(true);
    try {
      if (type === 'movie') await seerr.requestMovie(settings, tmdbId);
      else await seerr.requestTv(settings, tmdbId, 'all');
      Alert.alert('Demande envoyée', 'L’admin va la valider. Tu peux suivre tes demandes dans l’onglet Activité.');
      load();
    } catch (e: any) {
      if (e instanceof SeerrError && e.status === 401) {
        Alert.alert('Session expirée', 'Reconnecte-toi au serveur de demandes dans Profil.', [
          { text: 'Plus tard' },
          { text: 'Ouvrir Profil', onPress: () => router.push('/settings') },
        ]);
      } else Alert.alert('Demande refusée', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {(media || myRequest) && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {media && <Chip label={media.label} color={media.color} />}
          {myRequest && status !== MEDIA_STATUS.AVAILABLE && (
            <Chip label={`Demande : ${requestLabel(myRequest.status).label}`} color={requestLabel(myRequest.status).color} />
          )}
        </View>
      )}
      {canRequest && (
        <Button
          title={type === 'movie' ? 'Demander ce film' : 'Demander la série'}
          icon="paper-plane-outline"
          variant="glass"
          onPress={send}
          loading={busy}
        />
      )}
      {error ? <Text style={[styles.text, { color: C.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: R.md, padding: 14 },
  text: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
