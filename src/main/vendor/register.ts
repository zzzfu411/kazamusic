import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { copyFileSync, existsSync } from "node:fs";
import Module from "node:module";
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
} from "electron";

const require = createRequire(import.meta.url);

export let ownedMainWindow: BrowserWindow | null = null;

export function setOwnedMainWindow(win: BrowserWindow): void {
  ownedMainWindow = win;
  guardOwnedWindowLoads(win);
}

function isMainWindowOptions(opts?: BrowserWindowConstructorOptions): boolean {
  const preload = String(opts?.webPreferences?.preload ?? "").replace(/\\/g, "/");
  if (!preload) return opts?.width === 1200 && opts?.frame === false;
  if (preload.includes("preload-island") || preload.includes("/island")) return false;
  if (preload.includes("preload-taskbar") || preload.includes("/taskbar")) return false;
  return (
    preload.endsWith("preload.js") ||
    preload.includes("/preload/index") ||
    (opts?.width === 1200 && opts?.frame === false)
  );
}

function isLegacyMainTarget(target: string): boolean {
  const n = target.replace(/\\/g, "/");
  if (n.includes("work/asar/")) return true;
  if (n.includes("main-D9")) return true;
  if (/\/dist\/index\.html(?:\?|#|$)/.test(n)) return true;
  if (n.endsWith("/dist/index.html")) return true;
  return false;
}

function rewriteOverlayTarget(target: string): string | null {
  const n = target.replace(/\\/g, "/");
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (n.endsWith("/island.html") || n.includes("/island.html")) {
    if (dev) return `${dev}/src/island/index.html`;
    return join(__dirname, "../renderer/src/island/index.html");
  }
  if (n.endsWith("/taskbar.html") || n.includes("/taskbar.html")) {
    if (dev) return `${dev}/src/taskbar/index.html`;
    return join(__dirname, "../renderer/src/taskbar/index.html");
  }
  return null;
}

function loadRewritten(win: BrowserWindow, rewritten: string): Promise<void> {
  if (/^https?:\/\//.test(rewritten)) return win.loadURL(rewritten);
  return win.loadFile(rewritten);
}

function guardOwnedWindowLoads(win: BrowserWindow): void {
  const origURL = win.loadURL.bind(win);
  const origFile = win.loadFile.bind(win);

  win.loadURL = async (url, options) => {
    if (isLegacyMainTarget(url) || url === process.env.VITE_DEV_SERVER_URL) {
      return;
    }
    const rewritten = rewriteOverlayTarget(url);
    if (rewritten && rewritten !== url) return origURL(rewritten, options);
    return origURL(url, options);
  };

  win.loadFile = async (file, options) => {
    if (isLegacyMainTarget(file)) return;
    const rewritten = rewriteOverlayTarget(file);
    if (rewritten && rewritten !== file) return loadRewritten(win, rewritten);
    return origFile(file, options);
  };
}

function patchBrowserWindow(): typeof BrowserWindow {
  const Original = BrowserWindow;
  function Patched(this: unknown, opts?: BrowserWindowConstructorOptions) {
    if (ownedMainWindow && !ownedMainWindow.isDestroyed() && isMainWindowOptions(opts)) {
      return ownedMainWindow;
    }
    return new Original(opts);
  }
  Object.setPrototypeOf(Patched, Original);
  Object.assign(Patched, Original);
  Patched.prototype = Original.prototype;
  return Patched as unknown as typeof BrowserWindow;
}

function patchElectronExport(): typeof import("electron") {
  const electron = require("electron") as typeof import("electron");
  const PatchedBW = patchBrowserWindow();
  return new Proxy(electron, {
    get(target, prop, receiver) {
      if (prop === "BrowserWindow") return PatchedBW;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function installNativeModulePaths(): void {
  let appPath = "";
  try {
    appPath = (require("electron") as typeof import("electron")).app.getAppPath();
  } catch {
    /* app not available yet */
  }
  const extras = [
    join(process.cwd(), "app/node_modules"),
    join(process.cwd(), "..", "work", "asar", "node_modules"),
    appPath ? join(appPath, "node_modules") : "",
    appPath ? join(appPath, "app/node_modules") : "",
    appPath ? join(appPath, "..", "app.asar.unpacked", "node_modules") : "",
  ].filter((dir) => dir && existsSync(dir));
  if (extras.length === 0) return;
  const merged = [process.env.NODE_PATH, ...extras].filter(Boolean).join(delimiter);
  process.env.NODE_PATH = merged;
  (Module as typeof Module & { _initPaths: () => void })._initPaths();
}

function resolveVendorFile(): string {
  const candidates = [
    join(__dirname, "vendor", "main-Ww_YgTyR.js"),
    join(dirname(__dirname), "vendor", "main-Ww_YgTyR.js"),
    join(process.cwd(), "src/main/vendor/main-Ww_YgTyR.js"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  throw new Error("vendor main-Ww_YgTyR.js not found (copy from work/asar/dist-electron)");
}

let vendorLoaded = false;

/**
 * Require the DO-NOT-EDIT vendor bundle so existing ipcMain handlers
 * (lx, db, local, download, …) stay registered. Windows stay owned by
 * src/main/index.ts — vendor `new BrowserWindow` for the main frame is
 * redirected to the already-created KAZAM window.
 */
export function registerVendorIpc(): void {
  if (vendorLoaded) return;
  vendorLoaded = true;

  if (process.env.ELECTRON_RENDERER_URL && !process.env.VITE_DEV_SERVER_URL) {
    process.env.VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
  }

  installNativeModulePaths();

  const patched = patchElectronExport();
  const nodeModule = Module as typeof Module & {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _initPaths: () => void;
  };
  const origLoad = nodeModule._load.bind(Module);
  nodeModule._load = function (request: string, parent, isMain) {
    if (request === "electron") return patched;
    return origLoad(request, parent, isMain);
  };

  const vendorJs = resolveVendorFile();
  const vendorCjs = vendorJs.replace(/\.js$/i, ".cjs");
  if (vendorCjs !== vendorJs && !existsSync(vendorCjs)) {
    copyFileSync(vendorJs, vendorCjs);
  }
  require(existsSync(vendorCjs) ? vendorCjs : vendorJs);
}
