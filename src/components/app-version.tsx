// Réglages → Application : version installée, dernière version publiée, bouton « Vérifier ».
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/toast";
import { Button, Section } from "@/components/ui";
import { C, R } from "@/constants/theme";
import {
  ANDROID_APK_URL,
  APP_VERSION,
  checkForUpdate,
  cleanNotes,
  RELEASES_URL,
  useAppUpdate,
} from "@/lib/app-update";

export function AppVersionSection() {
  const update = useAppUpdate();
  const [checking, setChecking] = useState(false);
  const notes = cleanNotes(update?.notes);

  return (
    <Section title="Application">
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          <View
            style={[
              styles.icon,
              { backgroundColor: update ? C.accent : C.surfaceHigh },
            ]}
          >
            <Ionicons
              name={update ? "arrow-down-circle" : "checkmark-circle"}
              size={22}
              color={update ? "#fff" : C.success}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Lumio {APP_VERSION}</Text>
            <Text style={styles.dim}>
              {update
                ? `La version ${update.version} est disponible`
                : "À jour"}
            </Text>
          </View>
        </View>
        {update ? (
          <View style={styles.box}>
            {notes ? (
              <Text style={[styles.dim, { color: C.text }]}>{notes}</Text>
            ) : null}
            <Text style={styles.dim}>
              {Platform.OS === "android"
                ? "Touche « Télécharger », puis ouvre le fichier pour l’installer par-dessus. Tes réglages et ta connexion sont conservés."
                : "Ouvre FlareStore, onglet des mises à jour (ou la source Lumio), puis « Mettre à jour ». Tes réglages et ta connexion sont conservés."}
            </Text>
            {Platform.OS === "android" ? (
              <Button
                title="Télécharger la mise à jour"
                icon="download-outline"
                onPress={() => Linking.openURL(ANDROID_APK_URL)}
              />
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button
            title="Vérifier"
            icon="refresh"
            variant="secondary"
            loading={checking}
            style={{ flex: 1 }}
            onPress={async () => {
              setChecking(true);
              await checkForUpdate();
              setChecking(false);
              toast("Vérification faite", "info", 2500);
            }}
          />
          <Button
            title="Nouveautés"
            icon="newspaper-outline"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => Linking.openURL(RELEASES_URL)}
          />
        </View>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.text, fontSize: 16, fontWeight: "800" },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  box: {
    backgroundColor: C.surfaceHigh,
    borderRadius: R.md,
    padding: 12,
    gap: 6,
  },
});
