// Lumio Auto (bêta, admin) : réglages, indexeurs, titres suivis, téléchargements et recherche manuelle.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Picker, Toggle } from '@/components/arr-section';
import { toast } from '@/components/toast';
import { Button, Field, ScreenTitle, Section, SegChip } from '@/components/ui';
import { C } from '@/constants/theme';
import { autoApi, gb, type AutoGrab, type AutoIndexer, type AutoItem, type AutoRelease, type AutoState, type AutoWant } from '@/lib/auto';
import { useSettings } from '@/lib/settings';

type Tab = 'suivi' | 'indexeurs' | 'reglages';
const STATE_LABEL: Record<AutoGrab['state'], string> = { sent: 'envoyé', downloading: 'téléchargement', importing: 'rangement', done: 'terminé', failed: 'échec' };
const STATE_COLOR: Record<AutoGrab['state'], string> = { sent: C.warning, downloading: C.accent, importing: C.accent, done: C.success, failed: C.danger };
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

export default function AutoScreen() {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('suivi');
  const [st, setSt] = useState<AutoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editIx, setEditIx] = useState<Partial<AutoIndexer> & { key?: string } | null>(null);
  const [itemOpen, setItemOpen] = useState<AutoItem | null>(null);

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
    const t = setInterval(load, 5000);
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <ScreenTitle title="Lumio Auto" onBack={() => router.back()} />
      <View style={styles.tabs}>
        <SegChip label="Suivi" on={tab === 'suivi'} onPress={() => setTab('suivi')} icon="pulse" />
        <SegChip label="Indexeurs" on={tab === 'indexeurs'} onPress={() => setTab('indexeurs')} icon="search" />
        <SegChip label="Réglages" on={tab === 'reglages'} onPress={() => setTab('reglages')} icon="options" />
      </View>
      {!st ? (
        <View style={styles.center}>
          {error ? <Text style={styles.dim}>{error.includes('404') ? 'Le serveur Lumio doit être mis à jour (3.62.0 ou plus) : Profil → Serveur → Mettre à jour.' : error}</Text> : <ActivityIndicator color="#fff" />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 60 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.text} />}>
          <View style={[styles.banner, { borderColor: st.enabled ? C.success : C.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{st.enabled ? 'Actif' : 'Désactivé'}</Text>
              <Text style={styles.dim}>
                {st.enabled
                  ? 'Les demandes validées passent par Lumio Auto. Tu peux mettre Radarr et Sonarr en pause.'
                  : 'Les demandes passent encore par Radarr et Sonarr. Ajoute au moins un indexeur et règle le téléchargement, puis active.'}
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

          {tab === 'suivi' ? <Suivi st={st} reload={load} onItem={setItemOpen} /> : null}
          {tab === 'indexeurs' ? (
            <>
              <Text style={styles.help}>
                Sites Torznab (C411, Tr4ker, Jackett…) : colle l’adresse Torznab et ta clé API (ou passkey). Prowlarr est aussi possible, il regroupe tous ses indexeurs. Les clés restent sur le serveur.
              </Text>
              {st.indexers.map((ix) => (
                <IndexerRow key={ix.id} ix={ix} onEdit={() => setEditIx(ix)} reload={load} />
              ))}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Indexeur Torznab" icon="add" onPress={() => setEditIx({ type: 'torznab', enabled: true, rss: true, search: true, maxPerHour: 15 })} style={{ flex: 1 }} />
                <Button title="Prowlarr" icon="add" variant="secondary" onPress={() => setEditIx({ type: 'prowlarr', name: 'Prowlarr', enabled: true, search: true, rss: false, maxPerHour: 30 })} style={{ flex: 1 }} />
              </View>
            </>
          ) : null}
          {tab === 'reglages' ? <Reglages st={st} save={save} /> : null}
        </ScrollView>
      )}
      {editIx ? <IndexerEditor ix={editIx} onClose={() => setEditIx(null)} onSaved={load} /> : null}
      {itemOpen ? <ItemSheet item={itemOpen} st={st} onClose={() => setItemOpen(null)} reload={load} /> : null}
    </View>
  );
}

function Suivi({ st, reload, onItem }: { st: AutoState; reload: () => void; onItem: (i: AutoItem) => void }) {
  const { settings } = useSettings();
  const active = st.grabs.filter((g) => ['sent', 'downloading', 'importing'].includes(g.state));
  const recent = st.grabs.filter((g) => !['sent', 'downloading', 'importing'].includes(g.state)).slice(0, 12);
  return (
    <>
      <Text style={styles.h2}>En cours</Text>
      {active.length ? active.map((g) => <GrabRow key={g.id} g={g} reload={reload} />) : <Text style={styles.dim}>Aucun téléchargement en cours.</Text>}

      <View style={styles.rowBetween}>
        <Text style={styles.h2}>Suivis ({st.items.length})</Text>
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
      <Text style={styles.help}>Les demandes validées s’ajoutent ici toutes seules. Touche un titre pour voir les versions trouvées, choisir les saisons ou forcer une version.</Text>
      {st.items.map((i) => (
        <Pressable key={i.id} onPress={() => onItem(i)} style={styles.card}>
          <Ionicons name={i.type === 'movie' ? 'film-outline' : i.anime ? 'sparkles-outline' : 'tv-outline'} size={20} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {i.title}
              {i.year ? ` (${i.year})` : ''}
            </Text>
            <Text style={styles.dim} numberOfLines={2}>
              {i.paused ? 'En pause · ' : ''}
              {i.type === 'tv' ? `Saisons ${i.seasons.join(', ') || '—'} · ` : ''}
              {lastPart(i.folderPath)} · {i.note ?? 'en attente'}
              {i.nextSearch && !i.active ? ` · prochaine recherche ${inMin(i.nextSearch)}` : ''}
            </Text>
          </View>
          {i.active ? <ActivityIndicator color={C.accent} /> : <Ionicons name="chevron-forward" size={16} color={C.textDim} />}
        </Pressable>
      ))}

      {recent.length ? <Text style={styles.h2}>Derniers</Text> : null}
      {recent.map((g) => (
        <GrabRow key={g.id} g={g} reload={reload} />
      ))}

      <Section title="Journal" id="auto-journal">
        {st.log.slice(0, 40).map((l, k) => (
          <Text key={k} style={[styles.log, l.level === 'error' && { color: C.danger }]}>
            {new Date(l.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.msg}
          </Text>
        ))}
      </Section>
    </>
  );
}

function GrabRow({ g, reload }: { g: AutoGrab; reload: () => void }) {
  const { settings } = useSettings();
  const running = ['sent', 'downloading', 'importing'].includes(g.state);
  return (
    <View style={styles.card}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={1}>
          {g.title}
          {g.episodes[0] !== 'movie' ? ` · ${g.episodes.length > 1 ? `${g.episodes.length} épisodes` : `S${g.episodes[0].split(':')[0].padStart(2, '0')}E${g.episodes[0].split(':')[1].padStart(2, '0')}`}` : ''}
        </Text>
        <Text style={styles.dim} numberOfLines={1}>
          {g.release.title}
        </Text>
        <Text style={styles.dim}>
          <Text style={{ color: STATE_COLOR[g.state], fontWeight: '700' }}>{STATE_LABEL[g.state]}</Text>
          {running && g.state === 'downloading' ? ` · ${g.progress}%` : ''} · {gb(g.release.size)} · {g.release.indexer} · {g.client === 'alldebrid' ? 'AllDebrid' : 'rdt-client'} · {ago(g.doneAt || g.startedAt)}
          {g.error ? ` · ${g.error}` : ''}
        </Text>
        {running ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${g.progress || 2}%` }]} />
          </View>
        ) : null}
      </View>
      <Pressable
        hitSlop={8}
        onPress={() =>
          Alert.alert(running ? 'Annuler ce téléchargement ?' : 'Retirer de la liste ?', running ? 'Cette version sera écartée et une autre sera cherchée.' : undefined, [
            { text: 'Non', style: 'cancel' },
            { text: running ? 'Annuler' : 'Retirer', style: 'destructive', onPress: () => autoApi.cancelGrab(settings, g.id).then(reload).catch((e) => toast(e.message, 'error')) },
          ])
        }>
        <Ionicons name={running ? 'close-circle' : 'trash-outline'} size={22} color={C.textDim} />
      </Pressable>
    </View>
  );
}

function IndexerRow({ ix, onEdit, reload }: { ix: AutoIndexer; onEdit: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable onPress={onEdit} style={styles.card}>
      <Ionicons name={ix.type === 'prowlarr' ? 'layers-outline' : 'globe-outline'} size={20} color={ix.enabled ? C.accent : C.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {ix.name} {ix.enabled ? '' : '(désactivé)'}
        </Text>
        <Text style={styles.dim} numberOfLines={2}>
          {ix.type === 'prowlarr' ? 'Prowlarr' : 'Torznab'} · {ix.rss ? 'veille RSS · ' : ''}
          {ix.search ? 'recherche · ' : ''}
          {ix.callsLastHour}/{ix.maxPerHour} requêtes cette heure
          {ix.status ? ` · ${ix.status.ok ? `OK (${ix.status.count ?? 0})` : `erreur : ${ix.status.message}`} ${ago(ix.status.at)}` : ''}
        </Text>
      </View>
      <Pressable
        hitSlop={8}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await autoApi.testIndexer(settings, ix.id);
            Alert.alert(ix.name, r.ok ? `${r.message}${r.sample?.length ? `\n\n${r.sample.join('\n')}` : ''}` : `Erreur : ${r.message}`);
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
  const prowlarr = f.type === 'prowlarr';
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.rowBetween}>
          <Text style={styles.h1}>{ix.id ? ix.name : prowlarr ? 'Prowlarr' : 'Nouvel indexeur'}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <Field label="Nom" value={f.name ?? ''} onChangeText={(v) => set('name', v)} placeholder={prowlarr ? 'Prowlarr' : 'C411'} />
        <Field
          label={prowlarr ? 'Adresse de Prowlarr' : 'Adresse Torznab'}
          value={f.url ?? ''}
          onChangeText={(v) => set('url', v)}
          placeholder={prowlarr ? 'http://prowlarr:9696' : 'https://c411.org/api'}
          keyboardType="url"
          hint={prowlarr ? 'L’adresse vue depuis le serveur Lumio (dans Docker : http://prowlarr:9696).' : 'Le lien Torznab du site (ou celui d’un indexeur dans Prowlarr / Jackett).'}
        />
        <Field
          label={`${prowlarr ? 'Clé API Prowlarr' : 'Clé API / passkey'}${ix.hasKey ? ' · enregistrée ✓' : ''}`}
          value={f.key}
          onChangeText={(v) => set('key', v)}
          placeholder={ix.hasKey ? 'Coller pour remplacer' : 'Coller ici'}
          secureTextEntry
        />
        <Toggle label="Activé" value={f.enabled !== false} onChange={(v) => set('enabled', v)} />
        <Toggle label="Recherche des titres qui manquent" value={f.search !== false} onChange={(v) => set('search', v)} />
        {!prowlarr ? <Toggle label="Veille RSS (nouvelles sorties)" value={f.rss !== false} onChange={(v) => set('rss', v)} /> : null}
        <Picker
          label="Requêtes maximum par heure (évite d’être bloqué par le site)"
          options={[5, 10, 15, 30, 60].map((n) => ({ value: n, label: String(n) }))}
          value={f.maxPerHour ?? 15}
          onChange={(v) => set('maxPerHour', v)}
        />
        <Section title="Catégories (avancé)" id="auto-cats">
          <Field label="Films" value={f.catMovie ?? ''} onChangeText={(v) => set('catMovie', v)} placeholder="2000" keyboardType="numbers-and-punctuation" />
          <Field label="Séries" value={f.catTv ?? ''} onChangeText={(v) => set('catTv', v)} placeholder="5000" keyboardType="numbers-and-punctuation" />
          <Field label="Animés" value={f.catAnime ?? ''} onChangeText={(v) => set('catAnime', v)} placeholder="5070" keyboardType="numbers-and-punctuation" />
        </Section>
        <Button
          title="Enregistrer"
          icon="checkmark"
          onPress={async () => {
            try {
              await autoApi.saveIndexer(settings, { ...f, key: f.key || undefined });
              toast('Indexeur enregistré');
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

      <Button title="Réessayer les versions écartées" icon="refresh" variant="secondary" onPress={() => autoApi.unblock(settings).then(() => toast('Liste des versions écartées vidée'))} />
    </>
  );
}

function ItemSheet({ item, st, onClose, reload }: { item: AutoItem; st: AutoState | null; onClose: () => void; reload: () => void }) {
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [res, setRes] = useState<{ want: AutoWant; wanted: AutoWant[]; status: { name: string; count: number; error?: string; skipped?: boolean }[]; results: AutoRelease[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const cur = st?.items.find((i) => i.id === item.id) ?? item;

  const search = async (season?: number, episode?: number) => {
    setBusy(true);
    try {
      setRes(await autoApi.releases(settings, item.id, season, episode));
    } catch (e: any) {
      Alert.alert('Recherche', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const wantLabel = (w: AutoWant) =>
    w.kind === 'movie' ? 'Film' : w.kind === 'season' ? `Saison ${w.season} complète` : `S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}`;
  const shown = (res?.results ?? []).filter((r) => showRejected || !r.rejected);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.rowBetween}>
          <Text style={styles.h1} numberOfLines={2}>
            {cur.title}
            {cur.year ? ` (${cur.year})` : ''}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close-circle" size={28} color={C.textDim} />
          </Pressable>
        </View>
        <Text style={styles.dim}>
          {cur.type === 'movie' ? (cur.available ? 'Sorti en vidéo' : `Pas encore sorti en vidéo${cur.availableFrom ? ` (prévu le ${new Date(cur.availableFrom).toLocaleDateString('fr-FR')})` : ''}`) : `Saisons suivies : ${cur.seasons.join(', ') || '—'}`} ·{' '}
          {lastPart(cur.folderPath)} · {cur.note ?? 'en attente'}
          {cur.lastSearch ? ` · dernière recherche ${ago(cur.lastSearch)}` : ''}
        </Text>

        {cur.type === 'tv' ? (
          <>
            <Toggle label="Suivre aussi les prochaines saisons" value={cur.future} onChange={(v) => autoApi.updateItem(settings, item.id, { future: v }).then(reload)} />
            <Toggle label="Animé (numérotation absolue)" value={cur.anime} onChange={(v) => autoApi.updateItem(settings, item.id, { anime: v }).then(reload)} />
          </>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Chercher maintenant" icon="search" onPress={() => search()} loading={busy} style={{ flex: 1 }} />
          <Button
            title={cur.paused ? 'Reprendre' : 'Pause'}
            icon={cur.paused ? 'play' : 'pause'}
            variant="secondary"
            onPress={() => autoApi.pauseItem(settings, item.id).then(reload)}
            style={{ flex: 1 }}
          />
        </View>

        {res ? (
          <>
            <Text style={styles.h2}>Recherché : {wantLabel(res.want)}</Text>
            {res.wanted.length > 1 ? (
              <View style={styles.chips}>
                {res.wanted.slice(0, 20).map((w, k) => (
                  <SegChip key={k} label={wantLabel(w)} on={wantLabel(w) === wantLabel(res.want)} onPress={() => search(w.season, w.kind === 'episode' ? w.episode : undefined)} />
                ))}
              </View>
            ) : null}
            <Text style={styles.dim}>{res.status.map((s) => `${s.name} : ${s.error ? `erreur (${s.error})` : s.skipped ? 'limite atteinte' : `${s.count} résultat(s)`}`).join(' · ')}</Text>
            <Toggle label="Voir aussi les versions écartées" value={showRejected} onChange={setShowRejected} />
            {!shown.length ? <Text style={styles.dim}>Aucune version ne correspond au profil.</Text> : null}
            {shown.map((r) => (
              <View key={r.guid} style={[styles.card, r.rejected ? { opacity: 0.55 } : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.relTitle}>{r.title}</Text>
                  <Text style={styles.dim}>
                    {gb(r.size)} · {r.seeders ?? '?'} sources · {r.indexer}
                    {r.rejected ? ` · écartée : ${r.rejected}` : ` · note ${r.score}`}
                  </Text>
                </View>
                <Pressable
                  hitSlop={8}
                  style={styles.pill}
                  onPress={() =>
                    Alert.alert('Télécharger cette version ?', r.title, [
                      { text: 'Annuler', style: 'cancel' },
                      {
                        text: 'Télécharger',
                        onPress: () =>
                          autoApi
                            .grab(settings, item.id, r.guid)
                            .then(() => (toast('Téléchargement lancé'), reload(), onClose()))
                            .catch((e) => Alert.alert('Lumio Auto', e.message)),
                      },
                    ])
                  }>
                  <Ionicons name="download-outline" size={16} color={C.text} />
                </Pressable>
              </View>
            ))}
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
});
