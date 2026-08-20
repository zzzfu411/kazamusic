import { contextBridge, ipcRenderer } from "electron";

const bootstrap = ipcRenderer.sendSync("taskbar:get-bootstrap-sync");

function listen(channel: string, cb: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const taskbarAPI = {
  bootstrap,
  onSnapshot: (cb: (p: unknown) => void) => listen("taskbar:snapshot", cb),
  onTick: (cb: (p: unknown) => void) => listen("taskbar:tick", cb),
  onColors: (cb: (p: unknown) => void) => listen("taskbar:colors", cb),
  onLyricSession: (cb: (p: unknown) => void) => listen("taskbar:lyric-session", cb),
  onPerfStats: (cb: (p: unknown) => void) => listen("taskbar:perf-stats", cb),
  onCoverMode: (cb: (p: unknown) => void) => listen("taskbar:cover-mode", cb),
  onLayoutMode: (cb: (p: unknown) => void) => listen("taskbar:layout-mode", cb),
  onVisualizerEffect: (cb: (p: unknown) => void) => listen("taskbar:visualizer-effect", cb),
  onSpectrumData: (cb: (p: unknown) => void) => listen("taskbar:spectrum-data", cb),
  sendCommand: (cmd: unknown) => ipcRenderer.send("taskbar:command", cmd),
  requestLayout: (layout: unknown) => ipcRenderer.send("taskbar:layout", layout),
  moveBy: (x: number, y: number) => ipcRenderer.send("taskbar:move-by", x, y),
  finishDrag: () => ipcRenderer.send("taskbar:drag-end"),
  getColors: () => ipcRenderer.invoke("taskbar:get-colors"),
  setLyricColorMode: (mode: unknown) => ipcRenderer.invoke("taskbar:set-lyric-color-mode", mode),
};

contextBridge.exposeInMainWorld("taskbarAPI", taskbarAPI);
