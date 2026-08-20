import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button, Input, Modal, Spin, message } from "antd";
import { canEnqueuePlayUrl } from "../../shared/types";
import type {
  CollectionSummary,
  PlaylistPatch,
  Track,
  TrackExtra,
  UserPlaylist,
} from "../../shared/types";

const PLACEHOLDER_TITLE = "加载中…";
const ORDER_STORAGE_PREFIX = "m7:playlist-order:";
const EMPTY_TRACKS: Track[] = [];
const EMPTY_PLAYLIST: UserPlaylist = {
  id: "",
  name: "歌单",
  createdAt: Date.now(),
  trackIds: [],
};

type CollectionKind = "playlist" | "album";

type SharedProps = {
  variant?: "local" | "netease";
  currentTrackId?: string;
  onPlayAll?: (tracks: Track[]) => void;
  onPlayTrack?: (track: Track, allTracks: Track[]) => void;
  onRemove?: (trackId: string) => void;
  onPlayNext?: (track: Track) => void;
  onDownload?: (track: Track) => void;
  onSaveToPlaylist?: (track: Track) => void;
  onToggleFavorite?: (trackId: string) => void;
  isFavorited?: (trackId: string) => boolean;
  collected?: boolean;
  onToggleCollect?: (tracks: Track[]) => void;
  onSync?: () => void | Promise<void>;
  syncing?: boolean;
  onUpdatePlaylist?: (playlistId: string, patch: PlaylistPatch) => void;
};

export type LocalCollectionProps = SharedProps & {
  variant: "local";
  playlist: UserPlaylist;
  tracks: Track[];
};

export type NeteaseCollectionProps = SharedProps & {
  variant: "netease";
  kind: CollectionKind;
  id: string;
  summary: CollectionSummary;
};

export type CollectionDetailPageProps =
  | LocalCollectionProps
  | NeteaseCollectionProps
  | (SharedProps & { variant?: undefined });

type NeteaseSong = {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  extra?: TrackExtra;
  vip?: boolean;
};

type NeteaseTrackRaw = {
  id?: string | number;
  name?: string;
  dt?: number;
  duration?: number;
  fee?: number;
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { id?: string | number; name?: string; picUrl?: string };
  album?: { id?: string | number; name?: string; picUrl?: string };
  privilege?: { fee?: number; fl?: number };
};

type PlaylistDetailRaw = {
  code?: number;
  playlist?: {
    id?: string | number;
    name?: string;
    coverImgUrl?: string;
    trackCount?: number;
    playCount?: number;
    description?: string;
    creator?: { nickname?: string };
    tracks?: NeteaseTrackRaw[];
    trackIds?: { id?: string | number }[];
  };
};

type AlbumDetailRaw = {
  code?: number;
  album?: {
    id?: string | number;
    name?: string;
    picUrl?: string;
    size?: number;
    description?: string;
    briefDesc?: string;
    company?: string;
    publishTime?: string | number;
    artist?: { name?: string };
    artists?: { name?: string }[];
  };
  songs?: NeteaseTrackRaw[];
};

type SongDetailRaw = {
  code?: number;
  songs?: NeteaseTrackRaw[];
};

function isPlaceholderTrack(track: Track): boolean {
  return track.title === PLACEHOLDER_TITLE && track.duration === 0;
}

function formatTotalDuration(seconds: number): string {
  if (seconds <= 0) return "--";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${secs} 秒`;
  return `${secs} 秒`;
}

function formatTrackDuration(seconds: number): string {
  if (!seconds) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatPlayCount(count: number): string {
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
}

function formatPublishDate(value: string | number | undefined): string {
  if (!value) return "";
  const ts = Number(value);
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN");
}

function neteaseSongsToTracks(songs: NeteaseSong[]): Track[] {
  return songs.map((song) => ({
    id: `netease:${song.id}`,
    title: song.name || "未知标题",
    artist: song.artist || "未知艺术家",
    album: song.album || "未知专辑",
    duration: song.duration || 0,
    coverUrl: song.cover || "",
    platform: "netease",
    source: "online",
    extra: {
      song_id: song.id,
      ...(song.extra || {}),
      ...(song.vip ? { vip: "true" } : {}),
    },
  }));
}

function mapNeteaseSong(raw: NeteaseTrackRaw, feeHint?: number): NeteaseSong {
  const artists = raw.ar || raw.artists || [];
  const album = raw.al || raw.album;
  const durationMs = raw.dt ?? raw.duration ?? 0;
  const fee = feeHint ?? raw.fee ?? raw.privilege?.fee ?? 0;
  const fl = raw.privilege?.fl ?? 0;
  return {
    id: String(raw.id ?? ""),
    name: raw.name || "",
    artist: artists.map((item) => item.name).filter(Boolean).join("、"),
    album: album?.name || "",
    duration: Math.floor(durationMs / 1000),
    cover: album?.picUrl || "",
    extra: {
      song_id: String(raw.id ?? ""),
      fl: String(fl),
      fee: String(fee),
    },
    vip: fee === 1,
  };
}

function mapNeteasePlaylist(raw: NonNullable<PlaylistDetailRaw["playlist"]>): CollectionSummary {
  return {
    id: String(raw.id ?? ""),
    name: raw.name || "",
    cover: raw.coverImgUrl,
    trackCount: raw.trackCount,
    playCount: raw.playCount,
    creator: raw.creator?.nickname || "",
    description: raw.description || "",
    link: `https://music.163.com/#/playlist?id=${raw.id}`,
    source: "netease",
  };
}

function mapNeteaseAlbum(raw: NonNullable<AlbumDetailRaw["album"]>): CollectionSummary {
  const creator =
    raw.artist?.name ||
    raw.artists?.map((item) => item.name).filter(Boolean).join("、") ||
    "";
  return {
    id: String(raw.id ?? ""),
    name: raw.name || "",
    cover: raw.picUrl,
    trackCount: raw.size,
    creator,
    description: raw.description || raw.briefDesc || "",
    link: `https://music.163.com/#/album?id=${raw.id}`,
    source: "netease",
    extra: {
      type: "album",
      company: raw.company,
      publishTime: String(raw.publishTime ?? ""),
    },
  };
}

function parseNeteaseBody(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && "body" in raw) {
    const body = (raw as { body?: unknown }).body;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return raw;
      }
    }
    return body ?? raw;
  }
  return raw;
}

async function neteaseEapi<T>(path: string, data: Record<string, unknown>): Promise<T> {
  const api = window.electronAPI;
  if (!api?.neteaseEapi) {
    throw new Error("electronAPI.neteaseEapi 不可用");
  }
  const raw = await api.neteaseEapi(path, JSON.stringify(data));
  return parseNeteaseBody(raw) as T;
}

async function fetchNeteaseSongDetails(
  ids: string[],
  feeById?: Map<number | string, number>,
): Promise<NeteaseSong[]> {
  const payload = {
    c: JSON.stringify(ids.map((id) => ({ id: String(id) }))),
    ids: ids.map(String),
  };
  const body = await neteaseEapi<SongDetailRaw>("/eapi/v3/song/detail", payload);
  if (body.code !== 200) {
    throw new Error(`netease song detail error: code=${body.code}`);
  }
  const byId = new Map((body.songs || []).map((song) => [String(song.id), song]));
  return ids
    .map((id) => byId.get(id))
    .filter((song): song is NeteaseTrackRaw => !!song)
    .map((song) => mapNeteaseSong(song, feeById?.get(song.id ?? "")));
}

async function hydratePlaylistSongs(
  orderedIds: string[],
  feeById: Map<number | string, number>,
  present: NeteaseTrackRaw[],
): Promise<NeteaseSong[]> {
  const mapped = new Map<string, NeteaseSong>();
  for (const raw of present) {
    if (raw?.id != null) {
      mapped.set(String(raw.id), mapNeteaseSong(raw, feeById.get(raw.id)));
    }
  }
  const chunkSize = 500;
  for (let i = 0; i < orderedIds.length; i += chunkSize) {
    const missing = orderedIds.slice(i, i + chunkSize).filter((id) => !mapped.has(id));
    if (missing.length === 0) continue;
    try {
      const extra = await fetchNeteaseSongDetails(missing, feeById);
      for (const song of extra) mapped.set(song.id, song);
    } catch (err) {
      console.error("[netease] batch song detail failed:", err);
    }
  }
  return orderedIds.map((id) => mapped.get(id)).filter((song): song is NeteaseSong => !!song);
}

async function fetchNeteasePlaylist(id: string): Promise<{
  playlist: CollectionSummary;
  songs: NeteaseSong[];
}> {
  const body = await neteaseEapi<PlaylistDetailRaw>("/eapi/v3/playlist/detail", {
    id,
    n: 100000,
    s: 8,
    csrf_token: "",
  });
  if (body.code !== 200 || !body.playlist) {
    throw new Error(`netease playlist detail error: code=${body.code}`);
  }
  const playlist = mapNeteasePlaylist(body.playlist);
  const feeById = new Map<number | string, number>();
  for (const raw of body.playlist.tracks || []) {
    if (raw.id != null && raw.fee !== undefined) feeById.set(raw.id, raw.fee);
  }
  const orderedIds = (body.playlist.trackIds || [])
    .map((item) => String(item.id ?? ""))
    .filter(Boolean);
  if (orderedIds.length === 0) {
    return { playlist, songs: [] };
  }
  const present = body.playlist.tracks || [];
  const presentById = new Map<string, NeteaseTrackRaw>();
  for (const raw of present) {
    if (raw?.id != null) presentById.set(String(raw.id), raw);
  }
  if (presentById.size >= orderedIds.length) {
    const songs = orderedIds
      .map((songId) => presentById.get(songId))
      .filter((raw): raw is NeteaseTrackRaw => !!raw)
      .map((raw) => mapNeteaseSong(raw, feeById.get(raw.id ?? "")));
    if (songs.length === orderedIds.length) {
      return { playlist, songs };
    }
  }
  return {
    playlist,
    songs: await hydratePlaylistSongs(orderedIds, feeById, present),
  };
}

async function fetchNeteaseAlbum(id: string): Promise<{
  album: CollectionSummary;
  songs: NeteaseSong[];
}> {
  const body = await neteaseEapi<AlbumDetailRaw>(`/eapi/v1/album/${id}`, {
    csrf_token: "",
  });
  if (body.code !== 200 || !body.album) {
    throw new Error(`netease album detail error: code=${body.code}`);
  }
  return {
    album: mapNeteaseAlbum(body.album),
    songs: (body.songs || []).map((song) => mapNeteaseSong(song)),
  };
}

function resolvePlayUrl(track: Track): string | undefined {
  if (canEnqueuePlayUrl(track.playUrl)) return track.playUrl.trim();
  const api = window.electronAPI;
  if (!api) return undefined;
  if (track.source === "local" && track.filePath) {
    const url = api.getLocalUrl(track.filePath);
    return canEnqueuePlayUrl(url) ? url : undefined;
  }
  if (track.source === "webdav") {
    const accountId = typeof track.extra?.webdavAccountId === "string" ? track.extra.webdavAccountId : "";
    const remotePath =
      (typeof track.extra?.webdavPath === "string" ? track.extra.webdavPath : "") || track.filePath;
    if (accountId && remotePath) {
      const url = api.webdav.getPlayUrl(accountId, remotePath);
      return canEnqueuePlayUrl(url) ? url : undefined;
    }
  }
  return undefined;
}

function withResolvedPlayUrl(track: Track): Track {
  const playUrl = resolvePlayUrl(track);
  return playUrl ? { ...track, playUrl } : { ...track, playUrl: undefined };
}

function canAttemptPlay(track: Track): boolean {
  if (canEnqueuePlayUrl(track.playUrl)) return true;
  if (track.source === "local" && track.filePath) return true;
  if (track.source === "webdav") return true;
  return track.source === "online" && Boolean(track.id);
}

function playableTracks(tracks: Track[]): Track[] {
  return tracks
    .filter((track) => !isPlaceholderTrack(track))
    .map(withResolvedPlayUrl)
    .filter((track) => canAttemptPlay(track));
}

function loadPlaylistOrder(playlistId: string): Map<string, number> | null {
  if (!playlistId) return null;
  try {
    const raw = localStorage.getItem(`${ORDER_STORAGE_PREFIX}${playlistId}`);
    if (!raw) return null;
    return new Map(JSON.parse(raw) as [string, number][]);
  } catch {
    return null;
  }
}

function useLocateInList(opts: {
  items: Track[];
  currentTrackId?: string;
  keyword: string;
  setKeyword: (value: string) => void;
}) {
  const scrollerRef = useRef<((index: number, align?: string) => void) | null>(null);
  const itemsRef = useRef(opts.items);
  itemsRef.current = opts.items;

  const handleScrollerReady = useCallback((_key: string, scrollTo: (index: number, align?: string) => void) => {
    scrollerRef.current = scrollTo;
  }, []);

  const canLocate = useMemo(() => {
    if (!opts.currentTrackId) return false;
    return opts.items.some((track) => track.id === opts.currentTrackId);
  }, [opts.items, opts.currentTrackId]);

  const handleLocate = useCallback(() => {
    if (!opts.currentTrackId) return;
    const locate = (items: Track[]) => {
      const index = items.findIndex((track) => track.id === opts.currentTrackId);
      if (index >= 0) scrollerRef.current?.(index, "center");
    };
    if (opts.keyword.trim()) {
      opts.setKeyword("");
      setTimeout(() => locate(itemsRef.current), 0);
      return;
    }
    locate(opts.items);
  }, [opts.currentTrackId, opts.items, opts.keyword, opts.setKeyword]);

  return { handleScrollerReady, canLocate, handleLocate };
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconStarFilled() {
  return (
    <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 4.3-18.3 9.3a32.05 32.05 0 00.6 45.3l183.7 179.1-43.4 252.9a31.95 31.95 0 0046.4 33.7L512 754l227.1 119.4c6.2 3.3 13.4 4.4 20.3 3.2 17.4-3 29.1-19.5 26.1-36.9l-43.4-252.9 183.7-179.1c5-4.9 8.3-11.3 9.3-18.3 2.7-17.5-9.5-33.7-27-36.3z" />
    </svg>
  );
}

function IconStarOutlined() {
  return (
    <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 4.3-18.3 9.3a32.05 32.05 0 00.6 45.3l183.7 179.1-43.4 252.9a31.95 31.95 0 0046.4 33.7L512 754l227.1 119.4c6.2 3.3 13.4 4.4 20.3 3.2 17.4-3 29.1-19.5 26.1-36.9l-43.4-252.9 183.7-179.1c5-4.9 8.3-11.3 9.3-18.3 2.7-17.5-9.5-33.7-27-36.3zM664.8 561.6l36.1 210.3L512 672.7 323.1 772l36.1-210.3-152.8-149L417.6 382 512 190.7 606.4 382l211.2 30.7-152.8 148.9z" />
    </svg>
  );
}

function IconSync({ spin = false }: { spin?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden
      className={spin ? "collection-detail-spin" : undefined}
    >
      <path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5a5 5 0 01-8.9 3.1L6.7 17.5A7 7 0 0019 13c0-3.87-3.13-7-7-7zm-5 7a5 5 0 018.9-3.1l1.4-1.4A7 7 0 005 13c0 3.87 3.13 7 7 7v3l4-4-4-4v3c-2.76 0-5-2.24-5-5z" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

function IconLocate() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.94 3A8.99 8.99 0 0013 3.06V1h-2v2.06A8.99 8.99 0 003.06 11H1v2h2.06A8.99 8.99 0 0011 20.94V23h2v-2.06A8.99 8.99 0 0020.94 13H23v-2h-2.06zM12 19a7 7 0 110-14 7 7 0 010 14z" />
    </svg>
  );
}

function PlaylistCoverFallback() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden>
      <path d="M2 18H12V20H2V18ZM2 11H16V13H2V11ZM2 4H22V6H2V4ZM19 15.17V9H24V11H21V18A3 3 0 1118 15c.35 0 .69.06 1 .17zM18 19a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}

function AlbumCoverFallback() {
  return (
    <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden>
      <path d="M12 20a8 8 0 100-16 8 8 0 000 16zm0 2C6.48 22 2 17.52 2 12S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm0-8a2 2 0 100-4 2 2 0 000 4zm0 2a4 4 0 110-8 4 4 0 010 8z" />
    </svg>
  );
}

function EditPlaylistModal(props: {
  open: boolean;
  playlist: UserPlaylist | null;
  onClose: () => void;
  onSave: (patch: PlaylistPatch) => void;
}) {
  const { open, playlist, onClose, onSave } = props;
  const [name, setName] = useState("");

  useEffect(() => {
    if (open && playlist) setName(playlist.name);
    if (!open) setName("");
  }, [open, playlist]);

  const handlePickCover = async () => {
    const path = await window.electronAPI?.selectImage();
    if (path) onSave({ coverUrl: `file://${path}` });
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed });
    onClose();
  };

  return (
    <Modal
      open={open && !!playlist}
      title="编辑歌单"
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      width={360}
    >
      <button type="button" className="playlist-edit-cover" title="点击更换封面" onClick={() => void handlePickCover()}>
        {playlist?.coverUrl ? <img src={playlist.coverUrl} alt="" /> : <span>点击添加封面</span>}
      </button>
      <Input
        value={name}
        maxLength={100}
        placeholder="歌单名称"
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onPressEnter={handleSave}
      />
    </Modal>
  );
}

function TrackTable(props: {
  tracks: Track[];
  currentTrackId?: string;
  emptyText: string;
  reorderable?: boolean;
  onSelect: (index: number) => void;
  onRemove?: (trackId: string) => void;
  onPlayNext?: (track: Track) => void;
  onDownload?: (track: Track) => void;
  onSaveToPlaylist?: (track: Track) => void;
  onToggleFavorite?: (trackId: string) => void;
  isFavorited?: (trackId: string) => boolean;
  onReorderEnd?: (tracks: Track[]) => void;
  onScrollerReady?: (key: string, scrollTo: (index: number, align?: string) => void) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    props.onScrollerReady?.("all", (index, align) => {
      const root = listRef.current;
      const row = root?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
      row?.scrollIntoView({ block: align === "center" ? "center" : "nearest", behavior: "smooth" });
    });
  }, [props.onScrollerReady]);

  if (props.tracks.length === 0) {
    return (
      <div className="main-empty">
        <div>{props.emptyText}</div>
      </div>
    );
  }

  const handleDrop = (targetIndex: number) => {
    if (dragIndex == null || dragIndex === targetIndex || !props.onReorderEnd) return;
    const next = [...props.tracks];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    props.onReorderEnd(next);
  };

  return (
    <div className="main-list collection-detail-tracks" ref={listRef}>
      <div className="track-row track-row-header">
        <span>#</span>
        <span />
        <span>标题</span>
        <span>专辑</span>
        <span>时长</span>
        <span />
      </div>
      {props.tracks.map((track, index) => {
        const placeholder = isPlaceholderTrack(track);
        const active = track.id === props.currentTrackId;
        const favorited = props.isFavorited?.(track.id) ?? false;
        return (
          <div
            key={track.id}
            className={`track-row${active ? " active" : ""}${placeholder ? " is-loading" : ""}`}
            data-row-index={index}
            draggable={!!props.reorderable && !placeholder}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event: DragEvent) => {
              if (props.reorderable) event.preventDefault();
            }}
            onDrop={() => handleDrop(index)}
            onClick={() => {
              if (!placeholder) props.onSelect(index);
            }}
          >
            <span className="track-index-num">{active ? "♪" : index + 1}</span>
            <div className="track-cover">
              {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" /> : <span>♪</span>}
            </div>
            <div className="track-title-group">
              <div className="track-title">{track.title}</div>
              <div className="track-artist">{track.artist}</div>
            </div>
            <div className="track-album" title={track.album}>
              {track.album}
            </div>
            <div className="track-duration">{formatTrackDuration(track.duration)}</div>
            <div className="track-hover-actions">
              {props.onDownload && track.source === "online" && !placeholder && (
                <button
                  type="button"
                  className="track-hover-btn"
                  title="下载"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDownload?.(track);
                  }}
                >
                  ↓
                </button>
              )}
              {props.onSaveToPlaylist && !placeholder && (
                <button
                  type="button"
                  className="track-hover-btn"
                  title="添加到歌单"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSaveToPlaylist?.(track);
                  }}
                >
                  +
                </button>
              )}
              {props.onPlayNext && !placeholder && (
                <button
                  type="button"
                  className="track-hover-btn"
                  title="下一首播放"
                  onClick={(event) => {
                    event.stopPropagation();
                    const playable = playableTracks([track]);
                    if (playable.length === 0) {
                      message.warning("没有可播放的地址");
                      return;
                    }
                    props.onPlayNext?.(playable[0]);
                  }}
                >
                  ⏭
                </button>
              )}
              {props.onToggleFavorite && !placeholder && (
                <button
                  type="button"
                  className={`track-action-btn${favorited ? " favorited" : ""}`}
                  title={favorited ? "取消收藏" : "收藏"}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onToggleFavorite?.(track.id);
                  }}
                >
                  {favorited ? <IconStarFilled /> : <IconStarOutlined />}
                </button>
              )}
              {props.onRemove && (
                <button
                  type="button"
                  className="track-hover-btn"
                  title="移除列表"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onRemove?.(track.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CollectionDetailPageInner(props: CollectionDetailPageProps) {
  const isLocal = props.variant !== "netease";
  const playlist = props.variant === "local" ? props.playlist : EMPTY_PLAYLIST;
  const incomingTracks = props.variant === "local" ? props.tracks : null;
  const neteaseId = props.variant === "netease" ? props.id : "";
  const neteaseKind: CollectionKind = props.variant === "netease" ? props.kind : "playlist";
  const summary = props.variant === "netease" ? props.summary : null;
  const collectionKind: CollectionKind = isLocal
    ? playlist.sourceType === "netease-album"
      ? "album"
      : "playlist"
    : neteaseKind;
  const isRemoteMirror =
    isLocal &&
    (playlist.sourceType === "netease-pl" ||
      playlist.sourceType === "netease-album" ||
      playlist.sourceType === "qq-pl" ||
      playlist.sourceType === "kugou-pl" ||
      playlist.sourceType === "kuwo-pl");

  const [remoteTracks, setRemoteTracks] = useState<Track[]>([]);
  const [localTracks, setLocalTracks] = useState<Track[]>(() => incomingTracks ?? EMPTY_TRACKS);
  const incomingKeyRef = useRef("");
  const playlistId = isLocal ? playlist.id : "";
  const [orderMap, setOrderMap] = useState<Map<string, number> | null>(() => loadPlaylistOrder(playlistId));

  useEffect(() => {
    if (!playlistId) return;
    if (orderMap && orderMap.size > 0) {
      localStorage.setItem(`${ORDER_STORAGE_PREFIX}${playlistId}`, JSON.stringify([...orderMap.entries()]));
    } else {
      localStorage.removeItem(`${ORDER_STORAGE_PREFIX}${playlistId}`);
    }
  }, [playlistId, orderMap]);

  if (isLocal && incomingTracks) {
    const hasPlaceholder = incomingTracks.some(isPlaceholderTrack);
    const fingerprint = `${incomingTracks.length}:${incomingTracks[0]?.id ?? ""}:${incomingTracks[incomingTracks.length - 1]?.id ?? ""}:${hasPlaceholder ? "1" : "0"}`;
    if (incomingKeyRef.current !== fingerprint) {
      incomingKeyRef.current = fingerprint;
      if (localTracks !== incomingTracks) setLocalTracks(incomingTracks);
    }
  }

  const tracks = isLocal ? localTracks : remoteTracks;
  const [detail, setDetail] = useState<CollectionSummary | null>(summary);
  const [loading, setLoading] = useState(!isLocal);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const loadSeq = useRef(0);

  const loadRemote = useCallback(async () => {
    if (!neteaseId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      if (neteaseKind === "playlist") {
        const { playlist: remotePlaylist, songs } = await fetchNeteasePlaylist(neteaseId);
        if (seq !== loadSeq.current) return;
        setDetail(remotePlaylist);
        setRemoteTracks(neteaseSongsToTracks(songs));
      } else {
        const { album, songs } = await fetchNeteaseAlbum(neteaseId);
        if (seq !== loadSeq.current) return;
        setDetail(album);
        setRemoteTracks(neteaseSongsToTracks(songs));
      }
    } catch {
      if (seq !== loadSeq.current) return;
      setError("加载失败，请稍后重试");
      setRemoteTracks([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [neteaseId, neteaseKind]);

  useEffect(() => {
    if (!neteaseId) return;
    if (summary) setDetail(summary);
    void loadRemote();
  }, [neteaseId, neteaseKind, loadRemote, summary]);

  const autoSynced = useRef(false);
  const declaredCount = isLocal ? playlist.trackIds?.length ?? 0 : 0;
  const onSync = props.onSync;
  const syncing = props.syncing;
  useEffect(() => {
    if (!isLocal || !isRemoteMirror || !onSync || syncing || autoSynced.current) return;
    const allPlaceholder = localTracks.length > 0 && localTracks.every(isPlaceholderTrack);
    if (declaredCount === 0 || allPlaceholder) {
      autoSynced.current = true;
      void onSync();
    }
  }, [isLocal, isRemoteMirror, onSync, syncing, localTracks, declaredCount]);

  const visibleTracks = useMemo(() => {
    let next = tracks;
    const query = keyword.trim().toLowerCase();
    if (query) {
      next = tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(query) ||
          track.artist.toLowerCase().includes(query) ||
          track.album.toLowerCase().includes(query),
      );
    }
    if (orderMap && orderMap.size > 0) {
      next = [...next].sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));
    }
    return next;
  }, [tracks, keyword, orderMap]);

  const [stats, setStats] = useState({ songCount: tracks.length, artistCount: 0, totalDuration: 0 });
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      let totalDuration = 0;
      const artists = new Set<string>();
      for (const track of tracks) {
        totalDuration += track.duration;
        if (track.artist) artists.add(track.artist);
      }
      if (!cancelled) {
        setStats({ songCount: tracks.length, artistCount: artists.size, totalDuration });
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tracks]);

  const title = isLocal ? playlist.name : detail?.name || summary?.name || "歌单";
  const coverUrl = isLocal
    ? playlist.coverUrl || incomingTracks?.[0]?.coverUrl
    : detail?.cover || summary?.cover;
  const isPlaylistKind = collectionKind === "playlist";
  const remotePlaylist = !isLocal && isPlaylistKind ? detail : null;
  const albumSummary = !isLocal && !isPlaylistKind ? summary : null;
  const collected = isLocal ? true : !!props.collected;

  const { handleScrollerReady, canLocate, handleLocate } = useLocateInList({
    items: visibleTracks,
    currentTrackId: props.currentTrackId,
    keyword,
    setKeyword,
  });

  const onPlayAll = props.onPlayAll;
  const onPlayTrack = props.onPlayTrack;
  const enqueueOrToast = useCallback(
    (candidates: Track[], playOne?: Track) => {
      const playable = playableTracks(candidates);
      if (playable.length === 0) {
        message.warning("没有可播放的地址");
        return;
      }
      if (playOne) {
        const target = playable.find((track) => track.id === playOne.id) ?? playable[0];
        onPlayTrack?.(target, playable);
        return;
      }
      onPlayAll?.(playable);
    },
    [onPlayAll, onPlayTrack],
  );

  const handleSelect = useCallback(
    (index: number) => {
      const track = visibleTracks[index];
      if (track) enqueueOrToast(tracks, track);
    },
    [visibleTracks, tracks, enqueueOrToast],
  );

  const searchPlaceholder = isPlaylistKind ? "搜索歌单歌曲" : "搜索专辑歌曲";

  let body: ReactNode = null;
  if (loading) {
    body = (
      <div className="main-empty">
        <Spin />
        <div>正在加载{isPlaylistKind ? "歌单" : "专辑"}...</div>
      </div>
    );
  } else if (error) {
    body = (
      <div className="main-empty">
        <div>{error}</div>
        <Button onClick={() => void loadRemote()}>重试</Button>
      </div>
    );
  } else {
    body = (
      <div className="fav-list collection-detail-list">
        <TrackTable
          tracks={visibleTracks}
          currentTrackId={props.currentTrackId}
          emptyText={keyword ? "没有匹配的歌曲" : "暂无歌曲"}
          reorderable={isLocal}
          onSelect={handleSelect}
          onRemove={props.onRemove}
          onPlayNext={props.onPlayNext}
          onDownload={isLocal ? undefined : props.onDownload}
          onSaveToPlaylist={props.onSaveToPlaylist}
          onToggleFavorite={props.onToggleFavorite}
          isFavorited={props.isFavorited}
          onReorderEnd={(ordered) => {
            const next = new Map<string, number>();
            ordered.forEach((track, index) => next.set(track.id, index));
            setOrderMap(next);
          }}
          onScrollerReady={handleScrollerReady}
        />
      </div>
    );
  }

  return (
    <div className="favorite-page collection-detail-page">
      <style>{PAGE_STYLE}</style>
      <header className="fav-hero">
        <div className="fav-cover">
          {coverUrl ? (
            <img src={coverUrl} alt="" />
          ) : isPlaylistKind ? (
            <PlaylistCoverFallback />
          ) : (
            <AlbumCoverFallback />
          )}
        </div>
        <div className="fav-info">
          <div className="collection-detail-info-top">
            <div className="collection-detail-badge">{isPlaylistKind ? "歌单" : "专辑"}</div>
            <h1 className="fav-title">{title}</h1>
            <div className="fav-owner">
              {isLocal && (
                <span className="fav-owner-time">
                  创建于 {new Date(playlist.createdAt).toLocaleDateString("zh-CN")}
                </span>
              )}
              {!isLocal && isPlaylistKind && remotePlaylist?.creator && (
                <span className="fav-owner-name">{remotePlaylist.creator}</span>
              )}
              {!isLocal && !isPlaylistKind && detail?.creator && (
                <span className="fav-owner-name">{detail.creator}</span>
              )}
              {!isLocal && albumSummary?.extra?.publishTime && (
                <span className="fav-owner-time">发行于 {formatPublishDate(albumSummary.extra.publishTime)}</span>
              )}
            </div>
            <div className="fav-meta">
              <span>
                歌曲 <strong>{loading ? "…" : stats.songCount}</strong>
              </span>
              {!isLocal && isPlaylistKind && remotePlaylist && (
                <>
                  <span className="fav-meta-dot" />
                  <span>
                    播放 <strong>{formatPlayCount(remotePlaylist.playCount ?? 0)}</strong>
                  </span>
                </>
              )}
              {!loading && stats.songCount > 0 && (
                <>
                  <span className="fav-meta-dot" />
                  <span>
                    歌手 <strong>{stats.artistCount}</strong>
                  </span>
                  <span className="fav-meta-dot" />
                  <span>
                    总时长 <strong>{formatTotalDuration(stats.totalDuration)}</strong>
                  </span>
                </>
              )}
              {!isLocal && albumSummary?.extra?.company && (
                <>
                  <span className="fav-meta-dot" />
                  <span>{albumSummary.extra.company}</span>
                </>
              )}
            </div>
          </div>
          <div className="fav-actions collection-detail-actions">
            <Button
              type="primary"
              icon={<IconPlay />}
              disabled={loading || tracks.length === 0}
              onClick={() => enqueueOrToast(tracks)}
            >
              播放全部
            </Button>
            <Button
              icon={collected ? <IconStarFilled /> : <IconStarOutlined />}
              disabled={loading}
              onClick={() => props.onToggleCollect?.(tracks)}
            >
              {collected ? "已收藏" : "收藏"}
            </Button>
            {isLocal && isRemoteMirror && props.onSync && (
              <Button
                icon={<IconSync spin={!!props.syncing} />}
                disabled={!!props.syncing || loading}
                onClick={() => void props.onSync?.()}
              >
                {props.syncing ? "同步中…" : "同步"}
              </Button>
            )}
            {isLocal && !isRemoteMirror && props.onUpdatePlaylist && (
              <Button icon={<IconEdit />} disabled={loading} onClick={() => setEditOpen(true)}>
                编辑
              </Button>
            )}
            <Input
              className="collection-detail-search"
              allowClear
              placeholder={searchPlaceholder}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <button
              type="button"
              className="collection-detail-locate"
              title={canLocate ? "定位到正在播放" : "当前列表无正在播放的歌曲"}
              disabled={loading || !canLocate}
              onClick={handleLocate}
            >
              <IconLocate />
            </button>
          </div>
        </div>
      </header>
      {body}
      <EditPlaylistModal
        open={editOpen}
        playlist={isLocal ? playlist : null}
        onClose={() => setEditOpen(false)}
        onSave={(patch) => {
          if (isLocal) props.onUpdatePlaylist?.(playlist.id, patch);
        }}
      />
    </div>
  );
}

const PAGE_STYLE = `
.collection-detail-page{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--text-primary,#f0f0f0)}
.collection-detail-page .fav-hero{display:flex;gap:24px;padding:14px 32px 12px;align-items:stretch;flex-shrink:0}
.collection-detail-page .fav-cover{width:160px;height:160px;flex-shrink:0;border-radius:8px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ffffff1f,#ffffff0d);color:#ffffff4d;overflow:hidden}
.collection-detail-page .fav-cover img{width:100%;height:100%;object-fit:cover}
.collection-detail-page .fav-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;justify-content:flex-end}
.collection-detail-badge{display:inline-block;font-size:12px;opacity:.7;margin-bottom:4px}
.collection-detail-page .fav-title{margin:0;font-size:28px;font-weight:700;line-height:1.2}
.collection-detail-page .fav-owner{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary,#a3a3a3)}
.collection-detail-page .fav-meta{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary,#a3a3a3);flex-wrap:wrap}
.collection-detail-page .fav-meta-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5}
.collection-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.collection-detail-search{max-width:220px}
.collection-detail-locate{width:32px;height:32px;border:1px solid var(--border-color,#2a2a2a);background:transparent;color:inherit;cursor:pointer}
.collection-detail-locate:disabled{opacity:.4;cursor:not-allowed}
.collection-detail-list{flex:1;min-height:0;overflow:auto;padding:0 24px 24px}
.collection-detail-page .main-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px;color:var(--text-secondary,#a3a3a3)}
.collection-detail-tracks{display:flex;flex-direction:column}
.collection-detail-page .track-row{display:grid;grid-template-columns:36px 40px minmax(0,2fr) minmax(100px,1fr) 64px auto;gap:10px;align-items:center;height:56px;padding:0 8px;cursor:pointer}
.collection-detail-page .track-row-header{height:36px;font-size:12px;opacity:.5;cursor:default}
.collection-detail-page .track-row.active{background:var(--bg-hover,rgba(255,255,255,.06))}
.collection-detail-page .track-cover{width:40px;height:40px;border-radius:4px;overflow:hidden;background:var(--border-color,#2a2a2a);display:flex;align-items:center;justify-content:center}
.collection-detail-page .track-cover img{width:100%;height:100%;object-fit:cover}
.collection-detail-page .track-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.collection-detail-page .track-artist,.collection-detail-page .track-album,.collection-detail-page .track-duration{font-size:12px;color:var(--text-secondary,#a3a3a3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.collection-detail-page .track-hover-actions{display:flex;gap:4px;justify-content:flex-end}
.collection-detail-page .track-hover-btn,.collection-detail-page .track-action-btn{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.75}
.collection-detail-page .track-action-btn.favorited{color:#f5c518}
.collection-detail-page .playlist-edit-cover{width:160px;height:160px;margin:0 auto 16px;border-radius:10px;overflow:hidden;cursor:pointer;border:2px dashed rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;background:transparent;color:inherit}
.collection-detail-page .playlist-edit-cover img{width:100%;height:100%;object-fit:cover}
.collection-detail-spin{animation:collection-detail-spin 1s linear infinite}
@keyframes collection-detail-spin{to{transform:rotate(360deg)}}
`;

const CollectionDetailPage = memo(CollectionDetailPageInner);
export default CollectionDetailPage;
