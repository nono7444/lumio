import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { useUnreadChat } from '@/lib/chat';
import { usePendingRequests } from '@/lib/requests';
import { orderTabs } from '@/lib/home-layout';
import { useSeason } from '@/lib/seasons';
import { useAppUpdate } from '@/lib/app-update';
import { useSettings } from '@/lib/settings';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  search: 'search',
  library: 'albums',
  calendar: 'calendar',
  chat: 'chatbubbles',
  activity: 'file-tray-full',
};

// Libellés courts : seul l'onglet actif affiche le sien, à côté de l'icône
const SHORT: Record<string, string> = {
  index: 'Accueil',
  search: 'Recherche',
  library: 'Biblio',
  calendar: 'Agenda',
  chat: 'Chat',
  activity: 'Demandes',
  settings: 'Profil',
};

/** Barre d'onglets flottante en pilule : icônes seules, l'onglet actif s'élargit avec son nom. */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const season = useSeason();
  const activeColor = season?.accent ?? C.text;
  const unread = useUnreadChat();
  const pending = usePendingRequests();
  const update = useAppUpdate();
  const initial = (settings.jellyfin?.userName ?? 'L').slice(0, 1).toUpperCase();

  const visible = state.routes.filter((r) => {
    const opts = descriptors[r.key].options as { href?: string | null };
    return opts.href !== null;
  });
  const order = orderTabs(
    visible.map((r) => r.name),
    settings.tabsLayout
  );
  const routes = order.map((n) => visible.find((r) => r.name === n)!).filter(Boolean);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.pill}>
        {Platform.OS === 'ios' ? (
          <BlurView tint="systemThickMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? 'rgba(30,30,32,0.55)' : 'rgba(30,30,32,0.97)' }]} />
        {routes.map((route) => {
          const focused = state.routes[state.index]?.key === route.key;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const short = SHORT[route.name] ?? label;
          const isProfile = route.name === 'settings';
          const color = focused ? activeColor : C.textDim;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  tap();
                  LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'scaleX'));
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={[
                styles.item,
                focused && styles.itemFocused,
                focused && (season ? { backgroundColor: season.tint } : styles.itemOn),
              ]}>
              {isProfile ? (
                <View style={[styles.avatar, focused && { borderColor: activeColor }]}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              ) : (
                <Ionicons
                  name={(focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`) as keyof typeof Ionicons.glyphMap}
                  size={23}
                  color={color}
                />
              )}
              {focused && (
                <Text style={[styles.label, { color }]} numberOfLines={1}>
                  {short}
                </Text>
              )}
              {((route.name === 'chat' && unread > 0) || (route.name === 'activity' && pending > 0) || (route.name === 'settings' && update)) && (
                <View style={[styles.unread, focused && { right: 8 }]} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 18 },
  pill: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    maxWidth: 520,
    height: 62,
    borderRadius: 31,
    padding: 6,
    gap: 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 25, minWidth: 38 },
  itemFocused: { flex: 2.6, paddingHorizontal: 10 },
  itemOn: { backgroundColor: 'rgba(255,255,255,0.13)' },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  unread: { position: 'absolute', top: 10, right: '22%', width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF453A' },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3D6BFF',
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
