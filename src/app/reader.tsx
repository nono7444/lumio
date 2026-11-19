// Lumio Livres : la liseuse. EPUB chapitre par chapitre (mis en page par le serveur : thème, taille du texte),
// BD / mangas page par page (sens de lecture manga possible, zoom), PDF (iPhone ; ailleurs ouvert dans une autre appli).
// Un appui au milieu montre ou cache les barres ; la position est gardée sur le serveur (reprise sur tous les appareils).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { FocusPressable as Pressable } from '@/components/tv';
import { tap } from '@/components/ui';
import { C } from '@/constants/theme';
import { ebookApi, ebookById, fileUrl, saveProgress, type Ebook } from '@/lib/ebooks';
import { useSettings } from '@/lib/settings';

type Theme = 'sombre' | 'clair' | 'sepia';
type Prefs = { theme: Theme; size: number; rtl: boolean };
const PREFS_KEY = 'lumio-livres:liseuse';
const THEMES: Record<Theme, { bg: string; fg: string; label: string; server: string }> = {
  sombre: { bg: '#000', fg: '#e8e6e3', label: 'Sombre', server: 'sombre' },
  clair: { bg: '#fff', fg: '#111', label: 'Clair', server: 'clair' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', label: 'Sépia', server: 'sepia' },
};

export default function ReaderScreen() {
  const { id, chapter } = useLocalSearchParams<{ id: string; chapter?: string }>();
  const book = ebookById(String(id));
  const [prefs, setPrefs] = useState<Prefs>({ theme: 'sombre', size: 19, rtl: false });
  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY)
      .then((r) => r && setPrefs((p) => ({ ...p, ...JSON.parse(r) })))
      .catch(() => {});
  }, []);
  const change = (p: Partial<Prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

  if (!book) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Text style={{ color: C.textDim }}>Livre introuvable.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.text, fontWeight: '700' }}>Fermer</Text>
        </Pressable>
      </View>
    );
  }
  if (book.format === 'epub') return <EpubReader book={book} prefs={prefs} change={change} startChapter={chapter != null ? Number(chapter) : null} />;
  if (book.format === 'bd') return <ComicReader book={book} prefs={prefs} change={change} restart={chapter === '0'} />;
  return <PdfReader book={book} />;
}

// ——— Barres du haut et du bas (communes) ———
function Chrome({
  show,
  title,
  sub,
  dark,
  onChapters,
  onSettings,
  children,
}: {
  show: boolean;
  title: string;
  sub?: string;
  dark: boolean;
  onChapters?: () => void;
  onSettings?: () => void;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  if (!show) return null;
  const fg = dark ? '#fff' : '#111';
  const bg = dark ? 'rgba(20,20,22,0.94)' : 'rgba(250,248,244,0.96)';
  return (
    <>
      <View style={[styles.bar, { top: 0, paddingTop: insets.top + 6, backgroundColor: bg }]}>
        <Pressable onPress={() => (tap(), router.back())} hitSlop={12} accessibilityLabel="Fermer">
          <Ionicons name="chevron-down" size={26} color={fg} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.barTitle, { color: fg }]}>
            {title}
          </Text>
          {sub ? (
            <Text numberOfLines={1} style={[styles.barSub, { color: fg }]}>
              {sub}
            </Text>
          ) : null}
        </View>
        {onChapters ? (
          <Pressable onPress={() => (tap(), onChapters())} hitSlop={10} accessibilityLabel="Chapitres">
            <Ionicons name="list" size={24} color={fg} />
          </Pressable>
        ) : null}
        {onSettings ? (
          <Pressable onPress={() => (tap(), onSettings())} hitSlop={10} accessibilityLabel="Affichage">
            <Text style={{ color: fg, fontSize: 19, fontWeight: '700' }}>Aa</Text>
          </Pressable>
        ) : null}
      </View>
      {children ? <View style={[styles.bar, { bottom: 0, paddingBottom: insets.bottom + 8, backgroundColor: bg }]}>{children}</View> : null}
    </>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: height * 0.6 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

function Settings2({ prefs, change, comic }: { prefs: Prefs; change: (p: Partial<Prefs>) => void; comic?: boolean }) {
  return (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      {comic ? (
        <View style={styles.row}>
          <Text style={styles.optText}>Sens de lecture manga (droite → gauche)</Text>
          <Pressable onPress={() => (tap(), change({ rtl: !prefs.rtl }))} style={[styles.toggle, prefs.rtl && { backgroundColor: C.success }]}>
            <View style={[styles.knob, prefs.rtl && { alignSelf: 'flex-end' }]} />
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.row}>
            {(Object.keys(THEMES) as Theme[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => (tap(), change({ theme: t }))}
                style={[styles.themeBtn, { backgroundColor: THEMES[t].bg, borderColor: prefs.theme === t ? C.accent : 'rgba(128,128,128,0.4)' }]}>
                <Text style={{ color: THEMES[t].fg, fontWeight: '700' }}>{THEMES[t].label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => (tap(), change({ size: Math.max(14, prefs.size - 1) }))} style={styles.sizeBtn} accessibilityLabel="Texte plus petit">
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>A−</Text>
            </Pressable>
            <Text style={{ color: C.textDim, fontVariant: ['tabular-nums'] }}>{prefs.size} px</Text>
            <Pressable onPress={() => (tap(), change({ size: Math.min(30, prefs.size + 1) }))} style={styles.sizeBtn} accessibilityLabel="Texte plus grand">
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>A+</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ——— EPUB ———
// Script injecté dans le chapitre : position de défilement (0 → 1) et appui au milieu de l'écran
const EPUB_JS = `
(function(){
  var post=function(o){window.ReactNativeWebView.postMessage(JSON.stringify(o))};
  var max=function(){return Math.max(1,document.documentElement.scrollHeight-window.innerHeight)};
  var t=null;
  window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){post({t:'scroll',r:Math.min(1,window.scrollY/max())})},250)},{passive:true});
  document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a'))return;post({t:'tap',x:e.clientX/window.innerWidth})});
  window.__goto=function(r){window.scrollTo(0,r*max())};
})();true;`;

function EpubReader({ book, prefs, change, startChapter }: { book: Ebook; prefs: Prefs; change: (p: Partial<Prefs>) => void; startChapter: number | null }) {
  const { settings } = useSettings();
  const web = useRef<WebView>(null);
  const [toc, setToc] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resume = book.progress && !book.progress.done && startChapter == null;
  const [chapter, setChapter] = useState(startChapter ?? (resume ? book.progress!.chapter : 0));
  const pendingScroll = useRef<number>(resume ? book.progress!.scroll : 0);
  const scroll = useRef(0);
  const [ui, setUi] = useState(true);
  const [sheet, setSheet] = useState<null | 'toc' | 'aa'>(null);
  const lastSave = useRef(0);
  const th = THEMES[prefs.theme];

  useEffect(() => {
    ebookApi
      .epub(settings, book)
      .then((r) => (r.error ? setErr(r.error) : setToc(r.chapters ?? [])))
      .catch((e) => setErr(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const n = toc?.length ?? 0;
  const save = useCallback(
    (force = false) => {
      if (!n) return;
      if (!force && Date.now() - lastSave.current < 3000) return;
      lastSave.current = Date.now();
      const pct = Math.min(1, (chapter + scroll.current) / n);
      saveProgress(settings, book, { chapter, scroll: scroll.current, pct, done: chapter >= n - 1 && scroll.current > 0.97 });
    },
    [book, chapter, n, settings]
  );
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(true), []);

  const go = (c: number, at = 0) => {
    if (c < 0 || c >= n) return;
    save(true);
    pendingScroll.current = at;
    scroll.current = at;
    setChapter(c);
  };
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'scroll') {
        scroll.current = m.r;
        save();
      } else if (m.t === 'tap') setUi((v) => !v);
    } catch {}
  };
  const uri = useMemo(() => {
    const base = fileUrl(settings, book, `epub/${chapter}`);
    return base ? `${base}?theme=${th.server}&size=${prefs.size}` : null;
  }, [settings, book, chapter, th.server, prefs.size]);

  const dark = prefs.theme === 'sombre';
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <StatusBar style={dark ? 'light' : 'dark'} hidden={!ui} />
      {err ? (
        <View style={styles.center}>
          <Text style={{ color: th.fg, textAlign: 'center', padding: 24 }}>{err}</Text>
        </View>
      ) : !uri || !toc ? (
        <View style={styles.center}>
          <ActivityIndicator color={th.fg} />
        </View>
      ) : (
        <WebView
          ref={web}
          key={uri}
          source={{ uri }}
          style={{ flex: 1, backgroundColor: th.bg }}
          originWhitelist={['*']}
          injectedJavaScript={EPUB_JS}
          onMessage={onMessage}
          onLoadEnd={() => {
            const r = pendingScroll.current;
            pendingScroll.current = 0;
            if (r > 0) setTimeout(() => web.current?.injectJavaScript(`window.__goto(${r});true;`), 350);
          }}
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          decelerationRate="normal"
        />
      )}
      <Chrome
        show={ui}
        dark={dark}
        title={book.title}
        sub={toc?.[chapter] ? `${toc[chapter]} · ${chapter + 1}/${n}` : undefined}
        onChapters={n > 1 ? () => setSheet('toc') : undefined}
        onSettings={() => setSheet('aa')}>
        <View style={styles.bottomRow}>
          <Pressable onPress={() => (tap(), go(chapter - 1))} disabled={chapter === 0} style={[styles.navBtn, chapter === 0 && { opacity: 0.35 }]}>
            <Ionicons name="chevron-back" size={20} color={dark ? '#fff' : '#111'} />
            <Text style={[styles.navText, { color: dark ? '#fff' : '#111' }]}>Précédent</Text>
          </Pressable>
          <Text style={[styles.navText, { color: dark ? '#aaa' : '#555' }]}>{n ? `${Math.round(((chapter + scroll.current) / n) * 100)} %` : ''}</Text>
          <Pressable onPress={() => (tap(), go(chapter + 1))} disabled={chapter >= n - 1} style={[styles.navBtn, chapter >= n - 1 && { opacity: 0.35 }]}>
            <Text style={[styles.navText, { color: dark ? '#fff' : '#111' }]}>Suivant</Text>
            <Ionicons name="chevron-forward" size={20} color={dark ? '#fff' : '#111'} />
          </Pressable>
        </View>
      </Chrome>
      <Sheet visible={sheet === 'toc'} onClose={() => setSheet(null)} title="Chapitres">
        {toc?.map((c, i) => (
          <Pressable key={i} onPress={() => (tap(), setSheet(null), go(i))} style={styles.opt}>
            <Text numberOfLines={2} style={[styles.optText, i === chapter && { fontWeight: '800' }]}>
              {c}
            </Text>
            {i === chapter ? <Ionicons name="bookmark" size={18} color={C.text} /> : null}
          </Pressable>
        ))}
      </Sheet>
      <Sheet visible={sheet === 'aa'} onClose={() => setSheet(null)} title="Affichage">
        <Settings2 prefs={prefs} change={change} />
      </Sheet>
    </View>
  );
}

// ——— BD / mangas (CBZ) ———
function ComicReader({ book, prefs, change, restart }: { book: Ebook; prefs: Prefs; change: (p: Partial<Prefs>) => void; restart: boolean }) {
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = !restart && book.progress && !book.progress.done ? book.progress.page : 0;
  const [page, setPage] = useState(start);
  const [ui, setUi] = useState(true);
  const [sheet, setSheet] = useState(false);
  const list = useRef<FlatList<number>>(null);
  const lastSave = useRef(0);

  useEffect(() => {
    ebookApi
      .pages(settings, book)
      .then((r) => (r.error ? setErr(r.error) : setCount(r.pages)))
      .catch((e) => setErr(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const save = useCallback(
    (p: number, force = false) => {
      if (!count) return;
      if (!force && Date.now() - lastSave.current < 2000) return;
      lastSave.current = Date.now();
      saveProgress(settings, book, { page: p, pct: Math.min(1, (p + 1) / count), done: p >= count - 1 });
    },
    [book, count, settings]
  );
  const pageRef = useRef(page);
  pageRef.current = page;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(pageRef.current, true), []);

  const pages = useMemo(() => Array.from({ length: count ?? 0 }, (_, i) => i), [count]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== pageRef.current && i >= 0 && i < (count ?? 0)) {
      setPage(i);
      save(i);
    }
  };
  const goPage = (i: number) => {
    if (!count) return;
    const p = Math.max(0, Math.min(count - 1, i));
    list.current?.scrollToIndex({ index: p, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" hidden={!ui} />
      {err ? (
        <View style={styles.center}>
          <Text style={{ color: '#fff', textAlign: 'center', padding: 24 }}>{err}</Text>
        </View>
      ) : count == null ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          ref={list}
          data={pages}
          horizontal
          pagingEnabled
          inverted={prefs.rtl}
          initialScrollIndex={Math.min(start, Math.max(0, count - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onScroll}
          showsHorizontalScrollIndicator={false}
          windowSize={5}
          initialNumToRender={3}
          keyExtractor={(i) => String(i)}
          renderItem={({ item }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={{ width, height }}
              maximumZoomScale={3}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Pressable
                onPress={() => {
                  // Bords : page précédente / suivante ; milieu : barres
                  setUi((v) => !v);
                }}
                style={{ width, height }}>
                <Image
                  source={{ uri: fileUrl(settings, book, `page/${item}`) ?? undefined }}
                  style={{ width, height }}
                  contentFit="contain"
                  cachePolicy="disk"
                  recyclingKey={`${book.id}-${item}`}
                />
              </Pressable>
            </ScrollView>
          )}
        />
      )}
      <Chrome show={ui} dark title={book.title} sub={count ? `Page ${page + 1} / ${count}` : undefined} onSettings={() => setSheet(true)}>
        {count ? (
          <View style={styles.bottomRow}>
            <Pressable onPress={() => (tap(), goPage(prefs.rtl ? page + 1 : page - 1))} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 8, overflow: 'hidden' }}>
              <View style={{ width: `${((page + 1) / count) * 100}%`, height: '100%', backgroundColor: '#fff', alignSelf: prefs.rtl ? 'flex-end' : 'flex-start' }} />
            </View>
            <Pressable onPress={() => (tap(), goPage(prefs.rtl ? page - 1 : page + 1))} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </Chrome>
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Lecture">
        <Settings2 prefs={prefs} change={change} comic />
      </Sheet>
    </View>
  );
}

// ——— PDF ———
function PdfReader({ book }: { book: Ebook }) {
  const { settings } = useSettings();
  const [ui, setUi] = useState(true);
  const uri = fileUrl(settings, book);
  useEffect(() => {
    // Ouvert : le livre passe dans « Continuer la lecture »
    if (!book.progress) saveProgress(settings, book, { pct: 0.01 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);
  // Android : la WebView ne sait pas afficher un PDF → il s'ouvre dans l'appli PDF du téléphone
  if (Platform.OS !== 'ios') {
    return (
      <View style={[styles.center, { backgroundColor: C.bg, padding: 24, gap: 16 }]}>
        <Ionicons name="document-text-outline" size={48} color={C.textDim} />
        <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{book.title}</Text>
        <Text style={{ color: C.textDim, textAlign: 'center' }}>Ce livre est un PDF : il s'ouvre dans le lecteur PDF du téléphone.</Text>
        <Pressable onPress={() => uri && Linking.openURL(uri)} style={styles.bigBtn}>
          <Text style={{ color: '#000', fontWeight: '800' }}>Ouvrir le PDF</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: C.textDim }}>Fermer</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#525659' }}>
      <StatusBar style="light" hidden={!ui} />
      {uri ? <WebView source={{ uri }} style={{ flex: 1 }} originWhitelist={['*']} onTouchEnd={() => undefined} /> : null}
      <Chrome show={ui} dark title={book.title} sub="PDF">
        <Pressable onPress={() => setUi(false)} style={[styles.navBtn, { alignSelf: 'center' }]}>
          <Text style={[styles.navText, { color: '#fff' }]}>Masquer les barres</Text>
        </Pressable>
      </Chrome>
      {!ui ? (
        <Pressable onPress={() => setUi(true)} style={styles.showBtn} accessibilityLabel="Afficher les barres">
          <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 8 },
  barTitle: { fontSize: 15, fontWeight: '700' },
  barSub: { fontSize: 12, opacity: 0.65, marginTop: 1 },
  bottomRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 6 },
  navText: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sheet: { backgroundColor: C.surfaceHigh, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, paddingBottom: 34, paddingHorizontal: 18 },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 10 },
  optText: { color: C.text, fontSize: 15, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  themeBtn: { flex: 1, height: 52, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sizeBtn: { width: 64, height: 46, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: 'rgba(128,128,128,0.4)', padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  bigBtn: { backgroundColor: C.text, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  showBtn: { position: 'absolute', right: 16, bottom: 40, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
