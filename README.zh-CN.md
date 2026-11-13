# KAZAM

基于 Electron、React 与 TypeScript 构建的 Windows x64 桌面音乐播放器：支持多平台曲库搜索、LX 自定义音源沙箱、逐字歌词与桌面灵动岛歌词。

[English](README.md) · 简体中文

| 白日模式 | 暗色模式 |
| --- | --- |
| ![白日模式](docs/preview.png) | ![暗色模式](docs/ui-preview-dark.png) |

## 核心特性

- **多平台曲库检索** — 在同一界面内搜索网易云音乐、QQ 音乐、酷我音乐与酷狗音乐的单曲、歌单与榜单。
- **混合音源路由** — 结合内置 `eapi` 解析与独立沙箱运行的 LX 自定义音源脚本，支持智能回退、优先与独占三种音源策略。
- **逐字歌词与沉浸视图** — 基于 `@applemusic-like-lyrics`（AMLL）渲染全屏逐字歌词与封面音频频谱，内置奶油白日与暗色海军双主题。
- **本地曲库与云端挂载** — 支持本地目录扫描、WebDAV 曲库直连播放、听歌识曲、分片下载及 SQLite 歌单收藏持久化（数据目录沿用 `%AppData%\Roaming\gz-music`，兼容已有安装数据）。
- **Windows 桌面集成** — 提供桌面悬浮灵动岛歌词胶囊、任务栏内嵌播放条，以及系统媒体控制中心（SMTC）与全局媒体键支持。

## 快速开始

环境要求：**Windows 10/11（x64）**、**Node.js 20+**。

```bash
git clone https://github.com/zzzfu411/kazamusic.git
cd kazamusic
npm install
npm run dev
```

打包免安装便携版（输出至 `release/KAZAM-win32-x64/KAZAM.exe`）：

```bash
npm run dist:exe
```

`npm run dev`、`npm run build:vite` 与 `npm run dist:exe` 均走第一方 `src/` + `electron-vite` 构建管线；`npm run build` 仍保留旧版 `asar` 注入管线。

## 开发与目录结构

```bash
npm run typecheck   # TypeScript 类型检查
npm run build:vite  # 构建 main / preload / renderer 产物至 out/
npm test            # 构建产物与主题注入回归检查
```

```text
src/
├── main/      Electron 主进程入口与 vendor IPC 桥接
├── preload/   主窗口、灵动岛与任务栏的预加载隔离桥
├── renderer/  React 界面、主题样式、搜索页与 AMLL 歌词播放器
├── island/    桌面悬浮灵动岛歌词窗口入口
├── taskbar/   Windows 任务栏内嵌播放条入口
└── shared/    跨进程共享的主题解析、版本元数据与插件状态定义
scripts/       编译、便携打包与 CDP 界面检查脚本
```

- [docs/brand.md](docs/brand.md) — 视觉定位、配色方案与字体规范
- [docs/ipc-map.md](docs/ipc-map.md) — 主进程与渲染进程 IPC 通道契约
- [docs/rebuild-status.md](docs/rebuild-status.md) — `electron-vite` 迁移进度与模块拆分说明

---

仅供个人学习与自用，请遵守各音乐平台的服务条款。
