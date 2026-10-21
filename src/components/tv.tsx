// Android TV : effet de sélection (télécommande) sur tout ce qui est cliquable.
import { forwardRef, useRef, useState } from 'react';
import { Platform, Pressable as RNPressable, type PressableProps, type View } from 'react-native';
import * as RN from 'react-native';


export const IS_TV = Platform.isTV;

// Sélection façon Nuvio / Apple TV : l'élément grandit en douceur (animation de 180 ms) et passe devant,
// sans contour. Les cartes (affiches) grandissent un peu plus que les boutons.
const LAYOUT_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth', 'alignSelf',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'left', 'right', 'bottom', 'zIndex',
]);

/** Sépare le style : ce qui place l'élément (va sur l'enveloppe animée) et le reste (reste sur le bouton). */
function splitStyle(style: RN.StyleProp<RN.ViewStyle>) {
  const flat = (RN.StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (LAYOUT_KEYS.has(k) ? outer : inner)[k] = v;
  // Le bouton remplit son enveloppe quand celle-ci a une taille imposée (flex, absolu, hauteur)
  if (outer.flex != null || outer.position === 'absolute' || inner.height != null) inner.flexGrow = 1;
  if (outer.width != null || outer.flex != null || outer.position === 'absolute') inner.alignSelf = 'stretch';
  return { outer, inner };
}

type Props = PressableProps & {
  /** false : pas d'effet de sélection (l'élément gère lui-même son focus) */
  focusRing?: boolean;
  /** « card » : affiche ou vignette (grandit davantage) */
  tvFocus?: 'lift' | 'card';
};

/**
 * Pressable qui, sur TV, montre clairement l'élément sélectionné à la télécommande.
 * Sur téléphone, c'est exactement le Pressable de React Native.
 */
export const FocusPressable = forwardRef<View, Props>(function FocusPressable(
  { style, onFocus, onBlur, focusRing = true, tvFocus = 'lift', ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new RN.Animated.Value(0)).current;
  // TV : l'appui « OK » qui ouvre un écran se termine parfois sur le premier bouton du nouvel écran
  // (ex. le lecteur se refermait aussitôt) → on ignore les appuis pendant 700 ms après l'apparition
  const mountedAt = useRef(Date.now()).current;
  if (!IS_TV) return <RNPressable ref={ref} style={style} onFocus={onFocus} onBlur={onBlur} {...rest} />;
  const { children, onPress, ...others } = rest;
  const go = (to: number) =>
    RN.Animated.timing(anim, { toValue: to, duration: 120, easing: RN.Easing.out(RN.Easing.cubic), useNativeDriver: true }).start();
  const max = tvFocus === 'card' ? 1.06 : 1.03;
  const resolve = (state: { pressed: boolean; focused?: boolean; hovered?: boolean }) =>
    splitStyle(typeof style === 'function' ? style(state as never) : style);
  const { outer } = resolve({ pressed: false });
  return (
    <RN.Animated.View
      style={[
        outer,
        focusRing
          ? {
              zIndex: focused ? 10 : (outer.zIndex as number | undefined),
              transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, max] }) }],
            }
          : null,
      ]}>
      <RNPressable
        ref={ref}
        {...others}
        onPress={onPress ? (e) => Date.now() - mountedAt > 700 && onPress(e) : undefined}
        onFocus={(e) => {
          setFocused(true);
          if (focusRing) go(1);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (focusRing) go(0);
          onBlur?.(e);
        }}
        style={(state) => resolve(state).inner as RN.ViewStyle}>
        {children as never}
      </RNPressable>
    </RN.Animated.View>
  );
});

export type TVRemoteEvent = { eventType?: string };

// useTVEventHandler n'existe que dans react-native-tvos (build TV) : sur téléphone, c'est un hook vide.
const noop = (_handler: (e: TVRemoteEvent) => void) => {};
export const useTVRemote: (handler: (e: TVRemoteEvent) => void) => void = (RN as any).useTVEventHandler ?? noop;
