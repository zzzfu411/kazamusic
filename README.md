# KAZAM

桌面音乐播放器。奶油白日 / 暗色海军，圆角苹果风界面。

![KAZAM 白日模式](docs/preview.png)

## 运行

需要 Node.js 20+、Windows x64。

```bash
npm install
npm run dev
```

打包便携版（生成 `release/KAZAM-win32-x64/KAZAM.exe`）：

```bash
npm run dist:exe
```

`npm run dev` / `npm run dist:exe` 走第一方 `src/` + electron-vite。`npm run build` 仍是旧 asar 注入管线。

## 功能

- 搜索：网易 / 酷我 / QQ / 酷狗
- 播放：内置 eapi + LX 自定义音源（智能 / 优先 / 独占）
- 全屏沉浸详情、逐字歌词（AMLL）、封面频谱
- 本地曲库、WebDAV、听歌识曲、下载、收藏
- 灵动岛歌词、任务栏、系统媒体键（SMTC）

应用数据目录仍用 `gz-music`（`%AppData%\Roaming\gz-music`），避免和旧安装冲突。

## 源码

```
src/main/          Electron 主进程 + vendor IPC
src/preload/       主窗 / 灵动岛 / 任务栏
src/renderer/      界面、主题、搜索、播放器
src/island/        桌面歌词胶囊
src/taskbar/       任务栏播放条
scripts/           编译与便携打包
```

## 许可

仅供个人学习与自用。请遵守各音乐平台服务条款。
