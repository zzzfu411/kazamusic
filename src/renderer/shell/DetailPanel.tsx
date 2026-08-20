import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
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
  getAnalyser,
  next,
  previous,
  seek,
  setDetailOpen,
  setQuality,
  setVolume,
  toggle,
  toggleQueue,
  usePlayer,
  type AudioQuality,
  type LyricWord as PlayerLyricWord,
  type PlayMode,
} from "../stores/player";
import { useSettings } from "../stores/settings";
import { AmllBackground } from "./AmllBackground";
import { AmllLyrics, hasAmllLines } from "./AmllLyrics";

const QUALITY_CYCLE: AudioQuality[] = ["128k", "320k", "flac"];

type KaraokeWord = { time: number; text: string; end?: number; line?: number };

type LyricLine = {
  time: number;
  text: string;
  trans?: string;
  words?: KaraokeWord[];
};

function parseLrc(raw: string): LyricLine[] {
  if (!raw.trim()) return [];
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = row.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim();
    if (!text) continue;
    if (/^作[者词曲]|^编曲|^制作|^出品/.test(text) && lines.length === 0) continue;
    for (const stamp of stamps) {
      const min = Number(stamp[1]);
      const sec = Number(stamp[2]);
      const frac = stamp[3] ? Number(stamp[3].padEnd(3, "0")) / 1000 : 0;
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function parseYrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const body = raw.replace(/^\[format:yrc\]\s*/i, "");
  for (const row of body.split(/\r?\n/)) {
    const head = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;
    const time = Number(head[1]) / 1000;
    const rest = head[3] || "";
    const words: KaraokeWord[] = [];
    const re = /\((\d+),(\d+),-?\d+\)([^(]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(rest))) {
      const text = match[3] ?? "";
      if (!text) continue;
      const start = Number(match[1]) / 1000;
      words.push({ time: start, text, end: start + Number(match[2]) / 1000 });
    }
    const text = words.map((word) => word.text).join("") || rest.replace(/\(\d+,\d+,-?\d+\)/g, "").trim();
    if (!text) continue;
    lines.push({ time, text, words: words.length ? words : undefined });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function looksLikeYrc(raw: string): boolean {
  return /\[format:yrc\]/i.test(raw) || /^\s*\[\d+,\d+\]/.test(raw) || /\(\d+,\d+,0\)/.test(raw);
}

function pairTranslation(main: LyricLine[], trans: LyricLine[]): LyricLine[] {
  if (trans.length === 0) return main;
  return main.map((line) => {
    let best = "";
    let bestDt = 0.4;
    for (const row of trans) {
      const dt = Math.abs(row.time - line.time);
      if (dt < bestDt) {
        bestDt = dt;
        best = row.text;
      }
    }
    return best ? { ...line, trans: best } : line;
  });
}

function attachWords(lines: LyricLine[], rawWords: PlayerLyricWord[] | undefined): LyricLine[] {
  if (!rawWords?.length) return lines;
  const words: KaraokeWord[] = rawWords.map((word) => ({
    time: word.time,
    text: word.text,
    line: word.line,
  }));
  if (lines.length === 0) {
    const groups = new Map<number, KaraokeWord[]>();
    for (const word of words) {
      const key = word.line ?? 0;
      const list = groups.get(key) ?? [];
      list.push(word);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, group]) => ({
        time: group[0]?.time ?? 0,
        text: group.map((item) => item.text).join(""),
        words: group,
      }));
  }
  return lines.map((line, index) => ({
    ...line,
    words: words.filter((word) => word.line === index),
  }));
}

async function resolveBgSrc(path: string): Promise<string> {
  if (!path) return "";
  if (/^(data:|blob:|https?:)/i.test(path)) return path;
  const href = path.startsWith("file:") ? path : `file:///${path.replace(/\\/g, "/")}`;
  try {
    const got = await window.electronAPI?.fetchImage?.(href);
    if (typeof got === "string" && got) return got;
  } catch {
    /* fall through */
  }
  return href;
}

function splitArtists(artist: string): string[] {
  return artist
    .split(/[,、/＆&]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

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

function CoverSpectrum({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const bins = new Uint8Array(128);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();

    const color =
      getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#facc15";

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (ts - last < 1000 / 30) return;
      last = ts;
      const analyser = getAnalyser();
      if (!analyser) return;
      const data = bins.length >= analyser.frequencyBinCount ? bins : new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const count = 28;
      const gap = Math.max(2, width * 0.008);
      const barW = (width - gap * (count + 1)) / count;
      const usable = data.length ? Math.min(data.length, Math.floor(data.length * 0.72)) : 0;
      ctx.fillStyle = color;
      for (let i = 0; i < count; i += 1) {
        const sample = usable ? data[Math.floor((i / count) * usable)] / 255 : 0;
        const h = Math.max(2, sample * height * 0.46);
        const x = gap + i * (barW + gap);
        const y = height - h - height * 0.06;
        const radius = Math.min(barW / 2, 4);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, barW, h, radius);
        else ctx.rect(x, y, barW, h);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="detail-cover-spectrum" aria-hidden />;
}

export function DetailPanel() {
  const player = usePlayer();
  const { settings } = useSettings();
  const favorites = useFavorites();
  const track = player.currentTrack;
  const bg = settings.appearance.playerBg;
  const [customSrc, setCustomSrc] = useState("");
  const [favAnim, setFavAnim] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null);
  const [volTip, setVolTip] = useState<number | null>(null);
  const [dsTrans, setDsTrans] = useState("");
  const [transBusy, setTransBusy] = useState(false);
  const [transHint, setTransHint] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);
  const coverPointerY = useRef<number | null>(null);
  const lastVolume = useRef(player.volume > 0 ? player.volume : 0.8);
  const volumeRef = useRef(player.volume);
  const volTipTimer = useRef(0);
  const volTrackRef = useRef<HTMLDivElement>(null);
  const volWrapRef = useRef<HTMLDivElement>(null);

  volumeRef.current = player.volume;
  if (player.volume > 0) lastVolume.current = player.volume;

  const quality: AudioQuality = QUALITY_CYCLE.includes(player.quality) ? player.quality : "320k";
  const favorited = Boolean(track && favorites.isFavorite(track.id));
  const { mainRaw, transRaw } = useMemo(() => {
    const raw = player.lyrics || "";
    const parts = raw.split("\n\n__KAZAM_TL__\n");
    return { mainRaw: parts[0] || "", transRaw: parts[1] || "" };
  }, [player.lyrics]);
  const displayTrans = transRaw || dsTrans;

  const lines = useMemo(() => {
    const parsed = looksLikeYrc(mainRaw) ? parseYrc(mainRaw) : parseLrc(mainRaw);
    const paired = pairTranslation(parsed.length ? parsed : parseLrc(mainRaw), parseLrc(displayTrans));
    return attachWords(paired, player.lyricWords);
  }, [mainRaw, displayTrans, player.lyricWords]);

  const active = lines.reduce((idx, line, i) => (line.time <= player.currentTime + 0.12 ? i : idx), -1);
  const cover = track?.coverUrl || brand.covers[0];
  const frosted = bg.mode !== "custom" || !bg.image;
  const bgImage = frosted ? cover : customSrc || cover;
  const blurPx = frosted ? Math.max(48, bg.blur || 60) : bg.blur;
  const overlay = Math.min(80, Math.max(0, bg.overlay)) / 100;
  const ratio = player.duration > 0 ? Math.min(1, player.currentTime / player.duration) : 0;
  const playing = player.state === "playing" || player.state === "loading";
  const spectrumOn = player.detailOpen && player.state === "playing";
  const lyricsLoading = Boolean(track) && !player.lyrics && player.state === "loading";
  const translateMode = settings.appearance.lyrics.translateMode;
  const canTranslate =
    Boolean(track) &&
    lines.length > 0 &&
    !transRaw &&
    !dsTrans &&
    lines.some((line) => /[A-Za-z]/.test(line.text) && !/[\u4e00-\u9fff]/.test(line.text));

  useEffect(() => {
    setDsTrans("");
    setTransHint("");
    setTransBusy(false);
  }, [track?.id]);

  useEffect(() => {
    if (frosted || !bg.image) {
      setCustomSrc("");
      return;
    }
    let cancelled = false;
    void resolveBgSrc(bg.image).then((src) => {
      if (!cancelled) setCustomSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [frosted, bg.image]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && player.detailOpen) {
        event.preventDefault();
        setDetailOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player.detailOpen]);

  useEffect(() => {
    if (!player.detailOpen || active < 0) return;
    if (Date.now() - userScrollAt.current < 2400) return;
    const node = listRef.current?.querySelector<HTMLElement>("[data-active='1']");
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, player.detailOpen]);

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

  const runTranslate = async (silent: boolean) => {
    if (transBusy || !canTranslate) return;
    const texts = lines.map((line) => line.text);
    if (!texts.some((text) => text.trim())) return;
    setTransBusy(true);
    setTransHint(silent ? "" : "翻译中…");
    try {
      const result = (await window.electronAPI?.lyrics?.translate?.(texts)) as
        | { ok?: boolean; translations?: string[]; error?: string }
        | undefined;
      if (!result?.ok || !Array.isArray(result.translations)) {
        setTransHint(result?.error || "翻译失败");
        return;
      }
      if (result.translations.length !== texts.length) {
        setTransHint("翻译结果行数不匹配");
        return;
      }
      if (!result.translations.some((row) => row.trim())) {
        setTransHint("未检测到需要翻译的外文歌词");
        return;
      }
      const lrc = lines
        .map((line, index) => {
          const m = Math.floor(line.time / 60);
          const s = (line.time % 60).toFixed(2).padStart(5, "0");
          return `[${String(m).padStart(2, "0")}:${s}]${result.translations![index] || ""}`;
        })
        .join("\n");
      setDsTrans(lrc);
      setTransHint("");
    } catch (err) {
      setTransHint(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setTransBusy(false);
    }
  };

  useEffect(() => {
    if (!player.detailOpen || translateMode !== "auto" || !canTranslate || transBusy) return;
    void runTranslate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-run once lyrics become eligible
  }, [player.detailOpen, translateMode, canTranslate, track?.id]);

  useEffect(() => {
    const el = volWrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const nextVol = Math.min(1, Math.max(0, volumeRef.current + (event.deltaY > 0 ? -0.03 : 0.03)));
      setVolume(nextVol);
      setVolTip(nextVol);
      window.clearTimeout(volTipTimer.current);
      volTipTimer.current = window.setTimeout(() => setVolTip(null), 800);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onSeekBar = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || player.duration <= 0) return;
    seek(((event.clientX - rect.left) / rect.width) * player.duration);
  };

  const searchArtist = (name: string) => {
    window.dispatchEvent(new CustomEvent("kazam:search", { detail: name }));
    setDetailOpen(false);
  };

  const applyVolume = (nextVol: number) => {
    const clamped = Math.min(1, Math.max(0, nextVol));
    setVolume(clamped);
    setVolTip(clamped);
    window.clearTimeout(volTipTimer.current);
    volTipTimer.current = window.setTimeout(() => setVolTip(null), 800);
  };

  const volumeFromX = (clientX: number) => {
    const rect = volTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return volumeRef.current;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onVolPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyVolume(volumeFromX(event.clientX));
  };

  const muteToggle = () => {
    if (volumeRef.current > 0) {
      lastVolume.current = volumeRef.current;
      applyVolume(0);
      return;
    }
    applyVolume(lastVolume.current > 0 ? lastVolume.current : 0.8);
  };

  const onCoverPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    coverPointerY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCoverPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const startY = coverPointerY.current;
    coverPointerY.current = null;
    if (startY == null) return;
    const dy = event.clientY - startY;
    if (dy < -60) next();
    else if (dy > 60) previous();
  };

  const cycleQuality = () => {
    const idx = QUALITY_CYCLE.indexOf(quality);
    const nextQ = QUALITY_CYCLE[(idx + 1) % QUALITY_CYCLE.length];
    void setQuality(nextQ);
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

  const qualityLabel = quality === "flac" ? "FLAC" : quality;

  return (
    <div className={`app-detail${player.detailOpen ? " open" : ""}`} aria-hidden={!player.detailOpen}>
      <div className={`app-detail-slider${player.detailOpen ? " is-in" : ""}`}>
        <div className="detail-bg" aria-hidden>
          {frosted ? (
            <AmllBackground album={cover} playing={playing && player.detailOpen} />
          ) : (
            <div
              className="detail-bg-image"
              style={{
                backgroundImage: `url("${bgImage.replace(/"/g, "")}")`,
                filter: `blur(${blurPx}px) saturate(1.35)`,
              }}
            />
          )}
          <div
            className="detail-bg-overlay"
            style={{
              background: frosted
                ? `color-mix(in srgb, var(--bg) ${Math.round(overlay * 38)}%, transparent)`
                : `linear-gradient(180deg, color-mix(in srgb, var(--bg) ${Math.round(overlay * 70)}%, transparent) 0%, color-mix(in srgb, var(--bg) ${Math.round(overlay * 100)}%, #000) 100%)`,
            }}
          />
        </div>
        <div className="detail-drag-bar">
          <button
            type="button"
            className="detail-control-thumb"
            onClick={() => setDetailOpen(false)}
            title="收起 (Esc)"
          >
            <span className="detail-control-thumb-line" />
          </button>
        </div>
        {track ? (
          <div className="detail-body">
            <div className="detail-left">
              <div className="detail-cover-area">
                <div
                  className="detail-cover"
                  onPointerDown={onCoverPointerDown}
                  onPointerUp={onCoverPointerUp}
                  onPointerCancel={() => {
                    coverPointerY.current = null;
                  }}
                >
                  <img key={cover} className="detail-cover-img" src={cover} alt="" />
                  <CoverSpectrum active={spectrumOn} />
                </div>
                <div className="detail-meta">
                  <div className="detail-meta-left">
                    <div className="detail-title" title={track.title}>
                      <span className="detail-title-text">{track.title}</span>
                    </div>
                    <div className="detail-artist">
                      {splitArtists(track.artist || "").map((name, index, all) => (
                        <span key={`${name}-${index}`}>
                          <button type="button" className="detail-artist-link" onClick={() => searchArtist(name)}>
                            {name}
                          </button>
                          {index < all.length - 1 ? <span className="detail-artist-sep"> / </span> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="detail-info-actions">
                    <button
                      type="button"
                      className={`detail-info-btn${favorited ? " favorited" : ""}${favAnim ? " fav-anim" : ""}`}
                      title={favorited ? "取消收藏" : "收藏"}
                      onClick={onToggleFav}
                    >
                      <IconHeart size={15} filled={favorited} />
                    </button>
                    {track.source === "online" ? (
                      <button
                        type="button"
                        className="detail-info-btn"
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
                    ) : null}
                  </div>
                </div>
                <div className="detail-seek" onClick={onSeekBar} role="slider" aria-label="进度">
                  <span style={{ width: `${ratio * 100}%` }} />
                </div>
                <div className="detail-times">
                  <span>{formatPlayerTime(player.currentTime)}</span>
                  <button
                    type="button"
                    className={`detail-quality-badge clickable${quality === "flac" ? " flac" : ""}`}
                    title="切换音质"
                    onClick={cycleQuality}
                  >
                    {qualityLabel}
                  </button>
                  <span>{formatPlayerTime(player.duration)}</span>
                </div>
                <div className="detail-controls">
                  <div className="detail-control-buttons">
                    <button
                      type="button"
                      className="detail-ctrl-btn"
                      title={modeLabel(player.playMode)}
                      onClick={() => cyclePlayMode()}
                    >
                      <ModeIcon mode={player.playMode} />
                    </button>
                    <button type="button" className="detail-ctrl-btn" title="上一首" onClick={() => previous()}>
                      <IconPrev size={18} />
                    </button>
                    <button
                      type="button"
                      className="detail-play-btn"
                      title={playing ? "暂停" : "播放"}
                      onClick={() => toggle()}
                    >
                      {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
                    </button>
                    <button type="button" className="detail-ctrl-btn" title="下一首" onClick={() => next()}>
                      <IconNext size={18} />
                    </button>
                    <button
                      type="button"
                      className={`detail-ctrl-btn${player.queueOpen ? " is-on" : ""}`}
                      title="播放列表"
                      onClick={() => toggleQueue()}
                    >
                      <IconQueue size={16} />
                    </button>
                  </div>
                  <div className="detail-volume-section" ref={volWrapRef}>
                    {volTip != null ? <div className="detail-vol-tip">{Math.round(volTip * 100)}%</div> : null}
                    <button
                      type="button"
                      className="detail-vol-icon-btn"
                      title={player.volume > 0 ? "静音" : "恢复音量"}
                      onClick={muteToggle}
                    >
                      <IconVolume size={16} muted={player.volume <= 0} />
                    </button>
                    <div
                      className="detail-volume-track"
                      ref={volTrackRef}
                      onPointerDown={onVolPointer}
                      onPointerMove={(event) => {
                        if (event.buttons) applyVolume(volumeFromX(event.clientX));
                      }}
                    >
                      <div className="detail-volume-fill" style={{ width: `${player.volume * 100}%` }} />
                      <div className="detail-volume-dot" style={{ left: `${player.volume * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="detail-right">
              <div className="detail-lyric-shell">
                {canTranslate || transBusy || transHint ? (
                  <div className="detail-lyric-toolbar">
                    {canTranslate || transBusy ? (
                      <button
                        type="button"
                        className="detail-translate-btn"
                        disabled={transBusy || !canTranslate}
                        onClick={() => void runTranslate(false)}
                      >
                        {transBusy ? "翻译中…" : "翻译"}
                      </button>
                    ) : null}
                    {transHint ? <span className="detail-translate-hint">{transHint}</span> : null}
                  </div>
                ) : null}
                {lyricsLoading ? (
                  <div className="detail-lyric-area">
                    <div className="detail-lyric-empty">歌词加载中</div>
                  </div>
                ) : hasAmllLines(mainRaw) ? (
                  <div className="detail-lyric-area amll-host">
                    <AmllLyrics
                      mainRaw={mainRaw}
                      transRaw={displayTrans}
                      currentTime={player.currentTime}
                      playing={playing}
                      enabled={player.detailOpen}
                    />
                  </div>
                ) : lines.length === 0 ? (
                  <div className="detail-lyric-area">
                    <div className="detail-lyric-empty">
                      <img src={brand.empty.lyrics} alt="" />
                      暂无歌词
                    </div>
                  </div>
                ) : (
                  <div
                    className="detail-lyric-area"
                    ref={listRef}
                    onWheel={() => {
                      userScrollAt.current = Date.now();
                    }}
                    onPointerDown={() => {
                      userScrollAt.current = Date.now();
                    }}
                  >
                    <div className="detail-lyric-pad" />
                    {lines.map((line, index) => (
                      <button
                        type="button"
                        key={`${line.time}-${index}`}
                        data-active={index === active ? "1" : "0"}
                        className={`detail-lyric-line${index === active ? " is-active" : ""}`}
                        onClick={() => seek(line.time)}
                      >
                        <span className="detail-lyric-main">{line.text}</span>
                        {line.trans ? <span className="detail-lyric-trans">{line.trans}</span> : null}
                      </button>
                    ))}
                    <div className="detail-lyric-pad" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="detail-body">
            <div className="detail-left">
              <div className="detail-cover-area">
                <div className="detail-cover">
                  <img src={brand.covers[0]} alt="" />
                </div>
                <div className="detail-meta">
                  <div className="detail-title" style={{ opacity: 0.45 }}>
                    尚未选择曲目
                  </div>
                </div>
              </div>
            </div>
            <div className="detail-right">
              <div className="detail-lyric-empty">从播放列表选择一首歌</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
