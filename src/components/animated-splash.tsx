// Animation de lancement, façon logo Google : quatre points de couleur rebondissent en vague,
// se rassemblent au centre, et le symbole Lumio (Λ) apparaît à leur place. Pas de texte.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const BG = '#0B0D12';
const DOT = 16;
const GAP = 14;
const COLORS = ['#3D8BFF', '#7B4DFF', '#5AC8FA', '#FFFFFF'];
const MARK_W = 120;
const MARK_H = Math.round((MARK_W * 442) / 480);
const MIN_MS = 2000;

export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const bounce = useRef(COLORS.map(() => new Animated.Value(0))).current;
  const gather = useRef(new Animated.Value(0)).current; // 0 en ligne → 1 rassemblés au centre
  const mark = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const hop = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]);
    Animated.sequence([
      // Deux vagues de rebonds
      Animated.stagger(90, bounce.map(hop)),
      Animated.stagger(90, bounce.map(hop)),
      // Les points se rejoignent…
      Animated.timing(gather, { toValue: 1, duration: 280, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      // … et le symbole prend leur place
      Animated.spring(mark, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const started = useRef(Date.now());
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - started.current));
    const t = setTimeout(() => {
      Animated.timing(out, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        setGone(true);
        onDone?.();
      });
    }, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (gone) return null;
  const span = (COLORS.length - 1) * (DOT + GAP);

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity: out }]}>
      <View style={styles.stage}>
        {COLORS.map((c, i) => {
          const x0 = i * (DOT + GAP) - span / 2;
          return (
            <Animated.View
              key={c}
              style={[
                styles.dot,
                {
                  backgroundColor: c,
                  opacity: gather.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
                  transform: [
                    { translateX: gather.interpolate({ inputRange: [0, 1], outputRange: [x0, 0] }) },
                    { translateY: bounce[i].interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) },
                    { scale: gather.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) },
                  ],
                },
              ]}
            />
          );
        })}
        <Animated.Image
          source={require('@/assets/images/splash-mark-fill.png')}
          resizeMode="contain"
          style={[
            styles.mark,
            {
              opacity: mark,
              transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}


const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  stage: { width: MARK_W, height: MARK_H, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  mark: { position: 'absolute', width: MARK_W, height: MARK_H },
});
