import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { type Tabs } from 'expo-router';
import { useRef, useState, type ComponentProps } from 'react';
import { Animated, LayoutAnimation, Platform, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { FocusPressable as Pressable } from '@/components/tv';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TvSidebar } from '@/components/tv-sidebar';
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
  watchlist: 'bookmark',
  secour: 'link',
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
  watchlist: 'À voir',
  secour: 'Secour',
  settings: 'Profil',
};

const glass = Platform.OS === 'ios' && isLiquidGlassAvailable();

/** Barre d'onglets flottante façon iOS 26+ (« Liquid Glass ») : icône + libellé, bulle sur l'onglet actif.
 *  Appui long : une loupe en verre apparaît sous le doigt et le suit ; on glisse jusqu'à l'onglet voulu et on relâche,
 *  comme la barre d'onglets d'iOS 26. (Personnaliser les onglets : Profil → Personnalisation.) */
export function FloatingTabBar(props: TabBarProps) {
  // TV : menu latéral façon Nuvio
  if (Platform.isTV) {
    const { state, navigation } = props;
    const current = state.routes[state.index]?.name ?? 'index';
    return (
      <TvSidebar
        current={current}
        onNavigate={(name) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route || name === current) return;
          navigation.navigate(name, route.params);
        }}
      />
    );
  }
  return <PhoneTabBar {...props} />;
}

function PhoneTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const season = useSeason();
  const activeColor = season?.accent ?? C.text;
  const unread = useUnreadChat();
  const pending = usePendingRequests();
  const update = useAppUpdate();
  const initial = (settings.jellyfin?.userName ?? 'L').slice(0, 1).toUpperCase();

  const visible = state.routes.filter((r) => {
    // iPhone : pas d'onglet Lumio Secour
    if (Platform.OS === 'ios' && r.name === 'secour') return false;
    const opts = descriptors[r.key].options as { href?: string | null };
    return opts.href !== null;
  });
  const order = orderTabs(
    visible.map((r) => r.name),
    settings.tabsLayout
  );
  // TV : expérience épurée, seulement Accueil, Bibliothèque, Recherche, Demandes (et le profil)
  const TV_TABS = ['index', 'library', 'search', 'activity', 'settings'];
  const routes = Platform.isTV
    ? TV_TABS.map((n) => state.routes.find((r) => r.name === n)!).filter(Boolean)
    : order.map((n) => visible.find((r) => r.name === n)!).filter(Boolean);
  const dense = routes.length > 6;

  // ——— Loupe « Liquid Glass » à l'appui long ———
  const pillRef = useRef<View>(null);
  const pillBox = useRef({ x: 0, width: 1 });
  const wrapRef = useRef<View>(null);
  const wrapX = useRef(0);
  const lensX = useRef(new Animated.Value(0)).current;
  const lensScale = useRef(new Animated.Value(0)).current;
  const [lensOn, setLensOn] = useState(false);
  const lens = useRef({ on: false, timer: null as ReturnType<typeof setTimeout> | null, idx: -1, startX: 0, moved: false });
  const slot = pillBox.current.width / Math.max(1, routes.length);
  const lensW = Math.min(110, slot * 1.35);
  const indexAt = (pageX: number) =>
    Math.max(0, Math.min(routes.length - 1, Math.floor(((pageX - pillBox.current.x) / pillBox.current.width) * routes.length)));
  const placeLens = (pageX: number) => {
    const x = Math.max(0, Math.min(pillBox.current.width, pageX - pillBox.current.x));
    lensX.setValue(x - lensW / 2);
    const i = indexAt(pageX);
    if (i !== lens.current.idx) {
      if (lens.current.idx !== -1) Haptics.selectionAsync().catch(() => {});
      lens.current.idx = i;
    }
  };
  const onTouchStart = (e: GestureResponderEvent) => {
    if (Platform.isTV) return;
    const pageX = e.nativeEvent.pageX;
    lens.current.startX = pageX;
    lens.current.moved = false;
    pillRef.current?.measureInWindow((x, _y, w) => {
      pillBox.current = { x, width: w || 1 };
    });
    wrapRef.current?.measureInWindow((x) => (wrapX.current = x));
    lens.current.timer = setTimeout(() => {
      lens.current.on = true;
      lens.current.idx = -1;
      setLensOn(true);
      placeLens(lens.current.startX);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      Animated.spring(lensScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
    }, 280);
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const pageX = e.nativeEvent.pageX;
    if (!lens.current.on) {
      // Le doigt glisse avant l'appui long : on démarre la loupe tout de suite (comme iOS 26)
      if (Math.abs(pageX - lens.current.startX) > 12 && lens.current.timer) {
        clearTimeout(lens.current.timer);
        lens.current.timer = null;
        lens.current.on = true;
        lens.current.idx = -1;
        setLensOn(true);
        Animated.spring(lensScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
      } else return;
    }
    lens.current.moved = true;
    placeLens(pageX);
  };
  const onTouchEnd = () => {
    if (lens.current.timer) clearTimeout(lens.current.timer);
    lens.current.timer = null;
    if (!lens.current.on) return;
    lens.current.on = false;
    const route = routes[lens.current.idx];
    Animated.timing(lensScale, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => setLensOn(false));
    if (route && state.routes[state.index]?.key !== route.key) {
      tap();
      LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
      navigation.navigate(route.name, route.params);
    }
  };


  return (
    <View ref={wrapRef} pointerEvents="box-none" style={Platform.isTV ? styles.wrapTv : [styles.wrap, { bottom: Math.max(insets.bottom - 6, 10) }]}>
      <View
        ref={pillRef}
        style={styles.pill}
        onLayout={() => pillRef.current?.measureInWindow((x, _y, w) => (pillBox.current = { x, width: w || 1 }))}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}>
        {Platform.isTV ? (
          // TV : effet verre (façon iOS 26) — voile fumé translucide, reflet en haut, liseré clair
          <View style={[StyleSheet.absoluteFill, styles.tvGlass]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.10)']}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : glass ? (
          <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(20,20,22,0.35)" style={StyleSheet.absoluteFill} />
        ) : (
          <>
            {Platform.OS === 'ios' ? <BlurView tint="systemThickMaterialDark" intensity={80} style={StyleSheet.absoluteFill} /> : null}
            <View
              style={[
                StyleSheet.absoluteFill,
                // TV : verre fumé translucide ; téléphone Android : opaque (pas de flou natif)
                { backgroundColor: Platform.isTV ? 'rgba(255,255,255,0.08)' : Platform.OS === 'ios' ? 'rgba(30,30,32,0.55)' : 'rgba(30,30,32,0.97)' },
              ]}
            />
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
              // Appui long : c'est la loupe qui choisit l'onglet (pas de clic en plus au relâcher)
              onLongPress={() => {}}
              delayLongPress={280}
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
      {/* Loupe en verre sous le doigt (iOS 26 : Liquid Glass ; ailleurs : flou) */}
      {lensOn ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lens,
            {
              width: lensW,
              left: pillBox.current.x - wrapX.current,
              transform: [{ translateX: lensX }, { scale: lensScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
              opacity: lensScale,
            },
          ]}>
          {glass ? (
            <GlassView glassEffectStyle="clear" isInteractive colorScheme="dark" style={StyleSheet.absoluteFill} />
          ) : Platform.OS === 'ios' ? (
            <BlurView tint="systemUltraThinMaterialLight" intensity={40} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.16)' }]} />
          )}
          <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.02)']} style={[StyleSheet.absoluteFill, { bottom: '55%' }]} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 14 },
  // TV : barre flottante en haut de l'écran (comme sur Apple TV), posée sur l'image de l'accueil
  wrapTv: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, alignItems: 'center', paddingTop: 14, paddingHorizontal: 40 },
  tvGlass: {
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: 'rgba(24,26,34,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  pill: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: Platform.isTV ? 540 : 560,
    height: Platform.isTV ? 52 : 66,
    borderRadius: Platform.isTV ? 26 : 33,
    padding: 5,
    // TV : l'onglet sélectionné grandit, il ne doit pas être rogné
    overflow: Platform.isTV ? 'visible' : 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  item: { flex: 1, minWidth: 0 },
  lens: {
    position: 'absolute',
    top: -8,
    height: 82,
    borderRadius: 41,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
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
