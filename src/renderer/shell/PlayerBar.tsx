import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { brand } from "../brand/assets";
import {
  IconDownload,
  IconHeart,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconSequence,
  IconShuffle,
  IconVolume,
} from "../icons/Icons";
import { toggleFavorite, useFavorites } from "../stores/favorites";
import {
  cyclePlayMode,
  formatPlayerTime,
  next,
  playAt,
  previous,
  removeFromQueue,
  seek,
  setVolume,
  toggle,
  toggleDetail,
  toggleQueue,
  usePlayer,
  type PlayMode,
} from "../stores/player";

function modeLabel(mode: PlayMode): string {
  if (mode === "shuffle") return "随机播放";
  if (mode === "repeat-one") return "单曲循环";
  if (mode === "loop") return "列表循环";
  return "顺序播放";
}

function ModeIcon({ mode }: { mode: PlayMode }) {
  if (mode === "shuffle") return <IconShuffle size={16} />;
  if (mode === "repeat-one") return <IconRepeatOne size={16} />;
  if (mode === "loop") return <IconRepeat size={16} />;
  return <IconSequence size={16} />;
}

function asProgressPct(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, pct));
}

function VolumePopup({ volume }: { volume: number }) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState<number | null>(null);
  const last = useRef(volume > 0 ? volume : 0.8);
  const wrapRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  const tipTimer = useRef(0);
  const railRef = useRef<HTMLDivElement>(null);

  volumeRef.current = volume;
  useEffect(() => {
    if (volume > 0) last.current = volume;
  }, [volume]);

  const apply = (nextVol: number) => {
    const clamped = Math.min(1, Math.max(0, nextVol));
    setVolume(clamped);
    setTip(clamped);
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), 800);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      apply(volumeRef.current + (event.deltaY > 0 ? -0.03 : 0.03));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const fromY = (clientY: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return volumeRef.current;
    return Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
  };

  const onRailPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    apply(fromY(event.clientY));
  };

  const muteToggle = () => {
    if (volumeRef.current > 0) {
      last.current = volumeRef.current;
      apply(0);
      return;
    }
    apply(last.current > 0 ? last.current : 0.8);
  };

  const open = hover || dragging || tip != null;

  return (
    <div className="player-volume">
      <div
        ref={wrapRef}
        className={`player-volume-wrap${open ? " is-active" : ""}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          if (!dragging) setHover(false);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {open ? (
          <div className="player-vol-popup">
            {tip != null ? <div className="player-vol-tip">{Math.round(tip * 100)}%</div> : null}
            {hover || dragging ? (
              <div
                className="player-vol-slider"
                onPointerDown={onRailPointer}
                onPointerMove={(event) => {
                  if (event.buttons) apply(fromY(event.clientY));
                }}
                onPointerUp={() => {
                  setDragging(false);
                  setHover(false);
                }}
                onPointerCancel={() => setDragging(false)}
              >
                <div className="player-vol-rail" ref={railRef}>
                  <div className="player-vol-fill" style={{ height: `${volume * 100}%` }} />
                  <div className="player-vol-dot" style={{ bottom: `${volume * 100}%` }} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="player-queue-btn"
          title={volume > 0 ? "静音" : "恢复音量"}
          aria-label={volume > 0 ? "静音" : "恢复音量"}
          onClick={muteToggle}
        >
          <IconVolume size={16} muted={volume <= 0} />
        </button>
      </div>
    </div>
  );
}

export function PlayerBar() {
  const player = usePlayer();
  const favorites = useFavorites();
  const track = player.currentTrack;
  const ratio = player.duration > 0 ? Math.min(1, player.currentTime / player.duration) : 0;
  const playing = player.state === "playing" || player.state === "loading";
  const cover = track?.coverUrl || brand.covers[0];
  const favorited = Boolean(track && favorites.isFavorite(track.id));
  const [favAnim, setFavAnim] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "l") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!track || track.source !== "online") {
      setDlProgress(null);
      return;
    }
    const id = track.id;
    const api = window.electronAPI;
    const offProgress = api?.onDownloadProgress?.((payload) => {
      const rec = payload as { id?: string; progress?: number; status?: string };
      if (rec.id !== id) return;
      if (rec.status === "completed") {
        setDlProgress(100);
        return;
      }
      const pct = asProgressPct(rec.progress);
      if (pct != null) setDlProgress(pct);
    });
    const offDone = api?.onDownloadComplete?.((payload) => {
      const rec = payload as { id?: string };
      if (rec.id === id) setDlProgress(100);
    });
    return () => {
      offProgress?.();
      offDone?.();
    };
  }, [track?.id, track?.source]);

  const onSeekBar = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || player.duration <= 0) return;
    const t = ((event.clientX - rect.left) / rect.width) * player.duration;
    seek(t);
  };

  const onToggleFav = () => {
    if (!track) return;
    toggleFavorite(track);
    setFavAnim(true);
    window.setTimeout(() => setFavAnim(false), 300);
  };

  const onDownload = () => {
    if (!track || track.source !== "online") return;
    if (dlProgress != null && dlProgress < 100) return;
    setDlProgress(0);
    void Promise.resolve(window.electronAPI?.downloadStart?.(track)).catch(() => {
      setDlProgress(null);
    });
  };

  return (
    <>
      {player.warning ? (
        <div className="player-warning app-toast" role="status">
          {player.warning}
        </div>
      ) : null}
      {player.queueOpen ? (
        <div className="player-queue-panel" role="dialog" aria-label="播放列表">
          <div className="player-queue-head">
            <span>Queue · {player.queue.length}</span>
            <button type="button" onClick={() => toggleQueue()}>
              关闭
            </button>
          </div>
          {player.queue.length === 0 ? (
            <div className="player-queue-empty">队列为空</div>
          ) : (
            <ul className="player-queue-list">
              {player.queue.map((item, index) => (
                <li
                  key={item.id}
                  className={`player-queue-item${index === player.currentIndex ? " is-current" : ""}`}
                >
                  <button type="button" className="player-queue-main" onClick={() => playAt(index)}>
                    <span className="player-queue-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="player-queue-title">{item.title}</span>
                    <span className="player-queue-artist">{item.artist}</span>
                  </button>
                  <button
                    type="button"
                    className="player-queue-remove"
                    title="移出队列"
                    onClick={() => removeFromQueue(item.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <footer className="player">
        <div className="player-progress-bar" onClick={onSeekBar} role="slider" aria-label="进度">
          <div className="player-progress-bar-track" />
          <div className="player-progress-bar-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
        <div className="player-track player-track-info">
          <button type="button" className="player-cover" onClick={() => toggleDetail()} title="展开详情">
            <img src={cover} alt="" />
            <span className="player-cover-expand" aria-hidden>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M17.5858 5H14V3H21V10H19V6.41421L14.7071 10.7071L13.2929 9.29289L17.5858 5ZM3 14H5V17.5858L9.29289 13.2929L10.7071 14.7071L6.41421 19H10V21H3V14Z" />
              </svg>
            </span>
          </button>
          <div className="player-meta">
            <div className="player-title-row">
              <button type="button" className="player-track-title" onClick={() => toggleDetail()}>
                {track?.title || "未选择曲目"}
              </button>
              {track ? (
                <div className="player-actions">
                  <button
                    type="button"
                    className={`player-fav-btn${favorited ? " active" : ""}${favAnim ? " fav-anim" : ""}`}
                    title={favorited ? "取消收藏" : "收藏"}
                    onClick={onToggleFav}
                  >
                    <IconHeart size={15} filled={favorited} />
                  </button>
                  {track.source === "online" ? (
                    <span className="player-dl-btn-wrap">
                      <button
                        type="button"
                        className="player-fav-btn"
                        title={
                          dlProgress == null
                            ? "下载"
                            : dlProgress >= 100
                              ? "已下载"
                              : `下载中 ${Math.round(dlProgress)}%`
                        }
                        onClick={onDownload}
                      >
                        {dlProgress != null && dlProgress < 100 ? (
                          <span className="player-dl-percent">{Math.round(dlProgress)}</span>
                        ) : (
                          <IconDownload size={15} />
                        )}
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="player-track-artist">{track?.artist || "等待播放"}</div>
          </div>
        </div>
        <div className="player-controls">
          <div className="player-buttons">
            <button type="button" className="player-btn" title="上一首" onClick={() => previous()}>
              <IconPrev size={16} />
            </button>
            <button
              type="button"
              className={`player-btn player-btn-play${player.state === "loading" ? " is-loading" : ""}`}
              title={playing ? "暂停" : "播放"}
              aria-label={playing ? "暂停" : "播放"}
              onClick={() => toggle()}
            >
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <button type="button" className="player-btn" title="下一首" onClick={() => next()}>
              <IconNext size={16} />
            </button>
          </div>
          <div className="player-progress">
            <span>{formatPlayerTime(player.currentTime)}</span>
            <span>{formatPlayerTime(player.duration)}</span>
          </div>
        </div>
        <div className="player-right">
          <VolumePopup volume={player.volume} />
          <button
            type="button"
            className="player-queue-btn"
            title={modeLabel(player.playMode)}
            onClick={() => cyclePlayMode()}
          >
            <ModeIcon mode={player.playMode} />
          </button>
          <button
            type="button"
            className={`player-queue-btn${player.queueOpen ? " active" : ""}`}
            title="播放列表 (Ctrl+P)"
            onClick={() => toggleQueue()}
          >
            <IconQueue size={16} />
          </button>
        </div>
      </footer>
    </>
  );
}
