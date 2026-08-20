import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

const nativeExternals = ["better-sqlite3", "koffi", "electron"];

function copyAfpAssets(): void {
  const files = ["afp.js", "afp.wasm.js"];
  const srcDir = resolve(root, "app/dist");
  const dests = [
    resolve(root, "public"),
    resolve(root, "out/renderer"),
    resolve(root, "out/renderer/src/renderer"),
  ];
  for (const destDir of dests) {
    mkdirSync(destDir, { recursive: true });
    for (const name of files) {
      const from = join(srcDir, name);
      if (existsSync(from)) cpSync(from, join(destDir, name));
    }
  }
}

function copyVendorAssets(): Plugin {
  const srcDir = resolve(root, "src/main/vendor");
  const destDir = resolve(root, "out/main/vendor");
  const preloadDir = resolve(root, "out/preload");

  const copy = (): void => {
    mkdirSync(destDir, { recursive: true });
    if (existsSync(srcDir)) {
      for (const name of readdirSync(srcDir)) {
        if (name.endsWith(".ts")) continue;
        cpSync(join(srcDir, name), join(destDir, name));
      }
    }
    const preloads: Array<[string, string]> = [
      [join(preloadDir, "index.cjs"), join(destDir, "preload.js")],
      [join(preloadDir, "island.cjs"), join(destDir, "preload-island.js")],
      [join(preloadDir, "taskbar.cjs"), join(destDir, "preload-taskbar.js")],
    ];
    for (const [from, to] of preloads) {
      if (existsSync(from)) cpSync(from, to);
    }
    copyAfpAssets();
  };

  return {
    name: "copy-vendor-assets",
    buildStart: copy,
    closeBundle: copy,
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyVendorAssets()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/main/index.ts"),
        },
        external: nativeExternals,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), copyVendorAssets()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/preload/index.ts"),
          island: resolve(root, "src/preload/island.ts"),
          taskbar: resolve(root, "src/preload/taskbar.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
        external: ["electron"],
      },
    },
  },
  renderer: {
    root,
    plugins: [
      react(),
      {
        name: "copy-afp-assets",
        closeBundle: copyAfpAssets,
      },
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/renderer/index.html"),
          island: resolve(root, "src/island/index.html"),
          taskbar: resolve(root, "src/taskbar/index.html"),
        },
      },
    },
  },
});
