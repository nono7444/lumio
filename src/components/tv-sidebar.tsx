// TV : menu latéral façon Nuvio. Replié : une colonne d'icônes à gauche. Dès qu'on y entre à la télécommande,
// il se déploie avec les libellés ; on en sort vers la droite et il se replie.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/tv';
import { C } from '@/constants/theme';
import { usePendingRequests } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

export const SIDEBAR_W = 84;
const OPEN_W = 236;

const ITEMS: { name: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', label: 'Accueil', icon: 'home' },
  { name: 'search', label: 'Recherche', icon: 'search' },
  { name: 'library', label: 'Bibliothèque', icon: 'albums' },
  { name: 'activity', label: 'Demandes', icon: 'file-tray-full' },
  { name: 'settings', label: 'Profil', icon: 'person-circle' },
];

type Props = {
  current: string;
  onNavigate: (name: string) => void;
};

export function TvSidebar({ current, onNavigate }: Props) {
  const { settings } = useSettings();
  const pending = usePendingRequests();
  const [open, setOpen] = useState(false);
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const name = (settings.jellyfin?.userName ?? 'Lumio').trim();

  const show = (v: boolean) => {
    setOpen(v);
    Animated.timing(anim, { toValue: v ? 1 : 0, duration: v ? 300 : 160, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [SIDEBAR_W, OPEN_W] });
  const labelOpacity = anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] });

  return (
    <View style={styles.slot}>
      <Animated.View style={[styles.panel, { width }]}>
        <LinearGradient
          colors={['rgba(11,13,18,0.98)', 'rgba(11,13,18,0.94)', open ? 'rgba(11,13,18,0.86)' : 'rgba(11,13,18,0.94)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Marque en haut */}
        <View style={styles.brand}>
          <Text style={styles.brandL}>L</Text>
          <Animated.Text style={[styles.brandRest, { opacity: labelOpacity }]} numberOfLines={1}>
            UMIO
          </Animated.Text>
        </View>

        <View style={styles.items}>
          {ITEMS.map((it) => {
            const selected = current === it.name;
            const focused = focusedName === it.name;
            const count = it.name === 'activity' ? pending : 0;
            return (
              <Pressable
                key={it.name}
                focusRing={false}
                hasTVPreferredFocus={selected}
                onFocus={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  setFocusedName(it.name);
                  if (!open) show(true);
                }}
                onBlur={() => {
                  setFocusedName((f) => (f === it.name ? null : f));
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  blurTimer.current = setTimeout(() => show(false), 60);
                }}
                onPress={() => onNavigate(it.name)}
                style={[styles.item, focused ? styles.itemFocused : open && selected ? styles.itemSelected : null]}>
                <View style={styles.iconBox}>
                  {it.name === 'settings' ? (
                    <View style={[styles.avatar, selected && { borderColor: C.accent }]}>
                      <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  ) : (
                    <Ionicons
                      name={(selected || focused ? it.icon : `${it.icon}-outline`) as keyof typeof Ionicons.glyphMap}
                      size={22}
                      color={focused ? '#fff' : selected ? C.accent : 'rgba(255,255,255,0.55)'}
                    />
                  )}
                  {count > 0 ? (
                    <View style={styles.count}>
                      <Text style={styles.countText}>{count > 9 ? '9+' : count}</Text>
                    </View>
                  ) : null}
                </View>
                <Animated.Text
                  numberOfLines={1}
                  style={[styles.label, { opacity: labelOpacity, color: focused ? '#fff' : selected ? C.text : 'rgba(255,255,255,0.65)' }]}>
                  {it.name === 'settings' ? name : it.label}
                </Animated.Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Place réservée dans la mise en page : le panneau déployé passe par-dessus le contenu
  slot: { width: SIDEBAR_W, height: '100%', zIndex: 100 },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 20,
  },
  brand: { flexDirection: 'row', alignItems: 'baseline', height: 90, paddingTop: 34, paddingLeft: 16 },
  brandL: { color: C.accent, fontSize: 26, fontWeight: '900' },
  brandRest: { color: C.accent, fontSize: 26, fontWeight: '900', letterSpacing: 1 },
  items: { flex: 1, justifyContent: 'center', gap: 10, paddingBottom: 90 },
  item: { flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: 16, paddingHorizontal: 7, gap: 12 },
  itemFocused: { backgroundColor: 'rgba(61,139,255,0.28)' },
  itemSelected: { backgroundColor: 'rgba(255,255,255,0.07)' },
  iconBox: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17, fontWeight: '700', flex: 1 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  count: { position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
