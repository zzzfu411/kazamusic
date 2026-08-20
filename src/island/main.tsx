import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { brand } from "../renderer/brand/assets";
import { applyResolvedTheme } from "../renderer/theme-runtime";
import type { OverlaySnapshot } from "../types/overlay-api";
import "../renderer/styles/kazam-theme.css";
import "../renderer/styles/island-theme.css";

const OVERLAY_FONT = 'var(--lyric-font, "DM Sans", "PingFang SC", sans-serif)';

function IslandRoot() {
  const [snap, setSnap] = useState<OverlaySnapshot | null>(
    () => window.islandAPI?.bootstrap?.snapshot ?? null,
  );

  useEffect(() => {
    applyResolvedTheme();
    const api = window.islandAPI;
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
  const line = snap?.lyric?.activeLine || track?.title || brand.tagline;
  const sub = snap?.lyric?.nextLine || track?.artist || brand.callsign;

  return (
    <button
      type="button"
      className={`island-app${playing ? " is-live" : ""}`}
      style={{ fontFamily: OVERLAY_FONT }}
      onClick={() => window.islandAPI?.sendCommand({ type: "toggle" })}
    >
      <img className="island-mark" src={track?.coverUrl || brand.mark} alt="" />
      <div className="island-copy">
        <div className="island-title">{line}</div>
        <div className="island-sub">{sub}</div>
      </div>
    </button>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
createRoot(el).render(
  <StrictMode>
    <IslandRoot />
  </StrictMode>,
);
