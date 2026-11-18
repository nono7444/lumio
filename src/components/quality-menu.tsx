// « Streaming » (admin) : menu du choix de la qualité, puis écran de lecture en mode streaming.
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable as RNPressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useSettings, type Settings } from '@/lib/settings';
import { watchNowApi } from '@/lib/watch-now';
import { tmdb } from '@/lib/tmdb';

/** Le serveur permet-il le streaming à ce compte (admin, ou membre si l'admin l'a ouvert) ? */
export function useCanStream(settings: Settings) {
  const st = useStreamStatus(settings);
  return st.can;
}
/** Droit au streaming + état des services (ok : au moins un service marche ; null : pas encore vérifié). Revérifié chaque minute. */
export function useStreamStatus(settings: Settings) {
  const [st, setSt] = useState<{ can: boolean; ok: boolean | null }>({ can: false, ok: null });
  useEffect(() => {
    if (!settings.chatUrl) return setSt({ can: false, ok: null });
    const load = () =>
      watchNowApi
        .status(settings)
        .then((x) => setSt({ can: Boolean(x.streaming), ok: x.health ? x.health.ok : null }))
        .catch(() => setSt((o) => ({ ...o, ok: false })));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [settings]);
  return st;
}

type ProbeArgs = { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number; title?: string };
/** Sources par qualité, cherchées dès l'ouverture de la fiche (le serveur prépare aussi les liens LooStream) : le menu
 *  et la lecture sont alors immédiats. Gardé 10 min. */
const probeMemo = new Map<string, { at: number; p: Promise<Record<string, Sources>> }>();
function probeOnce(settings: Settings, a: ProbeArgs) {
  const k = `${a.type}:${a.tmdbId}:${a.season ?? ''}:${a.episode ?? ''}`;
  const hit = probeMemo.get(k);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.p;
  const p = watchNowApi.probe(settings, a).catch(() => ({}) as Record<string, Sources>);
  probeMemo.set(k, { at: Date.now(), p });
  if (probeMemo.size > 50) probeMemo.delete(probeMemo.keys().next().value as string);
  return p;
}

/** Bouton « Streaming » (icône seule ou avec texte) + son menu de qualité. */
export function StreamingButton({ type, tmdbId, title, imdb, season, episode, label = false, style, ok, small }: { type: 'movie' | 'tv'; tmdbId: number; title: string; imdb?: string; season?: number; episode?: number; label?: boolean; style?: any; ok?: boolean | null; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const { settings } = useSettings();
  // Série : saison et épisode choisis dans le menu (au départ ceux proposés par la fiche)
  const [se, setSe] = useState<{ s: number; e: number }>({ s: season ?? 1, e: episode ?? 1 });
  const [seasons, setSeasons] = useState<{ n: number; count: number }[]>([]);
  useEffect(() => setSe({ s: season ?? 1, e: episode ?? 1 }), [season, episode]);
  useEffect(() => {
    if (!open || type !== 'tv' || seasons.length) return;
    tmdb
      .tv(settings, tmdbId)
      .then((t) => setSeasons((t.seasons ?? []).filter((x) => x.season_number > 0 && x.episode_count > 0).map((x) => ({ n: x.season_number, count: x.episode_count }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, tmdbId]);
  const epCount = seasons.find((x) => x.n === se.s)?.count ?? 0;
  // Recherche lancée dès l'affichage du bouton, sans attendre l'appui
  useEffect(() => {
    probeOnce(settings, { type, tmdbId, season, episode, title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tmdbId, season, episode]);
  return (
    <>
      <View style={style ?? undefined}>
        <Button
          title={label ? 'Streaming' : ''}
          icon="cloud-outline"
          variant="glass"
          small={small ?? !label}
          onPress={() => setOpen(true)}
          style={style ? { flex: 1 } : { width: 46, paddingHorizontal: 0 }}
          accessibilityLabel={`Streaming${ok === false ? ' (en panne)' : ok ? ' (en ligne)' : ''}`}
        />
        {/* Pastille : vert = au moins un service de streaming marche, rouge = aucun */}
        {ok != null ? <View pointerEvents="none" style={[qm.dot, { backgroundColor: ok ? '#30D158' : '#FF453A' }]} /> : null}
      </View>
      <QualityMenu
        open={open}
        probe={type === 'tv' ? { type, tmdbId, season: se.s, episode: se.e, title } : { type, tmdbId, title }}
        onClose={() => setOpen(false)}
        header={
          type === 'tv' && seasons.length ? (
            <View style={{ gap: 8, marginBottom: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {seasons.map((x) => (
                  <RNPressable key={x.n} onPress={() => setSe({ s: x.n, e: 1 })} style={[qm.chip, se.s === x.n && qm.chipOn]}>
                    <Text style={[qm.chipTxt, se.s === x.n && qm.chipTxtOn]}>Saison {x.n}</Text>
                  </RNPressable>
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {Array.from({ length: epCount }, (_, i) => i + 1).map((n) => (
                  <RNPressable key={n} onPress={() => setSe((o) => ({ ...o, e: n }))} style={[qm.chip, qm.epChip, se.e === n && qm.chipOn]}>
                    <Text style={[qm.chipTxt, se.e === n && qm.chipTxtOn]}>É{n}</Text>
                  </RNPressable>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        onPick={(q) => {
          setOpen(false);
          router.push({
            pathname: '/watch',
            params: { type, tmdbId: String(tmdbId), imdb: imdb ?? '', title, stream: '1', quality: String(q), ...(type === 'tv' ? { season: String(se.s), episode: String(se.e) } : {}) },
          });
        }}
      />
    </>
  );
}

/** Menu « Streaming » : choix de la qualité (le serveur prend la meilleure version de cette qualité). */
type Sources = { torbox: boolean; alldebrid: boolean; wawacity: boolean; loostream?: boolean };
/** Pastilles « d'où vient le flux » : TorBox (lien direct), AllDebrid et Wawacity (passent par ton serveur). */
function SourceBadges({ src }: { src: Sources }) {
  const items = [
    src.loostream ? { label: 'LooStream', icon: 'server' as const, color: '#BF5AF2' } : null,
    src.torbox ? { label: 'TorBox', icon: 'flash' as const, color: '#30D158' } : null,
    src.alldebrid ? { label: 'AllDebrid', icon: 'server' as const, color: '#FFD60A' } : null,
    src.wawacity ? { label: 'Wawacity', icon: 'server' as const, color: '#64D2FF' } : null,
  ].filter(Boolean) as { label: string; icon: 'flash' | 'server'; color: string }[];
  if (!items.length) return <Text style={qm.none}>rien trouvé</Text>;
  return (
    <View style={qm.badges}>
      {items.map((x) => (
        <View key={x.label} style={[qm.badge, { borderColor: x.color }]}>
          <Ionicons name={x.icon} size={11} color={x.color} />
          <Text style={[qm.badgeTxt, { color: x.color }]}>{x.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Menu « Streaming » : choix de la qualité, avec pour chacune les sources disponibles (vérifiées à l'ouverture). */
export function QualityMenu({
  open,
  onClose,
  onPick,
  probe,
  header,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (q: 1080 | 720) => void;
  /** Au-dessus des qualités : choix de la saison et de l'épisode (série) */
  header?: ReactNode;
  probe?: { type: 'movie' | 'tv'; tmdbId: number; season?: number; episode?: number; title?: string };
}) {
  const { settings } = useSettings();
  const [src, setSrc] = useState<Record<string, Sources> | null>(null);
  useEffect(() => {
    if (!open || !probe) return;
    setSrc(null);
    probeOnce(settings, probe).then(setSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, probe?.season, probe?.episode]);
  const opts: { q: 1080 | 720; label: string }[] = [
    { q: 1080, label: '1080p' },
    { q: 720, label: '720p' },
  ];
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <RNPressable style={qm.backdrop} onPress={onClose}>
        <View style={qm.sheet}>
          <Text style={qm.title}>Streaming</Text>
          {header ?? null}
          <View style={qm.legend}>
            <Ionicons name="flash" size={11} color="#30D158" />
            <Text style={qm.help}>direct</Text>
            <Ionicons name="server" size={11} color="rgba(255,255,255,0.6)" style={{ marginLeft: 8 }} />
            <Text style={qm.help}>passe par ton serveur</Text>
          </View>
          {opts.map((o) => (
            <RNPressable key={o.q} onPress={() => onPick(o.q)} style={({ pressed }) => [qm.row, pressed && { opacity: 0.6 }]}>
              <Text style={qm.rowLabel}>{o.label}</Text>
              {!probe ? null : src == null ? (
                <View style={qm.badges}>
                  <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
                  <Text style={qm.none}>recherche des sources…</Text>
                </View>
              ) : src[String(o.q)] ? (
                <SourceBadges src={src[String(o.q)]} />
              ) : (
                <Text style={qm.none}>inconnu</Text>
              )}
            </RNPressable>
          ))}
          <RNPressable onPress={onClose} style={qm.cancel}>
            <Text style={qm.cancelTxt}>Annuler</Text>
          </RNPressable>
        </View>
      </RNPressable>
    </Modal>
  );
}

/** Admin : « DL » → choix de la qualité (4K ou 1080p), puis les fichiers Wawacity de cette qualité (téléchargés par le serveur). */
export function DlButton({ type, tmdbId, title, imdb, style }: { type: 'movie' | 'tv'; tmdbId: number; title: string; imdb?: string; style?: any }) {
  const [open, setOpen] = useState(false);
  const go = (quality: '4K' | '1080p') => {
    setOpen(false);
    router.push({ pathname: '/secour', params: { type, tmdbId: String(tmdbId), imdb: imdb ?? '', title, source: 'wawacity', quality } });
  };
  return (
    <>
      <Button title="DL" icon="download-outline" variant="glass" small onPress={() => setOpen(true)} style={style ?? { paddingHorizontal: 14 }} accessibilityLabel="Télécharger depuis Wawacity" />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <RNPressable style={qm.backdrop} onPress={() => setOpen(false)}>
          <View style={qm.sheet}>
            <Text style={qm.title}>Télécharger (Wawacity)</Text>
            <Text style={qm.help}>Le serveur télécharge le fichier choisi avec AllDebrid : rien de compté sur C411.</Text>
            {(['4K', '1080p'] as const).map((q) => (
              <RNPressable key={q} onPress={() => go(q)} style={({ pressed }) => [qm.row, pressed && { opacity: 0.6 }]}>
                <Text style={qm.rowLabel}>{q}</Text>
                <Text style={qm.rowSub}>{q === '4K' ? 'Le plus beau, fichiers lourds' : 'Le bon choix la plupart du temps'}</Text>
              </RNPressable>
            ))}
            <RNPressable onPress={() => setOpen(false)} style={qm.cancel}>
              <Text style={qm.cancelTxt}>Annuler</Text>
            </RNPressable>
          </View>
        </RNPressable>
      </Modal>
    </>
  );
}
const qm = StyleSheet.create({
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  epChip: { minWidth: 44, paddingHorizontal: 8 },
  chipOn: { backgroundColor: '#fff' },
  chipTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: '#000' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  none: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 4 },
  dot: { position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#000' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34, gap: 10 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  help: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 },
  row: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, gap: 2 },
  rowLabel: { color: '#fff', fontSize: 17, fontWeight: '700' },
  rowSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: '600' },
});
