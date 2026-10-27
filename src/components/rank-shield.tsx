// Écussons de rang (récompenses) : 10 rangs, dessinés en SVG.
// 0 à 4 : écussons en matière (bois, bronze, cuivre, argent, acier) ;
// 5 à 9 : écussons à cadre doré et fond de couleur (bleu, or, violet, pourpre, orange).
import { router } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';

import { FocusPressable as Pressable } from '@/components/tv';
import { C } from '@/constants/theme';
import { serverCall } from '@/lib/chat';
import { useSettings } from '@/lib/settings';

type Tier = { light: string; base: string; dark: string; inner?: [string, string]; star: [string, string]; starEdge: string };

const GOLD = { light: '#FFE58A', base: '#F4B52C', dark: '#A8700F' };
const GOLD_STAR: [string, string] = ['#FFE27A', '#E89B12'];

export const RANK_TIERS: Tier[] = [
  // Bois
  { light: '#8E5A34', base: '#6E4224', dark: '#3E2412', star: ['#7A4A28', '#4E2C16'], starEdge: '#2E190B' },
  // Bronze
  { light: '#C77A43', base: '#A65A26', dark: '#5E2F12', star: ['#B4642E', '#7A3C17'], starEdge: '#4A230B' },
  // Cuivre rosé
  { light: '#E3A79B', base: '#C27F73', dark: '#7E4A43', star: ['#D08F84', '#9A5F57'], starEdge: '#6A3C36' },
  // Argent
  { light: '#C2CAD6', base: '#8E98A8', dark: '#4D5563', star: ['#A3ADBC', '#6B7484'], starEdge: '#3E4552' },
  // Acier clair
  { light: '#E6EBF2', base: '#B3BBC8', dark: '#646C7A', star: ['#D2D8E1', '#8D96A5'], starEdge: '#555D6A' },
  // Doré, fond bleu
  { ...GOLD, inner: ['#5BA8FF', '#1F5FC4'], star: GOLD_STAR, starEdge: '#8A5A06' },
  // Doré, fond or
  { ...GOLD, inner: ['#F5A623', '#C26E08'], star: ['#FFF3BF', '#F7C23A'], starEdge: '#7A4E05' },
  // Doré, fond violet
  { ...GOLD, inner: ['#8C63FF', '#4B25B8'], star: GOLD_STAR, starEdge: '#8A5A06' },
  // Doré, fond pourpre
  { ...GOLD, inner: ['#A24DE0', '#5A1E99'], star: GOLD_STAR, starEdge: '#8A5A06' },
  // Doré, fond orange
  { ...GOLD, inner: ['#FFA43A', '#E0610F'], star: GOLD_STAR, starEdge: '#8A5A06' },
];

// Écusson : haut plat aux coins coupés, pointe en bas (repère 100 × 110)
const OUTER = 'M18 6 H82 L94 18 V60 C94 78 74 94 50 106 C26 94 6 78 6 60 V18 Z';
const INNER = 'M23 15 H77 L85 23 V59 C85 73 69 86 50 96 C31 86 15 73 15 59 V23 Z';

/** Étoile à 5 branches centrée en (cx, cy). */
function star(cx: number, cy: number, r: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export const RankShield = memo(function RankShield({ tier, size = 28 }: { tier?: number | null; size?: number }) {
  const t = RANK_TIERS[Math.max(0, Math.min(RANK_TIERS.length - 1, Number(tier) || 0))];
  const id = `rk${Math.max(0, Math.min(9, Number(tier) || 0))}`;
  const gold = Boolean(t.inner);
  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 100 110">
      <Defs>
        <LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={t.light} />
          <Stop offset="1" stopColor={t.base} />
        </LinearGradient>
        <LinearGradient id={`${id}i`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={gold ? t.inner![0] : t.base} />
          <Stop offset="1" stopColor={gold ? t.inner![1] : t.dark} />
        </LinearGradient>
        <LinearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={t.star[0]} />
          <Stop offset="1" stopColor={t.star[1]} />
        </LinearGradient>
      </Defs>
      {/* Ombre / bord sombre */}
      <Path d={OUTER} fill={t.dark} transform="translate(0 3)" />
      {/* Cadre */}
      <Path d={OUTER} fill={`url(#${id}f)`} stroke={t.dark} strokeWidth={2} />
      {/* Fond */}
      <Path d={INNER} fill={`url(#${id}i)`} stroke={gold ? GOLD.dark : t.dark} strokeWidth={1.5} strokeOpacity={0.6} />
      {/* Reflet en haut */}
      <Path d="M24 17 H76 L83 24 V34 C64 30 36 30 17 34 V24 Z" fill="#FFFFFF" opacity={gold ? 0.18 : 0.12} />
      {/* Étoile en relief */}
      <G>
        <Polygon points={star(50, 57, 25, 10.5)} fill={t.starEdge} transform="translate(0 2.5)" />
        <Polygon points={star(50, 57, 25, 10.5)} fill={`url(#${id}s)`} stroke={t.starEdge} strokeWidth={1.5} strokeLinejoin="round" />
        <Polygon points={star(50, 57, 13, 5.5)} fill="#FFFFFF" opacity={0.18} />
      </G>
    </Svg>
  );
});

// ——— Pastille du rang (haut de l'accueil) : écusson + nom du rang, ouvre la page des stats ———

type MyRank = { name: string; tier: number; points: number; rank: number };
let rankCache: { key: string; at: number; value: MyRank | null } | null = null;

/** Mon rang (récompenses du serveur Lumio), gardé 10 minutes. */
export function useMyRank(nonce = 0): MyRank | null {
  const { settings } = useSettings();
  const key = `${settings.chatUrl}|${settings.jellyfin?.userId ?? ''}`;
  const [me, setMe] = useState<MyRank | null>(rankCache?.key === key ? rankCache.value : null);
  useEffect(() => {
    if (!settings.chatUrl || !settings.jellyfin) return;
    if (rankCache?.key === key && Date.now() - rankCache.at < 10 * 60_000 && !nonce) return;
    serverCall<{ users: { id: string; points: number; rank: number; grade: { name: string; tier?: number; min: number } }[]; me: string }>(settings, '/api/rewards')
      .then((b) => {
        const u = b.users.find((x) => x.id === b.me);
        const value = u ? { name: u.grade.name, tier: u.grade.tier ?? 0, points: u.points, rank: u.rank } : null;
        rankCache = { key, at: Date.now(), value };
        setMe(value);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return me;
}

/** Haut de l'accueil : nom du profil, puis l'écusson et le rang ; un appui ouvre les stats et les bonus. */
export function ProfileRank({ nonce = 0 }: { nonce?: number }) {
  const { settings } = useSettings();
  const me = useMyRank(nonce);
  const name = settings.jellyfin?.userName ?? 'Lumio';
  return (
    <Pressable onPress={() => router.push('/rewards')} hitSlop={8} style={pill.profile} accessibilityLabel={`${name}${me ? `, rang ${me.name}` : ''} : voir mes stats`}>
      <Text style={pill.user} numberOfLines={1}>
        {name}
      </Text>
      {me ? (
        <View style={[pill.wrap, { flexShrink: 0 }]}>
          <RankShield tier={me.tier} size={18} />
          <Text style={pill.name} numberOfLines={1}>
            {me.name}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function RankPill({ nonce = 0 }: { nonce?: number }) {
  const me = useMyRank(nonce);
  if (!me) return null;
  return (
    <Pressable onPress={() => router.push('/rewards')} hitSlop={8} style={pill.wrap} accessibilityLabel={`Rang ${me.name}, voir mes stats`}>
      <RankShield tier={me.tier} size={20} />
      <View>
        <Text style={pill.name} numberOfLines={1}>
          {me.name}
        </Text>
      </View>
    </Pressable>
  );
}

const pill = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  user: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.6, flexShrink: 1 },
  // la pastille du rang garde sa taille, c'est le nom qui rétrécit
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingLeft: 6, paddingRight: 11, paddingVertical: 4 },
  name: { color: C.text, fontSize: 13, fontWeight: '800' },
});
