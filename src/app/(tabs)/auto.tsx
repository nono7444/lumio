// Onglet admin « Auto » (bêta) : Lumio Auto remplace Radarr / Sonarr. On y suit chaque demande (historique,
// recherches site par site, raisons des refus), on choisit une version à la main (recherche interactive),
// et on règle les indexeurs (C411…), le téléchargement et le profil de qualité.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Picker, Toggle } from '@/components/arr-section';
import { toast } from '@/components/toast';
import { Button, Field, ScreenTitle, Section, SegChip } from '@/components/ui';
import { C, TAB_SPACE } from '@/constants/theme';
import { autoApi, gb, type AutoEvent, type AutoGrab, type AutoIndexer, type AutoItem, type AutoRelease, type AutoState, type AutoWant } from '@/lib/auto';
import { useSettings } from '@/lib/settings';

type Tab = 'demandes' | 'telechargements' | 'indexeurs' | 'reglages';
const RUNNING: AutoGrab['state'][] = ['sent', 'downloading', 'importing'];
const STATE_LABEL: Record<AutoGrab['state'], string> = { sent: 'envoyé', downloading: 'téléchargement', importing: 'rangement', done: 'terminé', failed: 'échec' };
const STATE_COLOR: Record<AutoGrab['state'], string> = { sent: C.warning, downloading: C.accent, importing: C.accent, done: C.success, failed: C.danger };
const EVENT_ICON: Record<AutoEvent['type'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  added: { icon: 'add-circle', color: C.textDim },
  found: { icon: 'search', color: C.success },
  none: { icon: 'search', color: C.warning },
  sent: { icon: 'cloud-download', color: C.accent },
  imported: { icon: 'checkmark-circle', color: C.success },
  failed: { icon: 'alert-circle', color: C.danger },
};
const LANGS = [
  { value: 'multi', label: 'MULTI' },
  { value: 'vff', label: 'VFF' },
  { value: 'truefrench', label: 'TRUEFRENCH' },
  { value: 'vf2', label: 'VF2' },
  { value: 'french', label: 'FRENCH' },
  { value: 'vfq', label: 'VFQ' },
];
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const inMin = (iso?: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  return m <= 0 ? 'bientôt' : m < 60 ? `dans ${m} min` : `dans ${Math.round(m / 60)} h`;
};
const lastPart = (p?: string | null) => (p ? p.replace(/\/+$/, '').split('/').pop() : '—');
const wantLabel = (w: AutoWant) => (w.kind === 'movie' ? 'Film' : w.kind === 'season' ? `Saison ${w.season}` : `S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}`);

/** État d'un titre en une pastille : à choisir, recherche, téléchargement, pas sorti… */
function itemStatus(i: AutoItem, grabs: AutoGrab[]): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  const g = grabs.find((x) => x.itemId === i.id && ['sent', 'downloading', 'importing'].includes(x.state));
  if (i.paused) return { label: 'En pause', color: C.textDim, icon: 'pause' };
  if (i.searching) return { label: `Recherche ${i.searching}`, color: C.accent, icon: 'search' };
  if (g) return { label: g.state === 'downloading' ? `Téléchargement ${g.progress}%` : STATE_LABEL[g.state], color: C.accent, icon: 'cloud-download' };
  if (i.needsChoice) return { label: 'À choisir', color: C.warning, icon: 'hand-left' };
  if (i.type === 'movie' && i.available === false) return { label: 'Pas encore sorti', color: C.textDim, icon: 'calendar' };
  if (i.note === 'rien ne manque') return { label: 'Complet', color: C.success, icon: 'checkmark-circle' };
  return { label: 'En attente', color: C.textDim, icon: 'time' };
}

export default function AutoTab() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('demandes');
  const [st, setSt] = useState<AutoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editIx, setEditIx] = useState<(Partial<AutoIndexer> & { key?: string }) | null>(null);
  const [itemOpen, setItemOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    autoApi
      .state(settings)
      .then((s) => {
        setSt(s);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const save = async (b: Parameters<typeof autoApi.save>[1], msg?: string) => {
    try {
      await autoApi.save(settings, b);
      if (msg) toast(msg);
      load();
    } catch (e: any) {
      Alert.alert('Lumio Auto', e?.message ?? String(e));
    }
  };

  const open = st?.items.find((i) => i.id === itemOpen) ?? null;
  const toChoose = st?.items.filter((i) => i.needsChoice).length ?? 0;
  const running = st?.grabs.filter((g) => RUNNING.includes(g.state)).length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Auto" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
        <SegChip label={toChoose ? `Demandes · ${toChoose} à choisir` : 'Demandes'} on={tab === 'demandes'} onPress={() => setTab('demandes')} icon="pulse" />
        <SegChip label={running ? `Téléchargements · ${running}` : 'Téléchargements'} on={tab === 'telechargements'} onPress={() => setTab('telechargements')} icon="cloud-download-outline" />
        <SegChip label="Indexeurs" on={tab === 'indexeurs'} onPress={() => setTab('indexeurs')} icon="globe-outline" />
        <SegChip label="Réglages" on={tab === 'reglages'} onPress={() => setTab('reglages')} icon="options" />
      </ScrollView>
      {!st ? (
        <View style={styles.center}>
          {error ? (
            <Text style={styles.dim}>{/404|inconnue/.test(error) ? 'Le serveur Lumio doit être mis à jour (3.65.0 ou plus) : Profil → Serveur → Mettre à jour.' : error}</Text>
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: TAB_SPACE + insets.bottom + 20 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
          <View style={[styles.banner, { borderColor: st.enabled ? C.success : C.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{st.enabled ? 'Lumio Auto actif' : 'Lumio Auto désactivé'}</Text>
              <Text style={styles.dim}>
                {st.enabled
                  ? 'Les demandes validées passent par ici. Radarr et Sonarr peuvent être mis en pause.'
                  : `Les demandes passent encore par Radarr / Sonarr.${st.indexers.length ? '' : ' Ajoute d’abord un indexeur.'}`}
              </Text>
            </View>
            <Switch
              value={st.enabled}
              onValueChange={(v) => {
                if (v && !st.indexers.length) return Alert.alert('Lumio Auto', 'Ajoute d’abord un indexeur (onglet Indexeurs).');
                save({ enabled: v }, v ? 'Lumio Auto activé' : 'Lumio Auto désactivé');
              }}
              trackColor={{ true: C.success, false: C.border }}
            />
          </View>

          {tab === 'demandes' ? <Demandes st={st} reload={load} onItem={(i) => setItemOpen(i.id)} /> : null}
          {tab === 'telechargements' ? <Telechargements st={st} reload={load} onItem={(id) => setItemOpen(id)} /> : null}
          {tab === 'indexeurs' ? <Indexeurs st={st} reload={load} onEdit={setEditIx} /> : null}
          {tab === 'reglages' ? <Reglages st={st} save={save} /> : null}
        </ScrollView>
      )}
      {editIx ? <IndexerEditor ix={editIx} onClose={() => setEditIx(null)} onSaved={load} /> : null}
      {open && st ? <ItemSheet item={open} st={st} onClose={() => setItemOpen(null)} reload={load} /> : null}
    </View>
  );
}

function Demandes({ st, reload, onItem }: { st: AutoState; reload: () => void; onItem: (i: AutoItem) => void }) {
  const { settings } = useSettings();
  const active = st.grabs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state));
  // À choisir d'abord, puis ce qui bouge, puis le reste (le plus récent en haut)
  const rank = (i: AutoItem) => (i.needsChoice ? 0 : i.searching || i.active ? 1 : 2);
  const items = [...st.items].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      {active.map((g) => (
        <GrabRow key={g.id} g={g} reload={reload} compact />
      ))}

      <View style={styles.rowBetween}>
        <Text style={styles.h2}>Titres suivis ({st.items.length})</Text>
        <Pressable
          onPress={() =>
            autoApi
              .searchAll(settings)
              .then((r) => toast(r.message))
              .catch((e) => toast(e.message, 'error'))
          }
          hitSlop={8}
          style={styles.pill}>
          <Ionicons name="refresh" size={14} color={C.text} />
          <Text style={styles.pillTxt}>Tout chercher</Text>
        </Pressable>
      </View>
      {!st.items.length ? <Text style={styles.help}>Les demandes validées apparaissent ici dès que Lumio Auto est actif.</Text> : null}
      {items.map((i) => {
        const s = itemStatus(i, st.grabs);
        const r = i.lastReport;
        return (
          <Pressable key={i.id} onPress={() => onItem(i)} style={[styles.card, i.needsChoice && { borderWidth: 1, borderColor: C.warning }]}>
            <Ionicons name={i.type === 'movie' ? 'film-outline' : i.anime ? 'sparkles-outline' : 'tv-outline'} size={20} color={C.accent} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.title} numberOfLines={1}>
                {i.title}
                {i.year ? ` (${i.year})` : ''}
              </Text>
              <View style={styles.metaRow}>
                <View style={[styles.status, { borderColor: s.color }]}>
                  {i.searching ? <ActivityIndicator size="small" color={s.color} style={{ transform: [{ scale: 0.6 }] }} /> : <Ionicons name={s.icon} size={11} color={s.color} />}
                  <Text style={[styles.statusTxt, { color: s.color }]} numberOfLines={1}>
                    {s.label}
                  </Text>
                </View>
                <Text style={styles.small} numberOfLines={1}>
                  {i.type === 'tv' ? `S ${i.seasons.join(', ') || '—'} · ` : ''}
                  {lastPart(i.folderPath)}
                  {i.requestedBy.length ? ` · ${i.requestedBy.join(', ')}` : ''}
                </Text>
              </View>
              {r && !i.searching ? (
                <Text style={[styles.small, { color: r.kept ? C.success : C.warning }]} numberOfLines={2}>
                  {ago(r.at)} · {r.want} : {r.total} résultat(s)
                  {r.sites.length ? ` (${r.sites.map((x) => `${x.name} ${x.error ? 'erreur' : x.skipped ? 'limite' : x.count}`).join(', ')})` : ' (aucun indexeur)'}
                  {!r.kept && r.reasons.length ? ` · ${r.reasons.join(', ')}` : ''}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textDim} />
          </Pressable>
        );
      })}

      <Section title="Journal" id="auto-journal">
        {st.log.slice(0, 50).map((l, k) => (
          <Text key={k} style={[styles.log, l.level === 'error' && { color: C.danger }, l.level === 'warn' && { color: C.warning }]}>
            {new Date(l.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.msg}
          </Text>
        ))}
      </Section>
    </>
  );
}

/** Fiche d'un titre : où il en est, historique, recherches site par site, recherche interactive. */
function ItemSheet({ item, st, onClose, reload }: { item: AutoItem; st: AutoState; onClose: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [res, setRes] = useState<Awaited<ReturnType<typeof autoApi.releases>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(true);
  const [sort, setSort] = useState<'score' | 'size' | 'seeders' | 'age'>('score');
  const s = itemStatus(item, st.grabs);
  const grabs = st.grabs.filter((g) => g.itemId === item.id);

  const interactive = async (want?: AutoWant) => {
    setBusy(true);
    try {
      setRes(await autoApi.releases(settings, item.id, want?.season, want?.kind === 'episode' ? want.episode : undefined));
    } catch (e: any) {
      Alert.alert('Recherche', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // Rien trouvé automatiquement : on ouvre directement la recherche interactive
    if (item.needsChoice) interactive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const list = (res?.results ?? []).filter((r) => showRejected || !r.rejected);
    const key = (r: AutoRelease) => (sort === 'size' ? -r.size : sort === 'seeders' ? -(r.seeders ?? 0) : sort === 'age' ? r.ageDays ?? 9999 : 0);
    return sort === 'score' ? list : [...list].sort((a, b) => key(a) - key(b));
  }, [res, showRejected, sort]);

  const take = (r: AutoRelease) =>
    Alert.alert(
      r.rejected ? 'Version écartée par le profil' : 'Télécharger cette version ?',
      r.rejected ? `${r.title}\n\nRaisons : ${r.reasons.join(', ')}.\n\nLa télécharger quand même ?` : r.title,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: r.rejected ? 'Télécharger quand même' : 'Télécharger',
          onPress: () =>
            autoApi
              .grab(settings, item.id, r.guid)
              .then(() => (toast('Téléchargement lancé'), reload(), setRes(null)))
              .catch((e) => Alert.alert('Lumio Auto', e.message)),
        },
      ]
    );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1} numberOfLines={2}>
            {item.title}
            {item.year ? ` (${item.year})` : ''}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.status, { borderColor: s.color }]}>
            <Ionicons name={s.icon} size={11} color={s.color} />
            <Text style={[styles.statusTxt, { color: s.color }]}>{s.label}</Text>
          </View>
          <Text style={styles.small}>
            {item.type === 'tv' ? `Saisons ${item.seasons.join(', ') || '—'} · ` : ''}
            {lastPart(item.folderPath)}
            {item.requestedBy.length ? ` · demandé par ${item.requestedBy.join(', ')}` : ''}
          </Text>
        </View>
        <Text style={styles.dim}>
          {item.type === 'movie' && item.available === false ? `Pas encore sorti en vidéo${item.availableFrom ? ` (prévu le ${new Date(item.availableFrom).toLocaleDateString('fr-FR')})` : ''} · ` : ''}
          {item.note ?? 'en attente'}
          {item.lastSearch ? ` · dernière recherche ${ago(item.lastSearch)}` : ''}
          {item.nextSearch && !item.active ? ` · prochaine ${inMin(item.nextSearch)}` : ''}
          {item.imdbId ? ` · ${item.imdbId}` : ''}
        </Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Recherche interactive" icon="list" onPress={() => interactive()} loading={busy} style={{ flex: 1.3 }} small />
          <Button
            title="Auto"
            icon="flash"
            variant="secondary"
            small
            onPress={() => autoApi.searchItem(settings, item.id).then((r) => (toast(r.message), reload()))}
            style={{ flex: 0.8 }}
          />
          <Button title={item.paused ? 'Reprendre' : 'Pause'} icon={item.paused ? 'play' : 'pause'} variant="secondary" small onPress={() => autoApi.pauseItem(settings, item.id).then(reload)} style={{ flex: 1 }} />
        </View>

        {/* Recherche interactive, façon Radarr / Sonarr */}
        {res ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.h2}>Versions trouvées · {wantLabel(res.want)}</Text>
            {res.wanted.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {res.wanted.slice(0, 30).map((w, k) => (
                  <SegChip key={k} label={wantLabel(w)} on={wantLabel(w) === wantLabel(res.want)} onPress={() => interactive(w)} />
                ))}
              </ScrollView>
            ) : null}
            {res.status.map((x) => (
              <View key={x.name} style={styles.siteBox}>
                <Text style={[styles.small, { color: x.error ? C.danger : C.text, fontWeight: '700' }]}>
                  {x.name} : {x.error ? `erreur — ${x.error}` : x.skipped ? 'limite de requêtes atteinte, réessaie plus tard' : `${x.count} résultat(s)`}
                </Text>
                {(x.tries ?? []).map((t, k) => (
                  <Text key={k} style={styles.mono} numberOfLines={2}>
                    {t.query} → {t.error ? 'erreur' : t.skipped ? 'limite' : t.count}
                  </Text>
                ))}
              </View>
            ))}
            <View style={styles.metaRow}>
              {(['score', 'size', 'seeders', 'age'] as const).map((k) => (
                <SegChip key={k} label={{ score: 'Meilleures', size: 'Taille', seeders: 'Sources', age: 'Récentes' }[k]} on={sort === k} onPress={() => setSort(k)} />
              ))}
            </View>
            <Toggle label="Afficher aussi les versions écartées" value={showRejected} onChange={setShowRejected} />
            {!shown.length ? <Text style={styles.dim}>Aucune version. Vérifie les erreurs des sites ci-dessus.</Text> : null}
            {shown.map((r) => (
              <Pressable key={r.guid} onPress={() => take(r)} style={[styles.rel, r.rejected ? { opacity: 0.75 } : { borderColor: C.success }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.relTitle}>{r.title}</Text>
                  <View style={styles.metaRow}>
                    {r.quality ? <Text style={styles.tag}>{r.quality}</Text> : null}
                    {r.languages.map((l) => (
                      <Text key={l} style={[styles.tag, { color: C.accent }]}>
                        {l}
                      </Text>
                    ))}
                    {r.freeleech ? <Text style={[styles.tag, { color: C.success }]}>FREELEECH</Text> : null}
                    {r.matchedBy === 'identifiant' ? <Text style={[styles.tag, { color: C.success }]}>ID ✓</Text> : null}
                  </View>
                  <Text style={styles.small}>
                    {gb(r.size)} · ↑{r.seeders ?? '?'} ↓{r.leechers ?? '?'}
                    {r.ageDays != null ? ` · ${r.ageDays} j` : ''} · {r.indexer} · note {r.score}
                  </Text>
                  {r.reasons.length ? (
                    <View style={styles.metaRow}>
                      {r.reasons.map((x) => (
                        <Text key={x} style={[styles.tag, { color: C.danger, borderColor: 'rgba(255,69,58,0.4)' }]}>
                          {x}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
                <View style={[styles.dl, r.rejected ? { backgroundColor: C.surfaceHigh } : null]}>
                  <Ionicons name="download-outline" size={18} color={r.rejected ? C.textDim : '#fff'} />
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Dernière recherche automatique : site par site, requête par requête */}
        {item.lastReport && !res ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.h2}>Dernière recherche · {item.lastReport.want}</Text>
            {item.lastReport.sites.map((x) => (
              <View key={x.name} style={styles.siteBox}>
                <Text style={[styles.small, { color: x.error ? C.danger : C.text, fontWeight: '700' }]}>
                  {x.name} : {x.error ? `erreur — ${x.error}` : x.skipped ? 'limite atteinte' : `${x.count} résultat(s)`}
                </Text>
                {x.tries.map((t, k) => (
                  <Text key={k} style={styles.mono} numberOfLines={3}>
                    {t.query} → {t.error ?? (t.skipped ? 'limite' : t.count)}
                    {t.url ? `\n${t.url}` : ''}
                  </Text>
                ))}
              </View>
            ))}
            {item.lastReport.reasons.length ? <Text style={[styles.small, { color: C.warning }]}>Écartés : {item.lastReport.reasons.join(', ')}</Text> : null}
          </View>
        ) : null}

        {grabs.length ? <Text style={styles.h2}>Téléchargements</Text> : null}
        {grabs.slice(0, 6).map((g) => (
          <GrabRow key={g.id} g={g} reload={reload} />
        ))}

        <Text style={styles.h2}>Historique</Text>
        {!item.events.length ? <Text style={styles.dim}>Rien pour l’instant.</Text> : null}
        {item.events.map((e, k) => (
          <View key={k} style={styles.event}>
            <Ionicons name={EVENT_ICON[e.type]?.icon ?? 'ellipse'} size={16} color={EVENT_ICON[e.type]?.color ?? C.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTxt}>{e.msg}</Text>
              <Text style={styles.small}>
                {new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {e.indexer ? ` · ${e.indexer}` : ''}
                {e.size ? ` · ${gb(e.size)}` : ''}
                {e.by && e.by !== 'auto' ? ` · ${e.by === 'rss' ? 'veille RSS' : e.by}` : ''}
              </Text>
            </View>
          </View>
        ))}

        {item.type === 'tv' ? (
          <>
            <Toggle label="Suivre aussi les prochaines saisons" value={item.future} onChange={(v) => autoApi.updateItem(settings, item.id, { future: v }).then(reload)} />
            <Toggle label="Animé (numérotation absolue)" value={item.anime} onChange={(v) => autoApi.updateItem(settings, item.id, { anime: v }).then(reload)} />
          </>
        ) : null}
        <Button
          title="Ne plus suivre"
          icon="trash-outline"
          variant="danger"
          onPress={() =>
            Alert.alert('Ne plus suivre ce titre ?', 'Les fichiers déjà téléchargés restent dans la bibliothèque.', [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ne plus suivre', style: 'destructive', onPress: () => autoApi.removeItem(settings, item.id).then(() => (reload(), onClose())) },
            ])
          }
        />
      </ScrollView>
    </Modal>
  );
}

function Indexeurs({ st, reload, onEdit }: { st: AutoState; reload: () => void; onEdit: (ix: Partial<AutoIndexer> & { key?: string }) => void }) {
  return (
    <>
      <Text style={styles.help}>
        Lumio cherche d’abord par identifiant (TMDB / IMDb + saison / épisode) quand le site le permet, puis par le titre. Les adresses des sites passent par le DNS 1.1.1.1. Les clés restent sur le serveur.
      </Text>
      {st.indexers.map((ix) => (
        <IndexerRow key={ix.id} ix={ix} onEdit={() => onEdit(ix)} reload={reload} />
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {!st.indexers.some((x) => x.type === 'c411') ? (
          <Button title="C411" icon="add" small onPress={() => onEdit({ type: 'c411', name: 'C411', url: 'https://c411.org/api/torznab', enabled: true, rss: true, search: true, maxPerHour: 60 })} style={{ flex: 1 }} />
        ) : null}
        <Button title="Torznab" icon="add" variant="secondary" small onPress={() => onEdit({ type: 'torznab', enabled: true, rss: true, search: true, maxPerHour: 15 })} style={{ flex: 1 }} />
        <Button title="Prowlarr" icon="add" variant="secondary" small onPress={() => onEdit({ type: 'prowlarr', name: 'Prowlarr', url: 'http://prowlarr:9696', enabled: true, search: true, rss: false, maxPerHour: 30 })} style={{ flex: 1 }} />
      </View>
    </>
  );
}

function IndexerRow({ ix, onEdit, reload }: { ix: AutoIndexer; onEdit: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable onPress={onEdit} style={styles.card}>
      <Ionicons name={ix.type === 'prowlarr' ? 'layers-outline' : 'globe-outline'} size={20} color={ix.enabled ? C.accent : C.textDim} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>
          {ix.name} {ix.enabled ? '' : '(désactivé)'}
        </Text>
        <Text style={styles.small} numberOfLines={2}>
          {ix.type === 'prowlarr' ? 'Prowlarr' : ix.type === 'c411' ? 'C411 (Torznab)' : 'Torznab'} · {ix.rss ? 'veille RSS · ' : ''}
          {ix.callsLastHour}/{ix.maxPerHour} requêtes cette heure
          {ix.caps ? ` · par ID : ${[ix.caps.movie?.includes('tmdbid') ? 'films' : null, ix.caps.tv?.includes('tmdbid') || ix.caps.tv?.includes('imdbid') ? 'séries' : null].filter(Boolean).join(', ') || 'non'}` : ''}
        </Text>
        {ix.status ? (
          <Text style={[styles.small, { color: ix.status.ok ? C.success : C.danger }]} numberOfLines={3}>
            {ix.status.ok ? `OK (${ix.status.count ?? 0} résultats)` : `Erreur : ${ix.status.message}`} · {ago(ix.status.at)}
          </Text>
        ) : null}
      </View>
      <Pressable
        hitSlop={8}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await autoApi.testIndexer(settings, ix.id);
            Alert.alert(ix.name, `${r.ok ? `✅ ${r.message}` : `❌ ${r.message}`}\n\n${r.caps ?? ''}${r.url ? `\n\nAdresse appelée :\n${r.url}` : ''}${r.sample?.length ? `\n\nExemples :\n${r.sample.join('\n')}` : ''}`);
            reload();
          } catch (e: any) {
            Alert.alert(ix.name, e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        }}
        style={styles.pill}>
        {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.pillTxt}>Tester</Text>}
      </Pressable>
    </Pressable>
  );
}

function IndexerEditor({ ix, onClose, onSaved }: { ix: Partial<AutoIndexer> & { key?: string }; onClose: () => void; onSaved: () => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({ ...ix, key: '' });
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));
  const type = f.type ?? 'torznab';
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>{ix.id ? ix.name : type === 'c411' ? 'C411' : type === 'prowlarr' ? 'Prowlarr' : 'Nouvel indexeur'}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        {type === 'c411' ? (
          <View style={styles.siteBox}>
            <Text style={styles.small}>
              Sur c411.org : Mon compte → Intégrations → crée une clé API (ce n’est pas le passkey des torrents). Lumio appelle https://c411.org/api/torznab, au plus 15 requêtes par minute, en
              cherchant les séries par identifiant TMDB + saison / épisode.
            </Text>
            <Pressable onPress={() => Linking.openURL('https://c411.org')} hitSlop={6}>
              <Text style={[styles.small, { color: C.accent, marginTop: 6 }]}>Ouvrir c411.org</Text>
            </Pressable>
          </View>
        ) : null}
        <Field label="Nom" value={f.name ?? ''} onChangeText={(v) => set('name', v)} placeholder={type === 'prowlarr' ? 'Prowlarr' : 'Tr4ker'} />
        <Field
          label={type === 'prowlarr' ? 'Adresse de Prowlarr' : 'Adresse Torznab'}
          value={f.url ?? ''}
          onChangeText={(v) => set('url', v)}
          placeholder={type === 'prowlarr' ? 'http://prowlarr:9696' : 'https://site/api/torznab'}
          keyboardType="url"
          hint={type === 'prowlarr' ? 'Vue depuis le serveur Lumio : http://prowlarr:9696 (même docker compose).' : type === 'c411' ? 'Laisse https://c411.org/api/torznab.' : 'Le lien Torznab du site, ou d’un indexeur dans Prowlarr / Jackett.'}
        />
        <Field
          label={`${type === 'prowlarr' ? 'Clé API Prowlarr' : 'Clé API'}${ix.hasKey ? ' · enregistrée ✓' : ''}`}
          value={f.key}
          onChangeText={(v) => set('key', v)}
          placeholder={ix.hasKey ? 'Coller pour remplacer' : 'Coller ici'}
          secureTextEntry
        />
        <Toggle label="Activé" value={f.enabled !== false} onChange={(v) => set('enabled', v)} />
        <Toggle label="Recherche des titres qui manquent" value={f.search !== false} onChange={(v) => set('search', v)} />
        {type !== 'prowlarr' ? <Toggle label="Veille RSS (nouvelles sorties)" value={f.rss !== false} onChange={(v) => set('rss', v)} /> : null}
        <Picker
          label="Requêtes maximum par heure"
          options={[15, 30, 60, 120, 300].map((n) => ({ value: n, label: String(n) }))}
          value={f.maxPerHour ?? 15}
          onChange={(v) => set('maxPerHour', v)}
        />
        <Section title="Catégories (avancé)" id="auto-cats">
          <Field label="Films" value={f.catMovie ?? ''} onChangeText={(v) => set('catMovie', v)} placeholder="2000" keyboardType="numbers-and-punctuation" />
          <Field label="Séries" value={f.catTv ?? ''} onChangeText={(v) => set('catTv', v)} placeholder="5000" keyboardType="numbers-and-punctuation" />
          <Field label="Séries animées" value={f.catAnime ?? ''} onChangeText={(v) => set('catAnime', v)} placeholder="5070" keyboardType="numbers-and-punctuation" />
        </Section>
        <Button
          title="Enregistrer"
          icon="checkmark"
          onPress={async () => {
            try {
              await autoApi.saveIndexer(settings, { ...f, key: f.key || undefined });
              toast('Indexeur enregistré : touche « Tester »');
              onSaved();
              onClose();
            } catch (e: any) {
              Alert.alert('Indexeur', e?.message ?? String(e));
            }
          }}
        />
        {ix.id ? (
          <Button
            title="Supprimer"
            icon="trash-outline"
            variant="danger"
            style={{ marginTop: 10 }}
            onPress={() =>
              Alert.alert('Supprimer cet indexeur ?', undefined, [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Supprimer', style: 'destructive', onPress: () => autoApi.removeIndexer(settings, ix.id!).then(() => (onSaved(), onClose())) },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function Blocklist() {
  const { settings } = useSettings();
  const [list, setList] = useState<{ key: string; title: string | null; indexer?: string | null; reason?: string | null; at?: string }[] | null>(null);
  const load = () => autoApi.blocklist(settings).then((r) => setList(r.blocked)).catch(() => setList([]));
  return (
    <Section title="Liste noire" id="auto-block">
      <Text style={styles.help}>Versions en échec ou annulées : Lumio ne les reprend plus. Retire-en une pour qu’elle soit de nouveau proposée.</Text>
      {list === null ? <Button title="Afficher" icon="eye-outline" variant="secondary" small onPress={load} /> : null}
      {list?.length === 0 ? <Text style={styles.dim}>Vide.</Text> : null}
      {list?.map((b) => (
        <View key={b.key} style={[styles.card, { marginBottom: 6 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.relTitle}>{b.title ?? b.key}</Text>
            <Text style={styles.small}>
              {b.reason ?? 'échec'}
              {b.indexer ? ` · ${b.indexer}` : ''}
              {b.at ? ` · ${ago(b.at)}` : ''}
            </Text>
          </View>
          <Pressable hitSlop={8} onPress={() => autoApi.unblockOne(settings, b.key).then(load)}>
            <Ionicons name="close-circle" size={22} color={C.textDim} />
          </Pressable>
        </View>
      ))}
    </Section>
  );
}


// ——— Téléchargements : file d'attente et historique, comme l'onglet Activité de Radarr / Sonarr ———
const fmtSpeed = (b?: number) => (!b ? '—' : b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo/s` : `${Math.round(b / 1e3)} ko/s`);
const fmtEta = (sec?: number | null) => {
  if (sec == null || sec <= 0) return '—';
  const m = Math.round(sec / 60);
  return m < 1 ? '< 1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const epLabel = (g: AutoGrab) =>
  g.episodes[0] === 'movie'
    ? 'Film'
    : g.episodes.length > 1
      ? `S${g.episodes[0].split(':')[0].padStart(2, '0')} · ${g.episodes.length} épisodes`
      : `S${g.episodes[0].split(':')[0].padStart(2, '0')}E${g.episodes[0].split(':')[1].padStart(2, '0')}`;
const grabColor = (g: AutoGrab) => (g.paused ? C.textDim : /bloqué|erreur|manquants/.test(g.statusText ?? '') ? C.warning : STATE_COLOR[g.state]);
const grabStatus = (g: AutoGrab) =>
  g.paused ? 'En pause' : g.state === 'downloading' ? (g.statusText ? g.statusText[0].toUpperCase() + g.statusText.slice(1) : 'Téléchargement') : STATE_LABEL[g.state][0].toUpperCase() + STATE_LABEL[g.state].slice(1);

function Telechargements({ st, reload, onItem }: { st: AutoState; reload: () => void; onItem: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'done' | 'failed'>('all');
  const queue = st.grabs.filter((g) => RUNNING.includes(g.state));
  const history = st.grabs.filter((g) => !RUNNING.includes(g.state) && (filter === 'all' || g.state === filter));
  const speed = queue.reduce((n, g) => n + (g.paused ? 0 : g.speed || 0), 0);
  const left = queue.reduce((n, g) => n + Math.max(0, (g.size || g.release.size || 0) - (g.downloaded || 0)), 0);
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.h2}>File d’attente ({queue.length})</Text>
        {queue.length ? (
          <Text style={styles.small}>
            ↓ {fmtSpeed(speed)} · reste {gb(left)}
          </Text>
        ) : null}
      </View>
      {!queue.length ? <Text style={styles.help}>Rien en cours. Les versions envoyées à {st.client === 'alldebrid' ? 'AllDebrid' : 'rdt-client'} apparaissent ici, mises à jour toutes les 10 secondes.</Text> : null}
      {queue.map((g) => (
        <GrabRow key={g.id} g={g} reload={reload} onItem={onItem} />
      ))}

      <View style={[styles.rowBetween, { marginTop: 8 }]}>
        <Text style={styles.h2}>Historique</Text>
      </View>
      <View style={styles.metaRow}>
        <SegChip label="Tout" on={filter === 'all'} onPress={() => setFilter('all')} />
        <SegChip label="Rangés" on={filter === 'done'} onPress={() => setFilter('done')} icon="checkmark-circle-outline" />
        <SegChip label="Échecs" on={filter === 'failed'} onPress={() => setFilter('failed')} icon="alert-circle-outline" />
      </View>
      {!history.length ? <Text style={styles.dim}>Rien ici.</Text> : null}
      {history.slice(0, 40).map((g) => (
        <GrabRow key={g.id} g={g} reload={reload} onItem={onItem} />
      ))}
    </>
  );
}

function GrabRow({ g, reload, onItem, compact }: { g: AutoGrab; reload: () => void; onItem?: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const running = RUNNING.includes(g.state);
  const color = grabColor(g);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.card}>
        <Ionicons
          name={g.paused ? 'pause-circle' : g.state === 'done' ? 'checkmark-circle' : g.state === 'failed' ? 'alert-circle' : g.state === 'importing' ? 'folder-open' : 'cloud-download'}
          size={22}
          color={color}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.title} numberOfLines={1}>
            {g.title} · {epLabel(g)}
          </Text>
          {!compact ? (
            <Text style={styles.small} numberOfLines={1}>
              {g.release.title}
            </Text>
          ) : null}
          <Text style={styles.small} numberOfLines={2}>
            <Text style={{ color, fontWeight: '700' }}>{grabStatus(g)}</Text>
            {running && g.state === 'downloading' && !g.paused ? ` · ${g.progress}% · ${fmtSpeed(g.speed)} · ${fmtEta(g.eta)}` : ''}
            {!running ? ` · ${ago(g.doneAt || g.startedAt)}` : ''}
            {g.error ? ` · ${g.error}` : ''}
          </Text>
          {running ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${g.progress || 2}%`, backgroundColor: g.paused ? C.textDim : C.accent }]} />
            </View>
          ) : null}
        </View>
        <Ionicons name="ellipsis-horizontal" size={18} color={C.textDim} />
      </Pressable>
      {open ? <GrabSheet g={g} onClose={() => setOpen(false)} reload={reload} onItem={onItem} /> : null}
    </>
  );
}

/** Détail d'un téléchargement + actions : pause, reprise, rangement manuel, retrait (avec options). */
function GrabSheet({ g, onClose, reload, onItem }: { g: AutoGrab; onClose: () => void; reload: () => void; onItem?: (id: string) => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const running = RUNNING.includes(g.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [rm, setRm] = useState({ client: true, blocklist: running, search: running });
  const [askRemove, setAskRemove] = useState(false);
  const act = async (key: string, fn: () => Promise<any>, msg?: string, close = false) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(r?.message ?? msg ?? 'OK');
      reload();
      if (close) onClose();
    } catch (e: any) {
      Alert.alert('Téléchargement', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };
  const size = g.size || g.release.size || 0;
  const rows: [string, string][] = [
    ['État', grabStatus(g)],
    ['Avancement', running ? `${g.progress}%${g.downloaded ? ` · ${gb(g.downloaded)} sur ${gb(size)}` : ''}` : g.state === 'done' ? '100%' : '—'],
    ['Taille', gb(size)],
    ...(running ? ([['Vitesse', fmtSpeed(g.speed)], ['Temps restant', fmtEta(g.eta)]] as [string, string][]) : []),
    ['Contenu', epLabel(g)],
    ['Indexeur', g.release.indexer],
    ['Sources', g.release.seeders != null ? String(g.release.seeders) : '—'],
    ['Client', g.client === 'alldebrid' ? 'AllDebrid (direct)' : `rdt-client${g.clientState ? ` · ${g.clientState}` : ''}`],
    ['Lancé', `${new Date(g.startedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${g.by && g.by !== 'auto' ? ` par ${g.by === 'rss' ? 'la veille RSS' : g.by}` : ' automatiquement'}`],
    ...(g.doneAt ? ([['Terminé', new Date(g.doneAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })]] as [string, string][]) : []),
  ];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1} numberOfLines={2}>
            {g.title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <Text style={styles.relTitle} selectable>
          {g.release.title}
        </Text>
        {running ? (
          <View style={[styles.bar, { height: 8, borderRadius: 4 }]}>
            <View style={[styles.barFill, { height: 8, width: `${g.progress || 2}%`, backgroundColor: g.paused ? C.textDim : C.accent }]} />
          </View>
        ) : null}
        {g.error ? (
          <View style={[styles.siteBox, { borderWidth: 1, borderColor: 'rgba(255,69,58,0.4)' }]}>
            <Text style={[styles.small, { color: C.danger, fontWeight: '700' }]}>{g.error}</Text>
            {/^import/.test(g.error) ? (
              <Text style={styles.small}>Le téléchargement est fini mais Lumio n’a pas su le ranger. Vérifie le nom des fichiers, puis « Réessayer le rangement ».</Text>
            ) : /introuvables/.test(g.error) ? (
              <Text style={styles.small}>Vérifie dans Réglages → rdt-client le « chemin vu par rdt-client » et le disque / dossier.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.siteBox}>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.kv}>
              <Text style={styles.kvK}>{k}</Text>
              <Text style={styles.kvV}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {running && g.client === 'rdt' && g.state !== 'importing' ? (
            <Button
              title={g.paused ? 'Reprendre' : 'Pause'}
              icon={g.paused ? 'play' : 'pause'}
              variant="secondary"
              small
              loading={busy === 'pause'}
              onPress={() => act('pause', () => (g.paused ? autoApi.resumeGrab(settings, g.id) : autoApi.pauseGrab(settings, g.id)), g.paused ? 'Repris' : 'En pause')}
              style={{ flex: 1 }}
            />
          ) : null}
          {g.state === 'failed' && g.importSrc ? (
            <Button title="Réessayer le rangement" icon="folder-open" small loading={busy === 'import'} onPress={() => act('import', () => autoApi.retryImport(settings, g.id), undefined, true)} style={{ flex: 1 }} />
          ) : null}
          {onItem ? (
            <Button
              title="Voir le titre"
              icon="film-outline"
              variant="secondary"
              small
              onPress={() => {
                onClose();
                onItem(g.itemId);
              }}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>

        {!askRemove ? (
          <Button title={running ? 'Retirer de la file…' : 'Retirer de l’historique…'} icon="trash-outline" variant="danger" onPress={() => setAskRemove(true)} />
        ) : (
          <View style={[styles.siteBox, { gap: 2 }]}>
            <Text style={[styles.title, { marginBottom: 4 }]}>{running ? 'Retirer de la file' : 'Retirer de l’historique'}</Text>
            {running ? <Toggle label={`Supprimer aussi dans ${g.client === 'alldebrid' ? 'AllDebrid' : 'rdt-client'} (et les fichiers)`} value={rm.client} onChange={(v) => setRm((o) => ({ ...o, client: v }))} /> : null}
            <Toggle label="Mettre cette version en liste noire" value={rm.blocklist} onChange={(v) => setRm((o) => ({ ...o, blocklist: v }))} />
            <Toggle label="Chercher une autre version tout de suite" value={rm.search} onChange={(v) => setRm((o) => ({ ...o, search: v }))} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button title="Annuler" variant="secondary" small onPress={() => setAskRemove(false)} style={{ flex: 1 }} />
              <Button title="Retirer" icon="trash-outline" variant="danger" small loading={busy === 'rm'} onPress={() => act('rm', () => autoApi.removeGrab(settings, g.id, rm), 'Retiré', true)} style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

function Reglages({ st, save }: { st: AutoState; save: (b: any, msg?: string) => void }) {
  const { settings } = useSettings();
  const [rdt, setRdt] = useState({ ...st.rdt, pass: '' });
  const [pf, setPf] = useState(st.profile);
  const setP = (k: keyof typeof pf, v: any) => setPf((o) => ({ ...o, [k]: v }));
  return (
    <>
      <Section title="Profil de qualité" defaultOpen id="auto-profil">
        <Picker label="Résolution" options={[720, 1080, 2160].map((n) => ({ value: n, label: `${n}p` }))} value={pf.resolution} onChange={(v) => setP('resolution', v)} />
        <Picker
          label="Codec"
          options={[
            { value: 'required', label: 'H.265 obligatoire', hint: 'fichiers légers' },
            { value: 'preferred', label: 'H.265 de préférence' },
            { value: 'any', label: 'Peu importe' },
          ]}
          value={pf.h265}
          onChange={(v) => setP('h265', v)}
        />
        <Text style={styles.label}>Langues acceptées (dans l’ordre de préférence)</Text>
        <View style={styles.chips}>
          {LANGS.map((l) => {
            const on = pf.languages.includes(l.value);
            return (
              <SegChip
                key={l.value}
                label={on ? `${pf.languages.indexOf(l.value) + 1}. ${l.label}` : l.label}
                on={on}
                onPress={() => setP('languages', on ? pf.languages.filter((x) => x !== l.value) : [...pf.languages, l.value])}
              />
            );
          })}
        </View>
        <Text style={styles.help}>Les versions VOSTFR seules, les copies de cinéma (CAM, TS) et les REMUX sont toujours écartées.</Text>
        <Picker label="Taille maximale d’un film" options={[4, 6, 8, 12, 20].map((n) => ({ value: n, label: `${n} Go` }))} value={pf.maxMovieGb} onChange={(v) => setP('maxMovieGb', v)} />
        <Picker label="Taille maximale d’un épisode" options={[1, 1.5, 2.5, 4, 6].map((n) => ({ value: n, label: `${String(n).replace('.', ',')} Go` }))} value={pf.maxEpisodeGb} onChange={(v) => setP('maxEpisodeGb', v)} />
        <Toggle label="Accepter le 720p si rien en 1080p" value={pf.allowLower} onChange={(v) => setP('allowLower', v)} />
        <Picker label="Téléchargements en même temps" options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} value={pf.maxActive} onChange={(v) => setP('maxActive', v)} />
        <Picker label="Nouvelle recherche des titres manquants" options={[30, 60, 120, 360].map((n) => ({ value: n, label: n < 60 ? `${n} min` : `${n / 60} h` }))} value={pf.searchEveryMin} onChange={(v) => setP('searchEveryMin', v)} />
        <Picker label="Veille RSS" options={[15, 20, 30, 60].map((n) => ({ value: n, label: `${n} min` }))} value={pf.rssEveryMin} onChange={(v) => setP('rssEveryMin', v)} />
        <Button title="Enregistrer le profil" icon="checkmark" onPress={() => save({ profile: pf }, 'Profil enregistré')} />
      </Section>

      <Section title="Téléchargement" defaultOpen id="auto-client">
        <Picker
          label="Envoyer à"
          options={[
            { value: 'rdt', label: 'rdt-client', hint: 'comme Radarr / Sonarr' },
            { value: 'alldebrid', label: 'AllDebrid direct', hint: st.alldebrid ? 'clé présente' : 'clé manquante' },
          ]}
          value={st.client}
          onChange={(v) => save({ client: v })}
        />
        {st.client === 'rdt' ? (
          <>
            <Field label="Adresse de rdt-client" value={rdt.url} onChangeText={(v) => setRdt((o) => ({ ...o, url: v }))} placeholder="http://rdtclient:6500" keyboardType="url" />
            <Field label="Identifiant rdt-client" value={rdt.user} onChangeText={(v) => setRdt((o) => ({ ...o, user: v }))} />
            <Field label={`Mot de passe${st.rdt.hasPass ? ' · enregistré ✓' : ''}`} value={rdt.pass} onChangeText={(v) => setRdt((o) => ({ ...o, pass: v }))} secureTextEntry placeholder={st.rdt.hasPass ? 'Coller pour remplacer' : ''} />
            <Field label="Catégorie" value={rdt.category} onChangeText={(v) => setRdt((o) => ({ ...o, category: v }))} placeholder="lumio" hint="rdt-client range les fichiers de Lumio Auto dans ce sous-dossier." />
            <Field
              label="Dossier des téléchargements vu par rdt-client"
              value={rdt.remotePath}
              onChangeText={(v) => setRdt((o) => ({ ...o, remotePath: v }))}
              placeholder="/data/downloads"
              hint="Le même que dans le « Remote Path Mapping » de Radarr."
            />
            <Picker label="Le même dossier, vu par Lumio : disque" options={st.disks.map((d) => ({ value: d, label: d }))} value={rdt.localRoot} onChange={(v) => setRdt((o) => ({ ...o, localRoot: v }))} />
            <Field label="… et dossier sur ce disque" value={rdt.localFolder} onChangeText={(v) => setRdt((o) => ({ ...o, localFolder: v }))} placeholder="downloads" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Enregistrer" icon="checkmark" onPress={() => save({ rdt: { ...rdt, pass: rdt.pass || undefined } }, 'rdt-client enregistré')} style={{ flex: 1 }} />
              <Button
                title="Tester"
                icon="pulse"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() =>
                  autoApi
                    .testClient(settings)
                    .then((r) => Alert.alert('rdt-client', r.message))
                    .catch((e) => Alert.alert('rdt-client', e.message))
                }
              />
            </View>
          </>
        ) : (
          <Text style={styles.help}>Les torrents sont envoyés à AllDebrid avec la clé du serveur, téléchargés dans un dossier caché du disque, puis rangés dans la bibliothèque.</Text>
        )}
      </Section>

      <Section title="Dossiers par défaut" id="auto-folders">
        <Picker label="Films" options={st.folders.movie.map((f) => ({ value: f.path, label: `${f.name}`, hint: f.root }))} value={st.folders.defaults.movie ?? st.folders.movie[0]?.path} onChange={(v) => save({ folders: { ...st.folders.defaults, movie: v } })} />
        <Picker label="Séries" options={st.folders.tv.map((f) => ({ value: f.path, label: `${f.name}`, hint: f.root }))} value={st.folders.defaults.tv ?? st.folders.tv[0]?.path} onChange={(v) => save({ folders: { ...st.folders.defaults, tv: v } })} />
        <Text style={styles.help}>Le dossier choisi dans une demande (Films, Kids, Séries, Animés…) est toujours respecté.</Text>
      </Section>

      <Blocklist />
      <Button title="Vider toute la liste noire" icon="refresh" variant="secondary" onPress={() => autoApi.unblock(settings).then(() => toast('Liste noire vidée'))} />
    </>
  );
}


const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, borderWidth: 1.5, backgroundColor: C.surface },
  bannerTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 2 },
  h1: { color: C.text, fontSize: 22, fontWeight: '800', flex: 1 },
  h2: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  help: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  label: { color: C.textDim, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.surface },
  title: { color: C.text, fontSize: 15, fontWeight: '700' },
  relTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: C.surfaceHigh },
  pillTxt: { color: C.text, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  bar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 4 },
  barFill: { height: 5, backgroundColor: C.accent },
  log: { color: C.textDim, fontSize: 12, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  statusTxt: { fontSize: 11, fontWeight: '800' },
  small: { color: C.textDim, fontSize: 12, lineHeight: 17 },
  mono: { color: C.textDim, fontSize: 11, lineHeight: 16, fontFamily: 'Menlo' },
  siteBox: { padding: 12, borderRadius: 16, backgroundColor: C.surface, gap: 4 },
  rel: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: 'transparent' },
  tag: { color: C.text, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  kvK: { color: C.textDim, fontSize: 13 },
  kvV: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  dl: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventTxt: { color: C.text, fontSize: 13, lineHeight: 18 },
});
