// Lumio Audio : lecteur plein écran (façon Audiobookshelf / BookPlayer) : grande couverture, barre de position,
// −30 s / +30 s, chapitre précédent / suivant, vitesse, minuterie de sommeil, liste des chapitres.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Cover } from '@/components/audio-ui';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { goChapter, nextChapter, prevChapter, seekBy, seekTo, setRate, setSleep, toggle, useAudio } from '@/lib/audio-player';
import { audioUrl, fmtClock } from '@/lib/audiobooks';
import { useSettings } from '@/lib/settings';

const RATES = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2];
const SLEEPS: { label: string; v: number | 'chapter' }[] = [
  { label: '5 min', v: 5 },
  { label: '15 min', v: 15 },
  { label: '30 min', v: 30 },
  { label: '45 min', v: 45 },
  { label: '1 h', v: 60 },
  { label: 'Fin du chapitre', v: 'chapter' },
];

export default function ListeningScreen() {
  const a = useAudio();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const [sheet, setSheet] = useState<null | 'rate' | 'sleep' | 'chapters'>(null);
  const [, tick] = useState(0);
  // Minuterie : le compte à rebours se met à jour chaque seconde
  useEffect(() => {
    if (!a.sleep || !('at' in a.sleep)) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [a.sleep]);

  if (!a.book) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.textDim }}>Rien en lecture.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.text, fontWeight: '700' }}>Fermer</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  const b = a.book;
  const cover = audioUrl(settings, b.cover);
  const size = Math.min(width - 64, height * 0.42, 420);
  const chapterName = b.files.length > 1 ? b.files[a.file]?.name : null;
  const sleepLeft = a.sleep && 'at' in a.sleep ? Math.max(0, Math.round((a.sleep.at - Date.now()) / 1000)) : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {cover ? <Image source={{ uri: cover }} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} blurRadius={60} contentFit="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 28 }}>
        <View style={styles.top}>
          <Pressable onPress={() => (tap(), router.back())} hitSlop={12} accessibilityLabel="Fermer">
            <Ionicons name="chevron-down" size={28} color={C.text} />
          </Pressable>
          <Text numberOfLines={1} style={styles.topText}>
            {b.author ?? 'Livre audio'}
          </Text>
          <Pressable
            onPress={() => (tap(), router.push({ pathname: '/audiobook/[id]', params: { id: b.id } }))}
            hitSlop={12}
            accessibilityLabel="Fiche du livre">
            <Ionicons name="information-circle-outline" size={26} color={C.text} />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={styles.shadow}>
            <Cover book={b} size={size} radius={16} />
          </View>
        </View>

        <View style={{ gap: 4, marginBottom: 14 }}>
          <Text numberOfLines={2} style={styles.title}>
            {b.title}
          </Text>
          <Text numberOfLines={1} style={styles.sub}>
            {chapterName ? `${a.file + 1}/${b.files.length} · ${chapterName}` : (b.narrator ? `Lu par ${b.narrator}` : b.author) ?? ''}
          </Text>
        </View>

        <SeekBar pos={a.pos} dur={a.dur} />
        <View style={styles.times}>
          <Text style={styles.time}>{fmtClock(a.pos)}</Text>
          <Text style={styles.time}>
            {a.dur ? `−${fmtClock(Math.max(0, (a.dur - a.pos) / a.rate))}` : ''}
            {a.rate !== 1 && a.dur ? ` (${a.rate}×)` : ''}
          </Text>
        </View>

        <View style={styles.controls}>
          <Ctl icon="play-skip-back" size={28} onPress={prevChapter} label="Chapitre précédent" disabled={b.files.length < 2 && a.pos < 5} />
          <Ctl icon="refresh" flip size={34} onPress={() => seekBy(-30)} label="Reculer de 30 secondes" badge="30" />
          <Pressable onPress={() => (tap(), toggle())} style={styles.play} accessibilityLabel={a.playing ? 'Pause' : 'Lecture'}>
            {a.buffering && !a.playing ? <ActivityIndicator color="#000" /> : <Ionicons name={a.playing ? 'pause' : 'play'} size={38} color="#000" />}
          </Pressable>
          <Ctl icon="refresh" size={34} onPress={() => seekBy(30)} label="Avancer de 30 secondes" badge="30" />
          <Ctl icon="play-skip-forward" size={28} onPress={nextChapter} label="Chapitre suivant" disabled={a.file + 1 >= b.files.length} />
        </View>

        <View style={styles.bottom}>
          <Tool icon="speedometer-outline" text={`${a.rate}×`} onPress={() => setSheet('rate')} />
          <Tool
            icon={a.sleep ? 'moon' : 'moon-outline'}
            text={sleepLeft != null ? fmtClock(sleepLeft) : a.sleep ? 'Fin chap.' : 'Minuterie'}
            on={!!a.sleep}
            onPress={() => setSheet('sleep')}
          />
          {b.files.length > 1 ? <Tool icon="list" text="Chapitres" onPress={() => setSheet('chapters')} /> : null}
        </View>
      </SafeAreaView>

      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{sheet === 'rate' ? 'Vitesse de lecture' : sheet === 'sleep' ? 'Minuterie de sommeil' : 'Chapitres'}</Text>
          <ScrollView style={{ maxHeight: height * 0.55 }}>
            {sheet === 'rate'
              ? RATES.map((r) => <Opt key={r} text={`${r}×${r === 1 ? ' (normal)' : ''}`} on={a.rate === r} onPress={() => (setRate(r), setSheet(null))} />)
              : sheet === 'sleep'
                ? [
                    ...SLEEPS.map((s) => (
                      <Opt
                        key={String(s.v)}
                        text={s.label}
                        on={s.v === 'chapter' ? !!a.sleep && 'endOfChapter' in a.sleep : false}
                        onPress={() => (setSleep(s.v), setSheet(null))}
                      />
                    )),
                    a.sleep ? <Opt key="off" text="Arrêter la minuterie" danger onPress={() => (setSleep(null), setSheet(null))} /> : null,
                  ]
                : b.files.map((f, i) => <Opt key={f.index} text={`${i + 1}. ${f.name}`} on={i === a.file} onPress={() => (goChapter(i), setSheet(null))} />)}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** Barre de position : on touche ou on glisse pour aller à un moment du chapitre. */
function SeekBar({ pos, dur }: { pos: number; dur: number }) {
  const w = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / w.current));
  const v = drag ?? (dur ? pos / dur : 0);
  return (
    <View
      onLayout={(e) => (w.current = e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => dur > 0}
      onMoveShouldSetResponder={() => dur > 0}
      onResponderGrant={(e) => setDrag(at(e))}
      onResponderMove={(e) => setDrag(at(e))}
      onResponderRelease={(e) => {
        seekTo(at(e) * dur);
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
      style={{ height: 28, justifyContent: 'center' }}>
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: `${v * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.knob, { left: `${v * 100}%`, transform: [{ translateX: -7 }, { scale: drag != null ? 1.4 : 1 }] }]} />
    </View>
  );
}

function Ctl({
  icon,
  size,
  onPress,
  label,
  badge,
  flip,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  size: number;
  onPress: () => void;
  label: string;
  badge?: string;
  flip?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={() => (tap(), onPress())} disabled={disabled} hitSlop={10} accessibilityLabel={label} style={{ opacity: disabled ? 0.35 : 1, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size} color={C.text} style={flip ? { transform: [{ scaleX: -1 }] } : undefined} />
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

function Tool({ icon, text, onPress, on }: { icon: keyof typeof Ionicons.glyphMap; text: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable onPress={() => (tap(), onPress())} style={[styles.tool, on && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
      <Ionicons name={icon} size={18} color={C.text} />
      <Text style={styles.toolText}>{text}</Text>
    </Pressable>
  );
}

function Opt({ text, on, onPress, danger }: { text: string; on?: boolean; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={() => (tap(), onPress())} style={styles.opt}>
      <Text numberOfLines={2} style={[styles.optText, danger && { color: C.danger }, on && { fontWeight: '800' }]}>
        {text}
      </Text>
      {on ? <Ionicons name="checkmark" size={20} color={C.text} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, gap: 12 },
  topText: { flex: 1, textAlign: 'center', color: C.textDim, fontWeight: '600', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  shadow: { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 16, borderRadius: 16 },
  title: { color: C.text, fontSize: 22, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 15 },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.text },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: C.text, top: 7 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: C.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 4 },
  play: { width: 78, height: 78, borderRadius: 39, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', color: C.text, fontSize: 10, fontWeight: '800', top: '38%' },
  bottom: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 26, marginBottom: 12 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)' },
  toolText: { color: C.text, fontWeight: '600', fontSize: 13, fontVariant: ['tabular-nums'] },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.surfaceHigh, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, paddingBottom: 34, paddingHorizontal: 18 },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 10 },
  optText: { color: C.text, fontSize: 16, flex: 1 },
});
