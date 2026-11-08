// Lumio Auto : chercher un film ou une série dans les bibliothèques Jellyfin, puis l'ouvrir pour le
// supprimer, le déplacer (autre disque / dossier), modifier ses infos ou le rescanner.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenTitle } from '@/components/ui';
import { C } from '@/constants/theme';
import { jf, jfPoster, type JfItem } from '@/lib/jellyfin';
import { useSettings } from '@/lib/settings';

export default function LibraryAdmin() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<JfItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems(null);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      jf.items(settings, { search: term, types: 'Movie,Series', limit: 40 })
        .then((r) => n === seq.current && setItems(r.Items))
        .catch(() => n === seq.current && setItems([]))
        .finally(() => n === seq.current && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, settings]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Bibliothèques" onBack={() => router.back()} />
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={C.textDim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Titre d’un film ou d’une série"
          placeholderTextColor={C.textFaint}
          style={s.input}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading ? <ActivityIndicator size="small" color={C.textDim} /> : null}
      </View>
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => i.Id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={s.help}>
            {items === null ? 'Tape au moins 2 lettres. Ouvre ensuite le titre : Supprimer, Déplacer, Modifier les infos, Rescanner.' : 'Aucun titre trouvé dans les bibliothèques.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/jellyfin/[id]', params: { id: item.Id } })} style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
            <Image source={jfPoster(settings, item, 180)} style={s.poster} contentFit="cover" />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.title} numberOfLines={2}>
                {item.Name}
              </Text>
              <Text style={s.help} numberOfLines={1}>
                {item.Type === 'Series' ? 'Série' : 'Film'}
                {item.ProductionYear ? ` · ${item.ProductionYear}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, paddingHorizontal: 14, height: 46, borderRadius: 14, backgroundColor: C.surface },
  input: { flex: 1, color: C.text, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: C.surface },
  poster: { width: 46, height: 69, borderRadius: 8, backgroundColor: C.surfaceHigh },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  help: { color: C.textDim, fontSize: 13, lineHeight: 18 },
});
