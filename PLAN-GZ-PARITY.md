# 瓜子能力对齐计划

产品路径：`kazam/src` + `npx electron-vite build`（`out/`）。不要改 hashed asar。
视觉：奶油 / 藏青 / 明黄，圆角苹果风，本地 DM Sans，禁止 Google Fonts `@import`。
IPC：`window.electronAPI`（preload 已暴露，vendor 主进程已有实现的优先接线，不要重写主进程）。
不做：推送到手机 GZ（依赖瓜子云账号）。

## 缺口 → 交付

| ID | 能力 | 交付 |
|---|---|---|
| P1 | 详情打开藏底栏，左栏完整播控 | `.app:has(.app-detail.open) .player-dock` 下移隐藏；详情含进度/音量/模式/队列 |
| P2 | 音量 + 静音 | 底栏 + 详情：滑杆、滚轮 ±3%、点图标静音 |
| P3 | 收藏 | `dbLoadFavorites` / `dbSaveFavorites`；底栏/详情星标 |
| P4 | 下载入口 | 底栏/详情调 `downloadStart`，进行中显示进度 |
| P5 | 音质 | 取链 `br` 320k/999k 可切换，详情音质按钮 |
| P6 | Ctrl/Cmd+L | 开关详情 |
| P7 | 封面手势 | 上滑下一首、下滑上一首（阈值 60px） |
| P8 | 逐字歌词 | 解析 yrc 词级时间戳，当前词高亮（无 AMLL 包则 CSS，不阻塞） |
| P9 | 歌词源 | 自动：在线 eapi / 本地 sidecar+内嵌 `getLocalFileLyricsDetailed` / WebDAV `getSidecarLyrics` |
| P10 | lyricSync | `bindSession` + `clock` 跟 `currentTime` |
| P11 | DeepSeek 译词 | 设置 API Key，`lyrics.translate`；详情译文按钮 |
| P12 | 歌词字体 | `appearance.lyricFontFamily`，详情+岛+任务栏 CSS 变量 |
| P13 | 自定义滚动条 | `appearance.customScrollbar` |
| P14 | 主页背景 | auto 封面模糊 / 自定义图 / 纯色 / 视频；`applyVideoToDetail` |
| P15 | 封面频谱 | 详情封面 canvas，WebAudio analyser |
| P16 | SMTC / 媒体键 | `onMediaCommand` + `smtcWatchdog.start` + MediaSession |
| P17 | 相似推荐 | 详情右下入口，eapi simi 歌 |
| P18 | WebDAV UI | 设置页账号/浏览/扫描 |
| P19 | 歌单导入 | 网易/QQ/酷狗/酷我 链接；网易扫码若 IPC 可用则接 |
| P20 | 网易登录 | 设置/用户 扫码或 cookie，用于红心与歌单 |

## 文件所有权（并行，禁止跨组改同一文件）

| Agent | 独占文件 |
|---|---|
| A store-player | `src/renderer/stores/player.ts`, `src/renderer/stores/favorites.ts`（新建） |
| B settings-bg | `src/renderer/stores/settings.ts`, `src/renderer/pages/SettingsPage.tsx`, `src/renderer/shell/HomeBackground.tsx`（新建）, `src/renderer/styles/kazam-theme.css`, `src/renderer/styles/settings-theme.css` |
| C player-ui | `src/renderer/shell/PlayerBar.tsx`, `src/renderer/shell/DetailPanel.tsx`, `src/renderer/styles/app-shell.css` |
| D library | `src/renderer/pages/WebDavPage.tsx`（新建）, `src/renderer/pages/ImportPlaylistDialog.tsx`（新建）, `src/renderer/shell/RelatedPanel.tsx`（新建）, `src/renderer/pages/DownloadPage.tsx`（仅本地扫描入口如需） |
| E desktop | `src/renderer/desktop/media-session.ts`（新建）, `src/renderer/pages/UserCenter.tsx`（新建）, `src/island/main.tsx`, `src/taskbar/main.tsx` |

父进程收尾：`App.tsx` 挂 HomeBackground、media-session、RelatedPanel、WebDAV 路由、Ctrl+L、detail-open 不必改 class（用 `:has`）。

## 验收

`npx electron-vite build` 通过；详情全屏磨砂仍在；音量/收藏/下载/L 键可点；设置能改主页背景与译词 Key。
