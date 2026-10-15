import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type Addon = {
  /** URL de base, sans /manifest.json final */
  base: string;
  name: string;
  /** catalogues désactivés par l'utilisateur (clé type:id) */
  hidden?: string[];
};

export type ArrConfig = {
  url: string;
  apiKey: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  /** Sonarr v3 uniquement (ignoré par Sonarr v4) */
  languageProfileId?: number;
  /** Lance la recherche dès l'ajout */
  searchOnAdd: boolean;
};

export type RadarrConfig = ArrConfig & {
  minimumAvailability: 'announced' | 'inCinemas' | 'released';
};

export type SonarrConfig = ArrConfig & {
  seasonFolder: boolean;
};

export type JellyfinSession = {
  url: string;
  token: string;
  userId: string;
  userName: string;
  serverName?: string;
};

export type BetterPostersConfig = {
  enabled: boolean;
  rating: boolean;
  genre: boolean;
  /** '' = moyenne, sinon IM, TM, RT, MC, TR, LB */
  ratingSource: string;
};

export type Settings = {
  /** Identifiant d'appareil stable, envoyé à Jellyfin */
  deviceId: string;
  jellyfin: JellyfinSession | null;
  /** L'utilisateur a choisi de continuer sans Jellyfin */
  skipJellyfin: boolean;
  betterPosters: BetterPostersConfig;
  /** Clé API v3 ou jeton v4 TMDB (obligatoire : recherche + fiches) */
  tmdbKey: string;
  language: string;
  radarr: RadarrConfig;
  sonarr: SonarrConfig;
  addons: Addon[];
  showTrending: boolean;
};

export const DEFAULT_ADDON: Addon = {
  base: 'https://v3-cinemeta.strem.io',
  name: 'Cinemeta',
};

const newDeviceId = () =>
  'lumio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

const DEFAULTS: Settings = {
  deviceId: '',
  jellyfin: null,
  skipJellyfin: false,
  betterPosters: { enabled: true, rating: true, genre: false, ratingSource: '' },
  tmdbKey: '',
  language: 'fr-FR',
  radarr: { url: '', apiKey: '', searchOnAdd: true, minimumAvailability: 'released' },
  sonarr: { url: '', apiKey: '', searchOnAdd: true, seasonFolder: true },
  addons: [DEFAULT_ADDON],
  showTrending: true,
};

const KEY = 'lumio-native:settings:v2';

type Ctx = {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const current = useRef(settings);
  current.current = settings;

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<Settings>;
        const merged: Settings = {
          ...DEFAULTS,
          ...saved,
          radarr: { ...DEFAULTS.radarr, ...saved.radarr },
          sonarr: { ...DEFAULTS.sonarr, ...saved.sonarr },
          betterPosters: { ...DEFAULTS.betterPosters, ...saved.betterPosters },
        };
        current.current = merged;
        setSettings(merged);
      })
      .catch(() => {})
      .finally(() => {
        // Identifiant d'appareil généré une fois pour toutes
        if (!current.current.deviceId) {
          const next = { ...current.current, deviceId: newDeviceId() };
          current.current = next;
          setSettings(next);
          AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
        }
        setReady(true);
      });
  }, []);

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

export const hasTmdb = (s: Settings) => Boolean(s.tmdbKey.trim());

/** Prêt à ajouter : URL, clé, profil et dossier racine choisis. */
export const arrReady = (c: ArrConfig) =>
  Boolean(c.url && c.apiKey && c.qualityProfileId && c.rootFolderPath);
