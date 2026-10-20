// Android TV : contour de focus (télécommande) sur tout ce qui est cliquable.
import { forwardRef, useState } from 'react';
import { Platform, Pressable as RNPressable, type PressableProps, type View } from 'react-native';
import * as RN from 'react-native';

import { playNav } from '@/lib/tv-ui';

export const IS_TV = Platform.isTV;

// Sélection façon Apple TV : l'élément grandit et passe au premier plan avec une ombre, sans contour blanc
const FOCUS_SCALE = {
  transform: [{ scale: 1.08 }],
  zIndex: 10,
  elevation: 12,
  shadowColor: '#000',
  shadowOpacity: 0.6,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
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
  const { children, onPress, ...others } = rest;
  return (
    <RNPressable
      ref={ref}
      {...others}
      onPress={
        onPress
          ? (e) => {
              playNav('select');
              onPress(e);
            }
          : undefined
      }
      onFocus={(e) => {
        setFocused(true);
        playNav('tick');
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
        </>
      )}
    </RNPressable>
  );
});

export type TVRemoteEvent = { eventType?: string };

// useTVEventHandler n'existe que dans react-native-tvos (build TV) : sur téléphone, c'est un hook vide.
const noop = (_handler: (e: TVRemoteEvent) => void) => {};
export const useTVRemote: (handler: (e: TVRemoteEvent) => void) => void = (RN as any).useTVEventHandler ?? noop;
