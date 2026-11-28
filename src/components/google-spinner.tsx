// Spinner façon Google (Material) : un arc qui tourne, s'allonge et se raccourcit en passant
// bleu → rouge → jaune → vert. Dessiné en SVG et animé par Reanimated (fluide, sur le fil de l'interface).
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, interpolate, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
export const GOOGLE_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#34A853'];
const ARC = 1333; // durée d'un allongement + raccourcissement (ms)

export function GoogleSpinner({ size = 64, stroke = 5 }: { size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const spin = useSharedValue(0); // rotation du dessin
  const arc = useSharedValue(0); // 0 → 1 : longueur de l'arc, puis rattrapage de la queue
  const hue = useSharedValue(0); // 0 → 4 : les quatre couleurs

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 1568, easing: Easing.linear }), -1, false);
    arc.value = withRepeat(withTiming(1, { duration: ARC, easing: Easing.bezier(0.4, 0, 0.2, 1) }), -1, false);
    hue.value = withRepeat(withTiming(4, { duration: ARC * 4, easing: Easing.linear }), -1, false);
  }, [spin, arc, hue]);

  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const props = useAnimatedProps(() => {
    // Première moitié : la tête avance (l'arc s'allonge) ; deuxième moitié : la queue rattrape (l'arc raccourcit)
    const len = interpolate(arc.value, [0, 0.5, 1], [0.03, 0.75, 0.03]) * circ;
    const off = interpolate(arc.value, [0, 0.5, 1], [0, -0.1, -0.75]) * circ;
    const h = hue.value % 4;
    const stroke = interpolateColor(h, [0, 0.9, 1, 1.9, 2, 2.9, 3, 3.9, 4], [
      GOOGLE_COLORS[0], GOOGLE_COLORS[0], GOOGLE_COLORS[1], GOOGLE_COLORS[1], GOOGLE_COLORS[2], GOOGLE_COLORS[2], GOOGLE_COLORS[3], GOOGLE_COLORS[3], GOOGLE_COLORS[0],
    ]);
    return { strokeDasharray: [len, circ], strokeDashoffset: off, stroke };
  });

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[{ width: size, height: size }, rotate]}>
        <Svg width={size} height={size}>
          <AnimatedCircle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" animatedProps={props} />
        </Svg>
      </Animated.View>
    </View>
  );
}
