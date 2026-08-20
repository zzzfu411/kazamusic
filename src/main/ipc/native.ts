import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from "electron";
import { createCipheriv, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadKazamRenderer } from "../load-renderer";
import { httpText } from "./http";

const EAPI_KEY = "e82ckenh8dichen8";
const NETEASE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let powerId: number | null = null;
let islandWin: BrowserWindow | null = null;
let taskbarWin: BrowserWindow | null = null;

function handleMissing(channel: string, fn: (...args: unknown[]) => unknown): void {
  try {
    ipcMain.handle(channel, fn as never);
  } catch {
    /* vendor already owns this channel */
  }
}

function onMissing(channel: string, fn: (event: Electron.IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.on(channel, fn);
}

function overlayPreload(kind: "island" | "taskbar"): string {
  const base = kind === "island" ? "island" : "taskbar";
  const cjs = join(__dirname, "../preload", `${base}.cjs`);
  if (existsSync(cjs)) return cjs;
  const js = join(__dirname, "../preload", `${base}.js`);
  return existsSync(js) ? js : join(__dirname, "../preload", `${base}.mjs`);
}

async function createOverlay(kind: "island" | "taskbar"): Promise<BrowserWindow> {
  const existing = kind === "island" ? islandWin : taskbarWin;
  if (existing && !existing.isDestroyed()) return existing;
  const win = new BrowserWindow({
    width: kind === "island" ? 360 : 280,
    height: kind === "island" ? 56 : 72,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: "#00000000",
    icon: join(process.cwd(), "app/build/icon.png"),
    webPreferences: {
      preload: overlayPreload(kind),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await loadKazamRenderer(win, kind);
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("closed", () => {
    if (kind === "island") islandWin = null;
    else taskbarWin = null;
  });
  if (kind === "island") islandWin = win;
  else taskbarWin = win;
  return win;
}

function destroyOverlay(kind: "island" | "taskbar"): void {
  const win = kind === "island" ? islandWin : taskbarWin;
  if (win && !win.isDestroyed()) win.close();
}

function eapiEncrypt(path: string, data: string): string {
  const apiPath = path.replace("/eapi/", "/api/");
  const digest = createHash("md5").update(`nobody${apiPath}use${data}md5forencrypt`).digest("hex");
  const payload = `${apiPath}-36cd479b6b5-${data}-36cd479b6b5-${digest}`;
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(EAPI_KEY), null);
  return Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]).toString("hex");
}

export function registerFirstPartyIpc(): void {
  handleMissing("netease:eapi", async (_event, path: unknown, data: unknown) => {
    const e = String(path ?? "");
    const t = typeof data === "string" ? data : JSON.stringify(data ?? {});
    const hex = eapiEncrypt(e, t);
    const body = `params=${encodeURIComponent(hex)}`;
    return httpText(`https://interface.music.163.com${e}`, "POST", body, {
      Referer: "https://music.163.com/",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": NETEASE_UA,
    });
  });

  handleMissing("netease:post", async (_event, url: unknown, body: unknown, headers: unknown) => {
    const href = String(url ?? "");
    const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    const extra = headers && typeof headers === "object" ? (headers as Record<string, string>) : {};
    return httpText(href, payload ? "POST" : "GET", payload, extra);
  });

  handleMissing("netease:redirect", async (_event, url: unknown) => String(url ?? ""));
  handleMissing("kuwo:get", async (_event, url: unknown) => httpText(String(url ?? ""), "GET", null, { Referer: "https://www.kuwo.cn/" }));
  handleMissing("kuwo:searchKey", async () => []);
  handleMissing("qq:get", async (_event, url: unknown) => httpText(String(url ?? "")));
  handleMissing("qq:post", async (_event, url: unknown, body: unknown) =>
    httpText(String(url ?? ""), "POST", body == null ? null : String(body)),
  );
  handleMissing("kugou:get", async (_event, url: unknown) => httpText(String(url ?? "")));
  handleMissing("fetch:image", async () => "");
  handleMissing("bg:loadDefault", async () => "");

  handleMissing("app:getInfo", async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }));
  handleMissing("app:getLogInfo", async () => ({
    logDir: app.getPath("logs"),
    currentLogFile: "",
    userDataDir: app.getPath("userData"),
  }));
  handleMissing("app:log", async () => undefined);
  handleMissing("app:openLogDir", async () => {
    const logDir = app.getPath("logs");
    await shell.openPath(logDir);
    return { ok: true, logDir };
  });
  handleMissing("app:openExternal", async (_event, url: unknown) => {
    const href = String(url ?? "");
    if (href.startsWith("https://") || href.startsWith("http://")) await shell.openExternal(href);
  });
  handleMissing("app:checkForUpdates", async () => ({ code: 0, data: { has_update: false } }));
  handleMissing("app:get-memory-info", async () => app.getAppMetrics());
  handleMissing("app:set-background-throttling", async () => undefined);

  handleMissing("lx:list", async () => []);
  handleMissing("lx:musicUrl", async () => ({ url: "" }));
  handleMissing("lx:importFile", async () => ({ ok: false }));
  handleMissing("lx:importUrl", async () => ({ ok: false }));
  handleMissing("lx:setEnabled", async () => undefined);
  handleMissing("lx:remove", async () => undefined);
  handleMissing("lx:removeAll", async () => undefined);
  handleMissing("plugin:getStatus", async () => ({ status: "active", canPlayOnline: true }));
  handleMissing("plugin:canPlayOnline", async () => true);
  handleMissing("cache:getStats", async () => ({
    trackCache: { count: 0, size: 0 },
    audioCache: { count: 0, size: 0 },
    cacheDir: app.getPath("userData"),
  }));
  handleMissing("cache:clear", async () => true);
  handleMissing("db:savePlayback", async () => undefined);
  handleMissing("db:getPlayback", async () => undefined);
  handleMissing("db:loadFavorites", async () => []);
  handleMissing("db:loadPlaylists", async () => []);
  handleMissing("db:loadDownloads", async () => []);
  handleMissing("settings:update", async () => undefined);

  handleMissing("island:set-enabled", async (_event, on: unknown) => {
    if (on) await createOverlay("island");
    else destroyOverlay("island");
    return true;
  });
  handleMissing("island:set-always-on-top", async (_event, on: unknown) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.setAlwaysOnTop(Boolean(on), "screen-saver");
    return true;
  });
  handleMissing("taskbar:set-enabled", async (_event, on: unknown) => {
    if (on) await createOverlay("taskbar");
    else destroyOverlay("taskbar");
    return true;
  });
  handleMissing("taskbar:set-position", async () => true);
  handleMissing("taskbar:list-monitors", async () => []);

  onMissing("power:acquire", () => {
    if (powerId == null) powerId = powerSaveBlocker.start("prevent-display-sleep");
  });
  onMissing("power:release", () => {
    if (powerId != null && powerSaveBlocker.isStarted(powerId)) powerSaveBlocker.stop(powerId);
    powerId = null;
  });
  onMissing("island:get-bootstrap-sync", (event) => {
    event.returnValue = { snapshot: null, lyricSession: null, snapMode: "free" };
  });
  onMissing("taskbar:get-bootstrap-sync", (event) => {
    event.returnValue = { snapshot: null };
  });
  onMissing("island:publish", (_event, state) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send("island:snapshot", state);
  });
  onMissing("island:publish-tick", (_event, tick) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send("island:tick", tick);
  });
  onMissing("island:command", (_event, cmd) => {
    const main = BrowserWindow.getAllWindows()[0];
    main?.webContents.send("island:remote-command", cmd);
  });
  onMissing("taskbar:command", (_event, cmd) => {
    const main = BrowserWindow.getAllWindows()[0];
    main?.webContents.send("taskbar:remote-command", cmd);
  });
}
