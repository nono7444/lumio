// Mac / web : pas de Google Cast (le SDK n'existe que sur iOS / Android).
export type CastMedia = { uri: string; contentType: string; title?: string; subtitle?: string; image?: string };

export function guessContentType(uri: string, isHls?: boolean) {
  if (isHls || /\.m3u8(\?|$)/i.test(uri)) return 'application/x-mpegURL';
  if (/\.webm(\?|$)/i.test(uri)) return 'video/webm';
  return 'video/mp4';
}

export function CastIcon() {
  return null;
}

export function useCasting() {
  return { client: null as null | { stop?: () => void }, deviceName: null as string | null };
}

export function CastingScreen(_: {
  media: () => Promise<CastMedia>;
  startAt: number;
  deviceName: string | null;
  onPosition: (seconds: number, paused: boolean) => void;
  onEnded: () => void;
  onClose: () => void;
}) {
  return null;
}
