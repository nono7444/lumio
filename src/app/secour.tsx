// Admin : liens Lumio Secour pour un film ou un épisode → téléchargement AllDebrid sur un disque du serveur.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { FocusPressable as Pressable } from '@/components/tv';
import { Button, SegChip, tap } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { filesApi, formatSize, joinPath, parentPath, type Disk, type FileEntry } from '@/lib/files';
import { qualityBucket, secourApi, type SecourLink, type SecourStatus } from '@/lib/secour';
import { useSettings } from '@/lib/settings';
import { tmdb } from '@/lib/tmdb';

type Params = { type: 'movie' | 'tv'; tmdbId: string; imdb?: string; title: string; season?: string; source?: string };

// Dernière destination choisie (le temps que l'appli reste ouverte)
const lastDest: Record<'movie' | 'tv', { root: string; folder: string } | null> = { movie: null, tv: null };

const FILTERS = ['Toutes', '4K', '1080p', '720p', 'Autre'] as const;

export default function Secour() {
  const p = useLocalSearchParams<Params>();
  const type = p.type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(p.tmdbId);
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<SecourStatus | null>(null);
  const [url, setUrl] = useState('http://lumio-secour:7000');
  const [key, setKey] = useState('');

  // Série : saison et épisode
  const [seasons, setSeasons] = useState<{ n: number; count: number }[]>([]);
  const [season, setSeason] = useState(Number(p.season) || 1);
  const [episode, setEpisode] = useState(1);

  // Destination
  const [disks, setDisks] = useState<Disk[]>([]);
  const [root, setRoot] = useState<string | null>(lastDest[type]?.root ?? null);
  const [folder, setFolder] = useState(lastDest[type]?.folder ?? '');
  const [subdirs, setSubdirs] = useState<FileEntry[]>([]);

  // Liens
  const [links, setLinks] = useState<SecourLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Toutes');
  const [cachedOnly, setCachedOnly] = useState(false);
  // Source choisie depuis le bouton « LS » (sinon toutes)
  const [source, setSource] = useState<string>(typeof p.source === 'string' ? p.source : '');
  const [sending, setSending] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    secourApi
      .status(settings)
      .then((s) => {
        setStatus(s);
        if (s.url) setUrl(s.url);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, [settings]);

  useEffect(() => {
    loadStatus();
    filesApi
      .disks(settings)
      .then((d) => {
        setDisks(d);
        setRoot((r) => (r && d.some((x) => x.name === r) ? r : d[0]?.name ?? null));
      })
      .catch(() => {});
    if (type === 'tv' && tmdbId) {
      tmdb
        .tv(settings, tmdbId)
        .then((d) => {
          const list = d.seasons.filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => ({ n: s.season_number, count: s.episode_count }));
          setSeasons(list);
          if (list.length && !list.some((s) => s.n === season)) setSeason(list[0].n);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!root) return;
    lastDest[type] = { root, folder };
    filesApi
      .list(settings, root, folder)
      .then((l) => setSubdirs(l.filter((e) => e.dir)))
      .catch(() => setSubdirs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, folder]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLinks(null);
    try {
      const r = await secourApi.links(settings, { type, tmdbId, imdb: p.imdb || undefined, season, episode });
      setLinks(r.links);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, type, tmdbId, p.imdb, season, episode]);

  // Recherche automatique dès que Lumio Secour est prêt, et à chaque changement d'épisode
  useEffect(() => {
    if (status?.configured && status.online) search();
  }, [status?.configured, status?.online, search]);

  const saveConfig = async () => {
    try {
      await secourApi.configure(settings, url.trim(), key.trim() || undefined);
      setKey('');
      toast('Lumio Secour enregistré');
      loadStatus();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    }
  };

  const shown = useMemo(
    () =>
      (links ?? []).filter(
        (l) => (filter === 'Toutes' || qualityBucket(l.quality) === filter) && (!cachedOnly || l.cached) && (!source || l.source.toLowerCase() === source.toLowerCase())
      ),
    [links, filter, cachedOnly, source]
  );
  const sourcesFound = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of links ?? []) if (l.source) c.set(l.source, (c.get(l.source) ?? 0) + 1);
    return [...c.entries()];
  }, [links]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { Toutes: links?.length ?? 0 };
    for (const l of links ?? []) c[qualityBucket(l.quality)] = (c[qualityBucket(l.quality)] ?? 0) + 1;
    return c;
  }, [links]);

  const episodeLabel = type === 'tv' ? ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';
  const dest = root ? [root, ...(folder ? folder.split('/') : [])].join(' › ') : '';

  const grab = (l: SecourLink) => {
    if (!root) return toast('Choisis d’abord un disque', 'error');
    tap();
    Alert.alert(
      'Télécharger ce lien ?',
      `${l.quality || 'Qualité inconnue'} · ${l.language || '?'} · ${l.size || '?'}\n${l.hoster}\n\nDestination : ${dest}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Télécharger',
          onPress: async () => {
            setSending(l.link);
            try {
              await secourApi.download(settings, l, { type, root, folder, name: `${p.title}${episodeLabel}` });
              toast('Téléchargement lancé — suivi dans Téléchargements');
            } catch (e: any) {
              Alert.alert('Téléchargement impossible', e?.message ?? String(e));
            } finally {
              setSending(null);
            }
          },
        },
      ]
    );
  };

  const epCount = seasons.find((s) => s.n === season)?.count ?? 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Liens</Text>
          <Text style={styles.dim} numberOfLines={1}>
            {p.title}
            {episodeLabel}
          </Text>
        </View>
        <Pressable onPress={() => router.push('/downloads')} hitSlop={10} style={styles.round} accessibilityLabel="Téléchargements">
          <Ionicons name="cloud-download-outline" size={19} color={C.text} />
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.round} accessibilityLabel="Fermer">
          <Ionicons name="close" size={20} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {/* ——— Configuration ——— */}
        {status && (!status.configured || status.online === false) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Lumio Secour</Text>
            {status.error ? <Text style={[styles.dim, { color: C.danger }]}>{status.error}</Text> : null}
            <Text style={styles.dim}>
              Adresse vue par le serveur Lumio (même compose : http://lumio-secour:7000) et clé LUMIO_API_KEY de Lumio Secour.
            </Text>
            {status.fromEnv ? (
              <Text style={styles.dim}>L’adresse est fixée dans le docker-compose (LUMIO_SECOUR_URL).</Text>
            ) : (
              <TextInput value={url} onChangeText={setUrl} placeholder="http://lumio-secour:7000" placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} style={styles.input} />
            )}
            <TextInput value={key} onChangeText={setKey} placeholder={status.configured ? 'Clé (inchangée)' : 'Clé LUMIO_API_KEY'} placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} />
            <Button title="Enregistrer" icon="key-outline" onPress={saveConfig} disabled={!status.fromEnv && !url.trim()} />
          </View>
        ) : null}
        {status && !status.alldebrid ? (
          <Pressable onPress={() => router.push('/downloads')} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <Ionicons name="warning-outline" size={18} color={C.warning} />
            <Text style={[styles.dim, { flex: 1 }]}>Clé AllDebrid absente : ajoute-la dans Téléchargements pour pouvoir lancer un lien.</Text>
          </Pressable>
        ) : null}

        {/* ——— Série : saison / épisode ——— */}
        {type === 'tv' ? (
          <View style={styles.card}>
            <Text style={styles.label}>Saison</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(seasons.length ? seasons : [{ n: season, count: 0 }]).map((s) => (
                <SegChip
                  key={s.n}
                  label={`S${s.n}`}
                  on={season === s.n}
                  onPress={() => {
                    setSeason(s.n);
                    setEpisode(1);
                  }}
                />
              ))}
            </ScrollView>
            <Text style={styles.label}>Épisode</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {Array.from({ length: Math.max(epCount, episode) }, (_, i) => i + 1).map((n) => (
                <SegChip key={n} label={`E${n}`} on={episode === n} onPress={() => setEpisode(n)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ——— Destination ——— */}
        <View style={styles.card}>
          <Text style={styles.label}>Destination</Text>
          {disks.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {disks.map((d) => (
                <SegChip
                  key={d.name}
                  label={`${d.name} · ${formatSize(d.free)} libres`}
                  on={root === d.name}
                  onPress={() => {
                    setRoot(d.name);
                    setFolder('');
                  }}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.dim}>Aucun disque configuré sur le serveur Lumio (LUMIO_DISKS).</Text>
          )}
          {root ? (
            <>
              <View style={styles.folderBar}>
                {folder ? (
                  <Pressable onPress={() => setFolder(parentPath(folder))} hitSlop={8}>
                    <Ionicons name="arrow-up" size={18} color={C.text} />
                  </Pressable>
                ) : null}
                <Text style={[styles.dim, { flex: 1, color: C.text }]} numberOfLines={1}>
                  {dest}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {subdirs.slice(0, 40).map((d) => (
                  <Pressable
                    key={d.name}
                    onPress={() => {
                      tap();
                      setFolder(joinPath(folder, d.name));
                    }}
                    style={styles.sub}>
                    <Ionicons name="folder" size={14} color="#FFC93C" />
                    <Text style={styles.subText} numberOfLines={1}>
                      {d.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        {/* ——— Liens ——— */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={[styles.cardTitle, { flex: 1 }]}>{links ? `${shown.length} lien${shown.length > 1 ? 's' : ''}` : 'Liens'}</Text>
          <Pressable onPress={search} hitSlop={10} style={styles.round} accessibilityLabel="Relancer la recherche" disabled={loading || !status?.configured}>
            <Ionicons name="refresh" size={18} color={C.text} />
          </Pressable>
        </View>

        {links && links.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {FILTERS.filter((f) => f === 'Toutes' || counts[f]).map((f) => (
              <SegChip key={f} label={`${f} (${counts[f] ?? 0})`} on={filter === f} onPress={() => setFilter(f)} />
            ))}
            <SegChip label="⚡ En cache" on={cachedOnly} onPress={() => setCachedOnly((x) => !x)} />
          </ScrollView>
        ) : null}
        {links && (sourcesFound.length > 1 || source) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <SegChip label={`Toutes les sources (${links.length})`} on={!source} onPress={() => setSource('')} />
            {sourcesFound.map(([s, n]) => (
              <SegChip key={s} label={`${s} (${n})`} on={source.toLowerCase() === s.toLowerCase()} onPress={() => setSource(s)} />
            ))}
            {source && !sourcesFound.some(([s]) => s.toLowerCase() === source.toLowerCase()) ? <SegChip label={`${source} (0)`} on onPress={() => {}} /> : null}
          </ScrollView>
        ) : null}

        {loading ? (
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 20 }}>
            <ActivityIndicator color={C.text} />
            <Text style={styles.dim}>Recherche sur les sources… (jusqu’à une minute)</Text>
          </View>
        ) : null}
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
        {links && !links.length && !loading ? <Text style={styles.dim}>Aucun lien trouvé{episodeLabel ? ' pour cet épisode' : ''}.</Text> : null}

        {shown.map((l) => (
          <Pressable key={l.link} onPress={() => grab(l)} style={styles.link} disabled={!!sending}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.badge, qualityBucket(l.quality) === '4K' && { backgroundColor: 'rgba(255,201,60,0.18)' }]}>
                <Text style={styles.badgeText}>{l.quality || '?'}</Text>
              </View>
              <Text style={[styles.dim, { flex: 1, color: C.text }]} numberOfLines={1}>
                {l.language || 'Langue inconnue'}
              </Text>
              <Text style={styles.size}>{l.size || '—'}</Text>
            </View>
            {l.name ? (
              <Text style={styles.linkName} numberOfLines={2}>
                {l.name}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {l.cached ? <Text style={[styles.faint, { color: C.success }]}>⚡ dispo AllDebrid</Text> : null}
              <Text style={[styles.faint, { flex: 1 }]} numberOfLines={1}>
                {[l.hoster, l.source].filter(Boolean).join(' · ')}
              </Text>
              {sending === l.link ? <ActivityIndicator size="small" color={C.text} /> : <Ionicons name="cloud-download-outline" size={18} color={C.textDim} />}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 26, fontWeight: '800' },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: 14, gap: 10 },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  label: { color: C.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  dim: { color: C.textDim, fontSize: 13, lineHeight: 18 },
  faint: { color: C.textFaint, fontSize: 11 },
  input: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  folderBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surfaceHigh, borderRadius: R.md, padding: 10 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surfaceHigh, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '48%' },
  subText: { color: C.text, fontSize: 13 },
  link: { backgroundColor: C.surface, borderRadius: R.md, padding: 12, gap: 6 },
  linkName: { color: C.textDim, fontSize: 12 },
  badge: { backgroundColor: C.accentSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: C.text, fontSize: 12, fontWeight: '800' },
  size: { color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
