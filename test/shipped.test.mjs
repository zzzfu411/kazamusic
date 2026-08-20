import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveTheme, themeFromSettings } from "../src/shared/theme.ts";
import { pluginStatusHint, pluginPlayBlockMessage, PLUGIN_STATUS_LABEL } from "../src/shared/pluginTypes.ts";
import { appMeta } from "../src/shared/appMeta.ts";
import { injectThemeFile } from "../scripts/inject-theme.mjs";

const asar = join(import.meta.dirname, "..", "..", "work", "asar");

assert.equal(appMeta.name, "KAZAM");
assert.equal(appMeta.version, "2.1.4");

assert.equal(PLUGIN_STATUS_LABEL.active, "已启用");
assert.match(pluginStatusHint("not_installed"), /KAZAM/);
assert.match(pluginPlayBlockMessage("expired"), /过期/);

assert.equal(resolveTheme("dark", true), "dark");
assert.equal(resolveTheme("light", false), "light");
assert.equal(resolveTheme("system", true), "light");
assert.equal(resolveTheme("system", false), "dark");
assert.equal(resolveTheme(undefined, true), "dark");
assert.equal(themeFromSettings({ appearance: { theme: "light" } }), "light");
assert.equal(themeFromSettings({}), "dark");

const dir = mkdtempSync(join(tmpdir(), "kazam-theme-"));
const cssPath = join(dir, "main.css");
const themePath = join(import.meta.dirname, "..", "src/renderer/styles/kazam-theme.css");
writeFileSync(cssPath, ".app{color:red}\n/* kazam-theme */\nOLD\n");
assert.equal(injectThemeFile(cssPath, themePath), true);
const injected = readFileSync(cssPath, "utf8");
assert.match(injected, /^\.app\{color:red\}/);
assert.match(injected, /font-family: "Fraunces"/);
assert.match(injected, /--signal: #e8a84a/);
assert.doesNotMatch(injected, /OLD/);

const mainCss = readFileSync(join(asar, "dist/assets/main-CDiUTmMI.css"), "utf8");
assert.match(mainCss, /content:"KAZAM"/);
assert.match(mainCss, /html\[data-theme=light\] \.player/);
assert.match(mainCss, /html\[data-theme=light\] \.app-sidebar/);
assert.match(mainCss, /html\[data-theme=light\] \.app\{/);
assert.match(mainCss, /--ui-control-fg:#1a1a2e!important/);
assert.match(mainCss, /custom-bg-layer/);
assert.match(mainCss, /html\[data-theme=light\] \.track-list/);
assert.match(mainCss, /html\[data-theme=light\] \.amll-lyric-player/);
assert.match(mainCss, /mix-blend-mode:normal!important/);
assert.match(mainCss, /--amll-lp-color:#1a1a2e!important/);
assert.match(mainCss, /html\[data-theme=light\] \.detail-lyric-empty/);

const settingsCss = readFileSync(join(asar, "dist/assets/SettingsPage-DAsB6M3p.css"), "utf8");
assert.doesNotMatch(settingsCss, /content:"KAZAM"/);
assert.match(settingsCss, /\.sp-shell/);

const islandCss = readFileSync(join(asar, "dist/assets/island-BiP8yGxC.css"), "utf8");
assert.doesNotMatch(islandCss, /content:"KAZAM"/);
assert.match(islandCss, /\.island-capsule/);

const meta = await import(pathToFileURL(join(asar, "dist/assets/appMeta-2CMhk7Xp.js")).href);
assert.equal(meta.A.name, "KAZAM");
assert.equal(meta.A.version, "2.1.4");

const plugins = await import(pathToFileURL(join(asar, "dist/assets/pluginTypes-BCujqLyF.js")).href);
assert.match(plugins.pluginStatusHint("not_installed"), /KAZAM/);

const mainJs = readFileSync(join(asar, "dist/assets/main-D9-C2OLI.js"), "utf8");
assert.match(mainJs, /function kzApplyTheme/);
assert.match(mainJs, /offsetX:-1,monitorId:-1/);
assert.doesNotMatch(mainJs, /offsetX:-1\},monitorId/);
assert.match(mainJs, /sg-appearance-theme|theme:"dark"/);
assert.match(mainJs, /if\(!ue\)\{/);
assert.match(mainJs, /mode:"color"/);
assert.match(mainJs, /title:"移动端"[^"]*"aria-label":"移动端",style:\{display:"none"\}/);
const islandHtml = readFileSync(join(asar, "dist/island.html"), "utf8");
assert.match(islandHtml, /m7\.settings\.v1/);
const taskbarHtml = readFileSync(join(asar, "dist/taskbar.html"), "utf8");
assert.match(taskbarHtml, /m7\.settings\.v1/);

const preload = readFileSync(join(asar, "dist-electron/preload.js"), "utf8");
assert.match(preload, /electronAPI/);
assert.match(preload, /lx:musicUrl/);
assert.match(preload, /cache:clear/);
const mainProc = readFileSync(join(asar, "dist-electron/main-Ww_YgTyR.js"), "utf8");
assert.match(mainProc, /ipcMain\.handle\("cache:clear"/);
const settings = readFileSync(join(asar, "dist/assets/SettingsPage-BFXbe-8T.js"), "utf8");
assert.match(settings, /清理缓存/);
assert.match(settings, /!1&&r.enabled\?s\.jsx\(G,\{label:"胶囊背景风格"/);
assert.match(mainJs, /function Rn\(\)\{return!0\}/);
assert.match(mainJs, /function Hf\(t\)\{return!0\}/);

assert.equal(existsSync(join(asar, "dist/index.html")), true);
const html = readFileSync(join(asar, "dist/index.html"), "utf8");
assert.match(html, /<title>KAZAM<\/title>/);
assert.match(html, /m7\.settings\.v1/);

console.log("shipped tests ok");
