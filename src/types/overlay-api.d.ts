export type OverlaySnapshot = {
  generation?: number;
  currentTime?: number;
  duration?: number;
  playback?: string;
  lyric?: {
    lineIndex?: number;
    activeLine?: string;
    nextLine?: string;
    status?: string;
  };
  track?: {
    title?: string;
    artist?: string;
    coverUrl?: string;
  } | null;
};

type IslandAPI = {
  bootstrap?: { snapshot?: OverlaySnapshot | null; snapMode?: string };
  onSnapshot: (cb: (p: OverlaySnapshot) => void) => () => void;
  onTick: (cb: (p: { currentTime?: number; duration?: number }) => void) => () => void;
  sendCommand: (cmd: unknown) => void;
};

type TaskbarAPI = {
  bootstrap?: { snapshot?: OverlaySnapshot | null };
  onSnapshot: (cb: (p: OverlaySnapshot) => void) => () => void;
  onTick: (cb: (p: { currentTime?: number; duration?: number }) => void) => () => void;
  sendCommand: (cmd: unknown) => void;
};

declare global {
  interface Window {
    islandAPI?: IslandAPI;
    taskbarAPI?: TaskbarAPI;
  }
}

export {};
