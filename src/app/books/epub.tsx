// Lecteur de livres (EPUB) : chapitres, taille du texte, thème, sommaire, reprise au bon endroit.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { C } from '@/constants/theme';
import { bookUrl } from '@/lib/books';
import { useSettings } from '@/lib/settings';

const THEMES = ['sombre', 'sepia', 'clair'] as const;
type Theme = (typeof THEMES)[number];
const BG: Record<Theme, string> = { sombre: '#000', sepia: '#f4ecd8', clair: '#fff' };

export default function BookEpub() {
  const { token, title, path } = useLocalSearchParams<{ token: string; title: string; path: string }>();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [book, setBook] = useState<{ title: string; chapters: string[] } | null>(null);
  const [chap, setChap] = useState(0);
  const [size, setSize] = useState(19);
  const [theme, setTheme] = useState<Theme>('sombre');
  const [chrome, setChrome] = useState(true);
  const [toc, setToc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resume = useRef(0);

  useEffect(() => {
    (async () => {
      const [pos, s, th] = await Promise.all([
        AsyncStorage.getItem(`book.epub.${path}`).catch(() => null),
        AsyncStorage.getItem('book.size').catch(() => null),
        AsyncStorage.getItem('book.theme').catch(() => null),
      ]);
      if (s) setSize(Number(s) || 19);
      if (th && (THEMES as readonly string[]).includes(th)) setTheme(th as Theme);
      try {
        const r = await fetch(bookUrl(settings, token, 'epub'));
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (pos) {
          const [c, y] = pos.split(':').map(Number);
          if (c < j.chapters.length) {
            setChap(c);
            resume.current = y || 0;
          }
        }
        setBook(j);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path]);

  const save = (c: number, y: number) => AsyncStorage.setItem(`book.epub.${path}`, `${c}:${y.toFixed(3)}`).catch(() => {});
  const goTo = (c: number) => {
    if (!book) return;
    const k = Math.max(0, Math.min(book.chapters.length - 1, c));
    resume.current = 0;
    setChap(k);
    save(k, 0);
  };

  const script = `(function(){
    var y=${resume.current};
    function go(){ if(y>0){ window.scrollTo(0, y*(document.documentElement.scrollHeight-innerHeight)); } }
    window.addEventListener('load', function(){ setTimeout(go, 60); }); go();
    var t=null;
    window.addEventListener('scroll', function(){ if(t) return; t=setTimeout(function(){ t=null;
      var h=document.documentElement.scrollHeight-innerHeight; window.ReactNativeWebView.postMessage(JSON.stringify({y: h>0? scrollY/h : 0})); }, 400); });
    document.addEventListener('click', function(e){ window.ReactNativeWebView.postMessage(JSON.stringify({tap:1})); });
  })(); true;`;

  if (error)
    return (
      <View style={[st.center, { backgroundColor: C.bg }]}>
        <Text style={{ color: C.textDim, textAlign: 'center', padding: 30 }}>{error}</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: C.accent, fontWeight: '800' }}>Retour</Text></Pressable>
      </View>
    );
  if (!book) return <View style={[st.center, { backgroundColor: C.bg }]}><ActivityIndicator color="#fff" /></View>;

  const dark = theme === 'sombre';
  const ink = dark ? '#fff' : '#111';
  const barBg = dark ? 'rgba(20,20,22,0.92)' : 'rgba(240,240,240,0.95)';
  const setSz = (v: number) => {
    setSize(v);
    AsyncStorage.setItem('book.size', String(v)).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG[theme] }}>
      <StatusBar hidden={!chrome} style={dark ? 'light' : 'dark'} />
      <WebView
        key={`${chap}-${size}-${theme}`}
        source={{ uri: bookUrl(settings, token, `epub/${chap}?size=${size}&theme=${theme}`) }}
        style={{ flex: 1, backgroundColor: BG[theme] }}
        originWhitelist={['*']}
        injectedJavaScript={script}
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.tap) setChrome((c) => !c);
            if (typeof m.y === 'number') save(chap, m.y);
          } catch {}
        }}
      />
      {chrome ? (
        <>
          <View style={[st.top, { paddingTop: insets.top + 4, backgroundColor: barBg }]}>
            <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={24} color={ink} /></Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[st.title, { color: ink }]} numberOfLines={1}>{book.title || title}</Text>
              <Text style={st.sub} numberOfLines={1}>{book.chapters[chap]}</Text>
            </View>
            <Pressable onPress={() => setToc(true)} hitSlop={10}><Ionicons name="list" size={24} color={ink} /></Pressable>
          </View>
          <View style={[st.bottom, { paddingBottom: insets.bottom + 8, backgroundColor: barBg }]}>
            <Pressable onPress={() => goTo(chap - 1)} disabled={chap === 0} style={{ opacity: chap === 0 ? 0.3 : 1 }} hitSlop={8}>
              <Ionicons name="chevron-back-circle" size={32} color={ink} />
            </Pressable>
            <Pressable onPress={() => setSz(Math.max(13, size - 1))} hitSlop={8}><Text style={[st.aa, { color: ink, fontSize: 15 }]}>A−</Text></Pressable>
            <Pressable
              onPress={() => {
                const t = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
                setTheme(t);
                AsyncStorage.setItem('book.theme', t).catch(() => {});
              }}
              hitSlop={8}>
              <Ionicons name="contrast" size={24} color={ink} />
            </Pressable>
            <Pressable onPress={() => setSz(Math.min(32, size + 1))} hitSlop={8}><Text style={[st.aa, { color: ink, fontSize: 21 }]}>A+</Text></Pressable>
            <Text style={st.sub}>{chap + 1}/{book.chapters.length}</Text>
            <Pressable onPress={() => goTo(chap + 1)} disabled={chap >= book.chapters.length - 1} style={{ opacity: chap >= book.chapters.length - 1 ? 0.3 : 1 }} hitSlop={8}>
              <Ionicons name="chevron-forward-circle" size={32} color={ink} />
            </Pressable>
          </View>
        </>
      ) : null}
      <Modal visible={toc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setToc(false)}>
        <View style={{ flex: 1, backgroundColor: '#161618' }}>
          <View style={st.sheetHead}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>Sommaire</Text>
            <Pressable onPress={() => setToc(false)} hitSlop={10}><Ionicons name="close" size={26} color="#fff" /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {book.chapters.map((c, i) => (
              <Pressable key={i} onPress={() => { goTo(i); setToc(false); }} style={[st.toc, i === chap && { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Text style={{ color: i === chap ? C.accent : '#fff', fontSize: 16 }} numberOfLines={2}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10 },
  title: { fontWeight: '700', fontSize: 15 },
  sub: { color: '#8e8e93', fontSize: 12 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10 },
  aa: { fontWeight: '800' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  toc: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2c' },
});
