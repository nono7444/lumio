// Android TV : contour de focus (télécommande) sur tout ce qui est cliquable.
import { forwardRef, useState } from 'react';
import { Platform, Pressable as RNPressable, type PressableProps, type View } from 'react-native';
import * as RN from 'react-native';

export const IS_TV = Platform.isTV;

const FOCUS_RING = { borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 14, transform: [{ scale: 1.05 }] } as const;

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
  return (
    <RNPressable
      ref={ref}
      {...rest}
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
        return [base, focused && focusRing ? FOCUS_RING : null];
      }}
    />
  );
});

export type TVRemoteEvent = { eventType?: string };

// useTVEventHandler n'existe que dans react-native-tvos (build TV) : sur téléphone, c'est un hook vide.
const noop = (_handler: (e: TVRemoteEvent) => void) => {};
export const useTVRemote: (handler: (e: TVRemoteEvent) => void) => void = (RN as any).useTVEventHandler ?? noop;
