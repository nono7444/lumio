// VPN pour la Live TV : iOS ne laisse pas une appli piloter le VPN d'une autre (Proton VPN…),
// on passe donc par deux raccourcis de l'app Raccourcis, lancés par un lien shortcuts://.
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import type { LiveVpnConfig } from './settings';

let vpnOn = false;
let autoDone = false;
const listeners = new Set<(on: boolean) => void>();

const set = (on: boolean) => {
  vpnOn = on;
  listeners.forEach((l) => l(on));
};

function shortcutUrl(name: string) {
  const back = encodeURIComponent('lumio://live');
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(name)}&x-success=${back}&x-cancel=${back}&x-error=${back}`;
}

/** Lance le raccourci « VPN On » ou « VPN Off ». Sur Android : ouvre les réglages VPN du téléphone. */
export async function switchVpn(cfg: LiveVpnConfig, on: boolean) {
  if (Platform.OS === 'android') {
    await Linking.sendIntent('android.settings.VPN_SETTINGS').catch(() => Linking.openSettings());
    return;
  }
  await Linking.openURL(shortcutUrl(on ? cfg.onShortcut : cfg.offShortcut));
  set(on);
}

/** Démarrage auto : une seule fois par lancement de l'appli, à la première ouverture de la Live TV. */
export function autoStartVpn(cfg: LiveVpnConfig) {
  if (autoDone || !cfg.enabled || !cfg.auto || vpnOn || Platform.OS !== 'ios') return;
  autoDone = true;
  switchVpn(cfg, true).catch(() => {});
}

/** État supposé du VPN (lancé / coupé depuis Lumio pendant cette session). */
export function useVpnState() {
  const [on, setOn] = useState(vpnOn);
  useEffect(() => {
    listeners.add(setOn);
    return () => void listeners.delete(setOn);
  }, []);
  return on;
}
