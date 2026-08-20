import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerFirstPartyIpc } from "./ipc/native";
import { loadKazamRenderer } from "./load-renderer";
import { appMeta } from "../shared/appMeta";
import { registerVendorIpc, setOwnedMainWindow, ownedMainWindow } from "./vendor/register";

export { loadKazamRenderer } from "./load-renderer";

function preloadPath(): string {
  const cjs = join(__dirname, "../preload/index.cjs");
  if (existsSync(cjs)) return cjs;
  const js = join(__dirname, "../preload/index.js");
  if (existsSync(js)) return js;
  return join(__dirname, "../preload/index.mjs");
}

function iconPath(): string {
  const names = ["app/build/icon.png", "app/build/icon.ico", "build/icon.png", "build/icon.ico"];
  const roots = [process.cwd(), app.getAppPath(), join(__dirname, ".."), __dirname];
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return join(process.cwd(), "app/build/icon.png");
}

function ensureVendorTrayIcons(): void {
  const srcCandidates = [
    join(process.cwd(), "app/build"),
    join(app.getAppPath(), "app/build"),
    join(app.getAppPath(), "out/build"),
    join(__dirname, "../build"),
  ];
  const srcDir = srcCandidates.find((dir) => existsSync(join(dir, "icon.png")) || existsSync(join(dir, "icon.ico")));
  if (!srcDir) return;
  const destDirs = [
    join(process.cwd(), "build"),
    join(__dirname, "../build"),
    join(__dirname, "build"),
  ];
  const files = ["icon.png", "icon.ico", "icon-16.png", "icon-32.png", "icon-48.png"];
  for (const destDir of destDirs) {
    try {
      mkdirSync(destDir, { recursive: true });
      for (const name of files) {
        const src = join(srcDir, name);
        if (existsSync(src)) copyFileSync(src, join(destDir, name));
      }
    } catch (err) {
      console.warn("[kazam] tray icon copy failed", destDir, err);
    }
  }
}

function mainWindow(): BrowserWindow | null {
  if (ownedMainWindow && !ownedMainWindow.isDestroyed()) return ownedMainWindow;
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && !win.isAlwaysOnTop()) ?? null;
}

function isVisuallyMaximized(win: BrowserWindow): boolean {
  if (win.isMaximized()) return true;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return (
    Math.abs(bounds.x - area.x) <= 2 &&
    Math.abs(bounds.y - area.y) <= 2 &&
    Math.abs(bounds.width - area.width) <= 4 &&
    Math.abs(bounds.height - area.height) <= 4
  );
}

function toggleMaximize(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  win.setResizable(true);
  win.setMaximizable(true);
  if (win.isMaximized() || isVisuallyMaximized(win)) {
    win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    if (isVisuallyMaximized(win)) {
      win.setBounds({
        x: area.x + Math.round(area.width * 0.08),
        y: area.y + Math.round(area.height * 0.08),
        width: Math.round(area.width * 0.84),
        height: Math.round(area.height * 0.84),
      });
    }
    return false;
  }
  win.maximize();
  if (!win.isMaximized() && !isVisuallyMaximized(win)) {
    win.setBounds(screen.getDisplayMatching(win.getBounds()).workArea);
  }
  return true;
}

function emitMaximized(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send("window:maximized-changed", isVisuallyMaximized(win));
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    titleBarStyle: "hidden",
    title: appMeta.name,
    icon: iconPath(),
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.on("preload-error", (_event, path, err) => {
    console.error("[kazam] preload-error", path, err);
  });
  win.once("ready-to-show", () => {
    console.log("[kazam] preload", preloadPath(), "api will bind on", win.webContents.getURL());
    if (!win.isDestroyed()) win.show();
  });
  win.on("maximize", () => emitMaximized(win));
  win.on("unmaximize", () => emitMaximized(win));
  win.on("resized", () => emitMaximized(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

function registerWindowIpc(win: BrowserWindow): void {
  ipcMain.removeAllListeners("window:minimize");
  ipcMain.removeAllListeners("window:maximize");
  ipcMain.removeAllListeners("window:close");
  try {
    ipcMain.removeHandler("window:maximize");
  } catch {
    /* not registered */
  }
  try {
    ipcMain.removeHandler("window:isMaximized");
  } catch {
    /* not registered */
  }

  ipcMain.on("window:minimize", () => {
    const target = mainWindow() ?? win;
    if (!target.isDestroyed()) target.minimize();
  });
  ipcMain.handle("window:maximize", () => {
    const target = mainWindow() ?? win;
    if (target.isDestroyed()) return false;
    const next = toggleMaximize(target);
    emitMaximized(target);
    return next;
  });
  ipcMain.handle("window:isMaximized", () => {
    const target = mainWindow() ?? win;
    return !target.isDestroyed() && isVisuallyMaximized(target);
  });
  ipcMain.on("window:close", () => {
    const target = mainWindow() ?? win;
    if (!target.isDestroyed()) target.close();
  });
}

app.whenReady().then(() => {
  app.setName(appMeta.name);
  ensureVendorTrayIcons();
  const win = createMainWindow();
  setOwnedMainWindow(win);
  registerWindowIpc(win);
  void loadKazamRenderer(win);
});

try {
  registerVendorIpc();
  console.log("[kazam] vendor IPC ready");
} catch (err) {
  console.error("[kazam] vendor IPC bridge failed:", err);
  registerFirstPartyIpc();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createMainWindow();
    setOwnedMainWindow(win);
    void loadKazamRenderer(win);
  }
});
