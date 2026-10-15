import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type Addon = {
  /** URL de base, sans /manifest.json final */
  base: string;
  name: string;
  /** catalogues désactivés par l'utilisateur (clé type:id) */
  hidden?: string[];
};

export type Settings = {
  seerrUrl: string;
  seerrApiKey: string;
  /** Clé API v3 ou jeton v4 TMDB (optionnel, accélère la correspondance IMDb → TMDB) */
  tmdbKey: string;
  addons: Addon[];
  showTrending: boolean;
};

export const DEFAULT_ADDON: Addon = {
  base: 'https://v3-cinemeta.strem.io',
  name: 'Cinemeta',
};

const DEFAULTS: Settings = {
  seerrUrl: '',
  seerrApiKey: '',
  tmdbKey: '',
  addons: [DEFAULT_ADDON],
  showTrending: true,
};

const KEY = 'lumio-native:settings:v1';

type Ctx = {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const current = useRef(settings);
  current.current = settings;

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setSettings(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, ready, update }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings hors de SettingsProvider');
  return ctx;
}

export function isSeerrConfigured(s: Settings) {
  return Boolean(s.seerrUrl && s.seerrApiKey);
}
