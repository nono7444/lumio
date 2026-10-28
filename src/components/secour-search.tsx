// Disques (admin, bêta) : recherche d'un film ou d'une série → liens Lumio Secour → téléchargement sur un disque.
// Sert « au cas où » : Lumio Secour reste discret ailleurs dans l'appli (bouton « DL » sur les fiches).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { C, R } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { tmdb, tmdbImg, type TmdbItem } from '@/lib/tmdb';

export function SecourSearch() {
  const { settings } = useSettings();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Recherche TMDB (films et séries), 400 ms après la dernière lettre
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await tmdb.search(settings, text);
        if (n === seq.current) setResults(r.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 8));
      } catch {
        if (n === seq.current) setResults([]);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, settings]);

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={styles.ls}>
          <Text style={styles.lsText}>DL</Text>
        </View>
        <Text style={styles.title}>Recherche Lumio Secour</Text>
        <Pressable onPress={() => router.push('/secour-admin')} hitSlop={10} style={styles.round} accessibilityLabel="Réglages de Lumio Secour">
          <Ionicons name="settings-outline" size={17} color={C.text} />
        </Pressable>
      </View>
      <Text style={styles.dim}>Au cas où : un film ou une série, puis le fichier à télécharger sur un disque.</Text>
      <View style={styles.search}>
        <Ionicons name="film-outline" size={16} color={C.textDim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Titre d’un film ou d’une série…"
          placeholderTextColor={C.textFaint}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading ? <ActivityIndicator size="small" color={C.textDim} /> : null}
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={C.textDim} />
          </Pressable>
        ) : null}
      </View>
      {results && !results.length && !loading ? <Text style={styles.dim}>Rien trouvé.</Text> : null}
      {(results ?? []).map((it) => {
        const type = it.media_type === 'tv' ? 'tv' : 'movie';
        const title = it.title ?? it.name ?? '';
        const year = (it.release_date ?? it.first_air_date ?? '').slice(0, 4);
        return (
          <Pressable
            key={`${type}:${it.id}`}
            onPress={() => router.push({ pathname: '/secour', params: { type, tmdbId: String(it.id), title } })}
            style={styles.row}>
            {it.poster_path ? <Image source={tmdbImg(it.poster_path, 'w185')} style={styles.poster} contentFit="cover" /> : <View style={styles.poster} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.dim}>
                {type === 'tv' ? 'Série' : 'Film'}
                {year ? ` · ${year}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.textDim} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10, marginHorizontal: 12, marginTop: 10 },
  title: { flex: 1, color: C.text, fontSize: 16, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  ls: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
  lsText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  round: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9 },
  input: { flex: 1, color: C.text, fontSize: 14, padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  poster: { width: 36, height: 54, borderRadius: 6, backgroundColor: C.surfaceHigh },
  name: { color: C.text, fontSize: 14, fontWeight: '700' },
});
