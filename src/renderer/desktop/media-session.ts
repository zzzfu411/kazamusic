import { getPlayer, next, previous, seek, toggle, type PlayerSnapshot } from "../stores/player";

const POLL_MS = 500;
const POSITION_MIN_MS = 1000;
const SEEK_STEP = 10;

const SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekto",
  "seekbackward",
  "seekforward",
  "stop",
];

function mediaSession(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return navigator.mediaSession;
}

function stopPlayback(): void {
  const snap = getPlayer();
  if (snap.state === "playing" || snap.state === "loading") toggle();
  seek(0);
}

function onPlay(): void {
  const state = getPlayer().state;
  if (state !== "playing" && state !== "loading") toggle();
}

function onPause(): void {
  const state = getPlayer().state;
  if (state === "playing" || state === "loading") toggle();
}

function onSeekTo(details: MediaSessionActionDetails): void {
  if (details.seekTime != null && Number.isFinite(details.seekTime)) seek(details.seekTime);
}

function onSeekBy(sign: 1 | -1, details: MediaSessionActionDetails): void {
  const offset = details.seekOffset ?? SEEK_STEP;
  const snap = getPlayer();
  seek(Math.max(0, snap.currentTime + sign * offset));
}

function handlerFor(action: MediaSessionAction): MediaSessionActionHandler {
  switch (action) {
    case "play":
      return onPlay;
    case "pause":
      return onPause;
    case "previoustrack":
      return () => previous();
    case "nexttrack":
      return () => next();
    case "seekto":
      return onSeekTo;
    case "seekbackward":
      return (details) => onSeekBy(-1, details);
    case "seekforward":
      return (details) => onSeekBy(1, details);
    case "stop":
      return stopPlayback;
    default:
      return () => undefined;
  }
}

function bindActionHandlers(session: MediaSession): void {
  for (const action of SESSION_ACTIONS) {
    try {
      session.setActionHandler(action, handlerFor(action));
    } catch {
      /* Chromium rejects unsupported SMTC actions */
    }
  }
}

function unbindActionHandlers(session: MediaSession): void {
  for (const action of SESSION_ACTIONS) {
    try {
      session.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
}

function playbackStateOf(snap: PlayerSnapshot): MediaSessionPlaybackState {
  if (!snap.currentTrack) return "none";
  if (snap.state === "playing" || snap.state === "loading") return "playing";
  if (snap.state === "paused" || snap.state === "idle") return "paused";
  return "none";
}

function metaKey(snap: PlayerSnapshot): string {
  const track = snap.currentTrack;
  if (!track) return "";
  return [
    track.id,
    track.title,
    track.artist,
    track.album,
    track.coverUrl || "",
    playbackStateOf(snap),
  ].join("\0");
}

function applyPlaybackState(session: MediaSession | null, snap: PlayerSnapshot): void {
  if (!session) return;
  session.playbackState = playbackStateOf(snap);
}

function applyPosition(session: MediaSession | null, snap: PlayerSnapshot, force: boolean, lastAt: { t: number }): void {
  if (!session) return;
  const now = performance.now();
  if (!force && now - lastAt.t < POSITION_MIN_MS) return;
  const duration = Number.isFinite(snap.duration) && snap.duration > 0 ? snap.duration : 0;
  if (duration <= 0) return;
  const position = Math.max(0, Math.min(snap.currentTime || 0, duration));
  try {
    session.setPositionState({ duration, position, playbackRate: 1 });
    lastAt.t = now;
  } catch {
    /* setPositionState throws when duration/position are inconsistent */
  }
}

function applyMetadata(session: MediaSession | null, snap: PlayerSnapshot, artwork: MediaImage[] = []): void {
  if (!session) return;
  const track = snap.currentTrack;
  if (!track) {
    session.metadata = null;
    return;
  }
  session.metadata = new MediaMetadata({
    title: track.title || "未知歌曲",
    artist: track.artist || "未知艺术家",
    album: track.album || "",
    artwork,
  });
}

function coverArtwork(cover: string): MediaImage[] {
  if (!cover) return [];
  if (!/^(https?:|data:|blob:)/i.test(cover)) return [];
  return [{ src: cover, sizes: "512x512", type: "image/jpeg" }];
}

async function loadArtwork(cover: string): Promise<MediaImage[]> {
  const fallback = coverArtwork(cover);
  if (!cover || !/^(https?:|data:|blob:)/i.test(cover)) return fallback;
  if (cover.startsWith("data:") || cover.startsWith("blob:")) return fallback;
  try {
    const fetched = await window.electronAPI?.fetchImage?.(cover);
    if (typeof fetched === "string" && fetched.startsWith("data:")) {
      return [{ src: fetched, sizes: "512x512", type: "image/png" }];
    }
  } catch {
    /* keep remote cover */
  }
  return fallback;
}

export function startDesktopPlaybackBridge(): () => void {
  const cleanups: Array<() => void> = [];
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;

  void api?.smtcWatchdog?.start?.();
  cleanups.push(() => {
    void api?.smtcWatchdog?.stop?.();
  });

  const session = mediaSession();
  if (session) {
    bindActionHandlers(session);
    cleanups.push(() => unbindActionHandlers(session));
  }

  let lastKey = "\u0001";
  const lastPos = { t: 0 };
  let coverGen = 0;

  const push = (forcePosition = false) => {
    const snap = getPlayer();
    applyPlaybackState(session, snap);
    applyPosition(session, snap, forcePosition, lastPos);
    const key = metaKey(snap);
    if (key === lastKey) return;
    lastKey = key;
    const track = snap.currentTrack;
    applyMetadata(session, snap, coverArtwork(track?.coverUrl || ""));
    applyPosition(session, snap, true, lastPos);
    const gen = ++coverGen;
    const cover = track?.coverUrl || "";
    if (!cover) return;
    void loadArtwork(cover).then((artwork) => {
      if (gen !== coverGen) return;
      if (getPlayer().currentTrack?.id !== track?.id) return;
      if (artwork.length) applyMetadata(session, snap, artwork);
    });
  };

  const offPreempted = api?.smtcWatchdog?.onPreempted?.(() => {
    lastKey = "\u0001";
    push(true);
  });
  if (offPreempted) cleanups.push(offPreempted);

  push(true);
  const timer = window.setInterval(() => push(false), POLL_MS);
  cleanups.push(() => window.clearInterval(timer));

  return () => {
    coverGen += 1;
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    if (session) {
      session.metadata = null;
      session.playbackState = "none";
      try {
        session.setPositionState(undefined as unknown as MediaPositionState);
      } catch {
        /* ignore */
      }
    }
  };
}
