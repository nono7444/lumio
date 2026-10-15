import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { orderTabs } from '@/lib/home-layout';
import { useSettings } from '@/lib/settings';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  search: 'search',
  library: 'albums',
  activity: 'cloud-download',
};

/** Barre d'onglets flottante en pilule, à la façon de Nuvio. */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
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
          const isProfile = route.name === 'settings';
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
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={[styles.item, focused && styles.itemOn]}>
              {isProfile ? (
                <View style={[styles.avatar, focused && { borderColor: C.text }]}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              ) : (
                <Ionicons
                  name={(focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`) as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={focused ? C.text : C.textDim}
                />
              )}
              <Text style={[styles.label, { color: focused ? C.text : C.textDim }]} numberOfLines={1}>
                {label}
              </Text>
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
    height: 66,
    borderRadius: 33,
    padding: 5,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 28 },
  itemOn: { backgroundColor: 'rgba(255,255,255,0.10)' },
  label: { fontSize: 10.5, fontWeight: '600' },
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
