// Animation de lancement : une bulle tombe sur le symbole Lumio (Λ), éclate, et le symbole se remplit de lumière
// par le bas comme un liquide. Puis le nom apparaît et tout s'efface quand l'appli est prête.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

const BG = '#0B0D12';
const LETTERS = 'Lumio'.split('');
const MARK_W = 150;
const MARK_H = Math.round((MARK_W * 442) / 480);
const BUBBLE = 34;
// Durée minimale à l'écran (l'animation complète)
const MIN_MS = 2300;

export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const empty = useRef(new Animated.Value(0)).current; // apparition du symbole vide
  const fall = useRef(new Animated.Value(0)).current; // chute de la bulle (0 en haut → 1 sur le sommet)
  const squash = useRef(new Animated.Value(0)).current; // écrasement à l'impact
  const burst = useRef(new Animated.Value(0)).current; // éclatement de la bulle
  const ripple = useRef(new Animated.Value(0)).current; // onde de choc
  const fill = useRef(new Animated.Value(0)).current; // remplissage du symbole
  const glow = useRef(new Animated.Value(0)).current;
  const letters = useRef(LETTERS.map(() => new Animated.Value(0))).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(empty, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      // La bulle tombe en accélérant
      Animated.timing(fall, { toValue: 1, duration: 560, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      // Impact : elle s'écrase…
      Animated.timing(squash, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      // … éclate, l'onde part et le symbole se remplit
      Animated.parallel([
        Animated.timing(burst, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ripple, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fill, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(450),
          Animated.timing(glow, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(550),
          Animated.stagger(
            55,
            letters.map((v) => Animated.timing(v, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }))
          ),
        ]),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disparition une fois l'appli prête (et l'animation jouée en entier)
  const started = useRef(Date.now());
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - started.current));
    const t = setTimeout(() => {
      Animated.timing(out, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        setGone(true);
        onDone?.();
      });
    }, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (gone) return null;

  // Remplissage par le bas : la fenêtre descend pendant que l'image remonte d'autant (reste en place à l'écran)
  const clipY = fill.interpolate({ inputRange: [0, 1], outputRange: [MARK_H, 0] });
  const imgY = fill.interpolate({ inputRange: [0, 1], outputRange: [-MARK_H, 0] });

  const bubbleY = fall.interpolate({ inputRange: [0, 1], outputRange: [-360, -BUBBLE / 2 + 6] });
  const bubbleScaleX = Animated.add(
    squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }),
    burst.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] })
  );
  const bubbleScaleY = Animated.add(
    squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.68] }),
    burst.interpolate({ inputRange: [0, 1], outputRange: [0, 1.2] })
  );
  const bubbleOpacity = burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity: out, transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] }]}>
      <Animated.View
        style={[styles.glow, { opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] }) }] }]}
      />

      <View style={{ width: MARK_W, height: MARK_H }}>
        {/* Symbole vide */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: empty }]}>
          <Image source={require('@/assets/images/splash-mark-empty.png')} style={styles.mark} resizeMode="contain" />
        </Animated.View>

        {/* Symbole plein, révélé par le bas */}
        <Animated.View style={[styles.clip, { transform: [{ translateY: clipY }] }]}>
          <Animated.View style={{ transform: [{ translateY: imgY }] }}>
            <Image source={require('@/assets/images/splash-mark-fill.png')} style={styles.mark} resizeMode="contain" />
          </Animated.View>
        </Animated.View>

        {/* Onde à l'impact, au sommet du symbole */}
        <Animated.View
          style={[
            styles.ripple,
            {
              opacity: ripple.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.9, 0] }),
              transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.3, 4.2] }) }],
            },
          ]}
        />

        {/* La bulle */}
        <Animated.View
          style={[
            styles.bubble,
            { opacity: bubbleOpacity, transform: [{ translateY: bubbleY }, { scaleX: bubbleScaleX }, { scaleY: bubbleScaleY }] },
          ]}>
          <View style={styles.bubbleShine} />
        </Animated.View>
      </View>

      <View style={styles.word}>
        {LETTERS.map((ch, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.letter,
              { opacity: letters[i], transform: [{ translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
            ]}>
            {ch}
          </Animated.Text>
        ))}
      </View>
      <Animated.View style={{ opacity: glow }}>
        <Text style={styles.tag}>Ton cinéma maison</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(61,139,255,0.22)' },
  mark: { width: MARK_W, height: MARK_H },
  clip: { position: 'absolute', left: 0, top: 0, width: MARK_W, height: MARK_H, overflow: 'hidden' },
  ripple: {
    position: 'absolute',
    top: -14,
    left: MARK_W / 2 - 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(160,205,255,0.9)',
  },
  bubble: {
    position: 'absolute',
    top: 0,
    left: MARK_W / 2 - BUBBLE / 2,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    backgroundColor: 'rgba(90,162,255,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(210,232,255,0.95)',
    shadowColor: '#5AA2FF',
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  bubbleShine: { position: 'absolute', top: 6, left: 8, width: 10, height: 7, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.85)', transform: [{ rotate: '-30deg' }] },
  word: { flexDirection: 'row', marginTop: 30 },
  letter: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: 1 },
  tag: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600', marginTop: 8 },
});
