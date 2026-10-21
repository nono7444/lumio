// TV : taille de l'interface réglable (préréglages) et sons de navigation façon Apple TV.
//
// Taille : toute l'appli est dessinée dans un « écran virtuel » plus grand, puis réduite d'un coup
// (Petite = 70 %, Moyenne = 80 %…). Les dimensions annoncées aux écrans sont celles de cet écran virtuel,
// donc tout (affiches, barres, textes) rapetisse ou grandit ensemble, sans retoucher chaque page.
import { useEffect, type ReactNode } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { usePathname } from 'expo-router';

import { C } from '@/constants/theme';

export const TV_SCALES = [
  { value: 0.65, label: 'Très petite' },
  { value: 0.75, label: 'Petite' },
  { value: 0.85, label: 'Moyenne' },
  { value: 1, label: 'Grande' },
] as const;
export const DEFAULT_TV_SCALE = 0.75;

let scale = 1;
const realGet = Dimensions.get.bind(Dimensions);

// Doit être chargé avant tout écran : les composants lisent leurs dimensions via Dimensions.get
if (Platform.isTV) {
  (Dimensions as { get: typeof Dimensions.get }).get = ((dim: 'window' | 'screen') => {
    const d = realGet(dim);
    return scale === 1 ? d : { ...d, width: d.width / scale, height: d.height / scale };
  }) as typeof Dimensions.get;
}

/** Enveloppe l'appli : sur TV, écran virtuel réduit à la taille choisie (sur téléphone, ne fait rien). */
export function TvScaleRoot({ value, children }: { value?: number; children: ReactNode }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const path = Platform.isTV ? usePathname() : '';
  if (!Platform.isTV) return <>{children}</>;
  // Lecteur : pas de réduction (la vidéo s'affiche alors dans une SurfaceView, bien plus fluide qu'une TextureView)
  const full = path === '/player' || path === '/watch';
  scale = value && value > 0.4 && value <= 1 ? value : DEFAULT_TV_SCALE;
  const { width: W, height: H } = realGet('window');
  const w = W / scale;
  const h = H / scale;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, overflow: 'hidden' }}>
      {/* key : changer de taille recrée l'interface pour qu'elle relise les dimensions */}
      <View
        key={scale}
        style={
          full
            ? { width: W, height: H }
            : { width: w, height: h, transform: [{ translateX: (W - w) / 2 }, { translateY: (H - h) / 2 }, { scale }] }
        }>
        {children}
      </View>
    </View>
  );
}

// ——— Sons de navigation ———
type Player = { seekTo: (s: number) => Promise<void> | void; play: () => void; volume: number };
let players: { tick: Player; select: Player } | null = null;
let soundsOn = true;
let last = 0;

function load() {
  if (players || !Platform.isTV) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAudioPlayer, setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
    players = {
      tick: createAudioPlayer(require('@/assets/sounds/tick.wav')) as unknown as Player,
      select: createAudioPlayer(require('@/assets/sounds/select.wav')) as unknown as Player,
    };
    players.tick.volume = 0.5;
    players.select.volume = 0.55;
  } catch {
    players = null;
  }
}

/** Petit « tock » quand la sélection bouge à la télécommande, comme sur Apple TV. */
export function playNav(kind: 'tick' | 'select' = 'tick') {
  if (!Platform.isTV || !soundsOn) return;
  const now = Date.now();
  if (kind === 'tick' && now - last < 45) return;
  last = now;
  load();
  const p = players?.[kind];
  if (!p) return;
  try {
    Promise.resolve(p.seekTo(0))
      .catch(() => {})
      .finally(() => p.play());
  } catch {}
}

export function useTvSounds(enabled: boolean | undefined) {
  useEffect(() => {
    soundsOn = enabled !== false;
    if (soundsOn) load();
  }, [enabled]);
}
