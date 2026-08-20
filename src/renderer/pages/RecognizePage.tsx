import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { brand } from "../brand/assets";
import {
  AudioOutlined,
  CaretRightOutlined,
  CustomerServiceOutlined,
  LoadingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type {
  RecognizeArtist,
  RecognizeHit,
  RecognizeSongResponse,
  RecognizeStatus,
} from "../../shared/types";

const MAX_DURATION_SEC = 15;
const FINGERPRINT_SAMPLE_RATE = 8000;
const RECORDER_TIMESLICE_MS = 3000;
const SILENCE_ABS_THRESHOLD = 0.01;
const SILENCE_STRIDE = 100;
const AFP_FILES = ["afp.wasm.js", "afp.js"] as const;
const AFP_BASES = ["./", "../", "../../", "/", "./src/renderer/"];

type ChromeDesktopConstraint = {
  mandatory: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
};

export type RecognizePageProps = {
  onSearchSong?: (query: string) => void;
  onRecognizeStart?: () => void;
  onRecognizeStop?: () => void;
};

function formatArtists(value: RecognizeArtist | RecognizeArtist[] | undefined): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item.name || ""))
      .filter(Boolean)
      .join(" / ");
  }
  return typeof value === "string" ? value : value.name || "";
}

export function parseRecognizeResults(payload: RecognizeSongResponse | null | undefined): RecognizeHit[] {
  const rows = payload?.data?.result;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row) => {
    const song = row.song || {};
    const album = song.album || {};
    return {
      id: String(song.id || ""),
      name: song.name || "",
      artist: formatArtists(song.artist || song.artists),
      album: album.name || "",
      coverUrl: album.picUrl || album.blurPicUrl || "",
      startTime: row.startTime || 0,
    };
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureFingerprintModule(): Promise<boolean> {
  if (typeof window.GenerateFP === "function") return true;
  for (const base of AFP_BASES) {
    try {
      await loadScript(`${base}${AFP_FILES[0]}`);
    } catch {
      /* try next */
    }
    try {
      await loadScript(`${base}${AFP_FILES[1]}`);
    } catch {
      /* try next */
    }
    if (typeof window.GenerateFP === "function") return true;
  }
  return typeof window.GenerateFP === "function";
}

async function resampleToMono(buffer: AudioBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(
    1,
    Math.floor(buffer.duration * FINGERPRINT_SAMPLE_RATE),
    FINGERPRINT_SAMPLE_RATE,
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function hasAudibleSignal(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += SILENCE_STRIDE) {
    if (Math.abs(samples[i]!) > SILENCE_ABS_THRESHOLD) return true;
  }
  return false;
}

function pickRecorderMime(): string {
  return MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
}

function statusText(
  status: RecognizeStatus,
  durationSec: number,
  maxDuration: number,
  hasResults: boolean,
  errorMsg: string,
): string {
  if (status === "initializing") return "正在初始化…";
  if (status === "recording") return `正在识别中… ${durationSec}s / ${maxDuration}s`;
  if (status === "success" && !hasResults) return "未能识别到歌曲";
  if (status === "failed") return errorMsg || "识别失败";
  if (status === "idle") return "点击按钮开始识别";
  return "";
}

export function useRecognizeRecording(options: {
  onStart?: () => void;
  onStop?: () => void;
}) {
  const onStartRef = useRef(options.onStart);
  const onStopRef = useRef(options.onStop);
  onStartRef.current = options.onStart;
  onStopRef.current = options.onStop;

  const [status, setStatus] = useState<RecognizeStatus>("idle");
  const [durationSec, setDurationSec] = useState(0);
  const [results, setResults] = useState<RecognizeHit[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortedRef = useRef(false);
  const statusRef = useRef<RecognizeStatus>("idle");
  const tickTimerRef = useRef(0);
  const limitTimerRef = useRef(0);
  const startedAtRef = useRef(0);

  const setPhase = (next: RecognizeStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const cleanupCapture = useCallback(() => {
    window.clearInterval(tickTimerRef.current);
    window.clearTimeout(limitTimerRef.current);
    tickTimerRef.current = 0;
    limitTimerRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const tryRecognize = useCallback(async () => {
    if (abortedRef.current || statusRef.current !== "recording") return;
    const mime = pickRecorderMime();
    const blob = new Blob(chunksRef.current, { type: mime });
    if (blob.size === 0) return;

    const audioCtx = new AudioContext();
    try {
      const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
      if (!hasAudibleSignal(decoded.getChannelData(0))) return;
      const samples = await resampleToMono(decoded);
      const generateFp = window.GenerateFP;
      if (typeof generateFp !== "function") return;
      const fingerprint = await generateFp(samples);
      const raw = await window.electronAPI?.recognizeSong(fingerprint, samples.length / FINGERPRINT_SAMPLE_RATE);
      const hits = parseRecognizeResults(raw);
      if (hits.length > 0) {
        abortedRef.current = true;
        cleanupCapture();
        setResults(hits);
        setPhase("success");
        onStopRef.current?.();
      }
    } catch (err) {
      console.error("[recognize] tryRecognize failed:", err);
    } finally {
      await audioCtx.close();
    }
  }, [cleanupCapture]);

  const stopRecording = useCallback(() => {
    if (statusRef.current !== "recording" && statusRef.current !== "initializing") return;
    abortedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cleanupCapture();
    if (statusRef.current === "recording") setPhase("idle");
    onStopRef.current?.();
  }, [cleanupCapture]);

  const startRecording = useCallback(async () => {
    if (statusRef.current === "recording" || statusRef.current === "initializing") return;
    abortedRef.current = false;
    setPhase("initializing");
    setResults([]);
    setErrorMsg("");
    setDurationSec(0);
    onStartRef.current?.();

    try {
      if (!(await ensureFingerprintModule())) {
        setErrorMsg("音频指纹模块加载失败");
        setPhase("failed");
        onStopRef.current?.();
        return;
      }

      const sourceId = await window.electronAPI?.getDefaultScreenSourceId();
      if (!sourceId) {
        setErrorMsg("无法获取系统音频源");
        setPhase("failed");
        onStopRef.current?.();
        return;
      }

      const audio: ChromeDesktopConstraint = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };
      const video: ChromeDesktopConstraint = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audio as unknown as MediaTrackConstraints,
        video: video as unknown as MediaTrackConstraints,
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => track.stop());

      const mime = pickRecorderMime();
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          void tryRecognize();
        }
      };
      recorder.start(RECORDER_TIMESLICE_MS);
      setPhase("recording");
      startedAtRef.current = Date.now();
      tickTimerRef.current = window.setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      limitTimerRef.current = window.setTimeout(() => {
        if (statusRef.current === "recording") stopRecording();
      }, MAX_DURATION_SEC * 1000 + 500);
    } catch (err) {
      console.error("[recognize] start failed:", err);
      const name = err instanceof DOMException ? err.name : "";
      setErrorMsg(name === "NotAllowedError" ? "音频采集权限被拒绝" : "启动识别失败");
      setPhase("failed");
      cleanupCapture();
      onStopRef.current?.();
    }
  }, [cleanupCapture, stopRecording, tryRecognize]);

  useEffect(
    () => () => {
      abortedRef.current = true;
      cleanupCapture();
      onStopRef.current?.();
    },
    [cleanupCapture],
  );

  return {
    status,
    durationSec,
    maxDuration: MAX_DURATION_SEC,
    results,
    errorMsg,
    startRecording,
    stopRecording,
  };
}

function RecognizeResultCard({
  hit,
  onSearchSong,
}: {
  hit: RecognizeHit;
  onSearchSong?: (query: string) => void;
}) {
  const openSearch = () => {
    const query = `${hit.name} ${hit.artist}`.trim();
    if (!query) return;
    onSearchSong?.(query);
  };

  return (
    <div
      className="search-card"
      role="button"
      tabIndex={0}
      onClick={openSearch}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSearch();
        }
      }}
    >
      <div className="search-card-cover">
        {hit.coverUrl ? (
          <img src={hit.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="search-card-cover-inner">
            <CustomerServiceOutlined className="search-card-fallback-icon" />
          </div>
        )}
        <CaretRightOutlined className="search-card-play-icon" />
      </div>
      <div className="search-card-info">
        <div className="search-card-title">{hit.name}</div>
        <div className="search-card-meta">{hit.artist}</div>
      </div>
    </div>
  );
}

function RecognizePageInner({
  onSearchSong,
  onRecognizeStart,
  onRecognizeStop,
}: RecognizePageProps) {
  const { status, durationSec, maxDuration, results, errorMsg, startRecording, stopRecording } =
    useRecognizeRecording({
      onStart: onRecognizeStart,
      onStop: onRecognizeStop,
    });

  useEffect(() => {
    void startRecording();
  }, [startRecording]);

  const busy = status === "recording" || status === "initializing";
  const hasResults = results.length > 0;
  const message = statusText(status, durationSec, maxDuration, hasResults, errorMsg);

  return (
    <div className="recognize-page">
      <style>{RECOGNIZE_PAGE_CSS}</style>
      <div className="recognize-center">
        <div className="recognize-icon" aria-hidden>
          <img src={brand.empty.recognize} alt="" />
          {busy ? <LoadingOutlined spin /> : <AudioOutlined />}
        </div>
        <h1 className="recognize-title">听歌识曲</h1>
        <p className="recognize-desc">识别电脑正在播放的声音</p>
        <div className="recognize-actions">
          {busy ? (
            <Button icon={<StopOutlined />} onClick={stopRecording}>
              停止识别
            </Button>
          ) : (
            <Button type="primary" icon={<AudioOutlined />} onClick={() => void startRecording()}>
              {hasResults ? "继续识别" : "开始识别"}
            </Button>
          )}
        </div>
        {!hasResults && message ? <p className="recognize-status">{message}</p> : null}
        {hasResults ? (
          <div className="recognize-results">
            <div className="search-card-grid">
              {results.map((hit) => (
                <RecognizeResultCard
                  key={`${hit.id}-${hit.startTime}`}
                  hit={hit}
                  onSearchSong={onSearchSong}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const RECOGNIZE_PAGE_CSS = `
.recognize-page{flex:1;min-height:0;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:40px 24px;height:100%;box-sizing:border-box}
.recognize-center{width:100%;max-width:720px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px}
.recognize-icon{position:relative;width:220px;height:220px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;overflow:hidden;border:1px solid var(--line,#3a342c)}
.recognize-icon img{width:100%;height:100%;object-fit:cover;display:block;opacity:.85}
.recognize-icon .anticon{position:absolute;font-size:36px;color:#e8a84a;filter:drop-shadow(0 2px 8px #000)}
.recognize-title{margin:0;font-size:28px;font-weight:700;color:var(--text-primary);line-height:1.2}
.recognize-desc{margin:0;font-size:13px;color:var(--ui-control-fg-muted,rgba(255,255,255,.65))}
.recognize-actions{display:flex;justify-content:center;margin-top:8px}
.recognize-status{margin:4px 0 0;font-size:13px;color:var(--ui-control-fg-subtle,rgba(255,255,255,.45));min-height:20px}
.recognize-results{width:100%;margin-top:20px}
.recognize-results .search-card-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:20px 18px}
.recognize-results .search-card{width:180px;cursor:pointer;min-width:0}
.recognize-results .search-card-info{text-align:left;padding:10px 2px 0}
.search-card-cover{position:relative;width:100%;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#ffffff0a}
.search-card-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}
.search-card:hover .search-card-cover img{transform:scale(1.03)}
.search-card-cover-inner{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;color:var(--ui-control-fg-muted,rgba(255,255,255,.65))}
.search-card-play-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:36px;color:#ffffffeb;opacity:0;transition:opacity .18s ease;text-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none}
.search-card:hover .search-card-play-icon{opacity:1}
.search-card-title{font-size:13px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-card-meta{font-size:12px;color:var(--text-secondary,#a3a3a3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

export const RecognizePage = memo(RecognizePageInner);
export default RecognizePage;
