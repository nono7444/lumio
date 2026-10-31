// Lecteur PDF (celui du système).
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { C } from '@/constants/theme';
import { bookUrl } from '@/lib/books';
import { useSettings } from '@/lib/settings';

export default function BookPdf() {
  const { token, title } = useLocalSearchParams<{ token: string; title: string }>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[st.top, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color="#fff" /></Pressable>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
      </View>
      <WebView source={{ uri: bookUrl(settings, token, 'file') }} style={{ flex: 1, backgroundColor: '#000' }} startInLoadingState />
    </View>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: C.bg },
  title: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
});
