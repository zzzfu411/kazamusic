# KAZAM 源码重建计划（electron-vite）

目标：不再对 `main-D9-C2OLI.js` / `main-Ww_YgTyR.js` 打补丁，把播放器按页重写成 `kazam/src` 里的 TypeScript/TSX，用 **electron-vite** 编译出可运行的 KAZAM。

约束：官方无 source map。`kazam/recovered/` 是 webcrack 展开结果（可读 JSX，标识符仍压缩）。preload / 主题 / appMeta 已是源码。

---

## 0. 完成定义

1. `cd kazam && npm run dev` 能拉起 Electron，主窗来自 `src/renderer`，不是 asar 里的 minify 包。
2. `npm run build` 产出 electron-vite 的 `out/`（或 `dist` + `dist-electron`），不再依赖「往官方 hashed 文件里注入」。
3. 主进程 IPC 合同与现有 `src/preload/index.ts` 一致；LX、本地库、播放、设置、下载、灵动岛、任务栏至少有一条可走通的路径。
4. VIP/登录门禁在源码里直接放行，不再搜 `function Rn()`。
5. 主题只走 `src/renderer/styles` + `src/shared/theme.ts`。
6. `kazam/test/` 测的是 **编出来的入口**（preload、theme、至少一页 renderer），不是 minify 字符串。

未完成：若 `dev` 仍 `loadFile(work/asar/dist/index.html)`，或业务仍只存在于 `work/asar/dist/assets/main-D9*.js`。

---

## 1. 目标仓库布局

```
kazam/
  electron.vite.config.ts
  package.json                 # electron-vite / electron 42.5.0 / antd / better-sqlite3 / koffi
  src/
    main/
      index.ts                 # app ready、三窗口、协议、quit
      ipc/                     # 与 preload 一一对应
      db.ts
      lx.ts + workers/lxSandboxWorker.ts
      scan.ts + workers/scanWorker.ts
      island.ts
      taskbar.ts               # koffi 嵌入最后迁
      vendor/                  # 过渡期：require 旧 main-Ww（仅未拆完的 handler）
    preload/                   # 已有 index/island/taskbar.ts
    renderer/                  # 主窗
      index.html
      main.tsx
      App.tsx
      stores/settings.ts
      stores/player.ts
      stores/library.ts
      pages/SearchPage.tsx
      pages/SettingsPage.tsx
      pages/DownloadPage.tsx
      pages/RecommendFeedPage.tsx
      pages/RecognizePage.tsx
      pages/MvPlayerPage.tsx
      pages/CollectionDetailPage.tsx
      shell/Titlebar.tsx
      shell/Sidebar.tsx
      shell/PlayerBar.tsx
      shell/DetailPanel.tsx
      styles/kazam-theme.css
    island/{index.html,main.tsx}
    taskbar/{index.html,main.tsx}
    shared/{electron-api.d.ts,theme.ts,appMeta.ts,pluginTypes.ts,types.ts}
  recovered/                   # 只读对照，禁止当运行时
  resources/brand/
```

`work/asar` 在过渡期只当 **IPC/行为对照** 和 native `node_modules` 来源，不再是唯一运行入口。

---

## 2. 分阶段（必须按序，每阶段都能跑）

### 阶段 A — 脚手架（阻塞后续）

- 加依赖：`electron-vite`、`@vitejs/plugin-react`、`vite`、`electron@42.5.0`、`antd`、`react` 已有。
- `electron.vite.config.ts`：
  - main: `src/main/index.ts`
  - preload ×3
  - renderer 三入口：`src/renderer`、`src/island`、`src/taskbar`
  - externalize：`better-sqlite3`、`koffi`、`electron`
- `src/main/index.ts` **第一刀允许桥接**：
  - 自己创建 BrowserWindow，`loadURL` 走 electron-vite 的 renderer
  - 未重写的 IPC 暂时 `require('./vendor/main-Ww-handlers')` 或继续 load 旧包里已注册的 handler
  - 更稳的第一刀：新 main 只负责窗口 + 加载新 renderer；IPC 仍 `require` 一份从 `work/asar/dist-electron/main-Ww_YgTyR.js` 拷来的 vendor（标 `DO NOT EDIT`）
- `src/renderer/main.tsx`：KAZAM 壳（Titlebar + Sidebar + 空主区 + PlayerBar），设置/主题用已有 `theme.ts`。
- scripts：`dev` = `electron-vite dev`，`build` = `electron-vite build`。
- 验收：`npx electron-vite build` 退出码 0；dev 能出窗口且标题 KAZAM。

### 阶段 B — 合同冻结

- 从 `recovered/mainProcess/deobfuscated.js` 抽出 `ipcMain.handle/on` 清单，对照 `src/shared/electron-api.d.ts`，缺的补类型。
- 写出 `src/main/ipc/channels.ts`（channel 字符串常量）。
- SQLite 表结构从 main-Ww 的 `CREATE TABLE` / `PRAGMA` 抠到 `src/main/db.ts` 注释 + 类型。
- 验收：类型文件与 preload 无 drift；清单写入 `kazam/docs/ipc-map.md`。

### 阶段 C — 按页搬 renderer（可并行）

对照 `recovered/<Page>/deobfuscated.js`，**重写**为有名字的 TSX，禁止把 200KB Settings 整文件粘进 src。

并行页（互不依赖）：

| 页 | 对照 | 最低可用 |
|---|---|---|
| SearchPage | recovered/SearchPage | 搜索框 + 结果列表 + 点播放回调 |
| DownloadPage | recovered/DownloadPage | 列表 + 进度占位 |
| RecommendFeedPage | recovered/RecommendFeedPage | 卡片栅格 |
| RecognizePage | recovered/RecognizePage | 入口 UI（指纹可后接 afp） |
| MvPlayerPage | recovered/MvPlayerPage | 播放器壳 |
| CollectionDetailPage | recovered/CollectionDetailPage | 歌单头图 + 曲目表 |
| SettingsPage | recovered/SettingsPage | **重写分组**（外观主题/LX/缓存清理/任务栏），丢掉 chunk 里的 antd 内部 |

共用：`stores/settings.ts`（`m7.settings.v1` + `resolveTheme`）、`components/TrackRow.tsx`。

antd 用 npm 的 `antd`，不要从 recovered 里带 Radio 实现。

验收：各页 `tsc` 过；路由能切到该页；主题 class/`data-theme` 生效。

### 阶段 D — 壳与播放（主渲染核心）

从 `recovered/mainRenderer/deobfuscated.js` 抠行为，写成：

- `Titlebar.tsx`（设置、主题 ☀/☾、岛/任务栏开关；无登录）
- `Sidebar.tsx`（推荐/搜索/本地下载/歌单）
- `PlayerBar.tsx` + `DetailPanel.tsx`（展开页）
- `stores/player.ts`（队列、playUrl、空 URL 禁止入队）
- 歌词：优先 `@applemusic-like-lyrics/react`，白日模式 `mix-blend-mode:normal` + `--amll-lp-color:#1a1a2e`

验收：点一首有 URL 的歌能出进度条；无 URL toast；展开页浅色歌词可读。

### 阶段 E — 岛 / 任务栏

- 把 `recovered/island`、`recovered/taskbar` 收成 `src/island/main.tsx`、`src/taskbar/main.tsx`
- 读同一 `m7.settings.v1` 的 theme
- 任务栏位置：默认 right、宽 280，避开任务栏图标（对照旧 nF/k_ 逻辑，后迁 koffi）

### 阶段 F — 主进程拆分

按模块从 `recovered/mainProcess` 往 `src/main/` 搬，每搬一块就删 vendor 里对应 IPC：

1. 窗口 + 单例 + 协议 `local-music://` `webdav-music://`
2. `db.ts` + 播放/收藏/歌单 persist
3. `lxSandboxWorker` + `lx:musicUrl`
4. `scanWorker` + 本地元数据
5. 下载 / 缓存清理（`cache:clear`）
6. 岛窗口
7. 任务栏 + koffi（最后，native 最容易炸）

`better-sqlite3` / `koffi` 必须按 Electron 42 ABI，可继续用 `work/app/resources/app.asar.unpacked`。

### 阶段 G — 打包与退役补丁管线

- `electron-vite build` + 现有 `dist-portable.mjs` 改成吃 vite 输出
- 停用「往 work/asar hashed 文件注入」作为主路径（`compile.mjs` 仅保留到 F 完成）
- `npm test` 改为测 `src/` 与 build 产物

---

## 3. 行为必须带进源码（不要再补丁）

- `Rn`/`Hf`/`MC` 恒 true；插件 `id()` 空操作
- 无登录墙、无 onboarding
- 默认任务栏 `position:"right"`，宽 280
- 空 `playUrl` 不入队
- 主题 `dark|light|system`，浅色奶油 + 墨字，AMLL 禁止 `plus-lighter`
- 产品名 KAZAM；`package.json` name 暂留 `gz-music` 以免换 `%AppData%`

---

## 4. 风险

| 风险 | 对策 |
|---|---|
| Settings recovered 混了 antd | 重写，不整文件搬运 |
| main-Ww 2MB vendor+业务 | 桥接 vendor，按 IPC 一块块替换 |
| koffi / better-sqlite3 ABI | externalize + unpacked |
| 一次重写 8 万行渲染 | 阶段 A 先出壳，C/D 分页 |
| 并行改同一文件 | workflow 按页分文件，禁止两人改 App.tsx |

---

## 5. Workflow 映射

`kazam-source-rebuild`：

1. **Scaffold** — 一个 agent：electron-vite 配置 + 壳窗口 + vendor 桥
2. **Contract** — 只读抽 IPC/DB
3. **Pages** — 并行 6 页 TSX（Settings 单独一个，因为要重写）
4. **Shell** — Titlebar/Sidebar/Player/Detail
5. **Overlay** — island + taskbar
6. **Verify** — `electron-vite build` + `tsc` + 现有 theme/preload 测试

本计划允许第一轮只完成 A+B+C 的最小页 + 能 `electron-vite build`。后续同一 workflow 再跑或 resume 做 D–G。
