import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button, Empty, Input, Segmented, Spin, message } from "antd";
import { brand } from "../brand/assets";
import { EmptyState } from "../shell/EmptyState";
import {
  canEnqueuePlayUrl,
  type SearchAlbum,
  type SearchLyric,
  type SearchMv,
  type SearchPlaylist,
  type SearchSong,
  type SearchTab,
  type Track,
} from "../../shared/types";
import { resolvePlayUrl as resolvePlayerUrl } from "../stores/player";

const TRACK_ROW_HEIGHT = 56;
const LINUX_FORWARD = "http://music.163.com/api/linux/forward";
const NETEASE_REFERER = "http://music.163.com/";
const LINUX_KEY_HEX = "7246674226682325323F5E6544673A51";
const KUWO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64 x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const SOURCE_WEIGHT: Record<string, number> = {
  netease: 5,
  kuwo: 4,
  qq: 3,
  kugou: 3,
  migu: 2,
  soda: 0,
};

const SOURCE_ORDER = ["netease", "kuwo", "qq", "kugou", "migu", "soda"] as const;

const URL_CHECK_SOURCES = new Set(["migu"]);

type TabLoading = Record<SearchTab, boolean>;

export type SearchPageProps = {
  keyword?: string;
  searchRequestId?: number;
  currentTrackId?: string;
  onRemove?: (id: string) => void;
  onPlayNext?: (track: Track) => void;
  onPlayAll?: (tracks: Track[]) => void;
  onPlaySong?: (song: SearchSong) => void | Promise<void>;
  onOpenPlaylist?: (playlist: SearchPlaylist) => void;
  onOpenAlbum?: (album: SearchAlbum) => void;
  onOpenMv?: (mv: SearchMv) => void;
  onDownload?: (track: Track) => void;
  onSaveToPlaylist?: (track: Track) => void;
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = 16 - (data.length % 16 || 16);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

async function aesEcbEncryptHex(plain: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex) as BufferSource,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const padded = pkcs7Pad(new TextEncoder().encode(plain));
  const out = new Uint8Array(padded.length);
  const zeroIv = new Uint8Array(16);
  for (let i = 0; i < padded.length; i += 16) {
    const block = padded.slice(i, i + 16);
    const enc = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: zeroIv as BufferSource },
        key,
        block as BufferSource,
      ),
    );
    out.set(enc.subarray(0, 16), i);
  }
  return bytesToHex(out);
}

function asJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const jsonp = trimmed.match(/^[a-zA-Z_][\w.]*\(([\s\S]*)\)\s*;?\s*$/);
    const body = jsonp ? jsonp[1] : trimmed;
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function highlight(text: string, keyword: string, className = "search-highlight"): ReactNode {
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.split(re).map((part, i) => (re.test(part) ? <span className={className} key={i}>{part}</span> : part));
}

function formatCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatYear(raw: unknown): string {
  if (!raw) return "";
  const n = Number(raw);
  if (!n) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}`;
}

function songToTrack(song: SearchSong): Track {
  return {
    id: `${song.source}:${song.id}`,
    title: song.name,
    artist: song.artist,
    album: song.album || "",
    duration: song.duration,
    source: "online",
    platform: song.source,
    coverUrl: song.cover,
    extra: {
      ...(song.extra || {}),
      ...(song.vip ? { vip: "true" } : {}),
    },
  };
}

function normalizeKey(value: string): string {
  return value.replace(/[^\w\u4e00-\u9fff]/g, "").toLowerCase().trim();
}

function songBucket(song: SearchSong): string {
  const dur = song.duration > 0 ? Math.floor(song.duration / 30) : 0;
  return `${normalizeKey(song.name)}|${normalizeKey(song.artist)}|${dur}`;
}

const COVER_MARK = /(?:live|翻唱|伴奏|cover|karaoke|铃声|片段|纯音乐|钢琴|吉他|弹唱|remix|夜店|dj)/i;

function queryVariants(keyword: string): string[] {
  const q = keyword.trim();
  if (!q) return [];
  const set = new Set<string>([q]);
  if (q.includes("与")) set.add(q.replaceAll("与", "问"));
  if (q.includes("问")) set.add(q.replaceAll("问", "与"));
  if (q.includes("和")) set.add(q.replaceAll("和", "与"));
  return [...set];
}

function relevanceScore(song: SearchSong, keyword: string): number {
  const name = normalizeKey(song.name);
  const keys = queryVariants(keyword).map(normalizeKey).filter(Boolean);
  let score = SOURCE_WEIGHT[song.source] ?? 0;
  if (keys.some((key) => name === key)) score += 140;
  else if (keys.some((key) => name.startsWith(key))) score += 90;
  else if (keys.some((key) => name.includes(key))) score += 50;
  if (COVER_MARK.test(song.name)) score -= 55;
  score -= Math.min(song.searchRank ?? 0, 40);
  return score;
}

function pickBestSong(group: SearchSong[], keyword: string): SearchSong | null {
  const playable = group.filter((s) => s.playable !== false);
  if (playable.length === 0) return null;
  playable.sort((a, b) => {
    const ra = relevanceScore(a, keyword);
    const rb = relevanceScore(b, keyword);
    if (rb !== ra) return rb - ra;
    const wa = SOURCE_WEIGHT[a.source] ?? -1;
    const wb = SOURCE_WEIGHT[b.source] ?? -1;
    if (wb !== wa) return wb - wa;
    return (a.searchRank ?? 999) - (b.searchRank ?? 999);
  });
  const { searchRank: _r, playable: _p, ...rest } = playable[0];
  return rest;
}

function mergeSongs(bySource: Partial<Record<string, SearchSong[]>>, keyword: string): SearchSong[] {
  const tokens = keyword.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const sodaOk = (song: SearchSong) => {
    if (song.source !== "soda" || !tokens.length) return true;
    const hay = `${song.name} ${song.artist}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  };
  const order: string[] = [];
  const groups = new Map<string, SearchSong[]>();
  const seen = new Map<string, Set<string>>();
  for (const source of SOURCE_ORDER) {
    for (const song of bySource[source] || []) {
      if (!sodaOk(song)) continue;
      const bucket = songBucket(song);
      const sid = `${song.source}:${song.id}`;
      if (!groups.has(bucket)) {
        groups.set(bucket, []);
        order.push(bucket);
        seen.set(bucket, new Set());
      }
      const ids = seen.get(bucket)!;
      if (ids.has(sid)) continue;
      ids.add(sid);
      groups.get(bucket)!.push(song);
    }
  }
  const out: SearchSong[] = [];
  for (const key of order) {
    const best = pickBestSong(groups.get(key) || [], keyword);
    if (best) out.push(best);
  }
  out.sort((a, b) => relevanceScore(b, keyword) - relevanceScore(a, keyword));
  return out;
}

function lyricSnippetFrom(raw: string, keyword: string): string {
  if (!raw || !keyword.trim()) return "";
  const needle = keyword.trim();
  const line = raw
    .replace(/\[\d{2}:\d{2}(?:\.\d+)?\]/g, "\n")
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .find((s) => s.includes(needle));
  if (!line) return "";
  return line.length > 96 ? `${line.slice(0, 96)}…` : line;
}

async function neteaseCloudSearch(params: {
  s: string;
  type: number;
  offset: number;
  limit: number;
}): Promise<Record<string, unknown>> {
  const api = window.electronAPI;
  if (api?.neteaseEapi) {
    try {
      const raw = await api.neteaseEapi(
        "/eapi/cloudsearch/pc",
        JSON.stringify({
          s: params.s,
          type: params.type,
          offset: params.offset,
          limit: params.limit,
          total: true,
          csrf_token: "",
        }),
      );
      const json = asJson(raw);
      if (json && num(json.code) === 200) return json;
    } catch (err) {
      console.log("[search] eapi cloudsearch failed", err);
    }
  }
  if (!api?.neteasePost) throw new Error("electronAPI.neteasePost 不可用");
  const payload = JSON.stringify({
    method: "POST",
    url: "http://music.163.com/api/cloudsearch/pc",
    params,
  });
  const eparams = await aesEcbEncryptHex(payload, LINUX_KEY_HEX);
  const raw = await api.neteasePost(LINUX_FORWARD, `eparams=${encodeURIComponent(eparams)}`, {
    Referer: NETEASE_REFERER,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const json = asJson(raw);
  if (!json) throw new Error("网易云搜索返回无效");
  return json;
}

function mapNeteaseSong(raw: Record<string, unknown>, rank: number): SearchSong {
  const artists = (raw.ar || raw.artists || []) as Array<Record<string, unknown>>;
  const album = (raw.al || raw.album || {}) as Record<string, unknown>;
  const privilege = (raw.privilege || {}) as Record<string, unknown>;
  const durationMs = num(raw.dt ?? raw.duration);
  const fee = num(raw.fee ?? privilege.fee);
  const fl = num(privilege.fl);
  return {
    id: str(raw.id),
    name: str(raw.name),
    artist: artists.map((a) => str(a.name)).filter(Boolean).join("、"),
    album: str(album.name),
    duration: Math.floor(durationMs / 1000),
    cover: str(album.picUrl),
    link: `https://music.163.com/#/song?id=${raw.id}`,
    source: "netease",
    extra: { song_id: str(raw.id), fl: String(fl), fee: String(fee) },
    vip: fee === 1,
    searchRank: rank,
    playable: fl > 0,
  };
}

function mapNeteasePlaylist(raw: Record<string, unknown>): SearchPlaylist {
  const creator = (raw.creator || {}) as Record<string, unknown>;
  return {
    id: str(raw.id),
    name: str(raw.name),
    cover: str(raw.coverImgUrl),
    trackCount: num(raw.trackCount),
    playCount: num(raw.playCount),
    creator: str(creator.nickname),
    description: str(raw.description),
    link: `https://music.163.com/#/playlist?id=${raw.id}`,
    source: "netease",
  };
}

function mapNeteaseAlbum(raw: Record<string, unknown>): SearchAlbum {
  const artist = raw.artist as Record<string, unknown> | undefined;
  const artists = (raw.artists || []) as Array<Record<string, unknown>>;
  const creator =
    str(artist?.name) || artists.map((a) => str(a.name)).filter(Boolean).join("、");
  return {
    id: str(raw.id),
    name: str(raw.name),
    cover: str(raw.picUrl),
    trackCount: num(raw.size),
    creator,
    description: str(raw.description || raw.briefDesc),
    link: `https://music.163.com/#/album?id=${raw.id}`,
    source: "netease",
    extra: {
      type: "album",
      company: str(raw.company),
      publishTime: str(raw.publishTime),
    },
  };
}

function mapNeteaseMv(raw: Record<string, unknown>): SearchMv {
  const artists = (raw.artists || []) as Array<Record<string, unknown>>;
  const artistName = str(raw.artistName) || artists.map((a) => str(a.name)).filter(Boolean).join("、");
  const artistId = raw.artistId ? str(raw.artistId) : str(artists[0]?.id);
  return {
    id: str(raw.id),
    name: str(raw.name),
    cover: str(raw.cover),
    artistName,
    artistId,
    duration: Math.floor(num(raw.duration) / 1000),
    playCount: num(raw.playCount),
    description: str(raw.desc || raw.briefDesc),
    link: `https://music.163.com/#/mv?id=${raw.id}`,
    source: "netease",
  };
}

function upgradeKuwoCover(raw: string): string {
  if (!raw) return "";
  let url = raw.trim();
  if (url.startsWith("//")) url = `http:${url}`;
  else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://img1.kuwo.cn/star/albumcover/${url.replace(/^\//, "")}`;
  }
  return url
    .replace("/120/", "/500/")
    .replace("/150/", "/500/")
    .replace("/240/", "/500/")
    .replace("_100.", "_500.")
    .replace("_120.", "_500.")
    .replace("_150.", "_500.")
    .replace("_240.", "_500.");
}

function mapKuwoSong(raw: Record<string, unknown>, rank: number): SearchSong {
  const rid = str(raw.MUSICRID).replace(/^MUSIC_/, "");
  const minfo = str(raw.MINFO);
  let quality = "";
  if (minfo) {
    let best = 0;
    for (const part of minfo.split(";")) {
      const fields: Record<string, string> = {};
      for (const kv of part.split(",")) {
        const [k, v] = kv.split(":");
        if (k && v) fields[k] = v;
      }
      const br = Number.parseInt(fields.bitrate || "0", 10);
      if (br > best) best = br;
    }
    if (best >= 800) quality = "SQ";
    else if (best >= 320) quality = "HQ";
  }
  const bitSwitch = num(raw.bitSwitch);
  if (!quality && bitSwitch) {
    if (bitSwitch & 8) quality = "SQ";
    else if (bitSwitch & 4) quality = "HQ";
  }
  return {
    id: rid,
    name: str(raw.SONGNAME),
    artist: str(raw.ARTIST),
    album: str(raw.ALBUM),
    duration: Number.parseInt(str(raw.DURATION), 10) || 0,
    cover: upgradeKuwoCover(str(raw.web_albumpic_short || raw.hts_MVPIC)),
    link: `http://www.kuwo.cn/play_detail/${rid}`,
    source: "kuwo",
    extra: { rid, quality },
    vip: false,
    searchRank: rank,
    playable: bitSwitch !== 0,
  };
}

async function searchNeteaseSongs(keyword: string, limit = 30): Promise<SearchSong[]> {
  const json = await neteaseCloudSearch({ s: keyword, type: 1, offset: 0, limit });
  if (num(json.code) !== 200) throw new Error(`netease search error: code=${json.code}`);
  const result = (json.result || {}) as Record<string, unknown>;
  const songs = (result.songs || []) as Array<Record<string, unknown>>;
  return songs.map((song, i) => mapNeteaseSong(song, i));
}

async function searchKuwoSongs(keyword: string, limit = 30): Promise<SearchSong[]> {
  const api = window.electronAPI;
  if (!api?.neteasePost && !api?.kuwoGet) throw new Error("electronAPI 搜索通道不可用");
  const url = `http://www.kuwo.cn/search/searchMusicBykeyWord?${new URLSearchParams({
    vipver: "1",
    client: "kt",
    ft: "music",
    cluster: "0",
    strategy: "2012",
    encoding: "utf8",
    rformat: "json",
    mobi: "1",
    issubtitle: "1",
    show_copyright_off: "1",
    pn: "0",
    rn: String(limit),
    all: keyword,
  }).toString()}`;
  const headers = { "User-Agent": KUWO_UA, Referer: "http://www.kuwo.cn/" };
  const raw = api.kuwoGet ? await api.kuwoGet(url) : await api.neteasePost(url, "", headers);
  const json = asJson(raw);
  const list = ((json?.abslist || []) as Array<Record<string, unknown>>);
  return list.map((item, i) => mapKuwoSong(item, i));
}

function mapQqSong(raw: Record<string, unknown>, rank: number): SearchSong | null {
  const id = str(raw.songmid || raw.mid || raw.songid || raw.id);
  if (!id) return null;
  const singers = (raw.singer || raw.singers || []) as Array<Record<string, unknown>>;
  const album = (raw.album as Record<string, unknown> | undefined) || {};
  const albumMid = str(album.mid || raw.albummid);
  const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";
  return {
    id,
    name: str(raw.songname || raw.name || raw.title),
    artist: singers.map((item) => str(item.name)).filter(Boolean).join("、") || str(raw.singername),
    album: str(album.name || raw.albumname),
    duration: num(raw.interval || raw.songduration),
    cover,
    link: `https://y.qq.com/n/ryqq/songDetail/${id}`,
    source: "qq",
    extra: { mid: id, songmid: id },
    vip: num((raw.pay as Record<string, unknown> | undefined)?.pay_play ?? raw.payplay) > 0,
    searchRank: rank,
  };
}

function mapKugouSong(raw: Record<string, unknown>, rank: number): SearchSong | null {
  const hash = str(raw.hash || raw.FileHash);
  if (!hash) return null;
  const filename = str(raw.filename || raw.FileName || raw.songname);
  const split = filename.split(" - ");
  const artist = split.length > 1 ? split[0] : str(raw.singername);
  const name = split.length > 1 ? split.slice(1).join(" - ") : filename;
  return {
    id: hash,
    name: name || str(raw.songname),
    artist,
    album: str(raw.album_name || raw.albumname),
    duration: num(raw.duration || raw.timeLength),
    cover: str((raw.trans_param as Record<string, unknown> | undefined)?.union_cover || raw.img).replace("{size}", "240"),
    link: `https://www.kugou.com/song/#hash=${hash}`,
    source: "kugou",
    extra: { hash },
    vip: Boolean(raw.privilege === 10 || raw.fail_process),
    searchRank: rank,
  };
}

async function searchQqSongs(keyword: string, limit = 30): Promise<SearchSong[]> {
  const api = window.electronAPI;
  if (!api?.qqGet) return [];
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${new URLSearchParams({
    w: keyword,
    p: "1",
    n: String(limit),
    format: "json",
    cr: "1",
    g_tk: "5381",
    t: "0",
  }).toString()}`;
  const raw = await api.qqGet(url, { Referer: "https://y.qq.com/" });
  const json = asJson(raw);
  const list = ((json?.data as Record<string, unknown> | undefined)?.song as Record<string, unknown> | undefined)?.list;
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => mapQqSong(item as Record<string, unknown>, i)).filter((song): song is SearchSong => Boolean(song));
}

async function searchKugouSongs(keyword: string, limit = 30): Promise<SearchSong[]> {
  const api = window.electronAPI;
  if (!api?.kugouGet) return [];
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?${new URLSearchParams({
    keyword,
    page: "1",
    pagesize: String(limit),
  }).toString()}`;
  const raw = await api.kugouGet(url);
  const json = asJson(raw);
  const info = ((json?.data as Record<string, unknown> | undefined)?.info || []) as Array<Record<string, unknown>>;
  return info.map((item, i) => mapKugouSong(item, i)).filter((song): song is SearchSong => Boolean(song));
}

async function searchSongs(keyword: string): Promise<SearchSong[]> {
  const q = keyword.trim();
  if (!q) return [];
  const run = async (name: string, fn: () => Promise<SearchSong[]>) => {
    try {
      const list = await fn();
      console.log(`[search] ${name}: ${list.length} results`);
      return list;
    } catch (err) {
      console.log(`[search] ${name} FAILED:`, err instanceof Error ? err.message : err);
      return [] as SearchSong[];
    }
  };
  const variants = queryVariants(q);
  const extraNetease = variants.filter((item) => item !== q).slice(0, 1);
  const [netease, neteaseAlias, kuwo, qq, kugou] = await Promise.all([
    run("netease", () => searchNeteaseSongs(q)),
    extraNetease[0] ? run("netease-alias", () => searchNeteaseSongs(extraNetease[0])) : Promise.resolve([] as SearchSong[]),
    run("kuwo", () => searchKuwoSongs(q)),
    run("qq", () => searchQqSongs(q)),
    run("kugou", () => searchKugouSongs(q)),
  ]);
  return mergeSongs({ netease: [...netease, ...neteaseAlias], kuwo, qq, kugou }, q);
}

async function searchPlaylists(keyword: string): Promise<SearchPlaylist[]> {
  if (!keyword.toLowerCase().trim()) return [];
  try {
    const json = await neteaseCloudSearch({ s: keyword, type: 1000, offset: 0, limit: 30 });
    if (num(json.code) !== 200) throw new Error(`netease playlist search error: code=${json.code}`);
    const result = (json.result || {}) as Record<string, unknown>;
    return ((result.playlists || []) as Array<Record<string, unknown>>).map(mapNeteasePlaylist);
  } catch (err) {
    console.error("netease playlist search failed:", err);
    return [];
  }
}

async function searchAlbums(keyword: string): Promise<SearchAlbum[]> {
  if (!keyword.toLowerCase().trim()) return [];
  try {
    const json = await neteaseCloudSearch({ s: keyword, type: 10, offset: 0, limit: 30 });
    if (num(json.code) !== 200) throw new Error(`netease album search error: code=${json.code}`);
    const result = (json.result || {}) as Record<string, unknown>;
    return ((result.albums || []) as Array<Record<string, unknown>>).map(mapNeteaseAlbum);
  } catch (err) {
    console.error("netease album search failed:", err);
    return [];
  }
}

async function searchMvs(keyword: string): Promise<SearchMv[]> {
  if (!keyword.trim()) return [];
  try {
    const json = await neteaseCloudSearch({ s: keyword, type: 1004, offset: 0, limit: 30 });
    if (num(json.code) !== 200) throw new Error(`netease mv search error: code=${json.code}`);
    const result = (json.result || {}) as Record<string, unknown>;
    return ((result.mvs || []) as Array<Record<string, unknown>>).map(mapNeteaseMv);
  } catch (err) {
    console.error("netease mv search failed:", err);
    return [];
  }
}

async function fetchLyricText(songId: string): Promise<string> {
  const api = window.electronAPI;
  if (!api?.neteaseEapi) return "";
  try {
    const raw = await api.neteaseEapi(
      "/eapi/song/lyric",
      JSON.stringify({ id: songId, lv: -1, tv: -1, rv: -1, yv: -1, csrf_token: "" }),
    );
    const json = asJson(raw);
    if (!json) return "";
    const yrc = (json.yrc as Record<string, unknown> | undefined)?.lyric;
    const lrc = (json.lrc as Record<string, unknown> | undefined)?.lyric;
    return str(yrc || lrc);
  } catch {
    return "";
  }
}

async function searchLyrics(keyword: string): Promise<SearchLyric[]> {
  const q = keyword.trim();
  if (!q) return [];
  try {
    const json = await neteaseCloudSearch({ s: q, type: 1006, offset: 0, limit: 30 });
    if (num(json.code) !== 200) throw new Error(`netease lyric search error: code=${json.code}`);
    const result = (json.result || {}) as Record<string, unknown>;
    const songs = ((result.songs || []) as Array<Record<string, unknown>>)
      .map((song, i) => mapNeteaseSong(song, i))
      .filter((s) => s.source === "netease");
    return (
      await Promise.all(
        songs.slice(0, 20).map(async (song) => {
          try {
            const text = await fetchLyricText(song.id);
            return { ...song, lyricSnippet: lyricSnippetFrom(text, q) };
          } catch {
            return { ...song, lyricSnippet: "" };
          }
        }),
      )
    ).map(({ searchRank: _r, playable: _p, ...rest }) => rest);
  } catch (err) {
    console.error("netease lyric search failed:", err);
    return [];
  }
}

async function resolvePlayUrl(song: SearchSong): Promise<string> {
  try {
    return await resolvePlayerUrl(song);
  } catch (err) {
    console.log(`[lxSource] ${song.source}:${song.id} 取链失败:`, err instanceof Error ? err.message : err);
    return "";
  }
}

async function refineSearchSongs(songs: SearchSong[], concurrency = 6): Promise<SearchSong[]> {
  if (songs.length === 0) return [];
  const indexes = songs.map((s, i) => (URL_CHECK_SOURCES.has(String(s.source)) ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) return songs;
  const drop = new Set<number>();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const pos = cursor++;
      if (pos >= indexes.length) break;
      const idx = indexes[pos];
      const url = await Promise.race([
        resolvePlayUrl(songs[idx]),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), 4000)),
      ]);
      if (!url) drop.add(idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, indexes.length) }, () => worker()));
  return drop.size === 0 ? songs : songs.filter((_, i) => !drop.has(i));
}

function IconMusic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  );
}

function IconPlaylist({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M3 6h12v2H3V6zm0 5h12v2H3v-2zm0 5h8v2H3v-2zm14-8v8.18A3 3 0 1 0 19 19V8h3V6h-5z" />
    </svg>
  );
}

function IconAlbum({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm0 14.5A4.5 4.5 0 1 1 12 7a4.5 4.5 0 0 1 0 9.5zm0-6.5a2 2 0 1 0 .001 4.001A2 2 0 0 0 12 10z" />
    </svg>
  );
}

function IconVideo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

function IconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M854.6 288.6L639.4 73.4c-6-6-14.1-9.4-22.6-9.4H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V311.3c0-8.5-3.4-16.7-9.4-22.7zM790.2 326H602V137.8L790.2 326zm1.8 562H232V136h302v216a42 42 0 0042 42h216v494zM504 618H320c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8zM312 490v48c0 4.4 3.6 8 8 8h384c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H320c-4.4 0-8 3.6-8 8z" />
    </svg>
  );
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SearchEmpty({ title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return <EmptyState image={brand.empty.search} title={title} hint={hint} />;
}

function SearchCard({
  cover,
  fallbackIcon,
  title,
  meta,
  onClick,
  showHoverIcon,
}: {
  cover?: string;
  fallbackIcon: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  onClick?: () => void;
  showHoverIcon?: boolean;
}) {
  const clickable = Boolean(onClick);
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onClick();
    }
  };
  return (
    <div
      className="search-card"
      onClick={onClick}
      onKeyDown={onKey}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="search-card-cover">
        {cover ? <img src={cover} alt="" /> : <div className="search-card-cover-inner">{fallbackIcon}</div>}
        {clickable && showHoverIcon !== false ? <IconPlay className="search-card-play-icon" /> : null}
      </div>
      <div className="search-card-info">
        <div className="search-card-title">{title}</div>
        <div className="search-card-meta">{meta}</div>
      </div>
    </div>
  );
}

function TrackList({
  tracks,
  currentIndex,
  onSelect,
  onRemove,
  onPlayNext,
  onDownload,
  onSaveToPlaylist,
  showPlatform,
}: {
  tracks: Track[];
  currentIndex: number;
  onSelect?: (index: number) => void;
  onRemove?: (id: string) => void;
  onPlayNext?: (track: Track) => void;
  onDownload?: (track: Track) => void;
  onSaveToPlaylist?: (track: Track) => void;
  showPlatform?: boolean;
}) {
  return (
    <div className="search-track-list">
      {tracks.map((track, index) => {
        const active = index === currentIndex;
        return (
          <div
            key={track.id}
            className={`search-track-row${active ? " is-current" : ""}`}
            style={{ minHeight: TRACK_ROW_HEIGHT }}
            onClick={() => onSelect?.(index)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect?.(index);
              }
            }}
          >
            <span className="search-track-index">{index + 1}</span>
            <div className="search-track-cover">
              {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <IconMusic />}
            </div>
            <div className="search-track-main">
              <div className="search-track-title">
                {track.title}
                {track.extra?.vip ? <span className="search-track-vip">VIP</span> : null}
              </div>
              <div className="search-track-sub">
                {showPlatform && track.platform ? <span className="search-track-platform">{track.platform}</span> : null}
                <span>{track.artist}</span>
                {track.album ? <span> · {track.album}</span> : null}
              </div>
            </div>
            <span className="search-track-duration">{formatDuration(track.duration)}</span>
            <div className="search-track-actions" onClick={(ev) => ev.stopPropagation()}>
              {onPlayNext ? (
                <button type="button" title="下一首播放" onClick={() => onPlayNext(track)}>
                  下一首
                </button>
              ) : null}
              {onSaveToPlaylist ? (
                <button type="button" title="收藏到歌单" onClick={() => onSaveToPlaylist(track)}>
                  收藏
                </button>
              ) : null}
              {onDownload ? (
                <button type="button" title="下载" onClick={() => onDownload(track)}>
                  下载
                </button>
              ) : null}
              {onRemove ? (
                <button type="button" title="移除" onClick={() => onRemove(track.id)}>
                  移除
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchPageInner({
  keyword: keywordProp,
  searchRequestId,
  currentTrackId,
  onRemove,
  onPlayNext,
  onPlayAll,
  onPlaySong,
  onOpenPlaylist,
  onOpenAlbum,
  onOpenMv,
  onDownload,
  onSaveToPlaylist,
}: SearchPageProps) {
  const controlled = keywordProp != null;
  const [draft, setDraft] = useState(keywordProp ?? "");
  const [localKeyword, setLocalKeyword] = useState((keywordProp ?? "").trim());
  const [localRequestId, setLocalRequestId] = useState(0);
  const [playingId, setPlayingId] = useState(currentTrackId);

  const keyword = (controlled ? keywordProp : localKeyword).trim();
  const requestId = controlled ? (searchRequestId ?? 0) : localRequestId;

  const [tab, setTab] = useState<SearchTab>("songs");
  const [songs, setSongs] = useState<SearchSong[]>([]);
  const [playlists, setPlaylists] = useState<SearchPlaylist[]>([]);
  const [albums, setAlbums] = useState<SearchAlbum[]>([]);
  const [mvs, setMvs] = useState<SearchMv[]>([]);
  const [lyrics, setLyrics] = useState<SearchLyric[]>([]);
  const [loading, setLoading] = useState<TabLoading>({
    songs: false,
    playlists: false,
    albums: false,
    mvs: false,
    lyrics: false,
  });
  const [loaded, setLoaded] = useState(() => new Set<SearchTab>());
  const [errors, setErrors] = useState<Partial<Record<SearchTab, string>>>({});

  const generationRef = useRef(0);
  const refineGenRef = useRef(0);
  const fetchedRef = useRef(new Set<SearchTab>());
  const inflightRef = useRef(new Set<SearchTab>());
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    setPlayingId(currentTrackId);
  }, [currentTrackId]);

  useEffect(() => {
    if (controlled) setDraft(keywordProp ?? "");
  }, [controlled, keywordProp]);

  const setTabLoading = useCallback((key: SearchTab, value: boolean) => {
    setLoading((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const resetResults = useCallback(() => {
    fetchedRef.current = new Set();
    inflightRef.current = new Set();
    setLoaded(new Set());
    setLoading({ songs: false, playlists: false, albums: false, mvs: false, lyrics: false });
    setErrors({});
    setSongs([]);
    setPlaylists([]);
    setAlbums([]);
    setMvs([]);
    setLyrics([]);
  }, []);

  const fetchTab = useCallback(
    async (key: SearchTab, rawKeyword: string, generation: number) => {
      const q = rawKeyword.trim();
      if (!q || fetchedRef.current.has(key) || inflightRef.current.has(key)) return;
      inflightRef.current.add(key);
      setTabLoading(key, true);
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      try {
        switch (key) {
          case "songs": {
            const list = await searchSongs(q);
            if (generation !== generationRef.current) return;
            setSongs(list);
            const refineId = ++refineGenRef.current;
            void refineSearchSongs(list).then((refined) => {
              if (generation === generationRef.current && refineId === refineGenRef.current && refined.length !== list.length) {
                setSongs(refined);
              }
            });
            break;
          }
          case "playlists": {
            const list = await searchPlaylists(q);
            if (generation !== generationRef.current) return;
            setPlaylists(list);
            break;
          }
          case "albums": {
            const list = await searchAlbums(q);
            if (generation !== generationRef.current) return;
            setAlbums(list);
            break;
          }
          case "mvs": {
            const list = await searchMvs(q);
            if (generation !== generationRef.current) return;
            setMvs(list);
            break;
          }
          case "lyrics": {
            const list = await searchLyrics(q);
            if (generation !== generationRef.current) return;
            setLyrics(list);
            break;
          }
        }
        if (generation !== generationRef.current) return;
        fetchedRef.current.add(key);
        setLoaded((prev) => new Set(prev).add(key));
      } catch (err) {
        if (generation !== generationRef.current) return;
        setErrors((prev) => ({
          ...prev,
          [key]: err instanceof Error ? err.message : "搜索失败",
        }));
      } finally {
        if (generation !== generationRef.current) return;
        inflightRef.current.delete(key);
        setTabLoading(key, false);
      }
    },
    [setTabLoading],
  );

  useEffect(() => {
    if (!keyword) {
      generationRef.current += 1;
      resetResults();
      return;
    }
    const generation = ++generationRef.current;
    resetResults();
    void fetchTab("songs", keyword, generation);
    void fetchTab("playlists", keyword, generation);
    void fetchTab("albums", keyword, generation);
    void fetchTab("mvs", keyword, generation);
  }, [keyword, requestId, resetResults, fetchTab]);

  useEffect(() => {
    if (!keyword) return;
    if (!fetchedRef.current.has(tab) && !inflightRef.current.has(tab)) {
      void fetchTab(tab, keyword, generationRef.current);
    }
  }, [tab, keyword, fetchTab]);

  const submitSearch = useCallback((value?: string) => {
    const box = document.querySelector<HTMLInputElement>(".search-page-input input, .search-page input.ant-input");
    const next = String(value || box?.value || draft || "").trim();
    setDraft(next);
    setLocalKeyword(next);
    setLocalRequestId((n) => n + 1);
  }, [draft]);

  useEffect(() => {
    const onFill = (event: Event) => {
      const name = String((event as CustomEvent<string>).detail || "").trim();
      if (!name) return;
      submitSearch(name);
    };
    window.addEventListener("kazam:fill-search", onFill);
    return () => window.removeEventListener("kazam:fill-search", onFill);
  }, [submitSearch]);

  const metaCount = (key: SearchTab, count: number) =>
    loading[key] ? "…" : loaded.has(key) ? count : "—";

  const enqueueTrack = useCallback((track: Track) => {
    if (!canEnqueuePlayUrl(track.playUrl)) {
      message.warning(`"${track.title}" 暂无可用播放链接`);
      return false;
    }
    setPlayingId(track.id);
    return true;
  }, []);

  const handlePlaySong = useCallback(
    async (song: SearchSong) => {
      if (onPlaySong) {
        await onPlaySong(song);
        setPlayingId(`${song.source}:${song.id}`);
        return;
      }
      const playUrl = await resolvePlayUrl(song);
      const track = { ...songToTrack(song), playUrl };
      if (!enqueueTrack(track)) return;
    },
    [onPlaySong, enqueueTrack],
  );

  const handlePlayAll = useCallback(async () => {
    const tracks = songs.map(songToTrack);
    if (onPlayAll) {
      if (tracks.length === 0) return;
      onPlayAll(tracks);
      return;
    }
    const resolved: Track[] = [];
    for (const song of songs) {
      const playUrl = await resolvePlayUrl(song);
      if (!canEnqueuePlayUrl(playUrl)) continue;
      resolved.push({ ...songToTrack(song), playUrl });
    }
    if (resolved.length === 0) {
      message.warning("没有可播放的歌曲");
      return;
    }
    setPlayingId(resolved[0].id);
  }, [songs, onPlayAll]);

  const handleDownload = useCallback(
    (track: Track) => {
      if (onDownload) {
        onDownload(track);
        return;
      }
      void window.electronAPI?.downloadStart?.(track);
    },
    [onDownload],
  );

  const handleOpenPlaylist = useCallback(
    (playlist: SearchPlaylist) => {
      if (onOpenPlaylist) {
        onOpenPlaylist(playlist);
        return;
      }
      if (playlist.link) void window.electronAPI?.openExternal?.(playlist.link);
    },
    [onOpenPlaylist],
  );

  const handleOpenAlbum = useCallback(
    (album: SearchAlbum) => {
      if (onOpenAlbum) {
        onOpenAlbum(album);
        return;
      }
      if (album.link) void window.electronAPI?.openExternal?.(album.link);
    },
    [onOpenAlbum],
  );

  const handleOpenMv = useCallback(
    (mv: SearchMv) => {
      if (onOpenMv) {
        onOpenMv(mv);
        return;
      }
      if (mv.link) void window.electronAPI?.openExternal?.(mv.link);
    },
    [onOpenMv],
  );

  const tabs: Array<{ key: SearchTab; label: string; count: number; icon: ReactNode }> = [
    { key: "songs", label: "歌曲", count: songs.length, icon: <IconMusic /> },
    { key: "playlists", label: "歌单", count: playlists.length, icon: <IconPlaylist /> },
    { key: "albums", label: "专辑", count: albums.length, icon: <IconAlbum /> },
    { key: "mvs", label: "MV", count: mvs.length, icon: <IconVideo /> },
    { key: "lyrics", label: "歌词", count: lyrics.length, icon: <IconFileText /> },
  ];

  const tabError = errors[tab];
  const tabPending = !loaded.has(tab) && !tabError && !!keyword;
  const mappedTracks = songs.map(songToTrack);
  const currentIndex = playingId ? songs.findIndex((s) => `${s.source}:${s.id}` === playingId) : -1;

  return (
    <div className="favorite-page search-page">
      <style>{SEARCH_PAGE_CSS}</style>
      <header className="fav-hero search-hero">
        <div className="fav-info">
          <h1 className="fav-title">{keyword ? `搜索「${keyword}」` : "搜索"}</h1>
          {!controlled ? (
            <Input.Search
              className="search-page-input"
              placeholder="搜索歌曲、歌单、专辑、MV、歌词"
              value={draft}
              allowClear
              enterButton="搜索"
              onChange={(ev) => setDraft(ev.target.value)}
              onSearch={() => {
                const box = document.querySelector<HTMLInputElement>(".search-page-input input");
                submitSearch(box?.value || draft);
              }}
            />
          ) : null}
          <div className="fav-meta search-hero-meta">
            <span>歌曲 <strong>{metaCount("songs", songs.length)}</strong></span>
            <span className="fav-meta-dot" />
            <span>歌单 <strong>{metaCount("playlists", playlists.length)}</strong></span>
            <span className="fav-meta-dot" />
            <span>专辑 <strong>{metaCount("albums", albums.length)}</strong></span>
            <span className="fav-meta-dot" />
            <span>MV <strong>{metaCount("mvs", mvs.length)}</strong></span>
            <span className="fav-meta-dot" />
            <span>歌词 <strong>{metaCount("lyrics", lyrics.length)}</strong></span>
          </div>
        </div>
      </header>
      <div className="fav-toolbar search-toolbar">
        <div className="fav-filters">
          <Segmented
            value={tab}
            onChange={(value) => setTab(value as SearchTab)}
            options={tabs.map((item) => ({
              value: item.key,
              label: (
                <span className="search-tab-label">
                  {item.icon}
                  {item.label}
                  {loading[item.key] ? " …" : loaded.has(item.key) ? ` ${item.count}` : ""}
                </span>
              ),
            }))}
          />
        </div>
        <div className="fav-toolbar-right search-toolbar-actions">
          {tab === "songs" && songs.length > 0 ? (
            <Button type="primary" size="small" icon={<IconPlay />} onClick={() => void handlePlayAll()}>
              播放全部
            </Button>
          ) : null}
        </div>
      </div>
      {tabPending ? (
        <div className="main-empty">
          <Spin className="search-state-icon" />
          <div>搜索中...</div>
        </div>
      ) : null}
      {tabError && !tabPending ? <SearchEmpty icon={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />} title={tabError} /> : null}
      {!tabPending && !tabError ? (
        <div className="fav-list search-results">
          {tab === "songs" ? (
            songs.length > 0 ? (
              <TrackList
                tracks={mappedTracks}
                currentIndex={currentIndex}
                onSelect={(index) => {
                  const song = songs[index];
                  if (song) void handlePlaySong(song);
                }}
                onRemove={onRemove}
                onPlayNext={onPlayNext}
                onDownload={handleDownload}
                onSaveToPlaylist={onSaveToPlaylist}
                showPlatform
              />
            ) : keyword ? (
              <SearchEmpty icon={<IconMusic />} title="未找到相关歌曲" hint="换个关键词试试" />
            ) : null
          ) : null}
          {tab === "playlists" ? (
            playlists.length > 0 ? (
              <div className="search-card-grid">
                {playlists.map((item) => (
                  <SearchCard
                    key={item.id}
                    cover={item.cover}
                    fallbackIcon={<IconPlaylist className="search-card-fallback-icon" />}
                    title={highlight(item.name, keyword)}
                    meta={
                      <>
                        {item.trackCount} 首 · {formatCount(item.playCount)} 次播放
                        {item.creator ? <> · {item.creator}</> : null}
                      </>
                    }
                    onClick={() => handleOpenPlaylist(item)}
                    showHoverIcon={false}
                  />
                ))}
              </div>
            ) : keyword ? (
              <SearchEmpty icon={<IconPlaylist />} title="未找到相关歌单" hint="换个关键词试试" />
            ) : null
          ) : null}
          {tab === "albums" ? (
            albums.length > 0 ? (
              <div className="search-card-grid">
                {albums.map((item) => (
                  <SearchCard
                    key={item.id}
                    cover={item.cover}
                    fallbackIcon={<IconAlbum className="search-card-fallback-icon" />}
                    title={highlight(item.name, keyword)}
                    meta={
                      <>
                        {item.creator}
                        {item.trackCount > 0 ? <> · {item.trackCount} 首</> : null}
                        {item.extra?.publishTime ? <> · {formatYear(item.extra.publishTime)}</> : null}
                        {item.extra?.company ? <> · {item.extra.company}</> : null}
                      </>
                    }
                    onClick={() => handleOpenAlbum(item)}
                    showHoverIcon={false}
                  />
                ))}
              </div>
            ) : keyword ? (
              <SearchEmpty icon={<IconAlbum />} title="未找到相关专辑" hint="换个关键词试试" />
            ) : null
          ) : null}
          {tab === "mvs" ? (
            mvs.length > 0 ? (
              <div className="search-card-grid">
                {mvs.map((item) => (
                  <SearchCard
                    key={item.id}
                    cover={item.cover}
                    fallbackIcon={<IconVideo className="search-card-fallback-icon" />}
                    title={highlight(item.name, keyword)}
                    meta={
                      <>
                        {item.artistName}
                        {item.duration > 0 ? <> · {formatDuration(item.duration)}</> : null}
                        {item.playCount > 0 ? <> · {formatCount(item.playCount)} 次播放</> : null}
                      </>
                    }
                    onClick={() => handleOpenMv(item)}
                  />
                ))}
              </div>
            ) : keyword ? (
              <SearchEmpty icon={<IconVideo />} title="未找到相关 MV" hint="换个关键词试试" />
            ) : null
          ) : null}
          {tab === "lyrics" ? (
            lyrics.length > 0 ? (
              <div className="search-lyric-list">
                {lyrics.map((item) => (
                  <button
                    type="button"
                    className="search-lyric-card"
                    onClick={() => void handlePlaySong(item)}
                    key={`${item.source}:${item.id}`}
                  >
                    <blockquote className="search-lyric-quote">
                      {item.lyricSnippet ? (
                        highlight(item.lyricSnippet, keyword, "search-lyric-mark")
                      ) : (
                        <span className="search-lyric-quote-fallback">「{keyword}」</span>
                      )}
                    </blockquote>
                    <div className="search-lyric-card-foot">
                      <div className="search-lyric-cover">
                        {item.cover ? <img src={item.cover} alt="" /> : <IconMusic />}
                      </div>
                      <div className="search-lyric-card-meta">
                        <div className="search-lyric-card-title">{item.name}</div>
                        <div className="search-lyric-card-artist">{item.artist}</div>
                      </div>
                      <IconPlay className="search-lyric-play" />
                    </div>
                  </button>
                ))}
              </div>
            ) : keyword ? (
              <SearchEmpty icon={<IconFileText />} title="未找到相关歌词" hint="试试歌曲名或歌词中的一句" />
            ) : (
              <SearchEmpty icon={<IconFileText />} title="输入关键词开始搜索" hint="歌曲、歌单、专辑、MV、歌词" />
            )
          ) : null}
          {!keyword && tab !== "lyrics" ? (
            <SearchEmpty icon={<IconMusic />} title="输入关键词开始搜索" hint="歌曲、歌单、专辑、MV、歌词" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SEARCH_PAGE_CSS = `
.search-page{padding:20px 24px 32px;color:var(--ink)}
.search-hero{margin-bottom:16px}
.search-hero .fav-title{margin:0 0 12px;font-size:28px;letter-spacing:-.5px;color:var(--ink)}
.search-page-input{max-width:520px;margin-bottom:12px}
.search-hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink-muted);font-size:13px}
.fav-meta-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.45}
.search-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.search-tab-label{display:inline-flex;align-items:center;gap:6px}
.search-tab-label svg{font-size:14px}
.main-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:240px;color:var(--ink-muted)}
.search-empty-hint{font-size:12px;opacity:.75}
.search-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}
.search-card{cursor:pointer;border:1px solid var(--line)!important;background:color-mix(in srgb,var(--paper) 88%,transparent)!important;overflow:hidden;backdrop-filter:blur(8px) saturate(140%)}
.search-card:focus-visible{outline:2px solid var(--signal-deep)}
.search-card-cover{position:relative;aspect-ratio:1;background:var(--bg-hover)}
.search-card-cover img{width:100%;height:100%;object-fit:cover;display:block}
.search-card-cover-inner,.search-card-fallback-icon{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;opacity:.45}
.search-card-play-icon{position:absolute;right:8px;bottom:8px;width:28px;height:28px;padding:6px;border-radius:50%;background:rgba(0,0,0,.55);opacity:0}
.search-card:hover .search-card-play-icon{opacity:1}
.search-card-info{padding:10px}
.search-card-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-card-meta{margin-top:4px;font-size:12px;color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-highlight,.search-lyric-mark{color:var(--signal-deep);font-weight:700}
.search-track-list{display:flex;flex-direction:column;gap:4px}
.search-track-row{display:grid;grid-template-columns:36px 44px 1fr 56px auto;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:10px;background:color-mix(in srgb,var(--paper) 78%,transparent);backdrop-filter:blur(8px) saturate(140%)}
.search-track-row:hover,.search-track-row.is-current{background:var(--bg-hover)}
.search-track-index{color:var(--ink-faint);text-align:center;font-size:12px}
.search-track-cover{width:44px;height:44px;border-radius:8px;overflow:hidden;background:var(--line);display:flex;align-items:center;justify-content:center}
.search-track-cover img{width:100%;height:100%;object-fit:cover}
.search-track-title{font-weight:700;display:flex;align-items:center;gap:6px;color:var(--ink)}
.search-track-vip{font-size:10px;padding:0 4px;border:1px solid currentColor;opacity:.7;border-radius:4px}
.search-track-sub{font-size:12px;color:var(--ink-muted)}
.search-track-platform{margin-right:6px;text-transform:uppercase;font-size:10px;letter-spacing:.04em;font-weight:700}
.search-track-duration{font-size:12px;color:var(--ink-muted)}
.search-track-actions{display:flex;gap:4px}
.search-track-actions button{border:1px solid var(--line);background:color-mix(in srgb,var(--paper) 80%,transparent);color:inherit;font-size:12px;padding:4px 8px;cursor:pointer;border-radius:999px}
.search-lyric-list{display:flex;flex-direction:column;gap:12px}
.search-lyric-card{text-align:left;border:1px solid var(--line);background:color-mix(in srgb,var(--paper) 86%,transparent);color:inherit;padding:14px;cursor:pointer;border-radius:10px}
.search-lyric-quote{margin:0 0 12px;font-size:15px;line-height:1.5}
.search-lyric-quote-fallback{opacity:.7}
.search-lyric-card-foot{display:flex;align-items:center;gap:10px}
.search-lyric-cover{width:40px;height:40px;overflow:hidden;border-radius:8px;background:var(--line);display:flex;align-items:center;justify-content:center}
.search-lyric-cover img{width:100%;height:100%;object-fit:cover}
.search-lyric-card-title{font-weight:600}
.search-lyric-card-artist{font-size:12px;color:var(--ink-muted)}
.search-lyric-play{margin-left:auto}
`;

export const SearchPage = memo(SearchPageInner);
export default SearchPage;
