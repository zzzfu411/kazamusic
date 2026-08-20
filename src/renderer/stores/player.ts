import { useEffect, useState } from "react";
import {
  canEnqueuePlayUrl,
  type SearchSong,
  type Track,
} from "../../shared/types";
import { getSettings } from "./settings";

export type PlayState = "idle" | "loading" | "playing" | "paused";
export type PlayMode = "sequence" | "shuffle" | "repeat-one" | "loop";
export type AudioQuality = "128k" | "320k" | "flac";

export type LyricWord = {
  time: number;
  text: string;
  line: number;
};

export type PlayerSnapshot = {
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  state: PlayState;
  currentTime: number;
  duration: number;
  volume: number;
  playMode: PlayMode;
  queueOpen: boolean;
  detailOpen: boolean;
  warning: string | null;
  lyrics: string;
  lyricWords: LyricWord[];
  quality: AudioQuality;
};

type PlayerListener = (snapshot: PlayerSnapshot) => void;

const LX_SOURCE: Record<string, string> = {
  kuwo: "kw",
  kugou: "kg",
  qq: "tx",
  netease: "wy",
  migu: "mg",
};

const ENQUEUE_EVENT = "kazam:enqueue";
const WARNING_MS = 3600;

const listeners = new Set<PlayerListener>();

let audio: HTMLAudioElement | null = null;
let warningTimer: number | null = null;
let audioCtx: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let lyricSessionId: string | null = null;
let lyricsGen = 0;
let qualityGen = 0;
let playGen = 0;
let lastOverlayLine = -1;
let persistTimer: number | null = null;
let startIntent = false;
let overlayGeneration = 1;

let snapshot: PlayerSnapshot = {
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  state: "idle",
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  playMode: "sequence",
  queueOpen: false,
  detailOpen: false,
  warning: null,
  lyrics: "",
  lyricWords: [],
  quality: "320k",
};

function stripLyricMarkup(line: string): string {
  return line
    .replace(/\[format:yrc\]/gi, "")
    .replace(/\[\d+,\d+\]/g, "")
    .replace(/\(\d+,\d+,-?\d+\)/g, "")
    .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "")
    .replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})>/g, "")
    .trim();
}

function timedLyricLines(raw: string): Array<{ time: number; text: string }> {
  const main = (raw.split("\n\n__KAZAM_TL__\n")[0] || "").trim();
  if (!main) return [];
  const lines: Array<{ time: number; text: string }> = [];
  for (const row of main.split(/\r?\n/)) {
    const yrc = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (yrc) {
      const rest = yrc[3] || "";
      const text =
        stripLyricMarkup(rest) ||
        rest.replace(/\(\d+,\d+,-?\d+\)/g, "").trim();
      if (text) lines.push({ time: Number(yrc[1]) / 1000, text });
      continue;
    }
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = stripLyricMarkup(row.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, ""));
    if (!text) continue;
    for (const stamp of stamps) {
      const frac = stamp[3] ? Number(stamp[3].padEnd(3, "0")) / 1000 : 0;
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + frac, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function overlayLyric(currentTime = snapshot.currentTime): {
  lineIndex: number;
  activeLine: string;
  nextLine: string;
  status: string;
} {
  const rows = timedLyricLines(snapshot.lyrics);
  if (rows.length === 0) {
    return {
      lineIndex: 0,
      activeLine: "",
      nextLine: "",
      status: snapshot.lyrics.trim() ? "ok" : "empty",
    };
  }
  let idx = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].time <= currentTime + 0.12) idx = i;
  }
  return {
    lineIndex: idx,
    activeLine: rows[idx].text,
    nextLine: rows[idx + 1]?.text || "",
    status: "ok",
  };
}

function publishOverlays(kind: "full" | "tick" = "full", currentTime = snapshot.currentTime): void {
  const api = window.electronAPI;
  if (!api?.island?.publish) return;
  const track = snapshot.currentTrack;
  if (kind === "tick") {
    api.island.publishTick({
      generation: overlayGeneration,
      currentTime,
      duration: snapshot.duration,
    });
    return;
  }
  const lyric = overlayLyric(currentTime);
  lastOverlayLine = lyric.lineIndex;
  api.island.publish({
    generation: overlayGeneration,
    currentTime,
    duration: snapshot.duration,
    playback: snapshot.state,
    lyric,
    track: track
      ? { title: track.title, artist: track.artist, coverUrl: track.coverUrl }
      : null,
  });
}

function cloneSnapshot(): PlayerSnapshot {
  return {
    ...snapshot,
    queue: snapshot.queue.slice(),
    lyricWords: snapshot.lyricWords.slice(),
  };
}

function lyricSyncApi(): Window["electronAPI"]["lyricSync"] | undefined {
  return window.electronAPI?.lyricSync;
}

function bindLyricSession(track: Track | null): void {
  const api = lyricSyncApi();
  if (!api) return;
  const id = track?.id ?? null;
  if (id === lyricSessionId) return;
  api.reset();
  lyricSessionId = id;
  overlayGeneration += 1;
  lastOverlayLine = -1;
  if (!track) return;
  api.bindSession({
    generation: overlayGeneration,
    title: track.title,
    artist: track.artist,
    cover: track.coverUrl || "",
  });
  api.bindTransport?.({
    generation: overlayGeneration,
    track: { title: track.title, artist: track.artist, coverUrl: track.coverUrl },
    playback: snapshot.state === "playing" || snapshot.state === "loading" ? "playing" : "paused",
    currentTime: snapshot.currentTime,
    duration: snapshot.duration || track.duration || 0,
  });
}

function pushLyricClock(
  currentTime = snapshot.currentTime,
  duration = snapshot.duration,
  playing = snapshot.state === "playing" || snapshot.state === "loading",
): void {
  const api = lyricSyncApi();
  if (!api) return;
  api.clock({ generation: overlayGeneration, currentTime, duration, playing });
}

function emit(): void {
  const next = cloneSnapshot();
  for (const listener of listeners) listener(next);
  publishOverlays("full");
  pushLyricClock(next.currentTime, next.duration, next.state === "playing");
}

function patch(partial: Partial<PlayerSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  emit();
}

export function emptyPlayUrlWarning(name: string): string {
  return `"${name}" 暂无可用播放链接`;
}

export function formatPlayerTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function showPlayWarning(message: string): void {
  if (warningTimer != null) window.clearTimeout(warningTimer);
  patch({ warning: message });
  warningTimer = window.setTimeout(() => {
    warningTimer = null;
    if (snapshot.warning === message) patch({ warning: null });
  }, WARNING_MS);
}

export function clearPlayWarning(): void {
  if (warningTimer != null) {
    window.clearTimeout(warningTimer);
    warningTimer = null;
  }
  if (snapshot.warning) patch({ warning: null });
}

function formatLxInterval(seconds: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function songToTrack(song: SearchSong): Track {
  return {
    id: `${song.source}:${song.id}`,
    title: song.name,
    artist: song.artist,
    album: song.album || "",
    duration: song.duration,
    source: "online",
    platform: song.source,
    coverUrl: song.cover,
    playUrl: song.playUrl,
    extra: {
      ...(song.extra || {}),
      ...(song.vip ? { vip: "true" } : {}),
    },
  };
}

function toLxMusicInfo(song: SearchSong): Record<string, unknown> | null {
  if (!LX_SOURCE[song.source]) return null;
  const extra = song.extra || {};
  const info: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value != null && value !== "") info[key] = value;
  };
  set("name", song.name);
  set("singer", song.artist);
  set("artists", song.artist ? song.artist.split(/[/、,，]\s*/).filter(Boolean) : undefined);
  set("albumName", song.album);
  set("interval", formatLxInterval(song.duration));
  set("duration", song.duration > 0 ? song.duration : undefined);
  set("img", song.cover);
  switch (song.source) {
    case "kuwo":
      set("songmid", extra.rid || song.id);
      break;
    case "kugou":
      set("hash", extra.hash || song.id);
      break;
    case "qq":
      set("songmid", extra.mid || song.id);
      break;
    case "netease":
      set("songmid", extra.song_id || song.id);
      break;
    case "migu":
      set("copyrightId", extra.copyright_id);
      set("songmid", extra.content_id || song.id);
      break;
    default:
      return null;
  }
  return info;
}

function trackToSearchSong(track: Track): SearchSong {
  const id = track.id.includes(":") ? track.id.slice(track.id.indexOf(":") + 1) : track.id;
  return {
    id,
    name: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover: track.coverUrl,
    source: String(track.platform || "netease"),
    playUrl: track.playUrl,
    extra: track.extra,
    vip: Boolean(track.extra?.vip),
  };
}

function qualityBr(quality: AudioQuality): number {
  if (quality === "128k") return 128000;
  if (quality === "flac") return 999000;
  return 320000;
}

function asAudioQuality(value: unknown): AudioQuality {
  if (value === "128k" || value === "320k" || value === "flac") return value;
  return "320k";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function nestedLyric(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const lyric = (raw as { lyric?: unknown }).lyric;
    if (typeof lyric === "string") return lyric;
  }
  return "";
}

function pickLyricParts(raw: unknown): { embedded: string; sidecar: string; any: string } {
  if (typeof raw === "string") {
    const text = raw.trim();
    return { embedded: "", sidecar: text, any: text };
  }
  const rec = asRecord(raw);
  if (!rec) return { embedded: "", sidecar: "", any: "" };
  const sidecar = typeof rec.sidecar === "string" ? rec.sidecar.trim() : "";
  const embedded =
    (typeof rec.embedded === "string" ? rec.embedded : typeof rec.embeddedLyrics === "string" ? rec.embeddedLyrics : "").trim();
  const lyric = typeof rec.lyric === "string" ? rec.lyric.trim() : "";
  const main = typeof rec.main === "string" ? rec.main.trim() : "";
  return { embedded, sidecar, any: sidecar || embedded || lyric || main };
}

function pickLyricText(raw: unknown): string {
  return pickLyricParts(raw).any;
}

function stampToSeconds(mm: string, ss: string, frac: string): number {
  const ms = frac.length === 3 ? Number(frac) : Number(frac.padEnd(3, "0"));
  return Number(mm) * 60 + Number(ss) + (Number.isFinite(ms) ? ms / 1000 : 0);
}

function looksLikeNeteaseYrc(raw: string): boolean {
  return /\[format:yrc\]/i.test(raw) || /^\s*\[\d+,\d+\]/.test(raw) || /\(\d+,\d+,-?\d+\)/.test(raw);
}

function looksLikeYrcWords(raw: string): boolean {
  return (
    looksLikeNeteaseYrc(raw) ||
    (/\[\d{1,2}:\d{2}\.\d{2,3}\]/.test(raw) && /<\d{1,2}:\d{2}\.\d{2,3}>/.test(raw))
  );
}

function parseNeteaseYrcWords(raw: string): LyricWord[] {
  const words: LyricWord[] = [];
  let line = 0;
  const body = raw.replace(/^\[format:yrc\]\s*/i, "");
  for (const row of body.split(/\r?\n/)) {
    const head = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;
    const re = /\((\d+),(\d+),-?\d+\)([^(]*)/g;
    let match: RegExpExecArray | null;
    let any = false;
    while ((match = re.exec(head[3] || ""))) {
      const text = match[3] ?? "";
      if (!text) continue;
      words.push({ time: Number(match[1]) / 1000, text, line });
      any = true;
    }
    if (any) line += 1;
  }
  return words;
}

export function parseYrcWords(raw: string): LyricWord[] {
  if (!raw || !looksLikeYrcWords(raw)) return [];
  if (looksLikeNeteaseYrc(raw)) return parseNeteaseYrcWords(raw);
  const words: LyricWord[] = [];
  let line = 0;
  const wordRe = /<(\d{1,2}):(\d{2})\.(\d{2,3})>([^<]*)/g;
  for (const row of raw.split(/\r?\n/)) {
    if (!/\[\d{1,2}:\d{2}\.\d{2,3}\]/.test(row)) continue;
    if (/<\d{1,2}:\d{2}\.\d{2,3}>/.test(row)) {
      wordRe.lastIndex = 0;
      for (const match of row.matchAll(wordRe)) {
        const text = match[4] ?? "";
        if (!text) continue;
        words.push({
          time: stampToSeconds(match[1], match[2], match[3]),
          text,
          line,
        });
      }
    }
    line += 1;
  }
  return words;
}

function neteaseSongId(track: Track): string {
  const extra = track.extra?.song_id;
  if (typeof extra === "string" && extra.trim()) return extra.trim();
  if (typeof extra === "number" && Number.isFinite(extra)) return String(extra);
  const id = track.id || "";
  if (id.startsWith("netease:")) return id.slice("netease:".length);
  if (track.platform === "netease") {
    const raw = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    if (/^\d+$/.test(raw)) return raw;
  }
  if (/^\d+$/.test(id)) return id;
  return "";
}

async function loadLocalLyricParts(path: string): Promise<{ embedded: string; sidecar: string }> {
  const empty = { embedded: "", sidecar: "" };
  const api = window.electronAPI;
  if (!api || !path) return empty;
  try {
    const parts = pickLyricParts(await api.getLocalFileLyricsDetailed(path));
    if (parts.embedded || parts.sidecar) return { embedded: parts.embedded, sidecar: parts.sidecar };
  } catch {
    /* fall through */
  }
  try {
    const any = pickLyricText(await api.getLocalFileLyrics(path));
    return { embedded: any, sidecar: "" };
  } catch {
    return empty;
  }
}

async function loadWebdavLyrics(track: Track): Promise<string> {
  const api = window.electronAPI;
  const accountId =
    typeof track.extra?.webdavAccountId === "string" ? track.extra.webdavAccountId : "";
  const remotePath =
    (typeof track.extra?.webdavPath === "string" ? track.extra.webdavPath : "") || track.filePath || "";
  if (!api?.webdav?.getSidecarLyrics || !accountId || !remotePath) return "";
  try {
    return pickLyricText(await api.webdav.getSidecarLyrics(accountId, remotePath));
  } catch {
    return "";
  }
}

async function fetchNeteaseLyrics(songId: string): Promise<{ yrc: string; lrc: string; tlyric: string }> {
  const empty = { yrc: "", lrc: "", tlyric: "" };
  const api = window.electronAPI;
  if (!api?.neteaseEapi || !songId) return empty;
  try {
    const raw = await api.neteaseEapi(
      "/eapi/song/lyric",
      JSON.stringify({ id: songId, lv: -1, tv: -1, rv: -1, yv: -1, csrf_token: "" }),
    );
    const json = asRecord(raw);
    if (!json) return empty;
    return {
      yrc: nestedLyric(json.yrc).trim(),
      lrc: nestedLyric(json.lrc).trim(),
      tlyric: nestedLyric(json.tlyric).trim(),
    };
  } catch {
    return empty;
  }
}

function pickPreferredLyric(opts: {
  embedded: string;
  sidecar: string;
  yrc: string;
  lrc: string;
  tlyric: string;
}): { main: string; tlyric: string } {
  const priority = getSettings().appearance.lyrics.sourcePriority;
  const sidecar = opts.sidecar.trim();
  const embedded = opts.embedded.trim();
  const yrc = opts.yrc.trim();
  const lrc = opts.lrc.trim();
  const online = yrc || lrc;
  const localYrc = looksLikeYrcWords(sidecar) ? sidecar : looksLikeYrcWords(embedded) ? embedded : "";
  const order =
    priority === "embedded"
      ? [embedded, sidecar, yrc, lrc]
      : priority === "sidecar"
        ? [sidecar, embedded, yrc, lrc]
        : priority === "online"
          ? [yrc, lrc, sidecar, embedded]
          : [yrc || localYrc, sidecar, embedded, lrc];
  const main = order.find((item) => item.trim())?.trim() || "";
  return { main, tlyric: opts.tlyric.trim() };
}

export async function loadLyricsFor(track: Track | null): Promise<void> {
  const gen = ++lyricsGen;
  if (!track) {
    patch({ lyrics: "", lyricWords: [] });
    return;
  }
  const songId = neteaseSongId(track);
  const [localParts, sidecarRemote, online] = await Promise.all([
    track.source === "local" && track.filePath
      ? loadLocalLyricParts(track.filePath)
      : Promise.resolve({ embedded: "", sidecar: "" }),
    track.source === "webdav" ? loadWebdavLyrics(track) : Promise.resolve(""),
    songId ? fetchNeteaseLyrics(songId) : Promise.resolve({ yrc: "", lrc: "", tlyric: "" }),
  ]);
  if (gen !== lyricsGen) return;
  const picked = pickPreferredLyric({
    embedded: localParts.embedded,
    sidecar: sidecarRemote || localParts.sidecar,
    yrc: online.yrc,
    lrc: online.lrc,
    tlyric: online.tlyric,
  });
  const lyrics = picked.tlyric ? `${picked.main}\n\n__KAZAM_TL__\n${picked.tlyric}` : picked.main;
  const lyricWords = parseYrcWords(picked.main);
  if (snapshot.currentTrack?.id !== track.id) return;
  patch({ lyrics, lyricWords });
}

function resolveLocalPlayUrl(track: Track): string {
  const api = window.electronAPI;
  if (!api) return "";
  if (track.source === "local" && track.filePath) {
    const url = api.getLocalUrl(track.filePath);
    return canEnqueuePlayUrl(url) ? url.trim() : "";
  }
  if (track.source === "webdav") {
    const accountId = typeof track.extra?.webdavAccountId === "string" ? track.extra.webdavAccountId : "";
    const remotePath =
      (typeof track.extra?.webdavPath === "string" ? track.extra.webdavPath : "") || track.filePath;
    if (accountId && remotePath) {
      const url = api.webdav.getPlayUrl(accountId, remotePath);
      return canEnqueuePlayUrl(url) ? url.trim() : "";
    }
  }
  return "";
}

async function tryLxPlayUrl(song: SearchSong, timeoutMs: number): Promise<string> {
  const api = window.electronAPI;
  const lx = api?.lx;
  const source = LX_SOURCE[song.source];
  const musicInfo = toLxMusicInfo(song);
  if (!lx?.musicUrl || !source || !musicInfo) return "";
  try {
    const res = (await lx.musicUrl({
      source,
      musicInfo,
      quality: snapshot.quality,
      timeoutMs,
    })) as { url?: string } | null;
    if (typeof res?.url === "string" && res.url.trim()) return res.url.trim();
  } catch (err) {
    console.log(
      `[lxSource] ${song.source}:${song.id} LX 取链失败:`,
      err instanceof Error ? err.message : err,
    );
  }
  return "";
}

async function tryNeteasePlayUrl(song: SearchSong): Promise<string> {
  const api = window.electronAPI;
  if (song.source !== "netease" || !api?.neteaseEapi) return "";
  try {
    const raw = await api.neteaseEapi(
      "/eapi/song/enhance/player/url",
      JSON.stringify({ ids: JSON.stringify([Number(song.id)]), br: qualityBr(snapshot.quality) }),
    );
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    const url = (json as { data?: Array<{ url?: string }> })?.data?.[0]?.url;
    if (typeof url === "string" && url) return url.trim();
  } catch (err) {
    console.log(
      `[neteaseUrl] ${song.id} 官方取链失败:`,
      err instanceof Error ? err.message : err,
    );
  }
  return "";
}

export async function resolvePlayUrl(input: SearchSong | Track): Promise<string> {
  const existing = "playUrl" in input && canEnqueuePlayUrl(input.playUrl) ? input.playUrl.trim() : "";
  if (existing) return existing;
  if ("source" in input && (input.source === "local" || input.source === "webdav")) {
    return resolveLocalPlayUrl(input as Track);
  }
  const song: SearchSong =
    "title" in input && !("name" in input) ? trackToSearchSong(input as Track) : (input as SearchSong);
  const mode = getSettings().lx.mode;
  if (mode === "only") return tryLxPlayUrl(song, 8000);
  if (mode === "prefer") {
    return (await tryLxPlayUrl(song, 8000)) || (await tryNeteasePlayUrl(song));
  }
  return (await tryNeteasePlayUrl(song)) || (await tryLxPlayUrl(song, 8000));
}

function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.volume = snapshot.volume;
  audio.addEventListener("timeupdate", () => {
    const el = audio;
    if (!el) return;
    const currentTime = el.currentTime || 0;
    const duration = Number.isFinite(el.duration) ? el.duration : snapshot.duration;
    const safeDuration = duration > 0 ? duration : snapshot.duration;
    pushLyricClock(currentTime, safeDuration, snapshot.state === "playing");
    const lyric = overlayLyric(currentTime);
    if (lyric.lineIndex !== lastOverlayLine) {
      lastOverlayLine = lyric.lineIndex;
      publishOverlays("full", currentTime);
    } else {
      publishOverlays("tick", currentTime);
    }
    if (
      Math.abs(currentTime - snapshot.currentTime) < 0.2 &&
      Math.abs(safeDuration - snapshot.duration) < 0.2
    ) {
      return;
    }
    patch({ currentTime, duration: safeDuration });
  });
  audio.addEventListener("durationchange", () => {
    const el = audio;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    patch({ duration: el.duration });
  });
  audio.addEventListener("playing", () => {
    patch({ state: "playing" });
    window.electronAPI?.powerSaveBlocker.acquire();
    if (audioCtx?.state === "suspended") void audioCtx.resume();
  });
  audio.addEventListener("pause", () => {
    if (snapshot.state === "loading") return;
    patch({ state: snapshot.currentTrack ? "paused" : "idle" });
    window.electronAPI?.powerSaveBlocker.release();
  });
  audio.addEventListener("ended", () => {
    void onEnded();
  });
  audio.addEventListener("error", () => {
    const name = snapshot.currentTrack?.title || "该歌曲";
    showPlayWarning(`"${name}" 暂无可用播放链接`);
    patch({ state: snapshot.currentTrack ? "paused" : "idle" });
    window.electronAPI?.powerSaveBlocker.release();
  });
  return audio;
}

function persistPlayback(): void {
  const api = window.electronAPI;
  if (!api?.dbSavePlayback) return;
  void api.dbSavePlayback({
    queue: snapshot.queue.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      source: track.source,
      platform: track.platform,
      coverUrl: track.coverUrl,
      playUrl: track.source === "online" ? undefined : track.playUrl,
      filePath: track.filePath,
      extra: track.extra,
    })),
    currentIndex: snapshot.currentIndex,
    currentTime: snapshot.currentTime,
    playMode: snapshot.playMode,
    volume: snapshot.volume,
    quality: snapshot.quality,
  });
}

function persistPlaybackSoon(): void {
  if (typeof window === "undefined") {
    persistPlayback();
    return;
  }
  if (persistTimer != null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persistPlayback();
  }, 400);
}

function canAttemptPlay(track: Track): boolean {
  if (canEnqueuePlayUrl(track.playUrl)) return true;
  if (track.source === "local" && track.filePath) return true;
  if (track.source === "webdav") return true;
  return track.source === "online" && Boolean(track.id);
}

function applyAudioSource(track: Track, index: number, start: boolean, resumeAt = 0): void {
  const shouldStart = start && startIntent;
  const el = getAudio();
  el.src = track.playUrl || "";
  const seekTo = resumeAt > 0 ? resumeAt : 0;
  try {
    el.currentTime = seekTo;
  } catch {
    /* seek after metadata */
  }
  const trackChanged = snapshot.currentTrack?.id !== track.id;
  if (trackChanged) {
    lyricsGen += 1;
    lastOverlayLine = -1;
    bindLyricSession(track);
  }
  patch({
    currentIndex: index,
    currentTrack: track,
    currentTime: seekTo,
    duration: track.duration || 0,
    lyrics: trackChanged ? "" : snapshot.lyrics,
    lyricWords: trackChanged ? [] : snapshot.lyricWords,
    state: shouldStart ? "loading" : "paused",
  });
  if (seekTo > 0) {
    el.addEventListener(
      "loadedmetadata",
      () => {
        try {
          el.currentTime = seekTo;
        } catch {
          /* ignore */
        }
      },
      { once: true },
    );
  }
  if (trackChanged) void loadLyricsFor(track);
  if (shouldStart) {
    void el.play().catch(() => {
      showPlayWarning(emptyPlayUrlWarning(track.title));
      patch({ state: "paused" });
    });
  }
  persistPlayback();
}

function loadCurrent(index: number, start = true, resumeAt = 0): boolean {
  const track = snapshot.queue[index];
  if (!track) {
    playGen += 1;
    lyricsGen += 1;
    lastOverlayLine = -1;
    startIntent = false;
    getAudio().pause();
    bindLyricSession(null);
    patch({
      currentIndex: -1,
      currentTrack: null,
      state: "idle",
      currentTime: 0,
      duration: 0,
      lyrics: "",
      lyricWords: [],
    });
    persistPlayback();
    return false;
  }
  const token = ++playGen;
  startIntent = start;
  if (canEnqueuePlayUrl(track.playUrl)) {
    applyAudioSource(track, index, start, resumeAt);
    return true;
  }
  if (!canAttemptPlay(track)) {
    showPlayWarning(emptyPlayUrlWarning(track.title));
    return false;
  }
  const trackChanged = snapshot.currentTrack?.id !== track.id;
  if (trackChanged) {
    lyricsGen += 1;
    lastOverlayLine = -1;
    bindLyricSession(track);
  }
  patch({
    currentIndex: index,
    currentTrack: track,
    currentTime: resumeAt,
    duration: track.duration || 0,
    lyrics: trackChanged ? "" : snapshot.lyrics,
    lyricWords: trackChanged ? [] : snapshot.lyricWords,
    state: start ? "loading" : "paused",
  });
  if (trackChanged) void loadLyricsFor(track);
  void (async () => {
    const url = await resolvePlayUrl({ ...track, playUrl: undefined });
    if (token !== playGen || snapshot.currentTrack?.id !== track.id) return;
    if (!canEnqueuePlayUrl(url)) {
      showPlayWarning(emptyPlayUrlWarning(track.title));
      patch({ state: snapshot.currentTrack ? "paused" : "idle" });
      return;
    }
    const nextTrack = { ...track, playUrl: url };
    const queue = snapshot.queue.map((item, i) => (i === index ? nextTrack : item));
    patch({ queue, currentTrack: nextTrack });
    applyAudioSource(nextTrack, index, start, resumeAt);
  })();
  return true;
}

function pickNextIndex(step: 1 | -1, fromEnded = false): number {
  const { queue, currentIndex, playMode } = snapshot;
  if (queue.length === 0) return -1;
  if (playMode === "repeat-one" && step === 1 && fromEnded) return currentIndex;
  if (playMode === "shuffle" && queue.length > 1) {
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * queue.length);
    return next;
  }
  const raw = currentIndex + step;
  if (playMode === "loop") return (raw + queue.length) % queue.length;
  if (raw < 0 || raw >= queue.length) return -1;
  return raw;
}

async function onEnded(): Promise<void> {
  if (snapshot.playMode === "repeat-one") {
    const el = getAudio();
    el.currentTime = 0;
    void el.play().catch(() => patch({ state: "paused" }));
    return;
  }
  const next = pickNextIndex(1, true);
  if (next < 0) {
    const el = getAudio();
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    patch({ state: "paused", currentTime: 0 });
    persistPlaybackSoon();
    return;
  }
  loadCurrent(next, true);
}

export function getPlayer(): PlayerSnapshot {
  return cloneSnapshot();
}

export function setQueueOpen(open: boolean): void {
  patch({ queueOpen: open });
}

export function setDetailOpen(open: boolean): void {
  patch({ detailOpen: open });
}

export function toggleDetail(): void {
  setDetailOpen(!snapshot.detailOpen);
}

export function toggleQueue(): void {
  setQueueOpen(!snapshot.queueOpen);
}

export function setVolume(volume: number): void {
  const next = Math.min(1, Math.max(0, volume));
  getAudio().volume = next;
  patch({ volume: next });
  persistPlaybackSoon();
}

export function getAudioElement(): HTMLAudioElement {
  return getAudio();
}

export function getAnalyser(): AnalyserNode | null {
  if (analyser && mediaSource) {
    if (audioCtx?.state === "suspended") void audioCtx.resume();
    return analyser;
  }
  const el = getAudio();
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.6;
    const source = ctx.createMediaElementSource(el);
    audioCtx = ctx;
    mediaSource = source;
    analyser = node;
    source.connect(node);
    node.connect(ctx.destination);
    if (ctx.state === "suspended") void ctx.resume();
    return node;
  } catch (err) {
    console.error("AudioContext 创建失败:", err);
    if (!mediaSource) {
      audioCtx = null;
      analyser = null;
    }
    return analyser;
  }
}

export async function setQuality(q: AudioQuality): Promise<void> {
  const quality = asAudioQuality(q);
  if (quality === snapshot.quality) return;
  patch({ quality });
  const track = snapshot.currentTrack;
  if (!track) return;
  const token = ++qualityGen;
  const trackId = track.id;
  const el = getAudio();
  const resumeAt = el.currentTime || snapshot.currentTime || 0;
  const wasPlaying = snapshot.state === "playing" || snapshot.state === "loading";
  const url = await resolvePlayUrl({ ...track, playUrl: undefined });
  if (token !== qualityGen || snapshot.currentTrack?.id !== trackId) return;
  if (!canEnqueuePlayUrl(url)) {
    showPlayWarning(emptyPlayUrlWarning(track.title));
    return;
  }
  const queue = snapshot.queue.map((item) => (item.id === trackId ? { ...item, playUrl: url } : item));
  const currentTrack = { ...track, playUrl: url };
  patch({ queue, currentTrack });
  const applyResume = () => {
    if (token !== qualityGen || snapshot.currentTrack?.id !== trackId) return;
    try {
      el.currentTime = resumeAt;
    } catch {
      /* ignore engines that reject currentTime before metadata */
    }
    patch({ currentTime: resumeAt });
  };
  el.addEventListener("loadedmetadata", applyResume, { once: true });
  el.src = url;
  applyResume();
  if (wasPlaying) {
    void el.play().catch(() => {
      showPlayWarning(emptyPlayUrlWarning(track.title));
      patch({ state: "paused" });
    });
  }
}

export function cyclePlayMode(): PlayMode {
  const order: PlayMode[] = ["sequence", "loop", "repeat-one", "shuffle"];
  const next = order[(order.indexOf(snapshot.playMode) + 1) % order.length];
  patch({ playMode: next });
  persistPlaybackSoon();
  return next;
}

export function setPlayMode(mode: string): void {
  const next: PlayMode =
    mode === "repeat-all" || mode === "loop"
      ? "loop"
      : mode === "shuffle"
        ? "shuffle"
        : mode === "repeat-one"
          ? "repeat-one"
          : "sequence";
  if (next === snapshot.playMode) return;
  patch({ playMode: next });
  persistPlaybackSoon();
}

/** Seek stub: jump HTMLAudioElement currentTime when a duration exists. */
export function seek(time: number): void {
  const el = getAudio();
  const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : snapshot.duration;
  if (!duration || duration <= 0) return;
  const next = Math.min(duration, Math.max(0, time));
  try {
    el.currentTime = next;
  } catch {
    /* seek stub: ignore engines that reject currentTime before metadata */
  }
  patch({ currentTime: next, duration });
}

export function toggle(): void {
  const el = getAudio();
  if (!snapshot.currentTrack) return;
  if (snapshot.state === "playing" || snapshot.state === "loading") {
    startIntent = false;
    el.pause();
    patch({ state: "paused" });
    persistPlaybackSoon();
    return;
  }
  startIntent = true;
  if (!canEnqueuePlayUrl(snapshot.currentTrack.playUrl)) {
    if (canAttemptPlay(snapshot.currentTrack) && snapshot.currentIndex >= 0) {
      loadCurrent(snapshot.currentIndex, true, snapshot.currentTime);
      return;
    }
    showPlayWarning(emptyPlayUrlWarning(snapshot.currentTrack.title));
    return;
  }
  void el.play().catch(() => {
    showPlayWarning(emptyPlayUrlWarning(snapshot.currentTrack?.title || "该歌曲"));
  });
}

export function next(): void {
  const index = pickNextIndex(1);
  if (index < 0) return;
  loadCurrent(index, true);
}

export function previous(): void {
  if (snapshot.currentTime > 3) {
    seek(0);
    return;
  }
  const index = pickNextIndex(-1);
  if (index < 0) {
    seek(0);
    return;
  }
  loadCurrent(index, true);
}

export function playAt(index: number): boolean {
  if (index < 0 || index >= snapshot.queue.length) return false;
  return loadCurrent(index, true);
}

export function removeFromQueue(id: string): void {
  const queue = snapshot.queue.filter((track) => track.id !== id);
  const currentId = snapshot.currentTrack?.id;
  if (!currentId || currentId === id) {
    patch({ queue });
    if (queue.length === 0) {
      getAudio().pause();
      getAudio().removeAttribute("src");
      lyricsGen += 1;
      bindLyricSession(null);
      patch({
        currentIndex: -1,
        currentTrack: null,
        state: "idle",
        currentTime: 0,
        duration: 0,
        lyrics: "",
        lyricWords: [],
      });
      return;
    }
    loadCurrent(Math.min(snapshot.currentIndex, queue.length - 1), snapshot.state === "playing");
    return;
  }
  patch({
    queue,
    currentIndex: queue.findIndex((track) => track.id === currentId),
  });
}

function enqueuePlayable(tracks: Track[], startIndex: number, start = true): boolean {
  const playable = tracks.filter((track) => canAttemptPlay(track));
  if (playable.length === 0) {
    const name = tracks[startIndex]?.title || tracks[0]?.title || "该歌曲";
    showPlayWarning(emptyPlayUrlWarning(name));
    return false;
  }
  const wanted = tracks[startIndex];
  const index = Math.max(
    0,
    wanted ? playable.findIndex((track) => track.id === wanted.id) : 0,
  );
  patch({ queue: playable });
  return loadCurrent(index < 0 ? 0 : index, start);
}

export function playQueue(tracks: Track[], index = 0): boolean {
  return enqueuePlayable(tracks, index, true);
}

export async function playTracks(tracks: Track[], index = 0): Promise<boolean> {
  return playQueue(tracks, index);
}

export async function playTrack(track: Track): Promise<boolean> {
  const playUrl = await resolvePlayUrl(track);
  if (!canEnqueuePlayUrl(playUrl)) {
    showPlayWarning(emptyPlayUrlWarning(track.title));
    return false;
  }
  const nextTrack = { ...track, playUrl };
  const existing = snapshot.queue.findIndex((item) => item.id === nextTrack.id);
  if (existing >= 0) {
    const queue = snapshot.queue.slice();
    queue[existing] = { ...queue[existing], ...nextTrack };
    patch({ queue });
    return loadCurrent(existing, true);
  }
  const insertAt = snapshot.currentIndex >= 0 ? snapshot.currentIndex + 1 : snapshot.queue.length;
  const queue = snapshot.queue.slice();
  queue.splice(insertAt, 0, nextTrack);
  patch({ queue });
  return loadCurrent(insertAt, true);
}

export async function playNext(track: Track): Promise<boolean> {
  const playUrl = await resolvePlayUrl(track);
  if (!canEnqueuePlayUrl(playUrl)) {
    showPlayWarning(emptyPlayUrlWarning(track.title));
    return false;
  }
  const nextTrack = { ...track, playUrl };
  const playingId = snapshot.currentTrack?.id;
  const queue = snapshot.queue.slice();
  const existing = queue.findIndex((item) => item.id === nextTrack.id);
  if (existing >= 0) queue.splice(existing, 1);
  const currentIndex = playingId ? queue.findIndex((item) => item.id === playingId) : -1;
  const insertAt = currentIndex >= 0 ? currentIndex + 1 : queue.length;
  queue.splice(insertAt, 0, nextTrack);
  patch({
    queue,
    currentIndex: playingId ? queue.findIndex((item) => item.id === playingId) : snapshot.currentIndex,
  });
  if (currentIndex < 0 && snapshot.currentIndex < 0) return loadCurrent(0, true);
  return true;
}

/**
 * Recovered `handlePlaySong` empty-url guard:
 * resolve playUrl, log EMPTY, refuse enqueue, visible warning.
 */
export async function handlePlaySong(song: SearchSong): Promise<boolean> {
  try {
    const url = await resolvePlayUrl(song);
    console.log(
      `[handlePlaySong] ${song.source}:${song.id} "${song.name}" / "${song.artist}" (dur=${song.duration}s, vip=${song.vip}) -> platform=${song.source} url=${
        url ? `${url.slice(0, 80)}${url.length > 80 ? "..." : ""}` : "EMPTY"
      }`,
    );
    if (!url) {
      showPlayWarning(emptyPlayUrlWarning(song.name));
      return false;
    }
    return playTrack({ ...songToTrack(song), playUrl: url });
  } catch (err) {
    console.error(`[handlePlaySong] ${song.source}:${song.id} error:`, err);
    showPlayWarning(emptyPlayUrlWarning(song.name));
    return false;
  }
}

export function setLyrics(lyrics: string): void {
  const main = lyrics.split("\n\n__KAZAM_TL__\n")[0] || "";
  patch({ lyrics, lyricWords: parseYrcWords(main) });
}

export function usePlayer(): PlayerSnapshot {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    const onChange: PlayerListener = (next) => setState(next);
    listeners.add(onChange);
    setState(getPlayer());
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return state;
}

function onEnqueueEvent(event: Event): void {
  const detail = (event as CustomEvent<{ tracks?: Track[]; index?: number }>).detail;
  if (!detail?.tracks?.length) return;
  playQueue(detail.tracks, detail.index ?? 0);
}

function asPlayMode(value: unknown): PlayMode {
  if (value === "shuffle" || value === "repeat-one" || value === "loop" || value === "sequence") return value;
  if (value === "repeat-all") return "loop";
  return "sequence";
}

function asTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : "";
  const title = typeof rec.title === "string" ? rec.title : "";
  if (!id || !title) return null;
  const source = rec.source === "local" || rec.source === "webdav" ? rec.source : "online";
  return {
    id,
    title,
    artist: typeof rec.artist === "string" ? rec.artist : "",
    album: typeof rec.album === "string" ? rec.album : "",
    duration: typeof rec.duration === "number" ? rec.duration : 0,
    source,
    platform: typeof rec.platform === "string" ? rec.platform : undefined,
    coverUrl: typeof rec.coverUrl === "string" ? rec.coverUrl : undefined,
    playUrl: source === "online" ? undefined : typeof rec.playUrl === "string" ? rec.playUrl : undefined,
    filePath: typeof rec.filePath === "string" ? rec.filePath : undefined,
    extra: rec.extra && typeof rec.extra === "object" ? (rec.extra as Track["extra"]) : undefined,
  };
}

async function restorePlayback(): Promise<void> {
  const api = window.electronAPI;
  if (!api?.dbGetPlayback) return;
  try {
    const raw = await api.dbGetPlayback();
    const rec = asRecord(raw) || asRecord((raw as { data?: unknown } | null)?.data);
    if (!rec) return;
    const queueRaw = rec.queue ?? rec.tracks;
    const queue = Array.isArray(queueRaw) ? queueRaw.map(asTrack).filter((track): track is Track => Boolean(track)) : [];
    if (queue.length === 0) return;
    const currentIndex = Math.min(
      Math.max(0, Number(rec.currentIndex ?? rec.index ?? 0) || 0),
      queue.length - 1,
    );
    const currentTime = Math.max(0, Number(rec.currentTime ?? rec.position ?? 0) || 0);
    const volume = Math.min(1, Math.max(0, Number(rec.volume ?? snapshot.volume)));
    const playMode = asPlayMode(rec.playMode ?? rec.mode);
    const quality = asAudioQuality(rec.quality);
    getAudio().volume = volume;
    patch({ queue, volume, playMode, quality });
    loadCurrent(currentIndex, false, currentTime);
  } catch (err) {
    console.log("[player] restore playback failed:", err instanceof Error ? err.message : err);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(ENQUEUE_EVENT, onEnqueueEvent);
  window.electronAPI?.onMediaCommand?.((cmd) => {
    if (cmd === "toggle") toggle();
    else if (cmd === "next") next();
    else if (cmd === "previous") previous();
    else if (cmd === "stop") {
      getAudio().pause();
      seek(0);
      patch({ state: snapshot.currentTrack ? "paused" : "idle" });
    }
  });
  void restorePlayback();
}
