// Sauvegarde des réglages hors de l'appli, pour les retrouver après une suppression / réinstallation :
//  1. le trousseau iOS (Keychain), qui survit à la désinstallation de l'appli ;
//  2. les préférences de l'utilisateur sur le serveur Jellyfin, qui suivent le compte sur tous les appareils.
import * as SecureStore from 'expo-secure-store';

import type { Settings } from './settings';

const KEY = 'lumio_settings';
const CHUNK = 1800; // le trousseau tolère mal les valeurs > 2 Ko

const opts: SecureStore.SecureStoreOptions = {
  keychainService: 'lol.wawanono.lumio.backup',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function saveToKeychain(json: string) {
  try {
    const parts = Math.ceil(json.length / CHUNK);
    for (let i = 0; i < parts; i++) await SecureStore.setItemAsync(`${KEY}_${i}`, json.slice(i * CHUNK, (i + 1) * CHUNK), opts);
    await SecureStore.setItemAsync(`${KEY}_n`, String(parts), opts);
  } catch {}
}

export async function loadFromKeychain(): Promise<Partial<Settings> | null> {
  try {
    const n = Number(await SecureStore.getItemAsync(`${KEY}_n`, opts));
    if (!n) return null;
    let json = '';
    for (let i = 0; i < n; i++) json += (await SecureStore.getItemAsync(`${KEY}_${i}`, opts)) ?? '';
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ——— Préférences Jellyfin (DisplayPreferences, propres à chaque utilisateur) ———

const PREF_ID = 'lumio';

type DisplayPrefs = { CustomPrefs?: Record<string, string>; [k: string]: unknown };

function jfHeaders(s: Settings) {
  const auth = `MediaBrowser Client="Lumio", Device="iPhone", DeviceId="${s.deviceId}", Version="1.0.0", Token="${s.jellyfin!.token}"`;
  return { Authorization: auth, 'X-Emby-Authorization': auth, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/** Ce qui part sur le serveur : tout sauf la session Jellyfin elle-même et l'identifiant d'appareil. */
function cloudPayload(s: Settings) {
  const { jellyfin: _jf, deviceId: _d, skipJellyfin: _k, ...rest } = s;
  return rest;
}

export async function saveToJellyfin(s: Settings) {
  if (!s.jellyfin) return;
  const url = `${s.jellyfin.url}/DisplayPreferences/${PREF_ID}?userId=${s.jellyfin.userId}&client=lumio`;
  try {
    const cur: DisplayPrefs = await fetch(url, { headers: jfHeaders(s) }).then((r) => (r.ok ? r.json() : {}));
    const body = {
      ...cur,
      Id: PREF_ID,
      Client: 'lumio',
      CustomPrefs: { ...(cur.CustomPrefs ?? {}), settings: JSON.stringify(cloudPayload(s)), savedAt: new Date().toISOString() },
    };
    await fetch(url, { method: 'POST', headers: jfHeaders(s), body: JSON.stringify(body) });
  } catch {}
}

export async function loadFromJellyfin(s: Settings): Promise<Partial<Settings> | null> {
  if (!s.jellyfin) return null;
  try {
    const res = await fetch(`${s.jellyfin.url}/DisplayPreferences/${PREF_ID}?userId=${s.jellyfin.userId}&client=lumio`, {
      headers: jfHeaders(s),
    });
    if (!res.ok) return null;
    const prefs: DisplayPrefs = await res.json();
    const raw = prefs.CustomPrefs?.settings;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
