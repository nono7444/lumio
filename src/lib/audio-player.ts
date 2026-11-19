// Lumio Audio : le lecteur de livres audio (un seul pour toute l'appli). Lecture en arrière-plan, écran verrouillé,
// vitesse, minuterie de sommeil, chapitres (un fichier = un chapitre), position d'écoute envoyée au serveur.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useSyncExternalStore } from 'react';

import { audioApi, audioUrl, type AudioBook } from './audiobooks';
import type { Settings } from './settings';

export type Sleep = { at: number } | { endOfChapter: true } | null;
type State = {
  book: AudioBook | null;
  file: number;
  pos: number;
  dur: number;
  playing: boolean;
  buffering: boolean;
  rate: number;
  sleep: Sleep;
};

let state: State = { book: null, file: 0, pos: 0, dur: 0, playing: false, buffering: false, rate: 1, sleep: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));
/** État du lecteur, pour l'interface (mini-lecteur, plein écran). */
export const useAudio = () => useSyncExternalStore(subscribe, () => state);
export const audioState = () => state;

let player: AudioPlayer | null = null;
let settingsRef: Settings | null = null;
let pendingSeek: number | null = null;
let lastSave = 0;

async function ensure() {
  if (player) return player;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
  player = createAudioPlayer(null, { updateInterval: 500 });
  player.addListener('playbackStatusUpdate', onStatus);
  return player;
}

function save(done = false) {
  const b = state.book;
  if (!b || !settingsRef) return;
  lastSave = Date.now();
  // Position gardée aussi dans le livre en mémoire (la bibliothèque l'affiche sans recharger)
  b.progress = { file: state.file, pos: state.pos, dur: state.dur, total: b.files.length, done, at: Date.now() };
  audioApi.progress(settingsRef, b.id, { file: state.file, pos: state.pos, dur: state.dur, total: b.files.length, done }).catch(() => {});
}

function lockScreen() {
  const b = state.book;
  if (!player || !b || !settingsRef) return;
  const meta = {
    title: b.files.length > 1 ? b.files[state.file]?.name ?? b.title : b.title,
    artist: b.author ?? undefined,
    albumTitle: b.title,
    artworkUrl: audioUrl(settingsRef, b.cover) ?? undefined,
  };
  try {
    player.setActiveForLockScreen(true, meta, { showSeekForward: true, showSeekBackward: true });
  } catch {}
}

function onStatus(st: AudioStatus) {
  if (st.isLoaded && pendingSeek != null && st.duration > 0) {
    const t = Math.min(pendingSeek, Math.max(0, st.duration - 2));
    pendingSeek = null;
    player?.seekTo(t).catch(() => {});
  }
  set({ pos: pendingSeek ?? st.currentTime, dur: st.duration || state.dur, playing: st.playing, buffering: st.isBuffering });
  // Minuterie de sommeil
  const sl = state.sleep;
  if (sl && 'at' in sl && Date.now() >= sl.at && st.playing) {
    player?.pause();
    set({ sleep: null });
    save();
  }
  if (st.playing && Date.now() - lastSave > 15_000) save();
  if (st.didJustFinish) onFileEnd();
}

function onFileEnd() {
  const b = state.book;
  if (!b) return;
  if (state.sleep && 'endOfChapter' in state.sleep) {
    set({ sleep: null });
    if (state.file + 1 < b.files.length) load(state.file + 1, 0, false);
    return;
  }
  if (state.file + 1 < b.files.length) load(state.file + 1, 0, true);
  else {
    set({ playing: false });
    save(true);
  }
}

function load(file: number, at: number, autoplay: boolean) {
  const b = state.book;
  if (!b || !player || !settingsRef) return;
  const f = b.files[file];
  const uri = f && audioUrl(settingsRef, f.url);
  if (!uri) return;
  pendingSeek = at > 0 ? at : null;
  set({ file, pos: at, dur: 0 });
  player.replace({ uri });
  player.setPlaybackRate(state.rate, 'high');
  if (autoplay) player.play();
  lockScreen();
  save();
}

/** Lance un livre (à sa position d'écoute, ou au chapitre demandé). */
export async function playBook(s: Settings, book: AudioBook, file?: number) {
  settingsRef = s;
  await ensure();
  if (state.book?.id === book.id && file == null) {
    player?.play();
    return;
  }
  if (state.book && state.book.id !== book.id) save();
  const p = book.progress;
  const start = file ?? (p && !p.done ? Math.min(p.file, book.files.length - 1) : 0);
  const at = file == null && p && !p.done && start === p.file ? Math.max(0, p.pos - 5) : 0; // 5 s de rappel
  set({ book, sleep: null });
  load(start, at, true);
}

export function toggle() {
  if (!player || !state.book) return;
  if (state.playing) {
    player.pause();
    save();
  } else player.play();
}
export function seekTo(sec: number) {
  if (!player) return;
  player.seekTo(Math.max(0, Math.min(sec, state.dur || sec))).catch(() => {});
  set({ pos: sec });
}
export const seekBy = (d: number) => seekTo(state.pos + d);
export function nextChapter() {
  const b = state.book;
  if (b && state.file + 1 < b.files.length) load(state.file + 1, 0, state.playing);
}
/** Début du chapitre, ou chapitre précédent si on y est déjà. */
export function prevChapter() {
  if (state.pos > 5 || state.file === 0) return seekTo(0);
  load(state.file - 1, 0, state.playing);
}
export function goChapter(i: number) {
  load(i, 0, true);
}
export function setRate(rate: number) {
  set({ rate });
  player?.setPlaybackRate(rate, 'high');
}
/** Minuterie : minutes, « fin du chapitre », ou null pour l'arrêter. */
export function setSleep(v: number | 'chapter' | null) {
  set({ sleep: v == null ? null : v === 'chapter' ? { endOfChapter: true } : { at: Date.now() + v * 60_000 } });
}
export function stop() {
  save();
  player?.pause();
  try {
    player?.clearLockScreenControls();
  } catch {}
  set({ book: null, playing: false, sleep: null });
}
