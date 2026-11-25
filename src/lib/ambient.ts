// Accueil : image du haut (carrousel ou fond choisi) partagée avec le « reflet » qui prolonge ses couleurs sous la photo,
// au lieu d'un passage brutal au noir.
import { useSyncExternalStore } from 'react';

export type Ambient = { source: number | { uri: string }; height: number; tint?: string | null } | null;

let current: Ambient = null;
const subs = new Set<() => void>();

export function setAmbient(a: Ambient) {
  const same =
    a && current && a.height === current.height && (a.tint ?? null) === (current.tint ?? null) && (typeof a.source === 'number' ? a.source === current.source : typeof current.source === 'object' && a.source.uri === current.source.uri);
  if (same || (!a && !current)) return;
  current = a;
  subs.forEach((f) => f());
}

export const useAmbient = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current
  );

/** Noir posé sur le bas de la photo et le haut du reflet : les deux se rejoignent sans couture. */
export const SEAM_DARK = 0.62;
