import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { brand } from "../renderer/brand/assets";
import { IconNext, IconPause, IconPlay, IconPrev } from "../renderer/icons/Icons";
import { applyResolvedTheme } from "../renderer/theme-runtime";
import type { OverlaySnapshot } from "../types/overlay-api";
import "../renderer/styles/kazam-theme.css";
import "../renderer/styles/taskbar-theme.css";

const OVERLAY_FONT = 'var(--lyric-font, "DM Sans", "PingFang SC", sans-serif)';

function formatTime(seconds = 0): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TaskbarRoot() {
  const [snap, setSnap] = useState<OverlaySnapshot | null>(
    () => window.taskbarAPI?.bootstrap?.snapshot ?? null,
  );

  useEffect(() => {
    applyResolvedTheme();
    const api = window.taskbarAPI;
    if (!api) return;
    const offSnap = api.onSnapshot((payload) => setSnap(payload));
    const offTick = api.onTick((tick) => {
      setSnap((prev) => ({
        ...(prev || {}),
        currentTime: tick.currentTime ?? prev?.currentTime,
        duration: tick.duration ?? prev?.duration,
      }));
    });
    return () => {
      offSnap();
      offTick();
    };
  }, []);

  const track = snap?.track;
  const playing = snap?.playback === "playing";
  const duration = snap?.duration || 0;
  const currentTime = snap?.currentTime || 0;
  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="taskbar-app" style={{ fontFamily: OVERLAY_FONT }}>
      <img className="taskbar-cover" src={track?.coverUrl || brand.covers[0]} alt="" />
      <div className="taskbar-copy">
        <div className="taskbar-title">{track?.title || brand.name}</div>
        <div className="taskbar-sub">{track?.artist || `待机 · ${brand.callsign}`}</div>
        <div className="taskbar-progress">
          <span style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
      <div className="taskbar-controls">
        <button type="button" onClick={() => window.taskbarAPI?.sendCommand({ type: "previous" })}>
          <IconPrev size={14} />
        </button>
        <button
          type="button"
          className="is-play"
          onClick={() => window.taskbarAPI?.sendCommand({ type: "toggle" })}
        >
          {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <button type="button" onClick={() => window.taskbarAPI?.sendCommand({ type: "next" })}>
          <IconNext size={14} />
        </button>
      </div>
      <div className="taskbar-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
createRoot(el).render(
  <StrictMode>
    <TaskbarRoot />
  </StrictMode>,
);
