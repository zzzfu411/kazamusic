#!/usr/bin/env node
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectThemeFile } from "./inject-theme.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "..", "work", "asar");

await build({
  entryPoints: [join(root, "src/preload/index.ts")],
  outfile: join(app, "dist-electron/preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  logLevel: "info",
});

await build({
  entryPoints: [join(root, "src/preload/island.ts")],
  outfile: join(app, "dist-electron/preload-island.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  logLevel: "info",
});

await build({
  entryPoints: [join(root, "src/preload/taskbar.ts")],
  outfile: join(app, "dist-electron/preload-taskbar.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  logLevel: "info",
});

await build({
  entryPoints: [join(root, "src/renderer/entries/appMeta.js")],
  outfile: join(app, "dist/assets/appMeta-2CMhk7Xp.js"),
  bundle: true,
  format: "esm",
  logLevel: "info",
});

await build({
  entryPoints: [join(root, "src/shared/pluginTypes.ts")],
  outfile: join(app, "dist/assets/pluginTypes-BCujqLyF.js"),
  bundle: true,
  format: "esm",
  logLevel: "info",
});

injectThemeFile(
  join(app, "dist/assets/main-CDiUTmMI.css"),
  join(root, "src/renderer/styles/kazam-theme.css"),
);
injectThemeFile(
  join(app, "dist/assets/SettingsPage-DAsB6M3p.css"),
  join(root, "src/renderer/styles/settings-theme.css"),
);
injectThemeFile(
  join(app, "dist/assets/island-BiP8yGxC.css"),
  join(root, "src/renderer/styles/island-theme.css"),
);
injectThemeFile(
  join(app, "dist/assets/taskbar-OKzEC_l9.css"),
  join(root, "src/renderer/styles/taskbar-theme.css"),
);

console.log("compile ok");
