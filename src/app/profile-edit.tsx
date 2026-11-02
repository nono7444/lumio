// Création / modification d'un profil de la famille : prénom, avatar, couleur, enfant (bibliothèques, âge), code.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { AVATARS, COLORS, profilesApi, type Profile } from '@/lib/profiles';
import { useSettings } from '@/lib/settings';

const AGES = [
  { v: null, l: 'Aucune' },
  { v: 6, l: '6 ans' },
  { v: 10, l: '10 ans' },
  { v: 12, l: '12 ans' },
  { v: 16, l: '16 ans' },
];

export default function ProfileEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const [orig, setOrig] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [kind, setKind] = useState<'adult' | 'kid'>('adult');
  const [maxAge, setMaxAge] = useState<number | null>(10);
  const [libs, setLibs] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pin, setPin] = useState('');
  const [link, setLink] = useState(false);
  const [linkUser, setLinkUser] = useState('');
  const [linkPass, setLinkPass] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    profilesApi
      .libraries(settings)
      .then((r) => {
        setLibs(r.libraries);
        // Profil enfant : la bibliothèque des enfants est choisie d'office
        if (!id) setChosen(r.libraries.filter((l) => /kid|enfant|jeunesse|famil|anim/i.test(l.name)).map((l) => l.id));
      })
      .catch(() => {});
    if (id)
      profilesApi.list(settings).then((r) => {
        const p = r.profiles.find((x) => x.id === id);
        if (!p) return;
        setOrig(p);
        setName(p.name);
        setAvatar(p.avatar);
        setColor(p.color);
        setKind(p.kind);
        setMaxAge(p.maxAge);
        setChosen(p.libraries ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Profil', 'Choisis un prénom.');
    if (pin && !/^\d{4}$/.test(pin)) return Alert.alert('Profil', 'Le code doit avoir 4 chiffres.');
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        avatar,
        color,
        kind,
        maxAge: kind === 'kid' ? maxAge : null,
        libraries: kind === 'kid' ? chosen : [],
        ...(pin ? { pin } : {}),
        ...(!orig && link ? { linkUser: linkUser.trim(), linkPassword: linkPass } : {}),
      };
      if (orig) await profilesApi.update(settings, orig.id, body);
      else await profilesApi.create(settings, body);
      // Profil en cours modifié : on met à jour son nom / avatar affichés
      if (orig && settings.jellyfin?.profile?.id === orig.id)
        await update({ jellyfin: { ...settings.jellyfin, profile: { id: orig.id, name: name.trim(), avatar, color, kind } } });
      router.back();
    } catch (e: any) {
      Alert.alert('Profil', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    orig &&
    Alert.alert(`Supprimer « ${orig.name} » ?`, orig.linked ? 'Le compte Jellyfin relié n’est pas touché.' : 'Garder son compte Jellyfin permet de retrouver son historique plus tard.', [
      { text: 'Annuler', style: 'cancel' },
      ...(!orig.linked
        ? [
            {
              text: 'Supprimer avec son historique',
              style: 'destructive' as const,
              onPress: () => doRemove(true),
            },
          ]
        : []),
      { text: orig.linked ? 'Supprimer le profil' : 'Supprimer, garder le compte', style: 'destructive' as const, onPress: () => doRemove(false) },
    ]);
  const doRemove = async (account: boolean) => {
    try {
      await profilesApi.remove(settings, orig!.id, account);
      if (settings.jellyfin?.profile?.id === orig!.id && settings.household?.owner) await update({ jellyfin: settings.household.owner });
      router.back();
    } catch (e: any) {
      Alert.alert('Profil', e?.message ?? String(e));
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40, gap: 18 }} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.h1}>{orig ? 'Modifier le profil' : 'Nouveau profil'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={{ alignItems: 'center', gap: 12 }}>
        <View style={[styles.big, { backgroundColor: color }]}>
          <Text style={{ fontSize: 58 }}>{avatar}</Text>
        </View>
        <TextInput value={name} onChangeText={setName} placeholder="Prénom" placeholderTextColor={C.textFaint} style={styles.name} maxLength={24} />
      </View>

      <View>
        <Text style={styles.label}>Avatar</Text>
        <View style={styles.wrapRow}>
          {AVATARS.map((a) => (
            <Pressable key={a} onPress={() => (tap(), setAvatar(a))} style={[styles.emojiBtn, avatar === a && { borderColor: '#fff' }]}>
              <Text style={{ fontSize: 26 }}>{a}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View>
        <Text style={styles.label}>Couleur</Text>
        <View style={styles.wrapRow}>
          {COLORS.map((c) => (
            <Pressable key={c} onPress={() => (tap(), setColor(c))} style={[styles.color, { backgroundColor: c }, color === c && { borderColor: '#fff' }]} />
          ))}
        </View>
      </View>

      <View>
        <Text style={styles.label}>Type</Text>
        <View style={styles.seg}>
          {(['adult', 'kid'] as const).map((k) => (
            <Pressable key={k} onPress={() => (tap(), setKind(k))} style={[styles.segBtn, kind === k && styles.segOn]}>
              <Ionicons name={k === 'kid' ? 'happy-outline' : 'person-outline'} size={16} color={kind === k ? '#000' : C.text} />
              <Text style={[styles.segTxt, kind === k && { color: '#000' }]}>{k === 'kid' ? 'Enfant' : 'Adulte'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {kind === 'kid' ? (
        <>
          <View>
            <Text style={styles.label}>Bibliothèques autorisées</Text>
            <View style={styles.wrapRow}>
              {libs.map((l) => {
                const on = chosen.includes(l.id);
                return (
                  <Pressable key={l.id} onPress={() => (tap(), setChosen(on ? chosen.filter((x) => x !== l.id) : [...chosen, l.id]))} style={[styles.pill, on && styles.segOn]}>
                    <Text style={[styles.segTxt, on && { color: '#000' }]}>{l.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.help}>Rien de coché : toutes les bibliothèques.</Text>
          </View>
          <View>
            <Text style={styles.label}>Âge maximum</Text>
            <View style={styles.wrapRow}>
              {AGES.map((a) => (
                <Pressable key={a.l} onPress={() => (tap(), setMaxAge(a.v))} style={[styles.pill, maxAge === a.v && styles.segOn]}>
                  <Text style={[styles.segTxt, maxAge === a.v && { color: '#000' }]}>{a.l}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : null}

      <View>
        <Text style={styles.label}>Code à 4 chiffres {orig?.hasPin ? '(enregistré)' : '(facultatif)'}</Text>
        <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry placeholder={orig?.hasPin ? 'Nouveau code' : 'Aucun'} placeholderTextColor={C.textFaint} style={styles.input} />
        {orig?.hasPin ? (
          <Pressable onPress={() => profilesApi.update(settings, orig.id, { pin: null }).then(() => Alert.alert('Profil', 'Code retiré.'))}>
            <Text style={[styles.help, { color: C.accent }]}>Retirer le code</Text>
          </Pressable>
        ) : null}
      </View>

      {!orig ? (
        <View>
          <Pressable onPress={() => (tap(), setLink((l) => !l))} style={styles.linkHead}>
            <Ionicons name={link ? 'checkbox' : 'square-outline'} size={20} color={C.textDim} />
            <Text style={styles.segTxt}>Utiliser un compte Jellyfin qui existe déjà</Text>
          </Pressable>
          {link ? (
            <View style={{ gap: 10, marginTop: 10 }}>
              <TextInput value={linkUser} onChangeText={setLinkUser} placeholder="Nom d’utilisateur Jellyfin" placeholderTextColor={C.textFaint} autoCapitalize="none" style={styles.input} />
              <TextInput value={linkPass} onChangeText={setLinkPass} placeholder="Mot de passe" placeholderTextColor={C.textFaint} secureTextEntry style={styles.input} />
              <Text style={styles.help}>Son historique est gardé. Le mot de passe reste sur le serveur Lumio, personne n’aura à le retaper.</Text>
            </View>
          ) : (
            <Text style={[styles.help, { marginTop: 6 }]}>Sinon, un nouveau compte Jellyfin est créé pour ce profil (sa propre reprise, ses « vus », sa liste « À voir »).</Text>
          )}
        </View>
      ) : null}

      <Button title={orig ? 'Enregistrer' : 'Créer le profil'} icon="checkmark" onPress={save} loading={busy} />
      {orig ? <Button title="Supprimer le profil" icon="trash-outline" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: { color: C.textDim, fontSize: 15, fontWeight: '600', width: 60 },
  h1: { color: C.text, fontSize: 17, fontWeight: '800' },
  big: { width: 120, height: 120, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  name: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center', minWidth: 200, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { color: C.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  help: { color: C.textDim, fontSize: 12, lineHeight: 17, marginTop: 6 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  color: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: 'transparent' },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 999, backgroundColor: C.surfaceHigh },
  segOn: { backgroundColor: '#fff' },
  segTxt: { color: C.text, fontSize: 14, fontWeight: '700' },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: C.surfaceHigh },
  input: { backgroundColor: C.surfaceHigh, color: C.text, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
