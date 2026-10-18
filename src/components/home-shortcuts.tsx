// Accueil : raccourcis en haut à droite (signalements admin, calendrier, chat, personnalisation).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { useUnreadChat } from '@/lib/chat';
import { useTabInBar } from '@/lib/home-layout';
import { useActiveDownloads } from '@/lib/files';
import { useProblemCount } from '@/lib/ideas';
import { useSettings } from '@/lib/settings';

const MONTHS = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

function Btn({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={6}
      accessibilityLabel={label}
      style={styles.btn}>
      {children}
    </Pressable>
  );
}

/** Pastille rouge avec un nombre (ou un simple point). */
function Count({ n, dot }: { n?: number; dot?: boolean }) {
  if (dot) return <View style={styles.dot} />;
  if (!n) return null;
  return (
    <View style={styles.count}>
      <Text style={styles.countText}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

export function HomeShortcuts({ onCustomize }: { onCustomize: () => void }) {
  const { settings } = useSettings();
  const problems = useProblemCount();
  const downloads = useActiveDownloads();
  const admin = settings.jellyfin?.isAdmin === true && Boolean(settings.chatUrl);
  const unread = useUnreadChat();
  const calendarInBar = useTabInBar('calendar');
  const chatInBar = useTabInBar('chat');
  const now = new Date();

  // TV : accueil épuré, pas de raccourcis (calendrier, chat, signalements…)
  if (Platform.isTV) return null;

  return (
    <View style={styles.row}>
      {admin ? (
        <Btn label={problems ? `${problems} problème${problems > 1 ? 's' : ''} signalé${problems > 1 ? 's' : ''}` : 'Signalements'} onPress={() => router.push({ pathname: '/ideas', params: { filter: 'problems' } })}>
          <Ionicons name={problems > 0 ? 'warning' : 'warning-outline'} size={19} color={problems > 0 ? C.warning : C.text} />
          <Count n={problems} />
        </Btn>
      ) : null}
      {admin ? (
        <Btn label="Téléchargements AllDebrid et disques" onPress={() => router.push('/downloads')}>
          <Ionicons name="cloud-download-outline" size={19} color={C.text} />
          <Count n={downloads} />
        </Btn>
      ) : null}
      {!calendarInBar ? (
        <Btn label="Calendrier des sorties" onPress={() => router.navigate('/calendar')}>
          {/* Vignette façon icône Calendrier : mois + jour du jour */}
          <View style={styles.cal}>
            <Text style={styles.calMonth}>{MONTHS[now.getMonth()]}</Text>
            <Text style={styles.calDay}>{now.getDate()}</Text>
          </View>
        </Btn>
      ) : null}
      {!chatInBar && settings.jellyfin && settings.chatUrl ? (
        <Btn label="Chat de la famille" onPress={() => router.navigate('/chat')}>
          <Ionicons name="chatbubbles-outline" size={19} color={C.text} />
          <Count dot={unread > 0} />
        </Btn>
      ) : null}
      <Btn label="Personnaliser l'accueil" onPress={onCustomize}>
        <Ionicons name="options-outline" size={20} color={C.text} />
      </Btn>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF453A', borderWidth: 1.5, borderColor: '#000' },
  count: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#FF453A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#000',
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cal: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center' },
  calMonth: { width: '100%', textAlign: 'center', backgroundColor: '#FF453A', color: '#fff', fontSize: 6, fontWeight: '900', lineHeight: 8 },
  calDay: { color: '#000', fontSize: 12, fontWeight: '800', lineHeight: 14 },
});
