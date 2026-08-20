import { useEffect, useMemo, useState } from "react";
import { LyricPlayer } from "@applemusic-like-lyrics/react";
import type { LyricLine as AmllLine } from "@applemusic-like-lyrics/core";
import { parseLrc, parseYrc } from "@applemusic-like-lyrics/lyric";
import { getAudioElement, seek } from "../stores/player";

type Props = {
  mainRaw: string;
  transRaw: string;
  currentTime: number;
  playing: boolean;
  enabled: boolean;
};

function looksLikeYrc(raw: string): boolean {
  return /\[format:yrc\]/i.test(raw) || /^\s*\[\d+,\d+\]/.test(raw) || /\(\d+,\d+,0\)/.test(raw);
}

function attachTrans(lines: AmllLine[], transRaw: string): AmllLine[] {
  if (!transRaw.trim()) return lines;
  let trans: AmllLine[] = [];
  try {
    trans = parseLrc(transRaw);
  } catch {
    return lines;
  }
  return lines.map((line) => {
    let best = "";
    let bestDt = 400;
    for (const row of trans) {
      const dt = Math.abs(row.startTime - line.startTime);
      if (dt < bestDt) {
        bestDt = dt;
        best = row.words.map((word) => word.word).join("");
      }
    }
    return best ? { ...line, translatedLyric: best } : line;
  });
}

function parseMain(raw: string): AmllLine[] {
  if (!raw.trim()) return [];
  try {
    if (looksLikeYrc(raw)) return parseYrc(raw);
    return parseLrc(raw);
  } catch {
    try {
      return parseLrc(raw);
    } catch {
      return [];
    }
  }
}

export function AmllLyrics({ mainRaw, transRaw, currentTime, playing, enabled }: Props) {
  const lyricLines = useMemo(() => attachTrans(parseMain(mainRaw), transRaw), [mainRaw, transRaw]);
  const [liveTime, setLiveTime] = useState(currentTime);
  useEffect(() => {
    setLiveTime(currentTime);
    if (!playing || !enabled) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setLiveTime(getAudioElement().currentTime || 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, enabled, currentTime]);
  if (lyricLines.length === 0) return null;
  return (
    <LyricPlayer
      className="amll-host-inner"
      lyricLines={lyricLines}
      currentTime={Math.max(0, Math.round(liveTime * 1000))}
      playing={playing}
      disabled={!enabled}
      enableSpring
      enableScale
      enableBlur
      alignAnchor="top"
      alignPosition={0.26}
      onLyricLineClick={(event) => {
        const line = lyricLines[event.lineIndex];
        if (line) seek(line.startTime / 1000);
      }}
    />
  );
}

export function hasAmllLines(mainRaw: string): boolean {
  return parseMain(mainRaw).length > 0;
}
