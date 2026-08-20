#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "..", "work", "asar");
const dest = join(root, "..", "work", "app", "resources", "app.asar");
const copies = [
  join(root, "..", "work", "app.asar.patched"),
  join(root, "..", "app.asar"),
];

if (!existsSync(join(app, "package.json"))) {
  throw new Error("run prepare-app + compile first");
}

mkdirSync(dirname(dest), { recursive: true });
const r = spawnSync("npx", ["--yes", "@electron/asar", "pack", app, dest], {
  stdio: "inherit",
  shell: true,
});
if (r.status !== 0) process.exit(r.status ?? 1);

for (const p of copies) {
  try {
    cpSync(dest, p);
  } catch (e) {
    console.warn("copy skip", p, e.message);
  }
}
console.log("packed", dest);
