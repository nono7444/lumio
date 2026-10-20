// Pastille sur l'icône de Lumio (1, 2, 3…) et notifications locales des nouveaux messages.
// - Appli ouverte : mise à jour toutes les 60 s et à chaque passage en arrière-plan.
// - Appli fermée : tâche de fond du système (iOS / Android la lancent environ toutes les 15 min à quelques heures),
//   qui met la pastille à jour et prévient d'un nouveau message du chat.
// Le compte = messages non lus + (admin) demandes à valider + signalements nouveaux.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { serverBase } from './chat';
import { useSettings, type Settings } from './settings';

const TASK = 'lumio-badge-refresh';
const SETTINGS_KEY = 'lumio-native:settings:v2';
const READ_KEY = 'lumio-chat:last-read-at';
const NOTIFIED_KEY = 'lumio-badge:last-notified';

type Badge = { unread: number; pending: number; problems: number; total: number; last: { id: string; from: string; text: string; at: string } | null };

// Modules natifs chargés à la demande (absents sur le Mac / web)
function mods() {
  if (Platform.OS === 'web') return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return {
      N: require('expo-notifications') as typeof import('expo-notifications'),
      BT: require('expo-background-task') as typeof import('expo-background-task'),
      TM: require('expo-task-manager') as typeof import('expo-task-manager'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }
}

async function fetchBadge(s: Pick<Settings, 'chatUrl' | 'jellyfin'>): Promise<Badge | null> {
  if (!s.chatUrl || !s.jellyfin) return null;
  const after = (await AsyncStorage.getItem(READ_KEY).catch(() => null)) ?? '';
  const r = await fetch(`${serverBase(s.chatUrl)}/api/badge?after=${encodeURIComponent(after)}`, {
    headers: { Accept: 'application/json', 'X-Jellyfin-Token': s.jellyfin.token },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}

/** Met la pastille à jour ; en arrière-plan, notifie le dernier message pas encore signalé. */
async function refresh(s: Pick<Settings, 'chatUrl' | 'jellyfin'>, notifyNew: boolean) {
  const m = mods();
  if (!m) return;
  const b = await fetchBadge(s);
  if (!b) return;
  await m.N.setBadgeCountAsync(b.total).catch(() => {});
  if (notifyNew && b.last) {
    const done = await AsyncStorage.getItem(NOTIFIED_KEY).catch(() => null);
    if (done !== b.last.id) {
      await AsyncStorage.setItem(NOTIFIED_KEY, b.last.id).catch(() => {});
      await m.N.scheduleNotificationAsync({
        content: { title: `💬 ${b.last.from}`, body: b.last.text || 'Nouveau message', data: { url: 'lumio://chat' }, badge: b.total },
        trigger: null,
      }).catch(() => {});
    }
  }
}

// Tâche de fond : déclarée au chargement du module (obligatoire pour qu'elle existe au réveil de l'appli)
const m0 = mods();
if (m0 && !Platform.isTV) {
  try {
    m0.TM.defineTask(TASK, async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        if (raw) await refresh(JSON.parse(raw), true);
      } catch {}
      return m0.BT.BackgroundTaskResult.Success;
    });
  } catch {}
}

export function useAppBadge() {
  const { settings } = useSettings();
  useEffect(() => {
    const m = mods();
    if (!m || Platform.isTV || !settings.chatUrl || !settings.jellyfin) return;
    // Autorisation (pastille + notifications), demandée une seule fois par le système
    m.N.requestPermissionsAsync({ ios: { allowBadge: true, allowAlert: true, allowSound: true } }).catch(() => {});
    m.N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
    });
    m.BT.registerTaskAsync(TASK, { minimumInterval: 15 }).catch(() => {});
    // Tap sur une notification : ouvre la bonne page
    const sub = m.N.addNotificationResponseReceivedListener((r) => {
      const url = r.notification.request.content.data?.url;
      if (typeof url === 'string') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('react-native').Linking.openURL(url).catch(() => {});
      }
    });
    const tick = () => refresh(settings, false);
    tick();
    const t = setInterval(tick, 60_000);
    const st = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'active') tick();
    });
    return () => {
      clearInterval(t);
      st.remove();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.chatUrl, settings.jellyfin?.token]);
}
