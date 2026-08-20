import { useEffect, useMemo, useRef, useState } from "react";
import { brand } from "../brand/assets";
import { resolveTheme } from "../../shared/theme";
import { usePlayer } from "../stores/player";
import { getSettings, updateSettings, useSettings } from "../stores/settings";

function isRemoteSrc(path: string): boolean {
  return /^(data:|blob:|https?:)/i.test(path);
}

function toFileUrl(path: string): string {
  if (!path) return "";
  if (/^(data:|blob:|https?:|file:|local-)/i.test(path)) return path;
  const slash = path.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(slash)) return `file:///${slash}`;
  return slash.startsWith("/") ? `file://${slash}` : `file:///${slash}`;
}

async function resolveImageSrc(path: string): Promise<string> {
  if (!path) return "";
  if (isRemoteSrc(path)) return path;
  const href = toFileUrl(path);
  try {
    const got = await window.electronAPI?.fetchImage?.(href);
    if (typeof got === "string" && got) return got;
  } catch {
    /* fall through */
  }
  return href;
}

export function HomeBackground() {
  const { settings } = useSettings();
  const player = usePlayer();
  const home = settings.appearance.homeBg;
  const prefersLight =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches;
  const light = resolveTheme(settings.appearance.theme, prefersLight) === "light";
  const coverUrl = player.currentTrack?.coverUrl || "";
  const hasCover = Boolean(coverUrl);

  const showCover =
    (home.mode === "auto" && hasCover) ||
    (home.mode === "custom" && home.scope === "no-cover" && hasCover);
  const showThemePaper = home.mode === "auto" && !hasCover;
  const showCustom =
    home.mode === "custom" &&
    Boolean(home.image) &&
    (home.scope === "global" || (home.scope === "no-cover" && !hasCover));
  const showColor = home.mode === "color";
  const showVideo = home.mode === "video" && Boolean(home.videoPath);
  const themePaper = light ? brand.wallpaperLight : brand.wallpaperDark;

  const imageKey = showCover
    ? coverUrl
    : showCustom
      ? home.image
      : showThemePaper
        ? themePaper
        : "";
  const [resolvedImage, setResolvedImage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoSrc = useMemo(() => (showVideo ? toFileUrl(home.videoPath) : ""), [showVideo, home.videoPath]);

  useEffect(() => {
    const on = showVideo && home.applyVideoToDetail;
    if (on) document.documentElement.dataset.detailVideoBg = "1";
    else delete document.documentElement.dataset.detailVideoBg;
  }, [showVideo, home.applyVideoToDetail]);

  useEffect(() => {
    if (light) return;
    if (home.mode !== "custom" || home.image) return;
    let cancelled = false;
    void window.electronAPI?.loadDefaultBg?.().then((src) => {
      if (cancelled || typeof src !== "string" || !src) return;
      const latest = getSettings().appearance.homeBg;
      if (latest.mode === "custom" && !latest.image) {
        updateSettings("appearance", { homeBg: { ...latest, image: src } });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [home.mode, home.image]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;
    const sync = () => {
      if (document.visibilityState === "hidden") el.pause();
      else void el.play().catch(() => undefined);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [videoSrc]);

  useEffect(() => {
    if (!imageKey) {
      setResolvedImage("");
      return;
    }
    let cancelled = false;
    void resolveImageSrc(imageKey).then((next) => {
      if (!cancelled) setResolvedImage(next);
    });
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  const blurPx = showCover || showCustom || showVideo ? home.blur : light ? 8 : 18;
  const overlayPct = light
    ? Math.max(home.overlay, showCover || showCustom || showVideo ? 62 : 38)
    : home.overlay;
  const overlay = Math.min(100, Math.max(0, overlayPct)) / 100;
  const mediaFilter = light
    ? `blur(${blurPx}px) saturate(0.92) brightness(1.08)`
    : `blur(${blurPx}px) saturate(1.25)`;
  const showImage = Boolean(resolvedImage);
  const showOverlay = (showImage || showVideo) && overlay > 0;
  const overlayColor = light
    ? `color-mix(in srgb, var(--bg) ${Math.round(overlay * 100)}%, transparent)`
    : `rgba(0, 0, 0, ${overlay})`;
  const colorFill =
    showColor && home.color === "#121212" && light ? "#fdf6e3" : home.color || (light ? "#fdf6e3" : "#121212");

  return (
    <div className="home-bg" aria-hidden="true" data-mode={home.mode}>
      {showColor ? (
        <div className="home-bg-color" style={{ backgroundColor: colorFill }} />
      ) : null}
      {showImage ? (
        <div
          className="home-bg-image"
          style={{
            backgroundImage: `url("${resolvedImage.replace(/"/g, '\\"')}")`,
            filter: mediaFilter,
          }}
        />
      ) : null}
      {showVideo && videoSrc ? (
        <video
          ref={videoRef}
          className="home-bg-video"
          src={videoSrc}
          muted
          loop
          autoPlay
          playsInline
          style={{ filter: mediaFilter }}
        />
      ) : null}
      {showOverlay ? (
        <div className="home-bg-overlay" style={{ backgroundColor: overlayColor }} />
      ) : null}
    </div>
  );
}

export default HomeBackground;
