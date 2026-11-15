// « Streaming » (admin) : menu du choix de la qualité, puis écran de lecture en mode streaming.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import type { Settings } from '@/lib/settings';
import { watchNowApi } from '@/lib/watch-now';

/** Le serveur permet-il le streaming à ce compte (admin, ou membre si l'admin l'a ouvert) ? */
export function useCanStream(settings: Settings) {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (!settings.chatUrl) return setCan(false);
    watchNowApi
      .status(settings)
      .then((st) => setCan(Boolean(st.streaming)))
      .catch(() => setCan(false));
  }, [settings]);
  return can;
}

/** Bouton « Streaming » (icône seule ou avec texte) + son menu de qualité. */
export function StreamingButton({ type, tmdbId, title, imdb, season, episode, label = false, style }: { type: 'movie' | 'tv'; tmdbId: number; title: string; imdb?: string; season?: number; episode?: number; label?: boolean; style?: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title={label ? 'Streaming' : ''} icon="cloud-outline" variant="glass" small onPress={() => setOpen(true)} style={style ?? { width: 46, paddingHorizontal: 0 }} accessibilityLabel="Streaming" />
      <QualityMenu
        open={open}
        onClose={() => setOpen(false)}
        onPick={(q) => {
          setOpen(false);
          router.push({
            pathname: '/watch',
            params: { type, tmdbId: String(tmdbId), imdb: imdb ?? '', title, stream: '1', quality: String(q), ...(season != null ? { season: String(season), episode: String(episode ?? 1) } : {}) },
          });
        }}
      />
    </>
  );
}

/** Menu « Streaming » : choix de la qualité (le serveur prend la meilleure version de cette qualité). */
export function QualityMenu({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (q: 2160 | 1080 | 720) => void }) {
  const opts: { q: 2160 | 1080 | 720; label: string; sub: string }[] = [
    { q: 2160, label: '4K', sub: 'Le plus beau, mais lourd : à la maison de préférence' },
    { q: 1080, label: '1080p', sub: 'Le bon choix la plupart du temps' },
    { q: 720, label: '720p', sub: 'Connexion faible ou en déplacement' },
  ];
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <RNPressable style={qm.backdrop} onPress={onClose}>
        <View style={qm.sheet}>
          <Text style={qm.title}>Streaming</Text>
          <Text style={qm.help}>Cache TorBox / AllDebrid, puis Wawacity en dernier recours.</Text>
          {opts.map((o) => (
            <RNPressable key={o.q} onPress={() => onPick(o.q)} style={({ pressed }) => [qm.row, pressed && { opacity: 0.6 }]}>
              <Text style={qm.rowLabel}>{o.label}</Text>
              <Text style={qm.rowSub}>{o.sub}</Text>
            </RNPressable>
          ))}
          <RNPressable onPress={onClose} style={qm.cancel}>
            <Text style={qm.cancelTxt}>Annuler</Text>
          </RNPressable>
        </View>
      </RNPressable>
    </Modal>
  );
}
const qm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34, gap: 10 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  help: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 },
  row: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, gap: 2 },
  rowLabel: { color: '#fff', fontSize: 17, fontWeight: '700' },
  rowSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: '600' },
});
