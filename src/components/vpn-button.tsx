// Live TV : bouton VPN (Proton VPN via l'app Raccourcis) + écran de réglage.
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { autoStartVpn, switchVpn, useVpnState } from '@/lib/vpn';

const GREEN = '#30D158';

export function VpnButton() {
  const { settings, update } = useSettings();
  const cfg = settings.liveVpn;
  const on = useVpnState();
  const [open, setOpen] = useState(false);

  // Démarrage automatique en arrivant sur la Live TV
  useFocusEffect(
    useCallback(() => {
      autoStartVpn(cfg);
    }, [cfg])
  );

  const press = () => {
    tap();
    if (Platform.OS === 'android') {
      switchVpn(cfg, true).catch(() => {});
      return;
    }
    if (!cfg.enabled) {
      setOpen(true);
      return;
    }
    switchVpn(cfg, !on).catch(() =>
      toast('Impossible d’ouvrir Raccourcis. Vérifie le nom des raccourcis (appui long sur VPN).', 'error')
    );
  };

  return (
    <>
      <Pressable
        onPress={press}
        onLongPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityLabel={on ? 'Éteindre le VPN' : 'Démarrer le VPN'}
        style={[styles.chip, on && { backgroundColor: 'rgba(48,209,88,0.18)', borderColor: 'rgba(48,209,88,0.5)' }]}>
        <Ionicons name={on ? 'shield-checkmark' : 'shield-outline'} size={16} color={on ? GREEN : C.text} />
        <Text style={[styles.chipText, on && { color: GREEN }]}>{on ? 'VPN actif' : 'VPN'}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>VPN pour la Live TV</Text>
              <Text style={styles.dim}>
                iOS ne permet pas à Lumio d’allumer directement Proton VPN : on passe par deux raccourcis de l’app « Raccourcis »
                (une seule fois à faire).
              </Text>
              <View style={styles.steps}>
                <Text style={styles.step}>1. Ouvre l’app Raccourcis → onglet Raccourcis → « + » → Ajouter une action → cherche « Proton VPN » → « Se connecter au VPN » (Connect to VPN).</Text>
                <Text style={styles.step}>2. Touche le nom en haut et renomme le raccourci exactement « {cfg.onShortcut} » (majuscules et espaces compris).</Text>
                <Text style={styles.step}>3. Crée un 2ᵉ raccourci avec « Proton VPN › Se déconnecter du VPN » (Disconnect from VPN), nommé « {cfg.offShortcut} ».</Text>
                <Text style={styles.step}>4. Active ci-dessous, puis touche « Démarrer » pour tester : Raccourcis s’ouvre une seconde et lance Proton VPN.</Text>
                <Text style={styles.step}>💡 Encore plus simple : Raccourcis → Automatisation → « + » → App → Lumio → « Est ouverte » → action « Proton VPN › Se connecter au VPN » → Exécuter immédiatement. Le VPN démarre tout seul à chaque ouverture de Lumio.</Text>
              </View>
              <Button title="Ouvrir Raccourcis" icon="open-outline" variant="secondary" onPress={() => Linking.openURL('shortcuts://').catch(() => {})} />

              <Text style={styles.label}>Raccourci pour démarrer</Text>
              <TextInput
                value={cfg.onShortcut}
                onChangeText={(t) => update({ liveVpn: { ...cfg, onShortcut: t } })}
                style={styles.input}
                autoCorrect={false}
                placeholderTextColor={C.textFaint}
              />
              <Text style={styles.label}>Raccourci pour éteindre</Text>
              <TextInput
                value={cfg.offShortcut}
                onChangeText={(t) => update({ liveVpn: { ...cfg, offShortcut: t } })}
                style={styles.input}
                autoCorrect={false}
                placeholderTextColor={C.textFaint}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Bouton VPN actif</Text>
                <Switch value={cfg.enabled} onValueChange={(v) => update({ liveVpn: { ...cfg, enabled: v } })} />
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchText}>Démarrer automatiquement</Text>
                  <Text style={styles.dim}>À la première ouverture de Live TV après le lancement de l’appli.</Text>
                </View>
                <Switch value={cfg.auto} disabled={!cfg.enabled} onValueChange={(v) => update({ liveVpn: { ...cfg, auto: v } })} />
              </View>

              {cfg.enabled ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Démarrer" icon="shield-checkmark" style={{ flex: 1 }} onPress={() => switchVpn(cfg, true).catch(() => {})} />
                  <Button title="Éteindre" icon="power" variant="secondary" style={{ flex: 1 }} onPress={() => switchVpn(cfg, false).catch(() => {})} />
                </View>
              ) : null}
              <Button title="Fermer" variant="glass" onPress={() => setOpen(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  chipText: { color: C.text, fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34, maxHeight: '88%' },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  steps: { backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 12, gap: 6 },
  step: { color: C.text, fontSize: 13, lineHeight: 19 },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  switchText: { color: C.text, fontSize: 15, fontWeight: '600' },
});
