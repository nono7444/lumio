// « Qui regarde ? » : choix du profil de la famille (compte principal + profils), création et gestion.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { profilesApi, type Profile } from '@/lib/profiles';
import { useSettings } from '@/lib/settings';

export default function ProfilesScreen() {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Profile[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState('');
  const owner = settings.household?.owner ?? (settings.jellyfin?.isAdmin ? settings.jellyfin : null);
  const current = settings.jellyfin?.profile?.id ?? 'owner';

  const load = useCallback(() => {
    profilesApi
      .list(settings)
      .then((r) => {
        setList(r.profiles);
        if (owner) update({ household: { owner, askOnLaunch: settings.household?.askOnLaunch ?? true, count: r.profiles.length } });
      })
      .catch((e) => {
        setList([]);
        Alert.alert('Profils', e?.message ?? String(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.household?.owner?.token, settings.jellyfin?.token]);
  useFocusEffect(load);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const chooseOwner = async () => {
    tap();
    if (!owner) return;
    if (current !== 'owner') await update({ jellyfin: owner });
    close();
  };

  const choose = async (p: Profile, code?: string) => {
    tap();
    if (p.hasPin && code == null) {
      setPin('');
      setPinFor(p);
      return;
    }
    setBusy(p.id);
    try {
      const session = await profilesApi.switch(settings, p, code);
      setPinFor(null);
      await update({ jellyfin: session });
      close();
    } catch (e: any) {
      if (/code/i.test(e?.message ?? '')) {
        setPin('');
        Alert.alert('Code incorrect', 'Réessaie.');
      } else Alert.alert(p.name, e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const tiles = [
    ...(owner ? [{ key: 'owner', name: owner.userName, avatar: owner.userName.slice(0, 1).toUpperCase(), color: '#3A3A3C', kid: false, lock: false, onPress: chooseOwner, profile: null as Profile | null }] : []),
    ...(list ?? []).map((p) => ({ key: p.id, name: p.name, avatar: p.avatar, color: p.color, kid: p.kind === 'kid', lock: p.hasPin, onPress: () => (editing ? router.push({ pathname: '/profile-edit', params: { id: p.id } }) : choose(p)), profile: p })),
  ];

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.top}>
        <View style={{ width: 70 }} />
        <Text style={styles.h1}>{editing ? 'Gérer les profils' : 'Qui regarde ?'}</Text>
        <Pressable onPress={() => (tap(), setEditing((e) => !e))} hitSlop={10} style={styles.edit}>
          <Text style={styles.editTxt}>{editing ? 'OK' : 'Modifier'}</Text>
        </Pressable>
      </View>
      {list === null ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {tiles.map((t) => (
            <Pressable key={t.key} onPress={t.onPress} style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.96 }] }]}>
              <View style={[styles.avatar, { backgroundColor: t.color }, current === t.key && styles.current]}>
                {busy === t.key ? <ActivityIndicator color="#fff" /> : <Text style={[styles.emoji, t.key === 'owner' && styles.initial]}>{t.avatar}</Text>}
                {editing && t.profile ? (
                  <View style={styles.badgeEdit}>
                    <Ionicons name="pencil" size={16} color="#fff" />
                  </View>
                ) : null}
                {t.lock && !editing ? (
                  <View style={styles.badgeLock}>
                    <Ionicons name="lock-closed" size={12} color="#fff" />
                  </View>
                ) : null}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {t.name}
              </Text>
              {t.kid ? <Text style={styles.kid}>Enfant</Text> : null}
            </Pressable>
          ))}
          {owner && (list?.length ?? 0) < 8 ? (
            <Pressable onPress={() => (tap(), router.push('/profile-edit'))} style={styles.tile}>
              <View style={[styles.avatar, styles.add]}>
                <Ionicons name="add" size={44} color={C.textDim} />
              </View>
              <Text style={[styles.name, { color: C.textDim }]}>Ajouter</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
      {settings.household ? (
        <Pressable
          onPress={() => update({ household: { ...settings.household!, askOnLaunch: !settings.household!.askOnLaunch } })}
          style={styles.ask}
          hitSlop={8}>
          <Ionicons name={settings.household.askOnLaunch ? 'checkbox' : 'square-outline'} size={20} color={C.textDim} />
          <Text style={styles.askTxt}>Demander à chaque ouverture</Text>
        </Pressable>
      ) : null}

      <Modal visible={!!pinFor} transparent animationType="fade" onRequestClose={() => setPinFor(null)}>
        <Pressable style={styles.pinBack} onPress={() => setPinFor(null)}>
          <Pressable style={styles.pinBox} onPress={() => {}}>
            <Text style={styles.pinTitle}>Code de {pinFor?.name}</Text>
            <View style={styles.dots}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[styles.dot, pin.length > i && styles.dotOn]} />
              ))}
            </View>
            <TextInput
              autoFocus
              value={pin}
              onChangeText={(v) => {
                const d = v.replace(/\D/g, '').slice(0, 4);
                setPin(d);
                if (d.length === 4 && pinFor) choose(pinFor, d);
              }}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.hiddenInput}
              maxLength={4}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30 },
  h1: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  edit: { width: 70, alignItems: 'flex-end' },
  editTxt: { color: C.textDim, fontSize: 15, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 22, paddingBottom: 40 },
  tile: { width: 120, alignItems: 'center', gap: 8 },
  avatar: { width: 104, height: 104, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  current: { borderWidth: 3, borderColor: '#fff' },
  emoji: { fontSize: 52 },
  initial: { fontSize: 44, fontWeight: '800', color: '#fff' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600', maxWidth: 120 },
  kid: { color: C.warning, fontSize: 11, fontWeight: '800', marginTop: -4 },
  add: { borderWidth: 2, borderColor: '#3A3A3C', borderStyle: 'dashed', backgroundColor: 'transparent' },
  badgeEdit: { position: 'absolute', inset: 0, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  badgeLock: { position: 'absolute', right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center' },
  askTxt: { color: C.textDim, fontSize: 14 },
  pinBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  pinBox: { backgroundColor: '#1C1C1E', borderRadius: 28, paddingVertical: 28, paddingHorizontal: 34, alignItems: 'center', gap: 22 },
  pinTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#8E8E93' },
  dotOn: { backgroundColor: '#fff', borderColor: '#fff' },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
