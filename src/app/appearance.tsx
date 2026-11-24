// Profil → Apparence : couleurs, fond, arrondis, verre, taille des affiches et reflet de l'accueil, avec des curseurs
// et un aperçu en direct. Les couleurs s'appliquent partout au prochain lancement ; le reflet change tout de suite.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { DEFAULT_LOOK, hsl, lookPalette, LOOK_PRESETS, normalizeLook, writeLook, type Look } from '@/lib/look';
import { useSettings } from '@/lib/settings';

const HUES = Array.from({ length: 13 }, (_, i) => hsl(i * 30, 100, 55));

/** Curseur maison (pas de module natif) : glisser ou toucher la piste. */
function LookSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  track,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** Piste colorée (ex. arc-en-ciel pour la teinte) */
  track?: string[];
}) {
  const [w, setW] = useState(1);
  const startX = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;
  const geo = useRef({ w: 1, min, max, step });
  geo.current = { w, min, max, step };
  const toVal = (x: number) => {
    const g = geo.current;
    const r = Math.max(0, Math.min(1, x / g.w));
    const v = g.min + r * (g.max - g.min);
    return Math.round(v / g.step) * g.step;
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          startX.current = e.nativeEvent.locationX;
          cb.current(toVal(startX.current));
        },
        onPanResponderMove: (_, g) => cb.current(toVal(startX.current + g.dx)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const pct = (value - min) / (max - min || 1);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.sLabel}>{label}</Text>
        <Text style={styles.sValue}>{format ? format(value) : String(value)}</Text>
      </View>
      <View style={styles.sHit} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        {track ? (
          <LinearGradient colors={track as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sTrack} />
        ) : (
          <View style={[styles.sTrack, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
            <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 3, backgroundColor: '#fff' }} />
          </View>
        )}
        <View pointerEvents="none" style={[styles.sThumb, { left: Math.max(0, Math.min(w - 26, pct * w - 13)) }]} />
      </View>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={{ gap: 18 }}>{children}</View>
    </View>
  );
}

/** Aperçu : un morceau d'accueil dessiné avec les réglages en cours. */
function Preview({ look }: { look: Look }) {
  const p = lookPalette(look);
  const r = look.radius / 100;
  const poster = Math.round(64 * (look.posterSize / 100));
  return (
    <View style={[styles.preview, { backgroundColor: p.bg, borderRadius: 22 }]}>
      <LinearGradient colors={[hsl(look.accentHue, 70, 30), hsl((look.accentHue + 40) % 360, 60, 18)]} style={{ height: 110 }} />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']} style={{ position: 'absolute', left: 0, right: 0, top: 50, height: 60 }} />
      {look.reflection ? (
        <LinearGradient
          colors={[hsl((look.accentHue + 40) % 360, 60, 10), p.bg]}
          style={{ height: Math.round(70 * (look.reflectionLength / 100)) }}
        />
      ) : null}
      <View style={{ position: 'absolute', top: 70, left: 12, right: 12, flexDirection: 'row', gap: 8 }}>
        <View style={[styles.pvBtn, { backgroundColor: '#fff', borderRadius: 12 * r }]}>
          <Ionicons name="play" size={12} color="#000" />
          <Text style={{ color: '#000', fontWeight: '800', fontSize: 12 }}>Lire</Text>
        </View>
        <View style={[styles.pvBtn, { backgroundColor: p.glass, borderRadius: 12 * r }]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Infos</Text>
        </View>
      </View>
      <View style={{ padding: 12, gap: 8, marginTop: look.reflection ? -Math.round(70 * (look.reflectionLength / 100)) + 8 : 0 }}>
        <Text style={{ color: p.text, fontWeight: '800', fontSize: 15 }}>Derniers ajouts</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: poster, height: poster * 1.5, borderRadius: 8 * r, backgroundColor: hsl((look.accentHue + i * 50) % 360, 35, 28) }} />
          ))}
        </View>
        <Text style={{ color: p.textDim, fontSize: 12 }}>Texte secondaire · 2026 · Film</Text>
        <View style={[styles.pvTabs, { backgroundColor: p.surfaceHigh, borderRadius: 22 * r }]}>
          {['home', 'search', 'albums', 'person-circle'].map((n, i) => (
            <View key={n} style={[styles.pvTab, i === 0 && { backgroundColor: p.accentSoft }]}>
              <Ionicons name={n as keyof typeof Ionicons.glyphMap} size={16} color={i === 0 ? p.accent : p.textDim} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const [look, setLook] = useState<Look>(() => normalizeLook(settings.look));
  const [dirty, setDirty] = useState(false);
  const set = (patch: Partial<Look>) => {
    setLook((l) => ({ ...l, ...patch }));
    setDirty(true);
  };
  const pct = (v: number) => `${Math.round(v)} %`;

  const save = () => {
    tap();
    writeLook(look);
    update({ look });
    setDirty(false);
    Alert.alert(
      'Apparence enregistrée',
      Platform.OS === 'android'
        ? 'Le reflet change tout de suite. Les couleurs s’appliquent partout au prochain lancement : ferme Lumio puis rouvre-la.'
        : 'Le reflet change tout de suite. Les couleurs s’appliquent partout au prochain lancement : ferme Lumio (balaye-la vers le haut dans le sélecteur d’applis) puis rouvre-la.',
      Platform.OS === 'android' ? [{ text: 'Plus tard' }, { text: 'Fermer Lumio', onPress: () => BackHandler.exitApp() }] : [{ text: 'OK' }]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.round}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headTitle}>Apparence</Text>
        <Pressable onPress={save} disabled={!dirty} style={[styles.saveBtn, !dirty && { opacity: 0.4 }]}>
          <Text style={styles.saveTxt}>Enregistrer</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 16 }}>
        <Preview look={look} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {LOOK_PRESETS.map((pr) => {
            const l = normalizeLook(pr.look);
            const pal = lookPalette(l);
            return (
              <Pressable
                key={pr.name}
                onPress={() => {
                  tap();
                  setLook({ ...l, reflection: look.reflection, reflectionLength: look.reflectionLength, reflectionBlur: look.reflectionBlur, posterSize: look.posterSize, radius: look.radius });
                  setDirty(true);
                }}
                style={[styles.preset, { backgroundColor: pal.bg }]}>
                <View style={[styles.presetDot, { backgroundColor: pal.accent }]} />
                <Text style={styles.presetTxt}>{pr.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Card title="Couleur d’accent">
          <LookSlider label="Teinte" value={look.accentHue} min={0} max={360} onChange={(v) => set({ accentHue: v })} format={(v) => `${v}°`} track={HUES} />
          <LookSlider label="Intensité" value={look.accentSat} min={0} max={100} onChange={(v) => set({ accentSat: v })} format={pct} />
          <LookSlider label="Luminosité" value={look.accentLight} min={30} max={90} onChange={(v) => set({ accentLight: v })} format={pct} />
        </Card>

        <Card title="Fond">
          <LookSlider label="Luminosité du fond" value={look.bgLight} min={0} max={14} onChange={(v) => set({ bgLight: v })} format={(v) => (v === 0 ? 'Noir' : pct(v))} />
          <LookSlider label="Teinte du fond" value={look.bgHue} min={0} max={360} onChange={(v) => set({ bgHue: v })} format={(v) => `${v}°`} track={HUES} />
          <LookSlider label="Intensité de la teinte" value={look.bgSat} min={0} max={50} onChange={(v) => set({ bgSat: v })} format={pct} />
          <LookSlider label="Texte secondaire" value={look.textDim} min={45} max={85} onChange={(v) => set({ textDim: v })} format={pct} />
        </Card>

        <Card title="Formes">
          <LookSlider label="Arrondis" value={look.radius} min={40} max={170} step={5} onChange={(v) => set({ radius: v })} format={pct} />
          <LookSlider label="Boutons en verre" value={look.glass} min={4} max={32} onChange={(v) => set({ glass: v })} format={pct} />
          <LookSlider label="Taille des affiches" value={look.posterSize} min={80} max={130} step={5} onChange={(v) => set({ posterSize: v })} format={pct} />
        </Card>

        <Card title="Reflet sous l’image de l’accueil">
          <View style={styles.switchRow}>
            <Text style={styles.sLabel}>Reflet</Text>
            <Switch value={look.reflection} onValueChange={(v) => set({ reflection: v })} />
          </View>
          {look.reflection ? (
            <>
              <LookSlider label="Longueur" value={look.reflectionLength} min={40} max={150} step={5} onChange={(v) => set({ reflectionLength: v })} format={pct} />
              <LookSlider label="Flou" value={look.reflectionBlur} min={0} max={60} onChange={(v) => set({ reflectionBlur: v })} />
            </>
          ) : null}
        </Card>

        <Text style={styles.help}>
          Les couleurs, les arrondis et la taille des affiches s’appliquent dans toute l’appli au prochain lancement de Lumio. Le reflet change tout de suite.
        </Text>
        <Pressable
          onPress={() => {
            tap();
            setLook(DEFAULT_LOOK);
            setDirty(true);
          }}
          style={styles.reset}>
          <Ionicons name="refresh" size={16} color={C.textDim} />
          <Text style={{ color: C.textDim, fontWeight: '700' }}>Revenir à l’apparence d’origine</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, color: C.text, fontSize: 22, fontWeight: '800' },
  saveBtn: { backgroundColor: '#fff', paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: 'center' },
  saveTxt: { color: '#000', fontWeight: '800' },
  preview: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)' },
  pvBtn: { flex: 1, height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  pvTabs: { flexDirection: 'row', justifyContent: 'space-around', padding: 6, marginTop: 6 },
  pvTab: { width: 44, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  preset: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  presetDot: { width: 14, height: 14, borderRadius: 7 },
  presetTxt: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 18, padding: 16, gap: 14 },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  sLabel: { color: C.text, fontSize: 15, fontWeight: '600' },
  sValue: { color: C.textDim, fontSize: 14, fontVariant: ['tabular-nums'] },
  sHit: { height: 30, justifyContent: 'center' },
  sTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  sThumb: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', top: 2, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  help: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  reset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
});
