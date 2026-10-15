// Diagnostic du streaming : pour chaque addon, combien de sources sont trouvées et lesquelles sont lisibles.
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Section } from '@/components/ui';
import { C } from '@/constants/theme';
import { useSettings } from '@/lib/settings';
import { bestStream, describe } from '@/lib/streams';
import { fetchManifest, fetchStreams, hasResource, providesStreams } from '@/lib/stremio';

type Line = { ok: 'ok' | 'warn' | 'err' | 'info'; text: string };

// Titre de test : Dune, deuxième partie (2024), très présent sur tous les addons
const TEST_ID = 'tt15239678';

async function reachable(url: string, headers?: Record<string, string>) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1', ...(headers ?? {}) }, signal: ctrl.signal });
    return { ok: res.ok || res.status === 206, status: res.status, type: res.headers.get('content-type') ?? '' };
  } catch (e: any) {
    return { ok: false, status: 0, type: String(e?.name === 'AbortError' ? 'délai dépassé' : (e?.message ?? e)) };
  } finally {
    clearTimeout(t);
  }
}

export function DiagnosticSection() {
  const { settings } = useSettings();
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const out: Line[] = [];
    const push = (l: Line) => {
      out.push(l);
      setLines([...out]);
    };
    setLines([]);
    let streamAddons = 0;
    for (const a of settings.addons) {
      try {
        const m = await fetchManifest(a.base);
        if (!hasResource(m, 'stream')) {
          push({ ok: 'info', text: `${m.name} : catalogue seulement (pas de sources vidéo)` });
          continue;
        }
        streamAddons++;
        if (!providesStreams(m, 'movie', TEST_ID)) {
          push({ ok: 'warn', text: `${m.name} : ne répond pas aux identifiants IMDb (tt…) pour les films` });
          continue;
        }
        const raw = await fetchStreams(a.base, 'movie', TEST_ID);
        const list = raw.map((x) => describe(x, m.name));
        const playable = list.filter((x) => x.playable);
        const torrents = list.filter((x) => !x.url && x.infoHash);
        const external = list.filter((x) => !x.url && !x.infoHash);
        if (!list.length) {
          push({ ok: 'warn', text: `${m.name} : aucune source pour le film de test` });
          continue;
        }
        if (!playable.length) {
          push({
            ok: 'err',
            text: `${m.name} : ${list.length} sources, mais ${torrents.length ? `${torrents.length} torrents bruts` : `${external.length} liens externes`} : aucune lisible dans l'appli. Configure l'addon avec ta clé debrid (AllDebrid…) pour obtenir des liens directs.`,
          });
          continue;
        }
        const best = bestStream(list)!;
        const r = await reachable(best.url!, best.behaviorHints?.proxyHeaders?.request);
        push({
          ok: r.ok ? 'ok' : 'err',
          text: `${m.name} : ${playable.length} lisibles / ${list.length} (${list.filter((x) => x.fr).length} en VF). Test de la meilleure : ${
            r.ok ? `OK (${r.type || 'vidéo'})` : `échec ${r.status || ''} ${r.status ? '' : r.type}`.trim()
          }`,
        });
        if (r.ok && /text\/html/i.test(r.type)) {
          push({ ok: 'warn', text: `${m.name} : le lien renvoie une page web, pas une vidéo (lien expiré ou page d'attente du debrid).` });
        }
      } catch (e: any) {
        push({ ok: 'err', text: `${a.name} : ${e?.message ?? e}` });
      }
    }
    if (!streamAddons)
      push({
        ok: 'err',
        text: 'Aucun addon de sources vidéo : ajoute un addon de streams (Torrentio, Comet, MediaFusion… configuré avec ta clé debrid) dans Addons Stremio.',
      });
    setBusy(false);
  }

  const color = { ok: C.success, warn: C.warning, err: C.danger, info: C.textDim };
  const icon = { ok: '✅', warn: '⚠️', err: '❌', info: 'ℹ️' };

  return (
    <Section title="Diagnostic du streaming">
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
        Teste chaque addon sur un film connu et vérifie que la meilleure source répond.
      </Text>
      <Button title="Tester mes addons" icon="pulse-outline" variant="secondary" loading={busy} onPress={run} />
      {lines.length > 0 && (
        <View style={{ marginTop: 12, gap: 8 }}>
          {lines.map((l, i) => (
            <Text key={i} selectable style={{ color: l.ok === 'info' ? C.textDim : C.text, fontSize: 13, lineHeight: 19 }}>
              {icon[l.ok]} <Text style={{ color: color[l.ok] }}>{l.text}</Text>
            </Text>
          ))}
        </View>
      )}
    </Section>
  );
}
