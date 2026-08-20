#!/usr/bin/env node
/**
 * Recover first-party JS from the packaged asar into kazam/recovered.
 * Official source maps were stripped. This is unminify + JSX decompile, not original TSX.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asar = join(root, "..", "work", "asar");
const outRoot = join(root, "recovered");

const jobs = [
  ["pluginTypes", "dist/assets/pluginTypes-BCujqLyF.js"],
  ["appMeta", "dist/assets/appMeta-2CMhk7Xp.js"],
  ["island", "dist/assets/island-DevHQ_Sf.js"],
  ["taskbar", "dist/assets/taskbar-BMs9UdyF.js"],
  ["SettingsPage", "dist/assets/SettingsPage-BFXbe-8T.js"],
  ["SearchPage", "dist/assets/SearchPage-C_al6cmx.js"],
  ["DownloadPage", "dist/assets/DownloadPage-N3RLCJeU.js"],
  ["CollectionDetailPage", "dist/assets/CollectionDetailPage-BTzW7fwM.js"],
  ["RecommendFeedPage", "dist/assets/RecommendFeedPage-C7byYGSe.js"],
  ["RecognizePage", "dist/assets/RecognizePage-C3SzA5xW.js"],
  ["MvPlayerPage", "dist/assets/MvPlayerPage-uZLsb4Y4.js"],
  ["LyricSyncEngine", "dist/assets/LyricSyncEngine-Kr6auYM5.js"],
  ["lineTiming", "dist/assets/lineTiming-I_pVnHP1.js"],
  ["mainRenderer", "dist/assets/main-D9-C2OLI.js"],
  ["mainProcess", "dist-electron/main-Ww_YgTyR.js"],
  ["lxSandboxWorker", "dist-electron/lxSandboxWorker.js"],
  ["scanWorker", "dist-electron/scanWorker.js"],
  ["perfMonitorWorker", "dist-electron/perfMonitorWorker.js"],
  ["preload", "dist-electron/preload.js"],
];

mkdirSync(outRoot, { recursive: true });

for (const [name, rel] of jobs) {
  const input = join(asar, rel);
  const out = join(outRoot, name);
  if (!existsSync(input)) {
    console.warn("skip missing", rel);
    continue;
  }
  console.log("webcrack", name);
  const r = spawnSync(
    "npx",
    ["--yes", "webcrack", "-f", "--no-deobfuscate", "-o", out, input],
    { stdio: "inherit", shell: true },
  );
  if (r.status !== 0) {
    console.error("failed", name, r.status);
  }
}
