import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router, type Tabs } from 'expo-router';
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
  live: 'tv',
  chat: 'chatbubbles',
  activity: 'file-tray-full',
};

// Libellés courts, affichés sous chaque icône (comme la barre d'onglets d'iOS)
const SHORT: Record<string, string> = {
  index: 'Accueil',
  search: 'Recherche',
  library: 'Biblio',
  calendar: 'Agenda',
  live: 'Live TV',
  chat: 'Chat',
  activity: 'Demandes',
  settings: 'Profil',
};

const glass = Platform.OS === 'ios' && isLiquidGlassAvailable();

/** Barre d'onglets flottante façon iOS 26+ (« Liquid Glass ») : icône + libellé, bulle sur l'onglet actif.
 *  Appui long : personnaliser les raccourcis de la barre. */
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
  const dense = routes.length > 6;

  const customize = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/customize-tabs');
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom - 6, 10) }]}>
      <View style={styles.pill}>
        {glass ? (
          <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(20,20,22,0.35)" style={StyleSheet.absoluteFill} />
        ) : (
          <>
            {Platform.OS === 'ios' ? <BlurView tint="systemThickMaterialDark" intensity={80} style={StyleSheet.absoluteFill} /> : null}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? 'rgba(30,30,32,0.55)' : 'rgba(30,30,32,0.97)' }]} />
          </>
        )}
        {routes.map((route) => {
          const focused = state.routes[state.index]?.key === route.key;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const short = SHORT[route.name] ?? label;
          const isProfile = route.name === 'settings';
          const color = focused ? activeColor : C.textDim;
          const dot = (route.name === 'chat' && unread > 0) || (route.name === 'settings' && update);
          const count = route.name === 'activity' ? pending : 0;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onLongPress={customize}
              delayLongPress={450}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  tap();
                  LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={styles.item}>
              <View style={[styles.bubble, focused && (season ? { backgroundColor: season.tint } : styles.bubbleOn)]}>
                {isProfile ? (
                  <View style={[styles.avatar, focused && { borderColor: activeColor }]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                ) : (
                  <Ionicons
                    name={(focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`) as keyof typeof Ionicons.glyphMap}
                    size={dense ? 21 : 23}
                    color={color}
                  />
                )}
                <Text style={[styles.label, dense && { fontSize: 9 }, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {short}
                </Text>
                {count > 0 ? (
                  <View style={styles.count}>
                    <Text style={styles.countText}>{count > 9 ? '9+' : count}</Text>
                  </View>
                ) : dot ? (
                  <View style={styles.unread} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 14 },
  pill: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    maxWidth: 560,
    height: 66,
    borderRadius: 33,
    padding: 5,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  item: { flex: 1, minWidth: 0 },
  bubble: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 28, paddingHorizontal: 2 },
  bubbleOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: -0.1 },
  unread: { position: 'absolute', top: 7, right: '24%', width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF453A' },
  count: {
    position: 'absolute',
    top: 3,
    right: '16%',
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#FF453A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  avatar: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#3D6BFF',
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
