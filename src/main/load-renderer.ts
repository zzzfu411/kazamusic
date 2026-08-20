import { type BrowserWindow } from "electron";
import { join } from "node:path";

export function rendererDevUrl(page: "renderer" | "island" | "taskbar"): string | null {
  const base = process.env.ELECTRON_RENDERER_URL;
  if (!base) return null;
  if (page === "renderer") return `${base}/src/renderer/index.html`;
  return `${base}/src/${page}/index.html`;
}

export function rendererProdFile(page: "renderer" | "island" | "taskbar"): string {
  return join(__dirname, `../renderer/src/${page}/index.html`);
}

export function loadKazamRenderer(
  win: BrowserWindow,
  page: "renderer" | "island" | "taskbar" = "renderer",
): Promise<void> {
  const devUrl = rendererDevUrl(page);
  if (devUrl) return win.loadURL(devUrl);
  return win.loadFile(rendererProdFile(page));
}
