// Bande-annonce YouTube lue dans le lecteur de Lumio (mpv) : on demande à YouTube les flux directs
// comme le font les applis officielles (API « innertube »). Plusieurs profils d'appli sont essayés,
// car YouTube change régulièrement ce qu'il accepte. Si rien ne marche, on retombe sur YouTube.
export type TrailerStream = { video: string; audio?: string; headers: Record<string, string>; height?: number };

type Client = {
  name: string;
  id: string;
  version: string;
  ua: string;
  extra?: Record<string, unknown>;
};

const CLIENTS: Client[] = [
  {
    name: 'ANDROID_VR',
    id: '28',
    version: '1.62.27',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
  },
  {
    name: 'IOS',
    id: '5',
    version: '20.10.4',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  },
];

type Format = { url?: string; mimeType?: string; height?: number; bitrate?: number; audioTrack?: { displayName?: string; id?: string; audioIsDefault?: boolean } };

async function ask(c: Client, key: string): Promise<TrailerStream | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.ua,
        'X-YouTube-Client-Name': c.id,
        'X-YouTube-Client-Version': c.version,
        Origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({
        videoId: key,
        contentCheckOk: true,
        racyCheckOk: true,
        context: { client: { clientName: c.name, clientVersion: c.version, hl: 'fr', gl: 'FR', ...c.extra } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.playabilityStatus?.status && j.playabilityStatus.status !== 'OK') return null;
    const sd = j?.streamingData;
    if (!sd) return null;
    const headers = { 'User-Agent': c.ua };

    // Vidéo + audio séparés (jusqu'en 1080p), lisibles par mpv
    const adaptive: Format[] = (sd.adaptiveFormats ?? []).filter((f: Format) => f.url);
    const videos = adaptive
      .filter((f) => /^video\/mp4/.test(f.mimeType ?? '') && /avc1/.test(f.mimeType ?? '') && (f.height ?? 0) <= 1080)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const audios = adaptive
      .filter((f) => /^audio\/mp4/.test(f.mimeType ?? ''))
      // Piste française d'abord quand la vidéo a plusieurs langues, sinon la piste par défaut
      .sort(
        (a, b) =>
          Number(/^fr/.test(b.audioTrack?.id ?? '')) - Number(/^fr/.test(a.audioTrack?.id ?? '')) ||
          Number(Boolean(b.audioTrack?.audioIsDefault)) - Number(Boolean(a.audioTrack?.audioIsDefault)) ||
          (b.bitrate ?? 0) - (a.bitrate ?? 0)
      );
    if (videos[0]?.url && audios[0]?.url) return { video: videos[0].url, audio: audios[0].url, headers, height: videos[0].height };

    // Flux HLS (profil iPhone) : vidéo et son ensemble
    if (sd.hlsManifestUrl) return { video: sd.hlsManifestUrl, headers };

    // Dernier recours : format complet (souvent 360p)
    const muxed: Format[] = (sd.formats ?? []).filter((f: Format) => f.url).sort((a: Format, b: Format) => (b.height ?? 0) - (a.height ?? 0));
    if (muxed[0]?.url) return { video: muxed[0].url, headers, height: muxed[0].height };
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function trailerStream(key: string): Promise<TrailerStream | null> {
  for (const c of CLIENTS) {
    const s = await ask(c, key);
    if (s) return s;
  }
  return null;
}
