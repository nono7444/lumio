// Android TV : contour de focus (télécommande) sur tout ce qui est cliquable.
import { forwardRef, useState } from 'react';
import { Platform, Pressable as RNPressable, type PressableProps, type View } from 'react-native';
import * as RN from 'react-native';

export const IS_TV = Platform.isTV;

// Agrandissement léger (ne change pas la mise en page) + contour dessiné par-dessus (ne décale rien)
const FOCUS_SCALE = { transform: [{ scale: 1.04 }], zIndex: 10 } as const;
const RING = {
  position: 'absolute',
  top: -3,
  left: -3,
  right: -3,
  bottom: -3,
  borderWidth: 2,
  borderColor: 'rgba(255,255,255,0.85)',
  borderRadius: 14,
} as const;

type Props = PressableProps & { focusRing?: boolean };

/**
 * Pressable qui, sur TV, montre clairement l'élément sélectionné à la télécommande.
 * Sur téléphone, c'est exactement le Pressable de React Native.
 */
export const FocusPressable = forwardRef<View, Props>(function FocusPressable(
  { style, onFocus, onBlur, focusRing = true, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);
  if (!IS_TV) return <RNPressable ref={ref} style={style} onFocus={onFocus} onBlur={onBlur} {...rest} />;
  const { children, ...others } = rest;
  return (
    <RNPressable
      ref={ref}
      {...others}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        return [base, focused && focusRing ? FOCUS_SCALE : null];
      }}>
      {(state) => (
        <>
          {typeof children === 'function' ? children(state) : children}
          {focused && focusRing ? <RN.View pointerEvents="none" style={RING} /> : null}
        </>
      )}
    </RNPressable>
  );
});

export type TVRemoteEvent = { eventType?: string };

// useTVEventHandler n'existe que dans react-native-tvos (build TV) : sur téléphone, c'est un hook vide.
const noop = (_handler: (e: TVRemoteEvent) => void) => {};
export const useTVRemote: (handler: (e: TVRemoteEvent) => void) => void = (RN as any).useTVEventHandler ?? noop;
