// Logo animé au lancement : le symbole Lumio s'allume (halo + rayon de lumière), le nom apparaît, puis tout s'efface.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const BG = '#0B0D12';
const LETTERS = 'Lumio'.split('');

export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const logo = useRef(new Animated.Value(0)).current; // apparition du symbole
  const glow = useRef(new Animated.Value(0)).current; // halo
  const sweep = useRef(new Animated.Value(0)).current; // rayon qui traverse le symbole
  const letters = useRef(LETTERS.map(() => new Animated.Value(0))).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logo, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(sweep, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.stagger(
          60,
          letters.map((v) => Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }))
        ),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disparition une fois l'appli prête (et l'animation jouée au moins 1,4 s)
  const started = useRef(Date.now());
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, 1400 - (Date.now() - started.current));
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
  const scale = logo.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const rotate = logo.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '0deg'] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.15] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, 120] });

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity: out, transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] }]}>
      <Animated.View style={[styles.glow, { opacity: glow, transform: [{ scale: glowScale }] }]} />
      <Animated.View style={[styles.mark, { opacity: logo, transform: [{ scale }, { rotate }] }]}>
        <LinearGradient colors={['#5AA2FF', '#2F6BFF', '#7B4DFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name="play" size={58} color="#fff" style={{ marginLeft: 8 }} />
        {/* Rayon de lumière qui balaie le symbole */}
        <Animated.View style={[styles.sweep, { transform: [{ translateX: sweepX }, { rotate: '20deg' }] }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
      <View style={styles.word}>
        {LETTERS.map((ch, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.letter,
              {
                opacity: letters[i],
                transform: [{ translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}>
            {ch}
          </Animated.Text>
        ))}
      </View>
      <Text style={styles.tag}>Ton cinéma maison</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(61,139,255,0.22)' },
  mark: {
    width: 116,
    height: 116,
    borderRadius: 32,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3D8BFF',
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
  },
  sweep: { position: 'absolute', top: -40, bottom: -40, width: 46 },
  word: { flexDirection: 'row', marginTop: 26 },
  letter: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: 1 },
  tag: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600', marginTop: 8 },
});
