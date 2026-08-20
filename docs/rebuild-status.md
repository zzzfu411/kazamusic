# KAZAM electron-vite rebuild status

验证日期：2026-08-14。命令均在 `kazam/` 下执行。退出码如实记录。

## 1. 入口确认

- `kazam/electron.vite.config.ts` **存在**。
- Renderer 三入口：
  - `src/renderer/index.html`
  - `src/island/index.html`
  - `src/taskbar/index.html`
- `src/main/index.ts` 的 `loadKazamRenderer()`：
  - dev：`process.env.ELECTRON_RENDERER_URL` + `/src/renderer/index.html`（或 island/taskbar）
  - prod：`out/renderer/src/<page>/index.html`
- 源码与配置里 **没有** `loadFile(D:/Develop/grok/rev/revmusic/work/asar/dist/index.html)`。
- `src/main/vendor/register.ts` 把 `work/asar/`、`main-D9`、`/dist/index.html` 标为 legacy，主窗若再 load 这些路径会被直接丢掉；island/taskbar 的旧 `*.html` 会改写到新 renderer。

## 2. 本轮命令退出码

| 命令 | 退出码 | 说明 |
|---|---|---|
| `npx tsc --noEmit -p kazam/tsconfig.json`（未 `cd kazam`） | **1** | 命中全局假 `tsc`（“This is not the tsc command you are looking for”），不是项目类型错误 |
| `.\node_modules\.bin\tsc --noEmit -p kazam/tsconfig.json`（在 `kazam/`） | **0** | 本地 TypeScript 5.9 通过 |
| `npx electron-vite build`（在 `kazam/`） | **0** | main / preload / renderer 均产出 |
| `node --experimental-strip-types test/shipped.test.mjs` | **0** | 旧 `compile.mjs` → `work/asar` 路径仍成立，未改测试 |

`package.json` 的 `typecheck` 等于本地 `tsc --noEmit`，可用 `npm run typecheck`。

## 3. 现在能编什么

electron-vite 产出（`out/`）：

```
out/main/index.js                         7.18 kB   新主进程壳
out/preload/index.js                     14.02 kB
out/preload/island.js                     1.17 kB
out/preload/taskbar.js                    1.42 kB
out/renderer/src/renderer/index.html      title = KAZAM
out/renderer/src/island/index.html
out/renderer/src/taskbar/index.html
out/renderer/assets/index-c5kG_BOC.js     1,215.84 kB
out/renderer/assets/kazam-theme-*.{js,css}
out/renderer/assets/island-*.{js,css}     stub
out/renderer/assets/taskbar-*.{js,css}    stub
```

构建时 vendor 插件把 `src/main/vendor/*`（除 `.ts`）拷到 `out/main/vendor/`，并把三个 preload 再拷一份给旧 worker 相对路径用。

已进 `src/`、能过 `tsc` 的源码：

- 主窗壳：`App.tsx` + Titlebar / Sidebar / PlayerBar / DetailPanel
- 页：Search / Settings / Download / RecommendFeed / Recognize / MvPlayer / CollectionDetail
- store：`settings.ts`（`m7.settings.v1`、`TASKBAR_DEFAULT_WIDTH = 280`）、`player.ts`
- 主题：`src/shared/theme.ts` + `src/renderer/styles/kazam-theme.css`（含 `content:"KAZAM"`）
- preload ×3、`src/main/ipc/channels.ts`（合同字符串已冻）
- island / taskbar：**占位 TSX**，只读同一 theme runtime

`package.json` 的 `dev` / `build:vite` 走 electron-vite。`build` / `dist` / `dist:nsis` **仍走** `compile.mjs` + `pack-asar.mjs`（往 `work/asar` hashed 文件注入），不是 vite `out/`。STAGE G 未做。

## 4. 仍在用 vendor `main-Ww`

几乎全部业务 IPC 仍靠 `src/main/vendor/main-Ww_YgTyR.js`（文件头：`DO NOT EDIT — vendored from work/asar/dist-electron`）。

`src/main/index.ts` 自己只注册了：

- `window:minimize` / `window:maximize` / `window:close`

其余通道（`channels.ts` 里的 local / db / lx / download / cache / island / taskbar / webdav / plugin / 平台登录 / lyrics / SMTC …）由 `registerVendorIpc()` `require` 旧包注册。

vendor 目录一并带着：

| 文件 | 角色 |
|---|---|
| `main-Ww_YgTyR.js` | 主进程 IPC + SQLite + 窗口/协议/岛/任务栏/koffi |
| `index-eLnmtrHq.js` | 旧包依赖 |
| `lxSandboxWorker.js` | LX 沙箱 |
| `scanWorker.js` | 本地扫描 |
| `perfMonitorWorker.js` | 性能监控 |
| `multipart-parser-CNLi1nGi.js` | 下载分片 |

`register.ts` 还做：

- Patch `BrowserWindow`，避免 vendor 再建主窗
- 拦 legacy `work/asar` / `dist/index.html` load
- 把旧 `island.html` / `taskbar.html` 改写到新 renderer
- `NODE_PATH` 补 `app/node_modules` 和 `../work/asar/node_modules`（`better-sqlite3` / `koffi`）

`src/main/` 里 **没有** `db.ts` / `lx.ts` / `scan.ts` / `island.ts` / `taskbar.ts`。STAGE F 拆分未开始。

## 5. 测试现状

`test/shipped.test.mjs` **仍然适用**：`compile.mjs` 还往 `work/asar/dist` / `dist-electron` 写 hashed 产物，断言全部通过（exit 0）。

测的仍是旧注入管线，不是 electron-vite `out/`。本轮未改测试（失败条件未触发）。后续 STAGE G 应改成测：

- `src/shared/theme.ts` / `src/renderer/styles/kazam-theme.css`
- `out/renderer/src/renderer/index.html` 的 `<title>KAZAM</title>`
- `out/preload/index.js` 的 channel 字符串

## 6. 剩余 STAGE E / F

对照 `PLAN-ELECTRON-VITE.md`。

### STAGE E — 岛 / 任务栏（未完成）

已有：HTML 入口、theme 注入、`applyResolvedTheme()`、设置默认 `position` + 宽 280。

未做：

- 把 `recovered/island/deobfuscated.js` 收成真实 `src/island/main.tsx`（胶囊、双行歌词、opacity、remote command）
- 把 `recovered/taskbar/deobfuscated.js` 收成真实 `src/taskbar/main.tsx`（封面/频谱/歌词色/布局）
- 任务栏避开系统图标的 nF/k_ 几何；koffi 嵌入仍在 vendor 里

### STAGE F — 主进程拆分（未开始）

按计划从 `recovered/mainProcess` 往 `src/main/` 搬，每搬一块删 vendor 对应 handler：

1. 窗口 + 单例 + `local-music://` / `webdav-music://`
2. `db.ts` + 播放/收藏/歌单 persist
3. `lxSandboxWorker` + `lx:musicUrl`
4. `scanWorker` + 本地元数据
5. 下载 / `cache:clear`
6. 岛窗口
7. 任务栏 + koffi（最后）

`better-sqlite3` / `koffi` 继续 externalize，ABI 对齐 Electron 42，native 可继续用 `work/app/resources/app.asar.unpacked`。

### 顺带未做

- STAGE G：`dist-portable.mjs` 吃 vite `out/`；停用 hashed 注入作为主路径
- `npm run build` 仍指向 `compile.mjs`，不是 `electron-vite build`
- 构建警告：`brand/mark.svg` 运行时解析（未打进 renderer assets）
