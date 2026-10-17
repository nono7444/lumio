import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { loadFromJellyfin, loadFromKeychain, saveToJellyfin, saveToKeychain } from './backup';

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
  /** Admin Jellyfin : ajout direct Radarr/Sonarr. Sinon : demandes via Seerr */
  isAdmin?: boolean;
};

export type SeerrConfig = {
  url: string;
  /** Clé API (admin uniquement, facultative : la session Jellyfin suffit) */
  apiKey?: string;
  userName?: string;
};

/** Rangée de l'accueil : ordre et visibilité choisis par l'utilisateur */
export type HomeRow = { id: string; hidden?: boolean };
/** Onglet de la barre du bas */
export type TabPref = { name: string; hidden?: boolean };

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
  seerr: SeerrConfig | null;
  homeLayout: HomeRow[];
  tabsLayout: TabPref[];
  /** Rangées de l'onglet Bibliothèque : ordre et visibilité */
  libraryLayout: HomeRow[];
  /** Enchaîner automatiquement l'épisode suivant */
  autoNext: boolean;
  /** Addon Stremio des sorties numériques (onglet Calendrier) */
  calendarAddon: string;
  /** Thème saisonnier : 'auto' (selon la date), 'off', ou un thème forcé */
  seasonTheme: string;
  /** Serveur du chat famille */
  chatUrl: string;
  /** Qualité de lecture Jellyfin par défaut (id de QUALITIES, 'original' = lecture directe) */
  quality: string;
  /** Moteur de lecture : mpv (lit tout, MKV inclus) ou lecteur natif du téléphone */
  player: 'mpv' | 'native';
  /** Clé API v3 ou jeton v4 TMDB (obligatoire : recherche + fiches) */
  tmdbKey: string;
  language: string;
  radarr: RadarrConfig;
  sonarr: SonarrConfig;
  addons: Addon[];
  showTrending: boolean;
  /** Sources Live TV : listes IPTV (M3U, Xtream) et addons Stremio de chaînes */
  liveSources: LiveSource[];
  /** Chaînes favorites (clés « source:chaîne ») */
  liveFavorites: string[];
  /** Live TV : langue affichée ('fr' = chaînes en français, 'all' = tout, ou un code pays) */
  liveLang: string;
};

export type LiveSource = {
  id: string;
  name: string;
  kind: 'm3u' | 'stremio';
  /** Lien de la liste M3U, ou adresse de l'addon Stremio */
  url: string;
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
  player: 'mpv',
  quality: 'original',
  seerr: null,
  homeLayout: [],
  tabsLayout: [],
  libraryLayout: [],
  autoNext: true,
  calendarAddon: 'https://releasio-pearl.vercel.app/%7B%22posterSource%22%3A%22btttr%22%2C%22badge%22%3A%22bar%22%2C%22availability%22%3A%22all%22%2C%22titleMode%22%3A%22title%22%7D',
  seasonTheme: 'auto',
  chatUrl: '',
  tmdbKey: '',
  language: 'fr-FR',
  radarr: { url: '', apiKey: '', searchOnAdd: true, minimumAvailability: 'released' },
  sonarr: { url: '', apiKey: '', searchOnAdd: true, seasonFolder: true },
  addons: [DEFAULT_ADDON],
  showTrending: true,
  liveSources: [],
  liveFavorites: [],
  liveLang: 'fr',
};

const KEY = 'lumio-native:settings:v2';

function mergeSettings(saved: Partial<Settings>): Settings {
  return {
    ...DEFAULTS,
    ...saved,
    radarr: { ...DEFAULTS.radarr, ...saved.radarr },
    sonarr: { ...DEFAULTS.sonarr, ...saved.sonarr },
    betterPosters: { ...DEFAULTS.betterPosters, ...saved.betterPosters },
  };
}

/** Garde uniquement les réglages locaux réellement renseignés (pour ne pas écraser ceux du serveur par des vides). */
function stripEmpty(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [k, v] of Object.entries(s) as [keyof Settings, unknown][]) {
    if (v === '' || v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'radarr' || k === 'sonarr') {
      if (!(v as { url?: string }).url) continue;
    }
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

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

  const keychainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      let saved: Partial<Settings> | null = null;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) saved = JSON.parse(raw);
      } catch {}
      // Appli réinstallée : on récupère la copie du trousseau iOS
      if (!saved) saved = await loadFromKeychain();
      if (saved) {
        const merged = mergeSettings(saved);
        current.current = merged;
        setSettings(merged);
      }
      // Identifiant d'appareil généré une fois pour toutes
      if (!current.current.deviceId) {
        const next = { ...current.current, deviceId: newDeviceId() };
        current.current = next;
        setSettings(next);
      }
      AsyncStorage.setItem(KEY, JSON.stringify(current.current)).catch(() => {});
      setReady(true);
    })();
  }, []);

  const persist = useCallback((next: Settings, cloud: boolean) => {
    const json = JSON.stringify(next);
    AsyncStorage.setItem(KEY, json).catch(() => {});
    if (keychainTimer.current) clearTimeout(keychainTimer.current);
    keychainTimer.current = setTimeout(() => saveToKeychain(json), 800);
    if (cloud && next.jellyfin) {
      if (cloudTimer.current) clearTimeout(cloudTimer.current);
      cloudTimer.current = setTimeout(() => saveToJellyfin(next), 3000);
    }
  }, []);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const prev = current.current;
      let next = { ...prev, ...patch };
      // Nouvelle connexion Jellyfin : on restaure les réglages enregistrés sur le serveur
      if (patch.jellyfin && patch.jellyfin.token !== prev.jellyfin?.token) {
        const cloud = await loadFromJellyfin(next);
        if (cloud) {
          // Appli neuve (rien de configuré) : le serveur fait foi ; sinon les réglages locaux priment
          const fresh = !prev.tmdbKey && !prev.radarr.url && !prev.sonarr.url && !prev.seerr;
          const base = fresh ? cloud : { ...cloud, ...stripEmpty(next) };
          next = { ...mergeSettings(base), jellyfin: next.jellyfin, deviceId: next.deviceId, skipJellyfin: false };
        }
      }
      current.current = next;
      setSettings(next);
      persist(next, true);
    },
    [persist]
  );

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

/** Utilisateur qui peut piloter Radarr/Sonarr directement (admin Jellyfin, ou pas de Jellyfin du tout) */
export const isManager = (s: Settings) => !s.jellyfin || s.jellyfin.isAdmin !== false;

/** Prêt à ajouter : URL, clé, profil et dossier racine choisis. */
export const arrReady = (c: ArrConfig) =>
  Boolean(c.url && c.apiKey && c.qualityProfileId && c.rootFolderPath);
