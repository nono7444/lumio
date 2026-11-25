// Lumio Livres : couverture d'un livre (celle du fichier, sinon trouvée en ligne par le serveur) et barre d'avancement.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { C } from '@/constants/theme';
import { fileUrl, type Ebook } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = { epub: 'book', pdf: 'document-text', bd: 'images', audio: 'headset' };

/** Couverture au format livre (2:3). */
export function BookCover({ book, width, radius = 8 }: { book: Ebook; width: number; radius?: number }) {
  const { settings } = useSettings();
  const [bad, setBad] = useState(false);
  const uri = fileUrl(settings, book, 'cover');
  const height = Math.round(width * 1.5);
  const hue = [...book.title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11);
  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: `hsl(${hue},30%,22%)` }}>
      {/* Titre en dessous : il reste visible tant que l'image n'est pas arrivée (ou s'il n'y en a pas) */}
      <View style={[StyleSheet.absoluteFill, { padding: width * 0.1, justifyContent: 'space-between' }]}>
        <Ionicons name={ICON[book.format] ?? 'book'} size={width * 0.16} color="rgba(255,255,255,0.5)" />
        <View>
          <Text numberOfLines={4} style={{ color: '#fff', fontWeight: '800', fontSize: Math.max(11, width * 0.11) }}>
            {book.title}
          </Text>
          {book.author ? (
            <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.7)', fontSize: Math.max(9, width * 0.08), marginTop: 3 }}>
              {book.author}
            </Text>
          ) : null}
        </View>
      </View>
      {uri && !bad ? (
        <Image source={{ uri, cacheKey: `book-cover-v2-${book.id}` }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={book.id} onError={() => setBad(true)} />
      ) : null}
      {/* Liseré façon reliure */}
      <View style={styles.spine} />
    </View>
  );
}

export function ReadBar({ value }: { value: number }) {
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, height: '100%', backgroundColor: C.text }} />
    </View>
  );
}

const styles = StyleSheet.create({
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
});
