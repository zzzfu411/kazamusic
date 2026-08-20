# KAZAM IPC map

对照来源（只读）：

- `kazam/recovered/mainProcess/deobfuscated.js` — `ipcMain.handle` / `ipcMain.on` / `webContents.send`
- `kazam/src/shared/electron-api.d.ts` — `ElectronAPI`
- `kazam/src/preload/index.ts`（及 `work/asar/dist-electron/preload.js`）— 主窗 channel 字符串
- `kazam/src/preload/island.ts` / `taskbar.ts` — 覆盖窗专用 channel（不在 `ElectronAPI` 上）

约定：

- **invoke** = `ipcRenderer.invoke` ↔ `ipcMain.handle`（有返回值）
- **send** = `ipcRenderer.send` ↔ `ipcMain.on`（无返回值）
- **sendSync** = `ipcRenderer.sendSync` ↔ `ipcMain.on` + `event.returnValue`
- **push** = `webContents.send` ↔ `ipcRenderer.on`（主进程 → 渲染）
- 归属是阶段 F 拆 vendor 时的目标文件，见 `PLAN-ELECTRON-VITE.md`。尚未落地的文件标「later」。
- 形状以 recovered main 为准；`ElectronAPI` 仍大量是 `unknown`。

---

## 1. ElectronAPI 通道（主窗 preload）

这些会出现在 `src/main/ipc/channels.ts`。

### 1.1 窗口 / 电源 / 应用壳

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `window:minimize` | send | `minimize()` | — | — | `src/main/index.ts` |
| `window:maximize` | send | `maximize()` | — | — | `src/main/index.ts` |
| `window:close` | send | `close()` | — | 托盘开启时 hide，否则 close | `src/main/index.ts` |
| `power:acquire` | send | `powerSaveBlocker.acquire()` | — | `prevent-display-sleep` | `src/main/index.ts` |
| `power:release` | send | `powerSaveBlocker.release()` | — | — | `src/main/index.ts` |
| `app:set-background-throttling` | invoke | `setBackgroundThrottling(on)` | `boolean` | `undefined` | `src/main/index.ts` |
| `app:get-memory-info` | invoke | `getMemoryInfo()` | — | `app.getAppMetrics()` | `src/main/index.ts` |
| `app:visibility-changed` | push | `onAppVisibility(cb)` | — | `{ visible: boolean }` | `src/main/index.ts` |
| `app:getInfo` | invoke | `getAppInfo()` | — | `{ version, electron, node, chrome }` | `src/main/ipc/app.ts` |
| `app:getLogInfo` | invoke | `getLogInfo()` | — | `{ logDir, currentLogFile, userDataDir }` | `src/main/ipc/app.ts` |
| `app:log` | invoke | `writeAppLog(level, tag, msg)` | `level: "info"\|"warn"\|"error"`, `tag` ≤64, `msg` | `undefined` | `src/main/ipc/app.ts` |
| `app:openLogDir` | invoke | `openLogDir()` | — | `{ ok, logDir, error? }` | `src/main/ipc/app.ts` |
| `app:openExternal` | invoke | `openExternal(url)` | `https?://` 才打开 | `undefined` | `src/main/ipc/app.ts` |
| `app:checkForUpdates` | invoke | `checkForUpdates()` | — | `{ code: 0, data: { has_update: false } }`（当前恒无更新） | `src/main/updater.ts` |

### 1.2 对话框

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `dialog:openFiles` | invoke | `openFiles()` | — | `string[]`（取消 → `[]`） | `src/main/ipc/dialog.ts` |
| `dialog:openFolder` | invoke | `openFolder()` | — | `string \| null` | `src/main/ipc/dialog.ts` |
| `dialog:selectImage` | invoke | `selectImage()` | — | `data:<mime>;base64,...` 或 `null` | `src/main/ipc/dialog.ts` |
| `dialog:selectVideo` | invoke | `selectVideo()` | — | 文件路径或 `null` | `src/main/ipc/dialog.ts` |

### 1.3 本地库 / 扫描

扫描进度 payload：`{ phase: "collecting"\|"parsing", current, total, message? }`。

`opts` 可见字段：`{ minDurationSec?: number }`。

扫描条目至少含 `filePath`、`duration`（再经 `OT` 按时长过滤）。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `local:scanFolder` | invoke | `scanFolder(path, opts?)` | `path: string`, `opts?` | 扫描条目数组；非法 path → `[]` | `src/main/scan.ts` |
| `local:scanFolders` | invoke | `scanFolders(paths, opts?)` | `string[]`, `opts?` | 同上 | `src/main/scan.ts` |
| `local:readFiles` | invoke | `readFiles(paths)` | `string[]` | 同上 | `src/main/scan.ts` |
| `local:cancelScan` | invoke | `cancelScan()` | — | `true` | `src/main/scan.ts` |
| `local:scanProgress` | push | `onScanProgress(cb)` | — | 见上 progress | `src/main/scan.ts` |
| `local:getScanRoots` | invoke | `getLocalScanRoots()` | — | `Je.local.scanRoots` | `src/main/scan.ts` |
| `local:saveScanRoots` | invoke | `saveLocalScanRoots(roots)` | `unknown[]` | 写入后的 `scanRoots` | `src/main/scan.ts` |
| `local:getDurationFilter` | invoke | `getDurationFilter()` | — | `number \| null` | `src/main/scan.ts` |
| `local:setDurationFilter` | invoke | `setDurationFilter(value)` | `number \| null`；`>0` 才保存 | `number \| null` | `src/main/scan.ts` |
| `local:getFileMetadata` | invoke | `getLocalFileMetadata(path)` | `string` | metadata 对象或 `null`（见下） | `src/main/scan.ts` |
| `local:getFileLyrics` | invoke | `getLocalFileLyrics(path)` | `string` | 内嵌或 sidecar 歌词文本 / `null` | `src/main/scan.ts` |
| `local:getFileLyricsDetailed` | invoke | `getLocalFileLyricsDetailed(path)` | `string` | `{ embedded, sidecar }` 或 `null` | `src/main/scan.ts` |
| `local:fileExists` | invoke | `localFileExists(path)` | `string` | `boolean` | `src/main/scan.ts` |
| `local:getFileMtimes` | invoke | `getFileMtimes(paths)` | `string[]` | `{ [path]: mtimeMs }` | `src/main/scan.ts` |
| `local:writeCover` | invoke | `writeCover(path, data)` | `path`, `data: string`（data URL） | `{ filename, embedded }` 或 `null` | `src/main/scan.ts` |
| `local:validateCovers` | invoke | `validateCovers(items)` | `{ id, filePath, coverFilename }[]` | `{ id, coverFilename: string\|null }[]`（仅缺失封面） | `src/main/scan.ts` |

`local:getFileMetadata` 成功时：

```
{
  filePath, fileName, fileSize, modifiedAt,
  title, artist, album, albumArtist, year, genre[],
  trackNumber, discNumber, composer, comment, duration,
  format, container, codec, bitrate, sampleRate, channels, bitsPerSample,
  hasEmbeddedCover, coverDataUrl,
  embeddedLyrics, sidecarLyrics, lyricsSource: "both"|"embedded"|"sidecar"|"none",
  extraTags: { label, value }[]
}
```

`getLocalUrl` **不是 IPC**：preload 拼 `local-music://f/<encodeURIComponent(path)>`。协议 handler 仍归 `src/main/scan.ts` / `src/main/index.ts`。

### 1.4 媒体键 / 托盘

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `media:toggle` | push | `onMediaCommand` → `"toggle"` | — | — | `src/main/index.ts` |
| `media:next` | push | → `"next"` | — | — | `src/main/index.ts` |
| `media:previous` | push | → `"previous"` | — | — | `src/main/index.ts` |
| `media:stop` | push | → `"stop"` | — | — | `src/main/index.ts` |
| `update-tray-state` | send | `updateTrayState(state)` | `{ song?, isPlaying?, isLiked?, playMode? }` 与默认 `{ song:null, isPlaying:false, isLiked:false, playMode:"sequence" }` 合并 | — | `src/main/tray.ts` |
| `tray-control` | push | `onTrayControl(cb)` | — | `"mode:sequence"\|"mode:shuffle"\|"mode:repeat-all"\|"mode:repeat-one"\|"openSettings"` | `src/main/tray.ts` |

### 1.5 平台 HTTP 代理（网易 / QQ / 酷狗 / 酷我 / soda）

`en()` 类 GET/POST 成功返回 **UTF-8 响应体字符串**，失败/超时返回 `""`。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `netease:post` | invoke | `neteasePost(url, body?, headers?)` | 有 body → POST，否则 GET | `string` | `src/main/ipc/providers.ts` |
| `netease:qr-post` | invoke | `neteaseQrPost(url, body?, headers?)` | `url`, body 字符串, `Content-Type` | `` `${body}\\n${set-cookie}` ``；错误 `` `{"code":-1}\\n` `` | `src/main/ipc/providers.ts` |
| `netease:eapi` | invoke | `neteaseEapi(path, data)` | `path`（`/eapi/...`）, `data` 明文 | `string` | `src/main/ipc/providers.ts` |
| `netease:redirect` | invoke | `neteaseRedirect(url, headers?)` | `url`, 额外 headers | 301/302 `Location` 或 `""` | `src/main/ipc/providers.ts` |
| `qq:get` | invoke | `qqGet(url, headers?)` | `headers` 是 **JSON 字符串** | `string` | `src/main/ipc/providers.ts` |
| `qq:post` | invoke | `qqPost(url, body?, headers?)` | 同上 | `string` | `src/main/ipc/providers.ts` |
| `qq:fetch-qr` | invoke | `fetchQQQrImage(url)` | `url` | JSON 字符串 `{ base64, cookies }` | `src/main/ipc/providers.ts` |
| `qq:get-cookie-value` | invoke | `qqGetCookieValue(url, name)` | `url`, cookie 名 | 值或 `""` | `src/main/ipc/providers.ts` |
| `qq:fetch-redirect-cookies` | invoke | `qqFetchRedirectCookies(url, headers?)` | `url`, 初始 Cookie 字符串 | 合并后 `"k=v; ..."` | `src/main/ipc/providers.ts` |
| `qq:extract-wx-cookies` | invoke | `qqExtractWxCookies(url)` | API 标 `url: string`；main 按 **对象** 读 `musicid/musickey/openid/unionid` 等 | `"musicid=...; musickey=..."` | `src/main/ipc/providers.ts` |
| `kugou:get` | invoke | `kugouGet(url, cookie?)` | `url`, Cookie 字符串 | `string` | `src/main/ipc/providers.ts` |
| `kugou:login-get` | invoke | `kugouLoginGet(url, extra?)` | `url`, 额外 Cookie 串 | `string` | `src/main/ipc/providers.ts` |
| `kugou:post` | invoke | `kugouPost(url, body?, headers?, extra?)` | `headers` 实际当 Content-Type；`extra` 当 Cookie | `string` | `src/main/ipc/providers.ts` |
| `kugou:extract-cookies` | invoke | `kugouExtractCookies(url)` | `url` | **preload 有、recovered main 无 handler** | `src/main/ipc/providers.ts` |
| `kugou:device-cookies` | invoke | `kugouGetDeviceCookies()` | — | `"KUGOU_API_GUID=...; ..."` | `src/main/ipc/providers.ts` |
| `kugou:resolve-short-link` | invoke | `kugouResolveShortLink(url)` | `url` | 最终 URL（失败回原 URL） | `src/main/ipc/providers.ts` |
| `kuwo:get` | invoke | `kuwoGet(url)` | `url` | `string` | `src/main/ipc/providers.ts` |
| `kuwo:searchKey` | invoke | `kuwoSearchKey(key)` | `string` | `string[]`（建议词） | `src/main/ipc/providers.ts` |
| `soda:decrypt` | invoke | `sodaDecrypt(a, b, c)` | `url`, auth/base64 key, `trackId` | `"soda://<id>.mp4"` | `src/main/ipc/providers.ts` |
| `fetch:image` | invoke | `fetchImage(url)` | `url` | `data:<mime>;base64,...` 或 `""` | `src/main/ipc/assets.ts` |
| `bg:loadDefault` | invoke | `loadDefaultBg()` | — | `data:image/jpeg;base64,...` 或 `""` | `src/main/ipc/assets.ts` |

### 1.6 SQLite / `db:*`

表结构见第 4 节。handler 名即 channel。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `db:savePlayback` | invoke | `dbSavePlayback(state)` | `{ trackId?, trackJson?, position?, volume?, queueIds?, queueIndex?, flush? }` | `undefined` | `src/main/db.ts` |
| `db:flush` | invoke | `dbFlush()` | — | `undefined`（`wal_checkpoint(PASSIVE)`） | `src/main/db.ts` |
| `db:getPlayback` | invoke | `dbGetPlayback()` | — | `{ track_id, track_json, position, volume, updated_at, queue_ids, queue_index }` 或 `undefined` | `src/main/db.ts` |
| `db:saveFavorites` | invoke | `dbSaveFavorites(ids)` | API 名 `ids`；main 要 `{ track_id, created_at }[]`（整表替换） | `undefined` | `src/main/db.ts` |
| `db:loadFavorites` | invoke | `dbLoadFavorites()` | — | `{ track_id, created_at }[]` | `src/main/db.ts` |
| `db:saveRecentHistory` | invoke | `dbSaveRecentHistory(ids)` | `{ track_id, played_at }[]`（整表替换） | `undefined` | `src/main/db.ts` |
| `db:loadRecentHistory` | invoke | `dbLoadRecentHistory()` | — | `{ recentIds: string[], recentPlayedAt: Record<string,string> }` | `src/main/db.ts` |
| `db:saveTrackCache` | invoke | `dbSaveTrackCache(tracks)` | **JSON 字符串**，parse 后为 `{ id, source?, ... }[]` | `undefined` | `src/main/db.ts` |
| `db:upsertTrackCache` | invoke | `dbUpsertTrackCache(track)` | 同样 `JSON.parse` 后走同一 `$8`（应按数组字符串传） | `undefined` | `src/main/db.ts` |
| `db:loadTrackCache` | invoke | `dbLoadTrackCache(opts?)` | 额外 `track_id[]`（总是先装 `local`/`webdav`，在线最多约 800） | 解析后的 track 对象数组 | `src/main/db.ts` |
| `db:loadTracksByIds` | invoke | `dbLoadTracksByIds(ids)` | `string[]` | track 对象数组 | `src/main/db.ts` |
| `db:deleteTrackCache` | invoke | `dbDeleteTrackCache(id)` | `string` | `undefined` | `src/main/db.ts` |
| `db:savePlaylists` | invoke | `dbSavePlaylists(lists)` | **JSON 字符串** `{ id, name, trackIds, createdAt?, sourceType?, sourceId?, coverUrl? }[]` | `undefined` | `src/main/db.ts` |
| `db:loadPlaylists` | invoke | `dbLoadPlaylists()` | — | `{ id, name, trackIds, createdAt, sourceType?, sourceId?, coverUrl? }[]` | `src/main/db.ts` |
| `db:saveDownloads` | invoke | `dbSaveDownloads(items)` | **JSON 字符串** `{ id, downloadStatus?, downloadedFilePath?, ...track }[]` | `undefined` | `src/main/db.ts` |
| `db:loadDownloads` | invoke | `dbLoadDownloads()` | — | track 数组；`downloading`/`queued` 读出改成 `failed` | `src/main/db.ts` |

### 1.7 设置 / 缓存 / 数据目录

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `settings:update` | invoke | `settingsUpdate(patch)` | `{ general?: Partial<{ cacheDir, dataDir, dataDirMode, trayEnabled, ... }> }` | `undefined` | `src/main/ipc/settings.ts` |
| `cache:getStats` | invoke | `cache.getStats()` | — | `{ trackCache:{count,size}, audioCache:{count,size}, cacheDir }` | `src/main/cache.ts` |
| `cache:clear` | invoke | `cache.clear(scope?)` | `"track"\|"audio"\|"http"\|"all"` | `true` | `src/main/cache.ts` |
| `cache:openDir` | invoke | `cache.openDir()` | — | 缓存目录路径 | `src/main/cache.ts` |
| `cache:selectDir` | invoke | `cache.selectDir()` | — | 路径或 `null` | `src/main/cache.ts` |
| `data:getDir` | invoke | `data.getDir()` | — | userData / portable / custom 根 | `src/main/cache.ts` |
| `data:selectDir` | invoke | `data.selectDir()` | — | 路径或 `null` | `src/main/cache.ts` |

### 1.8 下载

preload 把 `downloadResume(item)` **映射到 `download:start`**，不走 `download:resume`。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `download:start` | invoke | `downloadStart` / `downloadResume` | `{ id, url, title, artist, downloadDir, nameFormat?, metadata?, embedMetadata?, sidecar? }` | `{ ok, filePath? }` 或 `{ ok:false, error }` | `src/main/download.ts` |
| `download:pause` | invoke | `downloadPause(id)` | `id: string` | `{ ok: true }` | `src/main/download.ts` |
| `download:remove` | invoke | `downloadRemove(id)` | `id: string` | `{ ok: true }` | `src/main/download.ts` |
| `download:progress` | push | `onDownloadProgress` | — | `{ id, progress?, receivedBytes?, totalBytes?, speed?, status?, error? }` | `src/main/download.ts` |
| `download:complete` | push | `onDownloadComplete` | — | `{ id, filePath }` | `src/main/download.ts` |

### 1.9 听歌识曲

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `system-audio:get-default-source-id` | invoke | `getDefaultScreenSourceId()` | — | desktopCapturer 第一个 screen `id` 或 `""` | `src/main/recognize.ts` |
| `recognize-song` | invoke | `recognizeSong(fp, duration)` | 包装为 `{ fp, duration }` | 网易 match JSON 或 `null` | `src/main/recognize.ts` |

### 1.10 灵动岛 / 歌词同步（主窗侧）

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `island:set-enabled` | invoke | `island.setEnabled(on)` | `boolean` | `true` | `src/main/island.ts` |
| `island:set-always-on-top` | invoke | `island.setAlwaysOnTop(on)` | `boolean` | `true` | `src/main/island.ts` |
| `island:publish` | send | `island.publish(state)` | snapshot：`generation`, `currentTime`, `duration`, `playback`, `lyric.lineIndex`, `toast?`, `track?` | 转发给岛窗 `island:snapshot` 或 `island:tick` | `src/main/island.ts` |
| `island:publish-tick` | send | `island.publishTick(tick)` | `{ generation, currentTime, duration }` | 转 `island:tick` | `src/main/island.ts` |
| `island:remote-command` | push | `island.onRemoteCommand` | — | 岛窗发来的 `cmd`（`{ type }` 等） | `src/main/island.ts` |
| `lyric-sync:bind-session` | send | `lyricSync.bindSession(s)` | session（含 `generation`） | — | `src/main/island.ts` |
| `lyric-sync:bind-transport` | send | `lyricSync.bindTransport(t)` | `{ generation, currentTime, playback, duration }` | — | `src/main/island.ts` |
| `lyric-sync:clock` | send | `lyricSync.clock(c)` | 同上；generation 须匹配 | — | `src/main/island.ts` |
| `lyric-sync:reset` | send | `lyricSync.reset()` | — | — | `src/main/island.ts` |

### 1.11 SMTC watchdog

仅 `win32` 注册 handle。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `smtc-watchdog-start` | invoke | `smtcWatchdog.start()` | — | `true` | `src/main/smtc.ts` |
| `smtc-watchdog-stop` | invoke | `smtcWatchdog.stop()` | — | `true` | `src/main/smtc.ts` |
| `smtc-preempted` | push | `smtcWatchdog.onPreempted` | — | `{ currentApp: string }` | `src/main/smtc.ts` |

### 1.12 M7 账号

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `m7:login` | invoke | `m7Login(user, pass)` | username, password | `n.data`（含 `token`）；`code!==0` throw | `src/main/m7.ts` |
| `m7:register` | invoke | `m7Register(user, pass, email, code)` | 四参 | 同上 | `src/main/m7.ts` |
| `m7:sendCode` | invoke | `m7SendCode(email, purpose?)` | `purpose` 默认 `"register"` | `true` | `src/main/m7.ts` |
| `m7:getToken` | invoke | `m7GetToken()` | — | `string \| null` | `src/main/m7.ts` |
| `m7:getMe` | invoke | `m7GetMe()` | — | `/auth/me` 的 `data` | `src/main/m7.ts` |
| `m7:clearToken` | invoke | `m7ClearToken()` | — | `true` | `src/main/m7.ts` |
| `m7:reportTrack` | invoke | `m7ReportTrack()` | 无参；body 用 device/platform/version | `true`/`false` | `src/main/m7.ts` |
| `m7:getDeviceId` | invoke | `m7GetDeviceId()` | — | UUID 字符串 | `src/main/m7.ts` |

### 1.13 更新器

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `app:update:setFeedURL` | invoke | `updater.setFeedURL(url)` | `string` | `{ ok: true }` | `src/main/updater.ts` |
| `app:update:download` | invoke | `updater.download()` | — | `{ ok: true }`（当前 download 体为空操作） | `src/main/updater.ts` |
| `app:update:install` | invoke | `updater.install()` | — | `{ ok: true }` | `src/main/updater.ts` |
| `app:update:isDownloaded` | invoke | `updater.isDownloaded()` | — | `{ downloaded: boolean }` | `src/main/updater.ts` |
| `update:progress` | push | `updater.onProgress` | — | `{ percent, transferred, total, bytesPerSecond }` | `src/main/updater.ts` |
| `update:downloaded` | push | `updater.onDownloaded` | — | 无 payload | `src/main/updater.ts` |
| `update:error` | push | `updater.onError` | — | `{ message }` | `src/main/updater.ts` |

### 1.14 在线插件

`plugin:canPlayOnline` 当前恒 `true`。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `plugin:getStatus` | invoke | `plugin.getStatus()` | — | 见下 status | `src/main/plugin.ts` |
| `plugin:refresh` | invoke | `plugin.refresh()` | — | 同上 | `src/main/plugin.ts` |
| `plugin:import` | invoke | `plugin.import()` | 文件对话框 `.gzplugin` | status 或 `null`（取消） | `src/main/plugin.ts` |
| `plugin:remove` | invoke | `plugin.remove()` | — | 清空后的 status | `src/main/plugin.ts` |
| `plugin:canPlayOnline` | invoke | `plugin.canPlayOnline()` | — | `true` | `src/main/plugin.ts` |

status：

```
{
  displayStatus: "active"|"check_failed"|"expired"|...,
  canPlayOnline: boolean,
  pluginId, fileVersion, lastCheckAt, lastCheckOk, lastCheckError, message
}
```

### 1.15 LX 音源

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `lx:list` | invoke | `lx.list()` | — | script info[]（见 `nb()`） | `src/main/lx.ts` |
| `lx:importFile` | invoke | `lx.importFile()` | 对话框 | `{ ok, info? }` / `{ ok:false, canceled:true }` / `{ ok:false, error }` | `src/main/lx.ts` |
| `lx:importUrl` | invoke | `lx.importUrl(url)` | `http(s)` | 同上 | `src/main/lx.ts` |
| `lx:setEnabled` | invoke | `lx.setEnabled(id, on)` | `id`, `boolean` | info 或 `null` | `src/main/lx.ts` |
| `lx:remove` | invoke | `lx.remove(id)` | `id` | `boolean` | `src/main/lx.ts` |
| `lx:removeAll` | invoke | `lx.removeAll()` | — | 删除数量 `number` | `src/main/lx.ts` |
| `lx:musicUrl` | invoke | `lx.musicUrl(req)` | `{ source, musicInfo, quality?, timeoutMs?, scriptId?, lxQuality? }` | `{ url, scriptName }`；失败 throw | `src/main/lx.ts` |
| `lx:saveTestResults` | invoke | `lx.saveTestResults(id, report)` | `id`, report 对象 | `undefined` | `src/main/lx.ts` |
| `lx:getTestReport` | invoke | `lx.getTestReport()` | — | `Record<scriptId, report>` | `src/main/lx.ts` |

`nb()` info：`{ id, name, description, version, author, homepage, enabled, origin, originUrl, addedAt, status, error, sources, updateAlert, configFields }`。

### 1.16 WebDAV

`webdav.getPlayUrl` **不是 IPC**：preload 拼 `webdav-music://<accountId>/file/<encodeURIComponent(path)>`。

账号对象（`KS`）：`{ id, name, baseUrl, username, rootPath, enabled, allowInsecureTls }`（密码另存，不进 list 明文以外的通道）。

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `webdav:listAccounts` | invoke | `webdav.listAccounts()` | — | account 浅拷贝[] | `src/main/webdav.ts` |
| `webdav:saveAccount` | invoke | `webdav.saveAccount(acc)` | 上列字段 + 可选 `password` | 规范化后的 account | `src/main/webdav.ts` |
| `webdav:deleteAccount` | invoke | `webdav.deleteAccount(id)` | `id` | `true` | `src/main/webdav.ts` |
| `webdav:testConnection` | invoke | `webdav.testConnection(id)` | `id` | `{ ok, error? }` | `src/main/webdav.ts` |
| `webdav:testConnectionDraft` | invoke | `webdav.testConnectionDraft(draft)` | 未保存账号草稿 | `{ ok, error? }` | `src/main/webdav.ts` |
| `webdav:browse` | invoke | `webdav.browse(id, path)` | `id`, remote path | `{ name, path, type:"directory"\|"file", size, lastmod }[]` | `src/main/webdav.ts` |
| `webdav:getScanRoots` | invoke | `webdav.getScanRoots()` | — | `{ accountId, remotePath }[]` | `src/main/webdav.ts` |
| `webdav:saveScanRoots` | invoke | `webdav.saveScanRoots(roots)` | 同上数组 | 写入后的 roots | `src/main/webdav.ts` |
| `webdav:scan` | invoke | `webdav.scan(id, path)` | `id`, path | 远程曲目数组（解析失败目录会 throw） | `src/main/webdav.ts` |
| `webdav:cancelScan` | invoke | `webdav.cancelScan()` | — | `true` | `src/main/webdav.ts` |
| `webdav:getSidecarLyrics` | invoke | `webdav.getSidecarLyrics(id, path)` | `id`, 音频 path | `.lrc` 文本或 `null` | `src/main/webdav.ts` |
| `webdav:scanProgress` | push | `webdav.onScanProgress` | — | `{ phase, current, total, message?, error? }` | `src/main/webdav.ts` |

### 1.17 歌词翻译（DeepSeek）

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `lyrics:hasApiKey` | invoke | `lyrics.hasApiKey()` | — | `boolean` | `src/main/lyrics.ts` |
| `lyrics:saveApiKey` | invoke | `lyrics.saveApiKey(key)` | `string`（空则删文件） | `true` | `src/main/lyrics.ts` |
| `lyrics:testApiKey` | invoke | `lyrics.testApiKey(key)` | `string`；空则用已存 key | `{ ok, error? }` | `src/main/lyrics.ts` |
| `lyrics:translate` | invoke | `lyrics.translate(lines)` | `string[]` | `{ ok:true, translations:string[] }` 或 `{ ok:false, error }` | `src/main/lyrics.ts` |

### 1.18 任务栏（主窗侧）

| Channel | 方向 | ElectronAPI | 请求 | 响应 | 归属 |
|---|---|---|---|---|---|
| `taskbar:set-enabled` | invoke | `taskbar.setEnabled(on)` | `boolean` | `true` | `src/main/taskbar.ts` |
| `taskbar:set-perf-config` | invoke | `taskbar.setPerfConfig(cfg)` | perf 配置对象 | `true` | `src/main/taskbar.ts` |
| `taskbar:set-position` | invoke | `taskbar.setPosition(pos)` | `{ position, offsetX?: number }` | `true` | `src/main/taskbar.ts` |
| `taskbar:set-cover-mode` | invoke | `taskbar.setCoverMode(mode)` | mode | `true` | `src/main/taskbar.ts` |
| `taskbar:set-visualizer-effect` | invoke | `taskbar.setVisualizerEffect(fx)` | fx | `true` | `src/main/taskbar.ts` |
| `taskbar:set-lyric-color-mode` | invoke | `taskbar.setLyricColorMode(mode)` | main 读 `{ mode, color }` | `true` | `src/main/taskbar.ts` |
| `taskbar:set-layout-mode` | invoke | `taskbar.setLayoutMode(mode)` | mode | `true` | `src/main/taskbar.ts` |
| `taskbar:list-monitors` | invoke | `taskbar.listMonitors()` | — | `{ monitors, currentId }` | `src/main/taskbar.ts` |
| `taskbar:set-monitor` | invoke | `taskbar.setMonitor(id)` | `number`，否则 `-1` | `dF()` 返回值 | `src/main/taskbar.ts` |
| `taskbar:monitors-changed` | push | `taskbar.onMonitorsChanged` | — | 无 payload | `src/main/taskbar.ts` |
| `taskbar:remote-command` | push | `taskbar.onRemoteCommand` | — | 任务栏 `cmd` | `src/main/taskbar.ts` |
| `taskbar:spectrum-data` | send | `taskbar.sendSpectrumData(data)` | 频谱数组 | 转发给任务栏窗 | `src/main/taskbar.ts` |

---

## 2. 不在 ElectronAPI 上的通道

主窗 `channels.ts` **不要**加这些。拆岛/任务栏/更新器时再各自建常量。

### 2.1 岛窗 preload（`src/preload/island.ts`）

| Channel | 方向 | 形状 | 归属 |
|---|---|---|---|
| `island:get-bootstrap-sync` | sendSync | return `{ snapshot, lyricSession, snapMode }`；失败 `{ snapshot:null, lyricSession:null, snapMode:"free" }` | `src/main/island.ts` |
| `island:command` | send | `cmd`；`type==="focus-main"` 会聚焦主窗；再 push `island:remote-command` | `src/main/island.ts` |
| `island:layout` | send | `{ width, immediate?, generation? }` | `src/main/island.ts` |
| `island:drag-start` / `island:drag-move` / `island:drag-end` | send | — | `src/main/island.ts` |
| `island:get-settings` | invoke | `{ alwaysOnTop, mousePassthrough, opacity, locked }`（`island-window.json`） | `src/main/island.ts` |
| `island:set-passthrough` | invoke | `boolean` → `true` | `src/main/island.ts` |
| `island:snapshot` | push → 岛 | publish 的整包 snapshot | `src/main/island.ts` |
| `island:tick` | push → 岛 | `{ generation, currentTime, duration, lineIndex? }` | `src/main/island.ts` |
| `island:lyric-session` | push → 岛 | lyric session | `src/main/island.ts` |
| `island:snap-mode` | push → 岛 | snap 模式 | `src/main/island.ts` |

### 2.2 任务栏窗 preload（`src/preload/taskbar.ts`）

| Channel | 方向 | 形状 | 归属 |
|---|---|---|---|
| `taskbar:get-bootstrap-sync` | sendSync | `{ snapshot, colors:{...s, cssVars}, lyricSession, coverMode, visualizerEffect, lyricColorMode, lyricColor, layoutMode }` | `src/main/taskbar.ts` |
| `taskbar:snapshot` / `taskbar:tick` | send（主→转发）兼 push | snapshot / tick | `src/main/taskbar.ts` |
| `taskbar:layout` | send | 触发重排 | `src/main/taskbar.ts` |
| `taskbar:move-by` | send | **空实现** | `src/main/taskbar.ts` |
| `taskbar:drag-end` | send | — | `src/main/taskbar.ts` |
| `taskbar:get-colors` | invoke | `{ colors, cssVars }` | `src/main/taskbar.ts` |
| `taskbar:command` | send | `{ type }`；`focus-main` 不转发 | `src/main/taskbar.ts` |
| `taskbar:colors` | push → 栏 | `{ colors, cssVars, lyricColorMode, lyricColor }` | `src/main/taskbar.ts` |
| `taskbar:lyric-session` | push → 栏 | session | `src/main/taskbar.ts` |
| `taskbar:perf-stats` | push → 栏 | `{}` 或 `null` | `src/main/taskbar.ts` |
| `taskbar:cover-mode` / `taskbar:visualizer-effect` / `taskbar:layout-mode` | push → 栏 | 对应 mode | `src/main/taskbar.ts` |
| `taskbar:spectrum-data` | push → 栏 | 与主窗 send 同名，转发给栏窗 | `src/main/taskbar.ts` |

### 2.3 更新器额外 push（preload 未 listen）

| Channel | 方向 | 形状 | 归属 |
|---|---|---|---|
| `update:available` | push | `{ version }` | `src/main/updater.ts` |
| `update:not-available` | push | 无 payload | `src/main/updater.ts` |

### 2.4 main 有 handle、ElectronAPI 没有

| Channel | 说明 | 归属 |
|---|---|---|
| `download:resume` | recovered 里 `ipcMain.emit("download:start")` 的残句；preload 不用它 | `src/main/download.ts` |

---

## 3. 已知合同漂移

1. `kugou:extract-cookies`：preload / `ElectronAPI` 有，recovered `ipcMain.handle` **没有**。
2. `downloadResume` → `download:start`，不是 `download:resume`。
3. `db:saveTrackCache` / `upsert` / `savePlaylists` / `saveDownloads` 在 main 里 `JSON.parse` 第一参，必须传 JSON **字符串**。
4. `dbSaveFavorites` / `dbSaveRecentHistory` 实际要 `{track_id, created_at|played_at}[]`，不是纯 id 数组。
5. `qq:extract-wx-cookies`：类型写 `url: string`，main 当对象读字段。
6. `qq:get` / `qq:post` 的 headers 是 JSON 字符串。
7. `taskbar.setLyricColorMode` 主窗 preload 传整个 `mode`；main 读 `s.mode` / `s.color`。
8. `plugin:canPlayOnline` / `id()` 已放行（`MC()===true`，`id()` 空）。

---

## 4. SQLite：`CREATE TABLE` 与 `db:` handler

初始化：`CH()`，`better-sqlite3`，`PRAGMA journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=5000`。

### 4.1 表

```sql
CREATE TABLE IF NOT EXISTS playback_state (
  id INTEGER PRIMARY KEY,
  track_id TEXT,
  track_json TEXT,
  position REAL DEFAULT 0,
  volume REAL DEFAULT 0.8,
  updated_at TEXT,
  queue_ids TEXT,
  queue_index INTEGER
);

CREATE TABLE IF NOT EXISTS favorites (
  track_id TEXT PRIMARY KEY,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS recent_history (
  track_id TEXT PRIMARY KEY,
  played_at TEXT
);

CREATE TABLE IF NOT EXISTS track_cache (
  track_id TEXT PRIMARY KEY,
  track_json TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS user_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  track_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS downloads (
  track_id TEXT PRIMARY KEY,
  track_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  file_path TEXT,
  updated_at TEXT
);
```

迁移（`PRAGMA table_info` 缺列才 `ALTER`）：

- `playback_state.queue_ids` / `queue_index`
- `user_playlists.metadata`
- `track_cache.source`
- `CREATE INDEX IF NOT EXISTS idx_track_cache_source ON track_cache(source)`
- 若无 `id=1` 行：插入默认 playback（`position=0`, `volume=0.8`）

`sourceType` 合法值：`netease-pl` | `netease-album` | `qq-pl` | `kugou-pl` | `kuwo-pl` | `local-folder`。  
`track_cache.source` 常见：`local` | `webdav` | `online`。

### 4.2 `db:` handler 名（完整）

| Handler | 表 | 内部函数 |
|---|---|---|
| `db:savePlayback` | `playback_state` | `PH` |
| `db:flush` | — | `U8` |
| `db:getPlayback` | `playback_state` | `RH` |
| `db:saveFavorites` | `favorites` | `DH` |
| `db:loadFavorites` | `favorites` | `OH` |
| `db:saveRecentHistory` | `recent_history` | `NH` |
| `db:loadRecentHistory` | `recent_history` | `MH` |
| `db:saveTrackCache` | `track_cache` | `$8` ← `JSON.parse` |
| `db:upsertTrackCache` | `track_cache` | `$8` ← `JSON.parse` |
| `db:loadTrackCache` | `track_cache` | `kH` |
| `db:loadTracksByIds` | `track_cache` | `UH` |
| `db:deleteTrackCache` | `track_cache` | `$H` |
| `db:savePlaylists` | `user_playlists` | `jH` + `SQ` |
| `db:loadPlaylists` | `user_playlists` | `HH` + `wQ` |
| `db:saveDownloads` | `downloads` | `zH` ← `JSON.parse` |
| `db:loadDownloads` | `downloads` | `WH` |

内部、无 IPC：`VH`/`GH` 给 `cache:getStats` / `cache:clear("track"|"all")`；`FH` 关库。

---

## 5. 归属总表（later `src/main/*.ts`）

| 文件 | 管什么 |
|---|---|
| `src/main/index.ts` | 窗口、电源、可见性、throttling、内存、媒体键、协议注册 |
| `src/main/db.ts` | 全部 `db:*` + schema |
| `src/main/scan.ts` | `local:*` + `local-music://` |
| `src/main/webdav.ts` | `webdav:*` + `webdav-music://` |
| `src/main/lx.ts` | `lx:*` + sandbox worker |
| `src/main/download.ts` | `download:*` |
| `src/main/cache.ts` | `cache:*` `data:*` |
| `src/main/island.ts` | `island:*` `lyric-sync:*` |
| `src/main/taskbar.ts` | `taskbar:*` |
| `src/main/tray.ts` | `update-tray-state` `tray-control` |
| `src/main/smtc.ts` | `smtc-*` |
| `src/main/recognize.ts` | `recognize-song` `system-audio:*` |
| `src/main/m7.ts` | `m7:*` |
| `src/main/plugin.ts` | `plugin:*` |
| `src/main/updater.ts` | `app:checkForUpdates` `app:update:*` `update:*` |
| `src/main/lyrics.ts` | `lyrics:*` |
| `src/main/ipc/app.ts` | `app:getInfo` / log / `openExternal` |
| `src/main/ipc/dialog.ts` | `dialog:*` |
| `src/main/ipc/providers.ts` | netease/qq/kugou/kuwo/soda |
| `src/main/ipc/assets.ts` | `fetch:image` `bg:loadDefault` |
| `src/main/ipc/settings.ts` | `settings:update` |
| `src/main/ipc/channels.ts` | 仅 ElectronAPI 字符串常量 |
