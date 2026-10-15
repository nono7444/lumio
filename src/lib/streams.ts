// Récupération et classement des streams des addons Stremio.
import type { Settings } from './settings';
import { fetchManifest, fetchStreams, providesStreams, type StremioStream } from './stremio';

export type Found = StremioStream & { addon: string; quality: string; sizeLabel?: string; sizeGb?: number; fr: boolean; playable: boolean };

export function quality(text: string) {
  if (/2160p|\b4k\b|uhd/i.test(text)) return '4K';
  if (/1080p/i.test(text)) return '1080p';
  if (/720p/i.test(text)) return '720p';
  if (/480p|\bsd\b/i.test(text)) return 'SD';
  return '';
}

function size(s: StremioStream, text: string): { label?: string; gb?: number } {
  if (s.behaviorHints?.videoSize) {
    const gb = s.behaviorHints.videoSize / 1024 ** 3;
    return { label: `${gb.toFixed(gb >= 10 ? 0 : 1)} Go`, gb };
  }
  const m = text.match(/(\d+(?:[.,]\d+)?)\s?(GB|Go|MB|Mo)\b/i);
  if (!m) return {};
  const n = Number(m[1].replace(',', '.'));
  const gb = /g/i.test(m[2]) ? n : n / 1024;
  return { label: `${m[1].replace(',', '.')} ${/g/i.test(m[2]) ? 'Go' : 'Mo'}`, gb };
}

export const isFrench = (text: string) => /🇫🇷|\b(multi|vff|vfq|vf2?|vfi|french|truefrench|fr)\b/i.test(text);

export const QUALITY_RANK: Record<string, number> = { '4K': 0, '1080p': 1, '720p': 2, SD: 3, '': 4 };

export function describe(s: StremioStream, addon: string): Found {
  const text = `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''} ${s.behaviorHints?.filename ?? ''}`;
  const sz = size(s, text);
  return { ...s, addon, quality: quality(text), sizeLabel: sz.label, sizeGb: sz.gb, fr: isFrench(text), playable: Boolean(s.url) };
}

/**
 * Score d'une source pour le lancement automatique :
 * VF d'abord, 1080p de préférence (4K lourd sur mobile), sources en cache debrid, taille raisonnable.
 */
export function score(f: Found) {
  if (!f.playable) return -1;
  const text = `${f.name ?? ''} ${f.title ?? ''}`;
  let n = 0;
  if (f.fr) n += 100;
  n += { '1080p': 40, '4K': 28, '720p': 25, SD: 5, '': 10 }[f.quality] ?? 0;
  if (/\[(RD|AD|PM|DL|TB|ED|OC)\+\]|⚡|cached|instant/i.test(text)) n += 15;
  if (f.sizeGb && f.sizeGb > 25) n -= 15;
  if (/\b(cam|ts|telesync|hdcam)\b/i.test(text)) n -= 60;
  return n;
}

/** Interroge tous les addons de streams en parallèle. */
export async function collectStreams(
  s: Settings,
  type: 'movie' | 'series',
  id: string,
  opts: { timeoutMs?: number; onPartial?: (list: Found[]) => void } = {}
): Promise<{ streams: Found[]; errors: string[] }> {
  const streams: Found[] = [];
  const errors: string[] = [];
  const jobs = s.addons.map(async (a) => {
    try {
      const m = await fetchManifest(a.base);
      if (!providesStreams(m, type, id)) return;
      const list = await fetchStreams(a.base, type, id);
      streams.push(...list.map((x) => describe(x, m.name)));
      opts.onPartial?.([...streams]);
    } catch (e: any) {
      errors.push(`${a.name} : ${e?.message ?? e}`);
    }
  });
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, opts.timeoutMs ?? 20000))]);
  return { streams: [...streams], errors };
}

export function bestStream(list: Found[]) {
  return [...list].filter((f) => f.playable).sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function hasStreamAddon(s: Settings) {
  return s.addons.length > 0;
}
