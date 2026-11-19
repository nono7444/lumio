// Vignette d'un résultat de recherche (C411, Wawacity…) : couverture trouvée en ligne par le serveur d'après le nom.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { C } from '@/constants/theme';
import { coverFind } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

export function ResultThumb({ path, q, kind, square, icon }: { path: string; q: string; kind?: string; square?: boolean; icon: keyof typeof Ionicons.glyphMap }) {
  const { settings } = useSettings();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    coverFind(settings, path, q, kind).then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, q, kind]);
  const w = 52;
  const h = square ? 52 : 78;
  return (
    <View style={{ width: w, height: h, borderRadius: 6, overflow: 'hidden', backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={20} color={C.textFaint} />
      {url ? <Image source={{ uri: url }} style={{ position: 'absolute', width: w, height: h }} contentFit="cover" transition={150} cachePolicy="disk" /> : null}
    </View>
  );
}
