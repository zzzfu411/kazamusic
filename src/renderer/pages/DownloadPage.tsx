import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, Checkbox, Input, Segmented, message } from "antd";
import {
  canEnqueuePlayUrl,
  type DownloadCompletePayload,
  type DownloadProgressPayload,
  type DownloadStartItem,
  type DownloadStatus,
  type DownloadTrack,
} from "../../shared/types";
import { SETTINGS_KEY } from "../stores/settings";

const STATUS_ORDER: DownloadStatus[] = [
  "downloading",
  "paused",
  "queued",
  "failed",
  "missing",
  "completed",
];

type StatusFilter = "all" | "downloading" | "completed";
type GroupBy = "none" | "status" | "artist";

const ACTIVE_DOWNLOAD: ReadonlySet<string> = new Set([
  "downloading",
  "queued",
  "paused",
  "failed",
  "missing",
]);

export type DownloadPageProps = {
  tracks?: DownloadTrack[];
  currentIndex?: number;
  onSelect?: (index: number) => void;
  onRemove?: (id: string) => void;
  onPlayNext?: (id: string) => void;
  onPlayAll?: () => void;
  onPauseDownload?: (id: string) => void;
  onResumeDownload?: (id: string) => void;
  onRetryDownload?: (id: string) => void;
  onRemoveDownload?: (id: string) => void;
  onCleanMissingDownloads?: () => void;
  onOpenDetail?: (index: number) => void;
};

function api(): Window["electronAPI"] | undefined {
  return window.electronAPI;
}

function readGeneralSettings(): {
  downloadDir?: string;
  downloadNameFormat?: string;
  embedMetadata?: boolean;
  downloadSidecarFiles?: boolean;
} {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as { general?: Record<string, unknown> }) : {};
    const general = parsed.general ?? {};
    return {
      downloadDir: typeof general.downloadDir === "string" ? general.downloadDir : "",
      downloadNameFormat:
        typeof general.downloadNameFormat === "string" ? general.downloadNameFormat : undefined,
      embedMetadata: typeof general.embedMetadata === "boolean" ? general.embedMetadata : undefined,
      downloadSidecarFiles:
        typeof general.downloadSidecarFiles === "boolean" ? general.downloadSidecarFiles : undefined,
    };
  } catch {
    return {};
  }
}

function readDownloadDir(): string {
  return String(readGeneralSettings().downloadDir ?? "").trim();
}

function formatFileSize(mb?: number): string {
  if (!mb) return "--";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolvePlayUrl(track: DownloadTrack): string {
  if (canEnqueuePlayUrl(track.playUrl)) return track.playUrl.trim();
  if (track.filePath) {
    const local = api()?.getLocalUrl(track.filePath) ?? "";
    return canEnqueuePlayUrl(local) ? local : "";
  }
  return "";
}

function resolveDownloadUrl(track: DownloadTrack): string {
  const url = track.playUrl?.trim() ?? "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function normalizeLoadedTrack(track: DownloadTrack): DownloadTrack {
  let next = track;
  if (track.downloadStatus === "completed" && track.filePath && track.source !== "local") {
    next = { ...track, source: "local" };
  }
  if (next.filePath && next.artist === "未知艺术家") {
    const stem =
      next.filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || "";
    const sep = stem.indexOf(" - ");
    if (sep > 0) {
      const artist = stem.slice(0, sep).trim();
      const title = stem.slice(sep + 3).trim();
      if (artist) {
        next = { ...next, artist, ...(title ? { title } : {}) };
      }
    }
  }
  return next;
}

function statusMeta(status?: string): { label: string; className: string; icon: ReactNode } {
  switch (status) {
    case "completed":
      return { label: "已完成", icon: <IconCheck />, className: "status-completed" };
    case "downloading":
      return { label: "下载中", icon: <IconSpin />, className: "status-downloading" };
    case "paused":
      return { label: "已暂停", icon: <IconPauseCircle />, className: "status-paused" };
    case "failed":
      return { label: "下载失败", icon: <IconClose />, className: "status-failed" };
    case "missing":
      return { label: "文件丢失", icon: <IconWarn />, className: "status-missing" };
    case "queued":
      return { label: "等待中", icon: <IconClock />, className: "status-queued" };
    default:
      return { label: "未知", icon: null, className: "" };
  }
}

function useSelection(visibleIds: string[]) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of visibleIds) {
        if (prev.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const selectedCount = selectedIds.size;
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectedIdList = useMemo(() => visibleIds.filter((id) => selectedIds.has(id)), [visibleIds, selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const every = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      return every ? new Set() : new Set(visibleIds);
    });
  }, [visibleIds]);

  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  return {
    selectMode,
    selectedIds,
    selectedCount,
    allSelected,
    selectedIdList,
    toggleSelect,
    toggleSelectAll,
    enterSelectMode,
    exitSelectMode,
  };
}

function useManagedDownloads(controlled?: DownloadTrack[]) {
  const [owned, setOwned] = useState<DownloadTrack[]>([]);
  const [hydrated, setHydrated] = useState(controlled !== undefined);
  const listRef = useRef<DownloadTrack[]>([]);
  const inflight = useRef(new Set<string>());
  const progressBuf = useRef(new Map<string, DownloadProgressPayload>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlledMode = controlled !== undefined;

  const tracks = controlled ?? owned;
  listRef.current = tracks;

  const setTracks = useCallback((updater: (prev: DownloadTrack[]) => DownloadTrack[]) => {
    if (controlledMode) return;
    setOwned((prev) => updater(prev));
  }, [controlledMode]);

  useEffect(() => {
    if (controlledMode) return;
    const electron = api();
    if (!electron) {
      setHydrated(true);
      return;
    }
    void electron
      .dbLoadDownloads()
      .then((raw) => {
        const rows = Array.isArray(raw) ? (raw as DownloadTrack[]) : [];
        if (rows.length) setOwned(rows.map(normalizeLoadedTrack));
      })
      .finally(() => setHydrated(true));
  }, [controlledMode]);

  useEffect(() => {
    if (controlledMode || !hydrated) return;
    const electron = api();
    if (!electron) return;
    const busy = tracks.some(
      (t) => t.downloadStatus === "downloading" || t.downloadStatus === "queued",
    );
    if (!busy) {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      void electron.dbSaveDownloads(JSON.stringify(tracks));
      return;
    }
    persistTimer.current ||= setTimeout(() => {
      persistTimer.current = null;
      void api()?.dbSaveDownloads(JSON.stringify(listRef.current));
    }, 1000);
  }, [tracks, controlledMode, hydrated]);

  useEffect(() => {
    if (controlledMode) return;
    const electron = api();
    if (!electron) return;

    const flush = () => {
      flushTimer.current = null;
      const buf = progressBuf.current;
      if (buf.size === 0) return;
      progressBuf.current = new Map();
      setOwned((prev) =>
        prev.map((track) => {
          const patch = buf.get(track.id);
          if (!patch) return track;
          const status =
            patch.status === "paused"
              ? "paused"
              : patch.status === "failed"
                ? "failed"
                : "downloading";
          return {
            ...track,
            downloadProgress: patch.progress ?? track.downloadProgress,
            downloadSpeed: patch.speed ?? track.downloadSpeed,
            fileSize: patch.totalBytes ? patch.totalBytes / 1024 / 1024 : track.fileSize,
            downloadStatus: status,
          };
        }),
      );
    };

    const offProgress = electron.onDownloadProgress((payload) => {
      const p = payload as DownloadProgressPayload;
      if (!p?.id) return;
      const prev = progressBuf.current.get(p.id);
      progressBuf.current.set(p.id, prev ? { ...prev, ...p } : p);
      flushTimer.current ||= setTimeout(flush, 250);
    });

    const offComplete = electron.onDownloadComplete((payload) => {
      const done = payload as DownloadCompletePayload;
      if (!done?.id) return;
      inflight.current.delete(done.id);
      progressBuf.current.delete(done.id);
      const current = listRef.current.find((t) => t.id === done.id);
      if (!current) return;
      const completed: DownloadTrack = {
        ...current,
        downloadStatus: "completed",
        downloadProgress: 100,
        downloadedAt: new Date().toLocaleString(),
        filePath: done.filePath,
        source: "local",
        playUrl: done.filePath ? electron.getLocalUrl(done.filePath) : current.playUrl,
      };
      setOwned((prev) => prev.map((t) => (t.id === done.id ? completed : t)));
      void message.success("下载完成");
      if (!done.filePath) return;
      void electron
        .readFiles([done.filePath])
        .then((rows) => {
          const meta = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
          if (!meta) return;
          const stem =
            done.filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
          const title = typeof meta.title === "string" && meta.title !== stem ? meta.title : undefined;
          const artist =
            typeof meta.artist === "string" && meta.artist !== "未知艺术家" ? meta.artist : undefined;
          const album =
            typeof meta.album === "string" && meta.album !== "未知专辑" ? meta.album : undefined;
          const duration = typeof meta.duration === "number" ? Math.round(meta.duration) : undefined;
          const fileSize =
            typeof meta.fileSize === "number"
              ? Math.round((meta.fileSize / 1048576) * 10) / 10
              : undefined;
          const coverPath = typeof meta.coverPath === "string" ? meta.coverPath : "";
          const coverUrl = coverPath
            ? `local-music://c/${encodeURIComponent(coverPath.replace(/\\/g, "/").split("/").pop() || "")}`
            : completed.coverUrl;
          const patched: DownloadTrack = {
            ...completed,
            title: title || completed.title,
            artist: artist || completed.artist,
            album: album || completed.album,
            duration: duration || completed.duration,
            fileSize: fileSize || completed.fileSize,
            coverUrl,
            lyrics: typeof meta.lyrics === "string" ? meta.lyrics : completed.lyrics,
          };
          setOwned((prev) => prev.map((t) => (t.id === patched.id ? patched : t)));
        })
        .catch(() => undefined);
    });

    return () => {
      offProgress?.();
      offComplete?.();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [controlledMode]);

  const pauseDownload = useCallback((id: string) => {
    void api()?.downloadPause(id);
    inflight.current.delete(id);
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, downloadStatus: "paused" } : t)),
    );
  }, [setTracks]);

  const startOrResume = useCallback(async (id: string) => {
    const track = listRef.current.find((t) => t.id === id);
    if (!track) return;
    if (inflight.current.has(id)) {
      void message.info("该歌曲正在下载中");
      return;
    }
    const downloadDir = readDownloadDir();
    if (!downloadDir) {
      void message.warning("请先在设置中选择下载保存目录");
      return;
    }
    const url = resolveDownloadUrl(track);
    if (!url) {
      void message.warning(`"${track.title}" 无法下载：未找到完整音源`);
      setTracks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, downloadStatus: "failed" } : t)),
      );
      return;
    }
    inflight.current.add(id);
    setTracks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, downloadStatus: "downloading", downloadProgress: t.downloadProgress ?? 0 } : t,
      ),
    );
    const general = readGeneralSettings();
    const item: DownloadStartItem = {
      id,
      url,
      title: track.title,
      artist: track.artist,
      downloadDir,
      nameFormat: general?.downloadNameFormat,
      embedMetadata: general?.embedMetadata,
      sidecar: general?.downloadSidecarFiles,
    };
    try {
      const result = (await api()?.downloadResume(item)) as { ok?: boolean; error?: string } | undefined;
      if (result && result.ok === false) {
        throw new Error(result.error || "下载启动失败");
      }
    } catch (err) {
      const text = err instanceof Error && /[一-龥]/.test(err.message) ? err.message : "未找到完整音源";
      void message.warning(`"${track.title}" 无法下载：${text}`);
      inflight.current.delete(id);
      setTracks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, downloadStatus: "failed" } : t)),
      );
    }
  }, [setTracks]);

  const removeDownload = useCallback((id: string) => {
    void api()?.downloadRemove(id);
    inflight.current.delete(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }, [setTracks]);

  const verifyDownloads = useCallback(async () => {
    const completed = listRef.current.filter((t) => t.downloadStatus === "completed" && t.filePath);
    if (completed.length === 0) return;
    const missing: string[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < completed.length) {
        const track = completed[cursor++];
        if (!track.filePath) continue;
        try {
          const exists = await api()?.localFileExists(track.filePath);
          if (!exists) missing.push(track.id);
        } catch {
          /* ignore */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, completed.length) }, () => worker()));
    if (missing.length === 0) return;
    const lost = new Set(missing);
    setTracks((prev) =>
      prev.map((t) =>
        lost.has(t.id)
          ? { ...t, downloadStatus: "missing", downloadProgress: 0, filePath: undefined, playUrl: undefined }
          : t,
      ),
    );
    void message.warning(`${missing.length} 个下载文件已丢失，已标记为「文件丢失」`);
  }, [setTracks]);

  const cleanMissingDownloads = useCallback(() => {
    const missing = listRef.current.filter((t) => t.downloadStatus === "missing");
    if (missing.length === 0) {
      void message.info("无丢失文件可清理");
      return;
    }
    const ids = new Set(missing.map((t) => t.id));
    for (const track of missing) {
      void api()?.downloadRemove(track.id);
      inflight.current.delete(track.id);
    }
    setTracks((prev) => prev.filter((t) => !ids.has(t.id)));
    void message.success(`已清理 ${missing.length} 个丢失的下载记录`);
  }, [setTracks]);

  useEffect(() => {
    if (controlledMode || !hydrated) return;
    void verifyDownloads();
  }, [controlledMode, hydrated, verifyDownloads]);

  return {
    tracks,
    pauseDownload,
    resumeDownload: startOrResume,
    retryDownload: startOrResume,
    removeDownload,
    cleanMissingDownloads,
    verifyDownloads,
  };
}

function DownloadPageView({
  tracks,
  currentIndex = -1,
  onSelect,
  onRemove,
  onPlayAll,
  onPauseDownload,
  onResumeDownload,
  onRetryDownload,
  onRemoveDownload,
  onCleanMissingDownloads,
  onOpenDetail,
}: Required<Pick<DownloadPageProps, "tracks">> & Omit<DownloadPageProps, "tracks" | "onPlayNext">) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const grouped = groupBy !== "none";
  const downloadDir = readDownloadDir();

  const tabCounts = useMemo(
    () => ({
      all: tracks.length,
      downloading: tracks.filter((t) => ACTIVE_DOWNLOAD.has(String(t.downloadStatus))).length,
      completed: tracks.filter((t) => t.downloadStatus === "completed").length,
    }),
    [tracks],
  );

  const stats = useMemo(() => {
    const completed = tracks.filter((t) => t.downloadStatus === "completed");
    return {
      completedCount: completed.length,
      downloadingCount: tracks.filter((t) => t.downloadStatus === "downloading").length,
      totalSize: completed.reduce((sum, t) => sum + (t.fileSize || 0), 0),
    };
  }, [tracks]);

  const heroCover = useMemo(() => tracks.find((t) => t.coverUrl)?.coverUrl, [tracks]);

  const visible = useMemo(() => {
    let list = tracks;
    if (filter === "downloading") {
      list = list.filter((t) => ACTIVE_DOWNLOAD.has(String(t.downloadStatus)));
    } else if (filter === "completed") {
      list = list.filter((t) => t.downloadStatus === "completed");
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tracks, filter, query]);

  const sections = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "", items: visible }];
    }
    const map = new Map<string, DownloadTrack[]>();
    for (const track of visible) {
      const key = groupBy === "status" ? track.downloadStatus || "unknown" : track.artist;
      const bucket = map.get(key);
      if (bucket) bucket.push(track);
      else map.set(key, [track]);
    }
    const entries = Array.from(map.entries());
    if (groupBy === "status") {
      entries.sort((a, b) => STATUS_ORDER.indexOf(a[0] as DownloadStatus) - STATUS_ORDER.indexOf(b[0] as DownloadStatus));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
    }
    return entries.map(([key, items]) => ({
      key,
      label: groupBy === "status" ? statusMeta(key).label : key,
      items,
    }));
  }, [visible, groupBy]);

  const visibleIds = useMemo(() => visible.map((t) => t.id), [visible]);
  const {
    selectMode,
    selectedIds,
    selectedCount,
    allSelected,
    selectedIdList,
    toggleSelect,
    toggleSelectAll,
    enterSelectMode,
    exitSelectMode,
  } = useSelection(visibleIds);

  const playableCompleted = useCallback((list: DownloadTrack[]) => {
    return list.filter((t) => t.downloadStatus === "completed" && resolvePlayUrl(t));
  }, []);

  const handleSelect = useCallback(
    (track: DownloadTrack) => {
      if (selectMode) {
        toggleSelect(track.id);
        return;
      }
      if (track.downloadStatus !== "completed") return;
      if (!resolvePlayUrl(track)) return;
      const index = tracks.findIndex((t) => t.id === track.id);
      if (index >= 0) onSelect?.(index);
    },
    [selectMode, toggleSelect, tracks, onSelect],
  );

  const handlePlayAll = useCallback(() => {
    const playable = playableCompleted(tracks);
    if (playable.length === 0) return;
    onPlayAll?.();
  }, [playableCompleted, tracks, onPlayAll]);

  const handleBatchDelete = useCallback(() => {
    if (selectedCount === 0) return;
    for (const id of selectedIdList) {
      (onRemoveDownload ?? onRemove)?.(id);
    }
    exitSelectMode();
  }, [selectedCount, selectedIdList, onRemoveDownload, onRemove, exitSelectMode]);

  const currentId = currentIndex >= 0 ? tracks[currentIndex]?.id : undefined;

  const renderRow = (track: DownloadTrack, sectionItems: DownloadTrack[]) => {
    const active = !selectMode && track.id === currentId;
    const meta = statusMeta(track.downloadStatus);
    const selected = selectedIds.has(track.id);
    const showProgress =
      (track.downloadStatus === "downloading" || track.downloadStatus === "paused") &&
      track.downloadProgress !== undefined;
    const indexLabel = (sectionItems.findIndex((t) => t.id === track.id) + 1).toString().padStart(2, "0");
    const progressStyle = showProgress
      ? ({ "--dl-progress": `${track.downloadProgress ?? 0}%` } as CSSProperties)
      : undefined;

    return (
      <div
        key={track.id}
        className={`dl-row${active ? " active" : ""}${selectMode && selected ? " selected" : ""}`}
        onClick={() => handleSelect(track)}
      >
        {selectMode && (
          <div className="dl-col-check" onClick={(ev) => ev.stopPropagation()}>
            <Checkbox checked={selected} onChange={() => toggleSelect(track.id)} />
          </div>
        )}
        <div className="dl-col-index">{indexLabel}</div>
        <div className="dl-col-title">
          {track.coverUrl ? (
            <img className="dl-cover" src={track.coverUrl} alt="" />
          ) : (
            <div className="dl-cover dl-cover-placeholder">
              <IconMusic />
            </div>
          )}
          <div className="dl-meta">
            <div className="dl-title">{track.title}</div>
            <div className="dl-artist">{track.artist}</div>
          </div>
        </div>
        <div className="dl-col-size">{formatFileSize(track.fileSize)}</div>
        <div className="dl-col-duration">{formatDuration(track.duration)}</div>
        <div className="dl-col-status">
          <span className={`download-status ${meta.className}`} style={progressStyle}>
            {meta.icon}
            <span>{meta.label}</span>
          </span>
        </div>
        {!selectMode && (
          <div className="dl-col-actions" onClick={(ev) => ev.stopPropagation()}>
            {track.downloadStatus === "completed" && onOpenDetail && (
              <button
                type="button"
                className="track-action-btn"
                title="查看详情"
                onClick={() => {
                  const index = tracks.findIndex((t) => t.id === track.id);
                  if (index >= 0) onOpenDetail(index);
                }}
              >
                <IconDetail />
              </button>
            )}
            {track.downloadStatus === "downloading" && onPauseDownload && (
              <button
                type="button"
                className="track-action-btn"
                title="暂停"
                onClick={() => onPauseDownload(track.id)}
              >
                <IconPause />
              </button>
            )}
            {track.downloadStatus === "paused" && onResumeDownload && (
              <button
                type="button"
                className="track-action-btn"
                title="继续"
                onClick={() => onResumeDownload(track.id)}
              >
                <IconCaretRight />
              </button>
            )}
            {(track.downloadStatus === "failed" || track.downloadStatus === "missing") && onRetryDownload && (
              <button
                type="button"
                className="track-action-btn"
                title={track.downloadStatus === "missing" ? "重新下载" : "重试"}
                onClick={() => onRetryDownload(track.id)}
              >
                <IconRedo />
              </button>
            )}
            {onRemoveDownload && (
              <button
                type="button"
                className="track-action-btn danger"
                title="移除"
                onClick={() => onRemoveDownload(track.id)}
              >
                <IconDelete />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`favorite-page download-page${selectMode ? " is-select-mode" : ""}`}>
      <style>{DOWNLOAD_PAGE_CSS}</style>
      <header className="fav-hero">
        <div className="fav-cover">
          {heroCover ? <img src={heroCover} alt="" /> : <IconMusic />}
        </div>
        <div className="fav-info">
          <h1 className="fav-title">下载管理</h1>
          <div className="fav-owner">
            <span className="fav-owner-time">
              {downloadDir ? `保存路径 · ${downloadDir}` : "尚未设置下载保存目录"}
            </span>
          </div>
          <div className="fav-meta">
            <span>
              已完成 <strong>{stats.completedCount}</strong>
            </span>
            <span className="fav-meta-dot" />
            <span>
              下载中 <strong>{stats.downloadingCount}</strong>
            </span>
            <span className="fav-meta-dot" />
            <span>
              占用空间 <strong>{formatFileSize(stats.totalSize)}</strong>
            </span>
          </div>
          <div className="fav-actions">
            {selectMode ? (
              <>
                <Button icon={<IconSelect />} onClick={toggleSelectAll}>
                  {allSelected ? "取消全选" : "全选当前"}
                </Button>
                <Button danger icon={<IconDelete />} disabled={selectedCount === 0} onClick={handleBatchDelete}>
                  删除{selectedCount > 0 ? ` (${selectedCount})` : ""}
                </Button>
                <Button type="text" onClick={exitSelectMode}>
                  完成
                </Button>
              </>
            ) : (
              <>
                <Button type="primary" icon={<IconPlay />} onClick={handlePlayAll}>
                  播放全部
                </Button>
                <Button icon={<IconSelect />} onClick={enterSelectMode}>
                  批量管理
                </Button>
                <Button
                  icon={<IconReload />}
                  onClick={onCleanMissingDownloads}
                  title="清理移动或删除的文件记录"
                >
                  刷新
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="fav-toolbar">
        <div className="fav-filters">
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as StatusFilter)}
            options={[
              { value: "all", label: `全部 ${tabCounts.all}`, icon: <IconGrid /> },
              { value: "downloading", label: `下载中 ${tabCounts.downloading}`, icon: <IconCloud /> },
              { value: "completed", label: `已完成 ${tabCounts.completed}`, icon: <IconCheck /> },
            ]}
          />
        </div>
        <div className="fav-toolbar-right">
          <Segmented
            value={groupBy}
            onChange={(value) => setGroupBy(value as GroupBy)}
            options={[
              { value: "none", label: "全部", icon: <IconGrid /> },
              { value: "status", label: "状态", icon: <IconClock /> },
              { value: "artist", label: "歌手", icon: <IconUser /> },
            ]}
          />
          <Input
            allowClear
            placeholder="搜索下载项"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            style={{ width: 200 }}
          />
        </div>
      </div>
      {selectMode && (
        <div className="fav-select-bar">
          已选 <strong>{selectedCount}</strong> / {visible.length} 项
        </div>
      )}
      <div className={`fav-list${grouped ? " fav-list--grouped" : ""}`}>
        {sections.map((section) => (
          <div className="fav-section" key={section.key}>
            {section.label && (
              <div className="fav-section-header">
                <span className="fav-section-title">{section.label}</span>
                <span className="fav-section-count">{section.items.length} 首</span>
              </div>
            )}
            {section.items.length === 0 ? (
              <div className="main-empty">
                <div className="empty-icon">
                  <IconMusic />
                </div>
                <div>当前 Tab 没有下载项</div>
              </div>
            ) : (
              <div className="main-list dl-table">
                <div className={`dl-header${selectMode ? " dl-header--select" : ""}`}>
                  {selectMode && <div className="dl-col-check" aria-hidden />}
                  <div className="dl-col-index">#</div>
                  <div className="dl-col-title dl-col-title--head">标题</div>
                  <div className="dl-col-size">大小</div>
                  <div className="dl-col-duration">时长</div>
                  <div className="dl-col-status">状态</div>
                  <div className="dl-col-actions" aria-hidden />
                </div>
                {section.items.map((track) => renderRow(track, section.items))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DownloadPageInner(props: DownloadPageProps) {
  const managed = useManagedDownloads(props.tracks);
  const tracks = props.tracks ?? managed.tracks;

  const handleSelect = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (!track || track.downloadStatus !== "completed") return;
      const playUrl = resolvePlayUrl(track);
      if (!playUrl) return;
      if (props.onSelect) {
        props.onSelect(index);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("kazam:enqueue", { detail: { tracks: [{ ...track, playUrl }], index: 0 } }),
      );
    },
    [tracks, props],
  );

  const handlePlayAll = useCallback(() => {
    const playable = tracks
      .filter((t) => t.downloadStatus === "completed")
      .map((t) => ({ ...t, playUrl: resolvePlayUrl(t) }))
      .filter((t) => canEnqueuePlayUrl(t.playUrl));
    if (playable.length === 0) return;
    if (props.onPlayAll) {
      props.onPlayAll();
      return;
    }
    window.dispatchEvent(new CustomEvent("kazam:enqueue", { detail: { tracks: playable, index: 0 } }));
  }, [tracks, props]);

  return (
    <DownloadPageView
      tracks={tracks}
      currentIndex={props.currentIndex}
      onSelect={handleSelect}
      onRemove={props.onRemove}
      onPlayAll={handlePlayAll}
      onPauseDownload={props.onPauseDownload ?? managed.pauseDownload}
      onResumeDownload={props.onResumeDownload ?? managed.resumeDownload}
      onRetryDownload={props.onRetryDownload ?? managed.retryDownload}
      onRemoveDownload={props.onRemoveDownload ?? props.onRemove ?? managed.removeDownload}
      onCleanMissingDownloads={props.onCleanMissingDownloads ?? managed.cleanMissingDownloads}
      onOpenDetail={props.onOpenDetail}
    />
  );
}

export const DownloadPage = memo(DownloadPageInner);
export default DownloadPage;

function IconSvg({ children, spin }: { children: ReactNode; spin?: boolean }) {
  return (
    <svg
      className={spin ? "dl-icon dl-icon--spin" : "dl-icon"}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function IconCheck() {
  return (
    <IconSvg>
      <path d="M20 6 9 17l-5-5" />
    </IconSvg>
  );
}
function IconSpin() {
  return (
    <IconSvg spin>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </IconSvg>
  );
}
function IconPauseCircle() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </IconSvg>
  );
}
function IconClose() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </IconSvg>
  );
}
function IconWarn() {
  return (
    <IconSvg>
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 9v5M12 17h.01" />
    </IconSvg>
  );
}
function IconClock() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconSvg>
  );
}
function IconPause() {
  return (
    <IconSvg>
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
    </IconSvg>
  );
}
function IconCaretRight() {
  return (
    <IconSvg>
      <path d="M8 5v14l11-7z" />
    </IconSvg>
  );
}
function IconRedo() {
  return (
    <IconSvg>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </IconSvg>
  );
}
function IconDelete() {
  return (
    <IconSvg>
      <path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" />
    </IconSvg>
  );
}
function IconDetail() {
  return (
    <IconSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 8h.01" />
    </IconSvg>
  );
}
function IconSelect() {
  return (
    <IconSvg>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </IconSvg>
  );
}
function IconPlay() {
  return (
    <IconSvg>
      <path d="M7 4v16l13-8z" />
    </IconSvg>
  );
}
function IconReload() {
  return (
    <IconSvg>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 4v6h-6" />
    </IconSvg>
  );
}
function IconGrid() {
  return (
    <IconSvg>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </IconSvg>
  );
}
function IconCloud() {
  return (
    <IconSvg>
      <path d="M7 18a5 5 0 0 1 .5-9.9A6 6 0 0 1 18.5 10 4 4 0 0 1 18 18H7z" />
    </IconSvg>
  );
}
function IconUser() {
  return (
    <IconSvg>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </IconSvg>
  );
}
function IconMusic() {
  return (
    <IconSvg>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </IconSvg>
  );
}

const DOWNLOAD_PAGE_CSS = `
.download-page{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;height:100%}
.download-page .fav-hero{display:flex;gap:24px;padding:14px 40px 12px;align-items:stretch;flex-shrink:0}
.download-page .fav-cover{aspect-ratio:1/1;height:auto;min-height:112px;width:112px;flex-shrink:0;border-radius:8px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ffffff1f,#ffffff0d);font-size:48px;color:#ffffff4d;overflow:hidden}
.download-page .fav-cover img{width:100%;height:100%;object-fit:cover}
.download-page .fav-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;justify-content:flex-end}
.download-page .fav-title{font-size:28px;font-weight:700;color:var(--text-primary);letter-spacing:.3px;line-height:1.2;margin:0}
.download-page .fav-owner{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)}
.download-page .fav-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-secondary)}
.download-page .fav-meta strong{color:var(--text-primary);font-weight:500;margin-left:2px}
.download-page .fav-meta-dot{width:3px;height:3px;border-radius:50%;background:var(--text-secondary)}
.download-page .fav-actions{display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap}
.download-page .fav-toolbar{display:flex;align-items:center;justify-content:space-between;padding:4px 40px 6px;gap:16px;flex-shrink:0}
.download-page .fav-toolbar-right{display:flex;align-items:center;gap:10px}
.download-page .fav-select-bar{margin:12px 40px 10px;padding:8px 14px;font-size:13px;color:var(--text-secondary);background:var(--bg-hover)}
.download-page .fav-list{flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto}
.download-page .fav-section-header{display:flex;align-items:center;gap:8px;padding:10px 40px 6px;color:var(--text-secondary);font-size:13px}
.download-page .fav-section-count{opacity:.7}
.download-page .main-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-secondary);font-size:13px;gap:12px;padding:48px 0}
.download-page .dl-header,.download-page .dl-row{display:grid;align-items:center;gap:16px;margin:0 16px;padding:10px 24px;grid-template-columns:36px minmax(0,1fr) 90px 64px 110px 80px}
.download-page .dl-header{padding:4px 24px 8px;font-size:13px;color:var(--text-tertiary,#fff6);border-bottom:1px solid var(--border-color,#ffffff1a)}
.download-page .dl-header--select,.download-page.is-select-mode .dl-row{grid-template-columns:32px 36px minmax(0,1fr) 90px 64px 110px 80px}
.download-page .dl-row{border-radius:6px;cursor:pointer;position:relative}
.download-page .dl-row:hover{background:var(--bg-hover)}
.download-page .dl-row.active,.download-page .dl-row.selected{background:var(--bg-hover)}
.download-page .dl-col-index{font-size:13px;color:var(--text-secondary);text-align:center;font-variant-numeric:tabular-nums}
.download-page .dl-col-title{display:flex;align-items:center;gap:16px;min-width:0}
.download-page .dl-cover{width:46px;height:46px;border-radius:8px;object-fit:cover;background:var(--bg-hover);flex-shrink:0}
.download-page .dl-cover-placeholder{display:flex;align-items:center;justify-content:center;color:var(--text-secondary)}
.download-page .dl-meta{min-width:0;display:flex;flex-direction:column;gap:4px}
.download-page .dl-title{font-size:14px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.download-page .dl-artist{font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.download-page .dl-col-size,.download-page .dl-col-duration{font-size:14px;color:var(--text-secondary);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.download-page .dl-col-status{display:flex;align-items:center;justify-content:center}
.download-page .dl-col-actions{display:flex;gap:2px;justify-content:flex-end}
.download-page .download-status{position:relative;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;padding:3px 10px;border-radius:999px;white-space:nowrap;min-width:88px;justify-content:center;background-color:var(--dl-bg,var(--bg-hover));background-image:var(--dl-bg-fill,none);background-repeat:no-repeat;color:var(--dl-fg,var(--text-tertiary))}
.download-page .download-status.status-completed{--dl-bg:rgba(82,196,26,.12);--dl-bg-fill:linear-gradient(to right,rgba(82,196,26,.32) 100%,transparent 100%);--dl-fg:#52c41a}
.download-page .download-status.status-downloading{--dl-bg:rgba(23,58,82,.35);--dl-bg-fill:linear-gradient(to right,rgba(255,255,255,.18) var(--dl-progress,0%),transparent var(--dl-progress,0%));--dl-fg:var(--accent,#173A52)}
.download-page .download-status.status-paused{--dl-bg:rgba(250,173,20,.12);--dl-bg-fill:linear-gradient(to right,rgba(250,173,20,.32) var(--dl-progress,0%),transparent var(--dl-progress,0%));--dl-fg:#faad14}
.download-page .download-status.status-failed{--dl-bg:rgba(255,77,79,.12);--dl-fg:#ff4d4f}
.download-page .download-status.status-missing{--dl-bg:rgba(250,173,20,.12);--dl-fg:#faad14}
.download-page .download-status.status-queued{--dl-bg:var(--bg-hover);--dl-fg:var(--text-secondary)}
.download-page .track-action-btn{width:28px;height:28px;border:none;background:transparent;color:var(--text-secondary);border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.download-page .track-action-btn:hover{background:var(--bg-hover);color:var(--text-primary)}
.download-page .track-action-btn.danger:hover{color:#ff4d4f}
.download-page .dl-icon--spin{animation:dl-spin 1s linear infinite}
@keyframes dl-spin{to{transform:rotate(360deg)}}
`;
