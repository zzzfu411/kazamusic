#!/usr/bin/env node
/**
 * Pack the electron-vite product into a double-clickable portable folder:
 *   kazam/release/KAZAM-win32-x64/KAZAM.exe
 * Reuses the local Electron 42 runtime in work/app (no GitHub download).
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const runtime = join(repo, "work", "app");
const nmSrc = join(repo, "work", "asar", "node_modules");
const dest = join(root, "release", "KAZAM-win32-x64");
const appDir = join(dest, "resources", "app");
const iconSrc = join(root, "app", "build");

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function robocopy(src, to) {
  mkdirSync(to, { recursive: true });
  const r = spawnSync(
    "robocopy",
    [src, to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np", "/R:1", "/W:1"],
    { stdio: "inherit", windowsHide: true },
  );
  const code = r.status ?? 1;
  if (code >= 8) {
    throw new Error(`robocopy failed ${code}: ${src} -> ${to}`);
  }
}

function copyTree(src, to) {
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  mkdirSync(dirname(to), { recursive: true });
  robocopy(src, to);
}

if (!existsSync(join(runtime, "GZ_MusicLauncher.exe")) && !existsSync(join(dest, "KAZAM.exe"))) {
  throw new Error(`missing Electron runtime: ${runtime}`);
}
if (!existsSync(nmSrc)) {
  throw new Error(`missing native modules: ${nmSrc}`);
}

console.log("[dist] electron-vite build");
run("npm", ["run", "build:vite"]);

if (!existsSync(join(dest, "KAZAM.exe")) && !existsSync(join(dest, "electron.exe"))) {
  console.log("[dist] copy Electron runtime");
  mkdirSync(join(root, "release"), { recursive: true });
  copyTree(runtime, dest);
}

const oldExe = join(dest, "GZ_MusicLauncher.exe");
const exe = join(dest, "KAZAM.exe");
if (existsSync(oldExe)) {
  if (existsSync(exe)) rmSync(exe, { force: true });
  renameSync(oldExe, exe);
}

const asar = join(dest, "resources", "app.asar");
if (existsSync(asar)) {
  console.log("[dist] remove injected app.asar so unpacked product wins");
  rmSync(asar, { force: true });
}

if (existsSync(appDir)) rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

writeFileSync(
  join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "gz-music",
      version: "2.1.4",
      description: "KAZAM desktop music player",
      main: "out/main/index.js",
      type: "module",
      author: "",
    },
    null,
    2,
  ) + "\n",
);

console.log("[dist] copy vite out/");
copyTree(join(root, "out"), join(appDir, "out"));

console.log("[dist] copy node_modules (sqlite / koffi / vendor deps)");
copyTree(nmSrc, join(appDir, "node_modules"));

const unpacked = join(runtime, "resources", "app.asar.unpacked");
const unpackedDest = join(dest, "resources", "app.asar.unpacked");
if (existsSync(unpacked) && !existsSync(join(unpackedDest, "node_modules", "better-sqlite3"))) {
  console.log("[dist] copy asar.unpacked natives");
  copyTree(unpacked, unpackedDest);
}

function copyIcons(toDir) {
  mkdirSync(toDir, { recursive: true });
  for (const name of ["icon.png", "icon.ico", "icon-16.png", "icon-32.png", "icon-48.png"]) {
    const from = join(iconSrc, name);
    if (existsSync(from)) copyFileSync(from, join(toDir, name));
  }
}
copyIcons(join(dest, "build"));
copyIcons(join(dest, "app", "build"));
copyIcons(join(appDir, "app", "build"));
copyIcons(join(appDir, "out", "build"));

const defaultBg = join(root, "app", "dist", "default-bg.jpg");
if (existsSync(defaultBg)) {
  mkdirSync(join(appDir, "public"), { recursive: true });
  copyFileSync(defaultBg, join(appDir, "public", "default-bg.jpg"));
}

const rcedit = join(root, "node_modules", "rcedit", "bin", "rcedit.exe");
const iconIco = join(iconSrc, "icon.ico");
if (existsSync(rcedit) && existsSync(iconIco) && existsSync(exe)) {
  console.log("[dist] stamp exe icon");
  spawnSync(rcedit, [exe, "--set-icon", iconIco, "--set-version-string", "ProductName", "KAZAM"], {
    stdio: "inherit",
  });
}

const lnkPs = `
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut(${JSON.stringify(join(root, "release", "KAZAM.lnk"))})
$lnk.TargetPath = ${JSON.stringify(exe)}
$lnk.WorkingDirectory = ${JSON.stringify(dest)}
$lnk.WindowStyle = 1
$lnk.Description = "KAZAM"
$ico = ${JSON.stringify(iconIco)}
if (Test-Path $ico) { $lnk.IconLocation = $ico }
$lnk.Save()
`;
spawnSync("powershell", ["-NoProfile", "-Command", lnkPs], { stdio: "inherit" });

if (!existsSync(exe)) {
  throw new Error("KAZAM.exe was not produced");
}

console.log("portable ok");
console.log(exe);
