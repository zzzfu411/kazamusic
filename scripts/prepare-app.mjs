#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asar = join(root, "..", "work", "asar");
const app = join(root, "app");

if (!existsSync(asar)) {
  throw new Error(`missing asar source: ${asar}`);
}

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "gz-music",
      version: "2.1.4",
      description: "KAZAM desktop music player",
      main: "dist-electron/main.js",
      author: "",
      dependencies: {
        "@ant-design/icons": "^6.2.5",
        "@applemusic-like-lyrics/core": "^0.5.2",
        "@applemusic-like-lyrics/lyric": "^1.0.1",
        "@applemusic-like-lyrics/react": "^0.5.2",
        "@dnd-kit/core": "^6.3.1",
        "@dnd-kit/sortable": "^10.0.0",
        "@dnd-kit/utilities": "^3.2.2",
        "@remixicon/react": "^4.9.0",
        "antd": "^6.4.5",
        "better-sqlite3": "^12.11.1",
        "crypto-js": "^4.2.0",
        "electron-updater": "^6.8.9",
        "koffi": "^3.1.0",
        "music-metadata": "^11.13.0",
        "node-id3": "^0.2.9",
        "node-taglib-sharp": "^6.0.3",
        "qrcode": "^1.5.4",
        "react": "^18.3.1",
        "react-dom": "^18.3.1",
        "string-similarity": "^4.0.4",
        "systeminformation": "^5.31.11",
        "webdav": "^5.10.0",
      },
    },
    null,
    2,
  ) + "\n",
);

for (const dir of ["dist", "dist-electron", "build"]) {
  cpSync(join(asar, dir), join(app, dir), { recursive: true });
}

const nm = join(asar, "node_modules");
if (process.platform === "win32") {
  const r = spawnSync("cmd", ["/c", "mklink", "/J", join(app, "node_modules"), nm], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.warn("junction failed, copying node_modules (slow)");
    cpSync(nm, join(app, "node_modules"), { recursive: true });
  }
} else {
  const { symlinkSync } = await import("node:fs");
  symlinkSync(nm, join(app, "node_modules"), "dir");
}

console.log("prepare-app ok", app);
