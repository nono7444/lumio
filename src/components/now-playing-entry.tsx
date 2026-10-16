// Profil (admin) : raccourci « En cours de lecture » avec le nombre de personnes qui regardent.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { jf, type JfSession } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export function NowPlayingEntry() {
  const { settings } = useSettings();
  const [list, setList] = useState<JfSession[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!settings.jellyfin || settings.jellyfin.isAdmin === false) return;
      const load = () => jf.sessions(settings).then(setList).catch(() => {});
      load();
      const t = setInterval(load, 15000);
      return () => clearInterval(t);
    }, [settings])
  );

  if (!settings.jellyfin || settings.jellyfin.isAdmin === false) return null;
  const playing = (list ?? []).filter((s) => s.NowPlayingItem);
  const names = [...new Set(playing.map((s) => s.UserName).filter(Boolean))];

  return (
    <Pressable
      onPress={() => {
        tap();
        router.push('/sessions');
      }}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.icon, { backgroundColor: playing.length ? 'rgba(48,209,88,0.18)' : C.surfaceHigh }]}>
        <Ionicons name="eye" size={20} color={playing.length ? C.success : C.textDim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>En cours de lecture</Text>
        <Text style={styles.dim} numberOfLines={1}>
          {list == null
            ? 'Chargement…'
            : playing.length
              ? `${playing.length} lecture${playing.length > 1 ? 's' : ''} · ${names.join(', ')}`
              : 'Personne ne regarde en ce moment'}
        </Text>
      </View>
      {playing.length ? <View style={styles.dot} /> : null}
      <Ionicons name="chevron-forward" size={18} color={C.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 14, marginBottom: 22 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 16, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
});
