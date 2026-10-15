import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { C, POSTER_H, POSTER_W, R } from '@/constants/theme';

export type PosterItem = {
  key: string;
  title: string;
  poster?: string;
  subtitle?: string;
  badge?: { label: string; color: string } | null;
  onPress: () => void | Promise<void>;
};

export function PosterCard({ item, width = POSTER_W }: { item: PosterItem; width?: number }) {
  const [busy, setBusy] = useState(false);
  const height = Math.round(width * 1.5);
  return (
    <Pressable
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await item.onPress();
        } finally {
          setBusy(false);
        }
      }}>
      <View style={[styles.poster, { width, height }]}>
        {item.poster ? (
          <Image source={item.poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <View style={styles.posterFallback}>
            <Ionicons name="film-outline" size={28} color={C.textFaint} />
          </View>
        )}
        {item.badge && (
          <View style={[styles.badge, { backgroundColor: item.badge.color }]}>
            <Text style={styles.badgeText}>{item.badge.label}</Text>
          </View>
        )}
        {busy && (
          <View style={styles.posterBusy}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={styles.posterTitle}>
        {item.title}
      </Text>
      {item.subtitle ? (
        <Text numberOfLines={1} style={styles.posterSub}>
          {item.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Row({
  title,
  subtitle,
  items,
  loading,
  error,
}: {
  title: string;
  subtitle?: string;
  items: PosterItem[];
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <View style={{ marginBottom: 26 }}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {loading ? (
        <View style={[styles.rowPlaceholder]}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : error ? (
        <Text style={[styles.rowSub, { paddingHorizontal: 16 }]}>Erreur : {error}</Text>
      ) : items.length === 0 ? (
        <Text style={[styles.rowSub, { paddingHorizontal: 16 }]}>Aucun contenu.</Text>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(i) => i.key}
          renderItem={({ item }) => <PosterCard item={item} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          initialNumToRender={6}
          windowSize={5}
        />
      )}
    </View>
  );
}

export function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? C.accent : variant === 'danger' ? 'rgba(239,91,91,0.15)' : C.surfaceHigh;
  const fg = variant === 'danger' ? C.danger : C.text;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={C.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        {...props}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function SetupPrompt({
  title = 'Ajoute ta clé TMDB',
  text = 'La recherche et les fiches passent par TMDB. Une clé gratuite suffit (themoviedb.org → Paramètres → API).',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <View style={styles.setup}>
      <Ionicons name="link-outline" size={36} color={C.accent} />
      <Text style={styles.setupTitle}>{title}</Text>
      <Text style={styles.setupText}>{text}</Text>
      <Button title="Ouvrir les réglages" icon="settings-outline" onPress={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: R.md,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  posterFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  posterBusy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterTitle: { color: C.text, fontSize: 13, fontWeight: '600', marginTop: 7 },
  posterSub: { color: C.textDim, fontSize: 12, marginTop: 1 },
  badge: { position: 'absolute', top: 6, left: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  rowHead: { paddingHorizontal: 16, marginBottom: 10 },
  rowTitle: { color: C.text, fontSize: 19, fontWeight: '700' },
  rowSub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  rowPlaceholder: { height: POSTER_H, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: R.md,
    paddingVertical: 13,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: C.surfaceHigh,
    color: C.text,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
  hint: { color: C.textFaint, fontSize: 12, marginTop: 5 },
  section: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  setup: { alignItems: 'center', padding: 28, gap: 12 },
  setupTitle: { color: C.text, fontSize: 20, fontWeight: '700' },
  setupText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
});
