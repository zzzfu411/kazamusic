import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Spin } from "antd";
import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  canEnqueuePlayUrl,
  createEmptyMvSummary,
  type MvSummary,
} from "../../shared/types";

const NETEASE_REFERER = "http://music.163.com/";
const MV_DETAIL_URL = "https://music.163.com/weapi/mv/detail";
const MV_PLAY_URL = "https://music.163.com/weapi/song/enhance/play/mv/url";
const WEAPI_PRESET_KEY = "0CoJUm6Qyw8W8jud";
const WEAPI_IV = "0102030405060708";
const WEAPI_RSA_EXPONENT = "010001";
const WEAPI_RSA_MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const MV_QUALITY_FALLBACK = [720, 480, 240] as const;
const DEFAULT_MV_VOLUME = 0.8;

export type MvPlayerPageProps = {
  id: string;
  summary?: MvSummary;
};

type NeteaseMvArtist = { id?: number | string; name?: string };

type NeteaseMvDetailData = {
  id?: number | string;
  name?: string;
  cover?: string;
  artistName?: string;
  artists?: NeteaseMvArtist[];
  artistId?: number | string;
  duration?: number;
  playCount?: number;
  desc?: string;
  briefDesc?: string;
  brs?: Array<{ br?: number }>;
};

type NeteaseMvDetailResponse = {
  code?: number;
  data?: NeteaseMvDetailData;
};

type NeteaseMvUrlResponse = {
  code?: number;
  data?: { url?: string };
};

class MvVideoController {
  video: HTMLVideoElement | null = null;
  pauseMusic: (() => void | Promise<void>) | null = null;
  volume = DEFAULT_MV_VOLUME;

  bindPauseMusic(fn: (() => void | Promise<void>) | null): void {
    this.pauseMusic = fn;
  }

  registerVideo(el: HTMLVideoElement | null): void {
    this.video = el;
    if (el) el.volume = this.volume;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.video) this.video.volume = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  async pauseMusicForMv(): Promise<void> {
    await this.pauseMusic?.();
  }

  pauseMv(): void {
    if (this.video && !this.video.paused) this.video.pause();
  }

  isMvPlaying(): boolean {
    return !!this.video && !this.video.paused && !this.video.ended;
  }

  dispose(): void {
    this.pauseMv();
    this.video = null;
  }
}

const mvVideoController = new MvVideoController();

function formatClock(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatPlayCount(count: number): string {
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
}

function randomSecret(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e % 2n === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function aesCbcEncrypt(plain: string, key: string): Promise<string> {
  const encodedKey = new TextEncoder().encode(key) as BufferSource;
  const iv = new TextEncoder().encode(WEAPI_IV) as BufferSource;
  const cryptoKey = await crypto.subtle.importKey("raw", encodedKey, { name: "AES-CBC" }, false, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    cryptoKey,
    new TextEncoder().encode(plain) as BufferSource,
  );
  return bytesToBase64(new Uint8Array(cipher));
}

function rsaEncryptSecret(secret: string): string {
  const reversed = secret.split("").reverse().join("");
  const hex = Array.from(new TextEncoder().encode(reversed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const encrypted = modPow(BigInt(`0x${hex}`), BigInt(`0x${WEAPI_RSA_EXPONENT}`), BigInt(`0x${WEAPI_RSA_MODULUS}`));
  return encrypted.toString(16).padStart(256, "0");
}

async function encryptWeapi(payload: string): Promise<{ params: string; encSecKey: string }> {
  const secret = randomSecret(16);
  const first = await aesCbcEncrypt(payload, WEAPI_PRESET_KEY);
  const params = await aesCbcEncrypt(first, secret);
  return { params, encSecKey: rsaEncryptSecret(secret) };
}

function parseNeteaseBody(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function neteaseWeapi<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const api = window.electronAPI;
  if (!api?.neteasePost) throw new Error("MV 加载失败");
  const { params, encSecKey } = await encryptWeapi(JSON.stringify(payload));
  const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
  const raw = await api.neteasePost(url, body, {
    Referer: NETEASE_REFERER,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  const parsed = parseNeteaseBody(raw);
  if (!parsed) throw new Error("MV 加载失败");
  return parsed as T;
}

function normalizeMvDetail(raw: NeteaseMvDetailData): MvSummary {
  const artistName =
    raw.artistName ||
    raw.artists?.map((artist) => artist.name).filter(Boolean).join("、") ||
    "";
  const artistId =
    raw.artistId != null && String(raw.artistId)
      ? String(raw.artistId)
      : String(raw.artists?.[0]?.id || "");
  return {
    id: String(raw.id ?? ""),
    name: raw.name || "",
    cover: raw.cover || "",
    artistName,
    artistId,
    duration: Math.floor((raw.duration || 0) / 1000),
    playCount: raw.playCount || 0,
    description: raw.desc || raw.briefDesc || "",
    link: `https://music.163.com/#/mv?id=${raw.id}`,
    source: "netease",
  };
}

export async function fetchMvDetail(id: string): Promise<MvSummary> {
  const response = await neteaseWeapi<NeteaseMvDetailResponse>(MV_DETAIL_URL, {
    id,
    csrf_token: "",
  });
  if (response.code !== 200 || !response.data) {
    throw new Error(`netease mv detail error: code=${response.code}`);
  }
  const detail = normalizeMvDetail(response.data);
  const brs = response.data.brs?.map((item) => item.br).filter((br): br is number => !!br);
  return brs?.length ? { ...detail, brs } : detail;
}

export async function fetchMvPlayUrl(id: string, quality = 1080): Promise<string> {
  const response = await neteaseWeapi<NeteaseMvUrlResponse>(MV_PLAY_URL, {
    id,
    r: quality,
    csrf_token: "",
  });
  const url = response.data?.url ?? "";
  if (response.code !== 200 || !canEnqueuePlayUrl(url)) {
    throw new Error("MV 播放地址获取失败");
  }
  return url;
}

async function fetchMvPlayUrlWithFallback(id: string): Promise<string> {
  try {
    return await fetchMvPlayUrl(id);
  } catch {
    for (const quality of MV_QUALITY_FALLBACK) {
      try {
        return await fetchMvPlayUrl(id, quality);
      } catch {
        continue;
      }
    }
    throw new Error("MV 播放地址获取失败");
  }
}

function MvPlayerPageInner({ id, summary }: MvPlayerPageProps) {
  const initial = summary ?? createEmptyMvSummary(id);
  const volume = DEFAULT_MV_VOLUME;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<MvSummary>(initial);
  const [playUrl, setPlayUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initial.duration || 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const controlsVisible = hovering || scrubbing;
  const showCenterPlay = !playing && !hovering && !scrubbing;

  const bindVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      mvVideoController.registerVideo(el);
      if (el) el.volume = volume;
    },
    [volume],
  );

  useEffect(() => () => {
    mvVideoController.dispose();
  }, []);

  useEffect(() => {
    const next = summary ?? createEmptyMvSummary(id);
    setDetail(next);
    setDuration(next.duration || 0);
    setCurrentTime(0);
    setPlaying(false);
  }, [id, summary]);

  useEffect(() => {
    let cancelled = false;
    const requestedId = id;
    if (!requestedId) {
      setLoading(false);
      setError("");
      setPlayUrl("");
      return;
    }

    async function loadMv(): Promise<void> {
      setLoading(true);
      setError("");
      setPlayUrl("");
      try {
        const [nextDetail, nextUrl] = await Promise.all([
          fetchMvDetail(requestedId).catch(() => null),
          fetchMvPlayUrlWithFallback(requestedId),
        ]);
        if (cancelled || requestedId !== id) return;
        if (nextDetail) {
          setDetail((prev) => ({ ...prev, ...nextDetail }));
        }
        if (!canEnqueuePlayUrl(nextUrl)) {
          throw new Error("MV 播放地址获取失败");
        }
        setPlayUrl(nextUrl);
      } catch (err) {
        if (cancelled || requestedId !== id) return;
        setError(err instanceof Error ? err.message : "MV 加载失败");
      } finally {
        if (!cancelled && requestedId === id) setLoading(false);
      }
    }

    void loadMv();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    mvVideoController.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !canEnqueuePlayUrl(playUrl)) return;
    video.volume = mvVideoController.getVolume();
    video.load();
    void mvVideoController.pauseMusicForMv().then(() => {
      video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    });
  }, [playUrl]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void mvVideoController.pauseMusicForMv().then(() => {
        void video.play().then(() => setPlaying(true));
      });
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const onSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.target.value);
    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      setFullscreen(false);
    } else {
      await stage.requestFullscreen?.();
      setFullscreen(true);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const durationMax = duration || detail.duration || 0;
  const progressMax = Math.max(durationMax, 0.1);
  const progressValue = Math.min(currentTime, durationMax);

  return (
    <div className="favorite-page mv-page">
      <style>{MV_PAGE_STYLE}</style>
      <header className="fav-hero mv-hero">
        <div className="mv-hero-cover">
          {detail.cover ? <img src={detail.cover} alt="" /> : <VideoCameraOutlined />}
        </div>
        <div className="fav-info">
          <h1 className="fav-title">{detail.name || "MV"}</h1>
          <div className="fav-meta mv-hero-meta">
            <span>{detail.artistName || "未知艺术家"}</span>
            {(detail.duration || 0) > 0 && (
              <>
                <span className="fav-meta-dot" />
                <span>{formatClock(detail.duration)}</span>
              </>
            )}
            {(detail.playCount || 0) > 0 && (
              <>
                <span className="fav-meta-dot" />
                <span>{formatPlayCount(detail.playCount || 0)} 次播放</span>
              </>
            )}
          </div>
          {detail.description ? <p className="mv-hero-desc">{detail.description}</p> : null}
        </div>
      </header>
      <div className="mv-stage-wrap">
        {loading && (
          <div className="mv-stage-state">
            <Spin className="search-state-icon" />
            <div>正在加载 MV...</div>
          </div>
        )}
        {error && !loading && (
          <div className="mv-stage-state">
            <VideoCameraOutlined className="search-state-icon" />
            <div>{error}</div>
          </div>
        )}
        {!loading && !error && !id && (
          <div className="mv-stage-state">
            <VideoCameraOutlined className="search-state-icon" />
            <div>在搜索结果中打开 MV</div>
          </div>
        )}
        {!loading && !error && canEnqueuePlayUrl(playUrl) && (
          <div className="mv-stage" ref={stageRef}>
            <div
              className={`mv-video-wrap${controlsVisible ? " mv-video-wrap--controls-visible" : ""}${playing ? "" : " mv-video-wrap--paused"}`}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => {
                if (!scrubbing) setHovering(false);
              }}
            >
              <video
                ref={bindVideo}
                className="mv-video"
                src={playUrl}
                poster={detail.cover}
                playsInline
                onClick={togglePlay}
                onLoadedMetadata={(event) => {
                  const next = event.currentTarget.duration;
                  if (Number.isFinite(next) && next > 0) setDuration(next);
                }}
                onTimeUpdate={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                  const next = event.currentTarget.duration;
                  if (next && Number.isFinite(next)) setDuration(next);
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <div className="mv-controls-panel" aria-hidden={!controlsVisible}>
                <div className="mv-progress-wrap">
                  <div
                    className="mv-progress-fill"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                  <input
                    type="range"
                    className="mv-progress"
                    min={0}
                    max={progressMax}
                    step={0.1}
                    value={progressValue}
                    onChange={onSeek}
                    onPointerDown={() => setScrubbing(true)}
                    onPointerUp={() => setScrubbing(false)}
                    onPointerCancel={() => setScrubbing(false)}
                    aria-label="播放进度"
                  />
                </div>
                <div className="mv-controls-bar">
                  <button
                    type="button"
                    className="mv-control-btn mv-control-btn--primary"
                    onClick={togglePlay}
                    aria-label={playing ? "暂停" : "播放"}
                  >
                    {playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  </button>
                  <div className="mv-time-group">
                    <span>{formatClock(currentTime)}</span>
                    <span className="mv-time-sep">/</span>
                    <span className="mv-time-total">{formatClock(durationMax)}</span>
                  </div>
                  <div className="mv-controls-spacer" />
                  <span className="mv-title-chip">{detail.name}</span>
                  <button
                    type="button"
                    className="mv-control-btn"
                    onClick={() => void toggleFullscreen()}
                    aria-label={fullscreen ? "退出全屏" : "全屏"}
                  >
                    {fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  </button>
                </div>
              </div>
              {showCenterPlay && (
                <button type="button" className="mv-center-play" onClick={togglePlay} aria-label="播放">
                  <span className="mv-center-play-inner">
                    <PlayCircleOutlined />
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const MV_PAGE_STYLE = `
.favorite-page.mv-page{height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.app-main:has(.mv-page){overflow:hidden}
.mv-page .mv-hero{display:flex;align-items:flex-start;gap:20px;padding:16px 40px 10px;flex-shrink:0}
.mv-hero-cover{width:160px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--bg-hover,#1a1a1a);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary,#6b6b6b);font-size:36px}
.mv-hero-cover img{width:100%;height:100%;object-fit:cover}
.mv-hero-meta{flex-wrap:wrap}
.mv-hero-desc{margin:10px 0 0;max-width:720px;font-size:13px;line-height:1.6;color:var(--text-secondary,#a3a3a3);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.fav-info{flex:1;min-width:0}
.fav-title{margin:0;font-size:28px;font-weight:700;line-height:1.2}
.fav-meta{display:flex;align-items:center;gap:12px;font-size:12px;margin-top:8px;color:var(--text-secondary,#a3a3a3)}
.fav-meta-dot{width:3px;height:3px;border-radius:50%;background:currentColor}
.mv-stage-wrap{flex:1;min-height:0;padding:0 40px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.mv-stage-state{flex:1;width:100%;min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text-secondary,#a3a3a3)}
.mv-stage{width:100%;max-width:960px;max-height:100%;margin:0 auto;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px #00000059}
.mv-video-wrap{position:relative;width:100%;aspect-ratio:16/9;max-height:calc(100vh - 280px);background:#000;cursor:pointer}
.mv-video{display:block;width:100%;height:100%;object-fit:contain;background:#000}
.mv-center-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;z-index:2}
.mv-center-play-inner{width:76px;height:76px;display:flex;align-items:center;justify-content:center;font-size:42px;color:var(--kazam-ink,#f0f0f0);background:var(--kazam-card,#050505);border:1px solid var(--kazam-border,#2a2a2a);box-shadow:4px 4px 0 var(--kazam-shadow,#173A52)}
.mv-controls-panel{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:48px 16px 14px;background:linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.45) 55%,transparent 100%);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .22s ease,transform .22s ease}
.mv-video-wrap--controls-visible .mv-controls-panel{opacity:1;transform:translateY(0);pointer-events:auto}
.mv-progress-wrap{position:relative;height:18px;display:flex;align-items:center;margin-bottom:4px}
.mv-progress-fill{position:absolute;left:0;top:50%;transform:translateY(-50%);height:3px;border-radius:999px;background:#fffffff2;pointer-events:none}
.mv-progress{position:relative;z-index:1;width:100%;height:18px;margin:0;appearance:none;background:transparent;cursor:pointer}
.mv-progress::-webkit-slider-runnable-track{height:3px;border-radius:999px;background:#ffffff38}
.mv-progress::-webkit-slider-thumb{appearance:none;width:12px;height:12px;margin-top:-4.5px;border-radius:50%;background:#fff}
.mv-controls-bar{display:flex;align-items:center;gap:12px;min-height:36px}
.mv-control-btn{width:34px;height:34px;border:none;background:transparent;color:#ffffffeb;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border-radius:8px}
.mv-control-btn--primary{width:38px;height:38px;font-size:24px}
.mv-time-group{display:flex;align-items:center;gap:4px;font-size:12px;font-variant-numeric:tabular-nums;color:#ffffffe0;flex-shrink:0}
.mv-time-sep,.mv-time-total{color:#ffffff8c}
.mv-controls-spacer{flex:1;min-width:8px}
.mv-title-chip{max-width:220px;font-size:12px;color:#ffffffb8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-stage:fullscreen{max-width:none;width:100vw;height:100vh;border-radius:0}
.mv-stage:fullscreen .mv-video-wrap{max-height:none;height:100%;aspect-ratio:auto}
`;

export const MvPlayerPage = memo(MvPlayerPageInner);
export default MvPlayerPage;
