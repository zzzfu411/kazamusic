import { contextBridge, ipcRenderer } from "electron";

let bootstrap: Record<string, unknown> = {
  snapshot: null,
  lyricSession: null,
  snapMode: "free",
};

try {
  bootstrap = ipcRenderer.sendSync("island:get-bootstrap-sync");
} catch {
  /* keep fallback */
}

function listen(channel: string, cb: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const islandAPI = {
  bootstrap,
  onSnapshot: (cb: (p: unknown) => void) => listen("island:snapshot", cb),
  onLyricSession: (cb: (p: unknown) => void) => listen("island:lyric-session", cb),
  onTick: (cb: (p: unknown) => void) => listen("island:tick", cb),
  onSnapMode: (cb: (p: unknown) => void) => listen("island:snap-mode", cb),
  sendCommand: (cmd: unknown) => ipcRenderer.send("island:command", cmd),
  requestLayout: (layout: unknown) => ipcRenderer.send("island:layout", layout),
  beginDrag: () => ipcRenderer.send("island:drag-start"),
  dragMove: () => ipcRenderer.send("island:drag-move"),
  finishDrag: () => ipcRenderer.send("island:drag-end"),
  getSettings: () => ipcRenderer.invoke("island:get-settings"),
};

contextBridge.exposeInMainWorld("islandAPI", islandAPI);
