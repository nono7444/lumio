import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle , Platform } from 'react-native';
import { verdict } from '@/lib/ratings';
import { setTvFocus } from '@/lib/tv-focus';
import { FocusPressable as Pressable } from '@/components/tv';

import { C, POSTER_H, POSTER_W, R } from '@/constants/theme';
import { useBetterPoster, type PosterIds } from '@/lib/better-posters';
import { useFamilyRatingBadge } from '@/lib/ratings';
import { useSettings } from '@/lib/settings';

export const tap = () => Haptics.selectionAsync().catch(() => {});

export type PosterItem = {
  key: string;
  title: string;
  poster?: string;
  /** Identifiants pour l'affiche Better Posters (sinon : poster) */
  ids?: PosterIds;
  subtitle?: string;
  /** Image large (TV : fond de l'accueil quand l'affiche est sélectionnée) */
  backdrop?: string;
  badge?: { label: string; color: string; state?: 'available' | 'partial' | 'monitored' | 'missing' | 'pending' } | null;
  onPress: () => void | Promise<void>;
};

const BADGE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  available: 'checkmark',
  partial: 'remove',
  monitored: 'time-outline',
  missing: 'eye-off-outline',
  pending: 'hourglass-outline',
};

/** Pastille ronde en haut à droite de l'affiche (coche = dans ta bibliothèque). */
export function StatusBadge({ badge }: { badge: NonNullable<PosterItem['badge']> }) {
  const icon = badge.state ? BADGE_ICON[badge.state] : 'checkmark';
  return (
    <View style={styles.badge} accessibilityLabel={badge.label}>
      <Ionicons name={icon} size={13} color={badge.state === 'monitored' || badge.state === 'pending' ? C.warning : '#fff'} />
    </View>
  );
}

/** Pastille « ★ 8,5 · Top » en haut à gauche de l'affiche : moyenne des Notes de la famille (sur 10) et son verdict. */
export function FamilyStarBadge({ type, tmdbId }: { type?: 'movie' | 'tv'; tmdbId?: number }) {
  const { settings } = useSettings();
  const r = useFamilyRatingBadge(settings, type, tmdbId);
  if (!r) return null;
  return (
    <View style={styles.starsWrap} pointerEvents="none" accessibilityLabel={`Notes ${r.avg} sur 10`}>
      <View style={styles.stars}>
        <Ionicons name="star" size={10} color="#FFC93C" />
        <Text style={styles.starsText}>{r.avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</Text>
        <Text style={[styles.starsText, { color: verdict(r.avg).color }]}>· {verdict(r.avg).label}</Text>
      </View>
    </View>
  );
}

/** Chip de filtre façon Nuvio : sélectionnée = contour clair. */
export function SegChip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.seg, on && styles.segOn]}>
      <Text style={[styles.segText, on && { color: C.text }]}>{label}</Text>
      {icon && <Ionicons name={icon} size={13} color={on ? C.text : C.textDim} />}
    </Pressable>
  );
}

export function PosterCard({ item, width = POSTER_W }: { item: PosterItem; width?: number }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Titre noté par la famille : affiche Better Posters sans sa note (c'est la note de la famille qui s'affiche)
  const fam = useFamilyRatingBadge(settings, item.ids?.type === 'tv' ? 'tv' : item.ids?.type === 'movie' ? 'movie' : undefined, item.ids?.tmdb);
  // TV : affiches TMDB directes (le service d'affiches améliorées ajoute une requête et du délai)
  const better = useBetterPoster(Platform.isTV ? undefined : item.ids, { hideRating: Boolean(fam) });
  const src = better && !failed ? better : item.poster;
  const height = Math.round(width * 1.5);
  return (
    <Pressable
      style={({ pressed }) => [{ width, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
      tvFocus="card"
      onFocus={() => setTvFocus({ key: item.key, title: item.title, backdrop: item.backdrop ?? item.poster, meta: item.subtitle })}
      onPress={async () => {
        if (busy) return;
        tap();
        setBusy(true);
        try {
          await item.onPress();
        } finally {
          setBusy(false);
        }
      }}>
      <View style={[styles.poster, { width, height }]}>
        {src ? (
          <Image
            source={src}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={Platform.isTV ? 0 : 200}
            cachePolicy="memory-disk"
            recyclingKey={item.key}
            onError={() => better && setFailed(true)}
          />
        ) : (
          <View style={styles.posterFallback}>
            <Text style={styles.posterFallbackText} numberOfLines={3}>
              {item.title}
            </Text>
          </View>
        )}
        {item.badge && <StatusBadge badge={item.badge} />}
        <FamilyStarBadge type={item.ids?.type === 'tv' ? 'tv' : item.ids?.type === 'movie' ? 'movie' : undefined} tmdbId={item.ids?.tmdb} />
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

function SkeletonRow() {
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.poster, { width: POSTER_W, height: POSTER_H, opacity: 0.6 - i * 0.12 }]} />
      ))}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  items,
  loading,
  error,
  accent,
}: {
  title: string;
  subtitle?: string;
  items: PosterItem[];
  loading?: boolean;
  error?: string | null;
  /** Couleur de thème (sélections de saison) */
  accent?: string;
}) {
  if (!loading && !error && items.length === 0) return null;
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, accent ? { color: accent } : null]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
          {!loading && !error && (
          <View style={styles.rowMore}>
            <Ionicons name="chevron-forward" size={15} color={C.textDim} />
          </View>
        )}
      </View>
      {loading ? (
        <SkeletonRow />
      ) : error ? (
        <Text style={[styles.rowSub, { paddingHorizontal: 16 }]}>Erreur : {error}</Text>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(i) => i.key}
          renderItem={({ item }) => <PosterCard item={item} />}
          showsHorizontalScrollIndicator={false}
          // TV : marge autour des affiches, sinon l'agrandissement au focus est rogné
          contentContainerStyle={Platform.isTV ? { paddingHorizontal: 24, paddingVertical: 12, gap: 14 } : { paddingHorizontal: 16, gap: 12 }}
          initialNumToRender={Platform.isTV ? 8 : 6}
          maxToRenderPerBatch={8}
          windowSize={Platform.isTV ? 7 : 5}
          removeClippedSubviews={!Platform.isTV}
        />
      )}
    </View>
  );
}

export function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/** Pastille d'info neutre (année, durée, note…) */
export function Pill({ children, icon }: { children: ReactNode; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.pill}>
      {icon && <Ionicons name={icon} size={12} color={C.text} />}
      <Text style={styles.pillText}>{children}</Text>
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
  small,
}: {
  title: string;
  /** Version compacte (fiches : Lire, Bande-annonce) */
  small?: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** primary : blanc plein · glass : verre dépoli · secondary : gris · danger */
  variant?: 'primary' | 'secondary' | 'glass' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === 'primary'
      ? C.text
      : variant === 'glass'
        ? C.glass
        : variant === 'danger'
          ? 'rgba(255,69,58,0.15)'
          : C.surfaceHigh;
  const fg = variant === 'primary' ? '#000' : variant === 'danger' ? C.danger : C.text;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 19} color={fg} />}
          {title ? <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</Text> : null}
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
    <View style={{ marginBottom: 22 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

/** En-tête de grand titre, aligné à gauche (style Apple TV / Nuvio). */
export function ScreenTitle({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.screenTitle}>
      {onBack ? (
        <Pressable
          onPress={() => {
            tap();
            onBack();
          }}
          hitSlop={10}
          accessibilityLabel="Retour"
          style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
      ) : null}
      <Text style={[styles.screenTitleText, onBack ? { flex: 1 } : null]}>{title}</Text>
      {right}
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
      <View style={styles.setupIcon}>
        <Ionicons name="key-outline" size={30} color={C.text} />
      </View>
      <Text style={styles.setupTitle}>{title}</Text>
      <Text style={styles.setupText}>{text}</Text>
      <Button title="Ouvrir les réglages" icon="settings-outline" onPress={() => router.push('/settings')} />
    </View>
  );
}

/** Dégradé vers le noir, pour fondre un visuel dans le fond. */
export function Fade({ height, top }: { height: number; top?: boolean }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={top ? ['rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'] : ['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)', '#000']}
      locations={top ? [0, 1] : [0, 0.55, 1]}
      style={[{ position: 'absolute', left: 0, right: 0, height }, top ? { top: 0 } : { bottom: 0 }]}
    />
  );
}

const styles = StyleSheet.create({
  starsWrap: { position: 'absolute', left: 6, top: 6, alignItems: 'flex-start' },
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  starsText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  poster: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  posterFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10 },
  posterFallbackText: { color: C.textDim, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  posterBusy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterTitle: { color: C.text, fontSize: 14, fontWeight: '500', marginTop: 8 },
  posterSub: { color: C.textDim, fontSize: 12, marginTop: 3, letterSpacing: 0.3 },
  badge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  rowTitle: { color: C.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  rowMore: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.surfaceHigh,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segOn: { borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.06)' },
  segText: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  rowSub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    backgroundColor: C.glass,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '700', color: C.text },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: C.glass,
  },
  pillText: { color: C.text, fontSize: 12, fontWeight: '700' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: R.md,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minHeight: 50,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonSmall: { minHeight: 40, paddingVertical: 9, paddingHorizontal: 14, gap: 6, borderRadius: 12 },
  buttonTextSmall: { fontSize: 14 },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 7 },
  input: {
    backgroundColor: C.surfaceHigh,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  hint: { color: C.textFaint, fontSize: 12, marginTop: 6, lineHeight: 17 },
  section: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16 },
  sectionTitle: {
    color: C.textDim,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  screenTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  screenTitleText: { color: C.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  setup: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: C.bg },
  setupIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  setupTitle: { color: C.text, fontSize: 22, fontWeight: '800' },
  setupText: { color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
});
