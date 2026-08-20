#!/usr/bin/env node
/**
 * Build a portable KAZAM folder from the local Electron runtime
 * (work/app) plus the freshly compiled asar. Avoids GitHub downloads.
 */
import { cpSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, "..", "work", "app");
const asar = join(runtime, "resources", "app.asar");
const out = join(root, "release", "KAZAM-win32-x64");

if (!existsSync(join(runtime, "GZ_MusicLauncher.exe"))) {
  throw new Error(`missing Electron runtime: ${runtime}`);
}
if (!existsSync(asar)) {
  throw new Error("missing app.asar — run npm run build first");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
cpSync(runtime, out, { recursive: true });

const oldExe = join(out, "GZ_MusicLauncher.exe");
const newExe = join(out, "KAZAM.exe");
if (existsSync(oldExe)) renameSync(oldExe, newExe);

console.log("portable ok");
console.log(newExe);
