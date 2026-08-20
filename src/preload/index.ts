import { contextBridge, ipcRenderer } from "electron";

console.log("[kazam-preload] boot");
import type { ElectronAPI, MediaCommand } from "../shared/electron-api";

function webdavPlayUrl(accountId: string, filePath: string): string {
  const path = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return `webdav-music://${accountId}/file/${encodeURIComponent(path)}`;
}

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: ElectronAPI = {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize") as Promise<boolean>,
  isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
  onMaximizedChange: (cb) => listen("window:maximized-changed", cb),
  close: () => ipcRenderer.send("window:close"),
  powerSaveBlocker: {
    acquire: () => ipcRenderer.send("power:acquire"),
    release: () => ipcRenderer.send("power:release"),
  },
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  selectImage: () => ipcRenderer.invoke("dialog:selectImage"),
  selectVideo: () => ipcRenderer.invoke("dialog:selectVideo"),
  scanFolder: (path, opts) => ipcRenderer.invoke("local:scanFolder", path, opts),
  scanFolders: (paths, opts) => ipcRenderer.invoke("local:scanFolders", paths, opts),
  readFiles: (paths) => ipcRenderer.invoke("local:readFiles", paths),
  cancelScan: () => ipcRenderer.invoke("local:cancelScan"),
  onScanProgress: (cb) => listen("local:scanProgress", cb),
  getLocalUrl: (filePath) => `local-music://f/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`,
  getLocalScanRoots: () => ipcRenderer.invoke("local:getScanRoots"),
  saveLocalScanRoots: (roots) => ipcRenderer.invoke("local:saveScanRoots", roots),
  getDurationFilter: () => ipcRenderer.invoke("local:getDurationFilter"),
  setDurationFilter: (value) => ipcRenderer.invoke("local:setDurationFilter", value),
  getLocalFileMetadata: (path) => ipcRenderer.invoke("local:getFileMetadata", path),
  getLocalFileLyrics: (path) => ipcRenderer.invoke("local:getFileLyrics", path),
  getLocalFileLyricsDetailed: (path) => ipcRenderer.invoke("local:getFileLyricsDetailed", path),
  localFileExists: (path) => ipcRenderer.invoke("local:fileExists", path),
  getFileMtimes: (paths) => ipcRenderer.invoke("local:getFileMtimes", paths),
  writeCover: (path, data) => ipcRenderer.invoke("local:writeCover", path, data),
  validateCovers: (items) => ipcRenderer.invoke("local:validateCovers", items),
  onMediaCommand: (cb) => {
    const cmds = ["media:toggle", "media:next", "media:previous", "media:stop"] as const;
    const bindings = cmds.map((cmd) => {
      const handler = () => cb(cmd.replace("media:", "") as MediaCommand);
      ipcRenderer.on(cmd, handler);
      return { cmd, handler };
    });
    return () => {
      for (const { cmd, handler } of bindings) ipcRenderer.removeListener(cmd, handler);
    };
  },
  neteasePost: (url, body, headers) => ipcRenderer.invoke("netease:post", url, body, headers),
  neteaseQrPost: (url, body, headers) => ipcRenderer.invoke("netease:qr-post", url, body, headers),
  kuwoSearchKey: (key) => ipcRenderer.invoke("kuwo:searchKey", key),
  neteaseEapi: (path, data) => ipcRenderer.invoke("netease:eapi", path, data),
  neteaseRedirect: (url, headers) => ipcRenderer.invoke("netease:redirect", url, headers),
  qqGet: (url, headers) => ipcRenderer.invoke("qq:get", url, headers),
  qqPost: (url, body, headers) => ipcRenderer.invoke("qq:post", url, body, headers),
  fetchQQQrImage: (url) => ipcRenderer.invoke("qq:fetch-qr", url),
  qqGetCookieValue: (url, name) => ipcRenderer.invoke("qq:get-cookie-value", url, name),
  qqFetchRedirectCookies: (url, headers) => ipcRenderer.invoke("qq:fetch-redirect-cookies", url, headers),
  qqExtractWxCookies: (url) => ipcRenderer.invoke("qq:extract-wx-cookies", url),
  kugouGet: (url, cookie) => ipcRenderer.invoke("kugou:get", url, cookie),
  kugouLoginGet: (url, extra) => ipcRenderer.invoke("kugou:login-get", url, extra),
  kugouPost: (url, body, headers, extra) => ipcRenderer.invoke("kugou:post", url, body, headers, extra),
  kugouExtractCookies: (url) => ipcRenderer.invoke("kugou:extract-cookies", url),
  kugouGetDeviceCookies: () => ipcRenderer.invoke("kugou:device-cookies"),
  kugouResolveShortLink: (url) => ipcRenderer.invoke("kugou:resolve-short-link", url),
  kuwoGet: (url) => ipcRenderer.invoke("kuwo:get", url),
  sodaDecrypt: (a, b, c) => ipcRenderer.invoke("soda:decrypt", a, b, c),
  loadDefaultBg: () => ipcRenderer.invoke("bg:loadDefault"),
  fetchImage: (url) => ipcRenderer.invoke("fetch:image", url),
  dbSavePlayback: (state) => ipcRenderer.invoke("db:savePlayback", state),
  dbFlush: () => ipcRenderer.invoke("db:flush"),
  dbGetPlayback: () => ipcRenderer.invoke("db:getPlayback"),
  dbSaveFavorites: (ids) => ipcRenderer.invoke("db:saveFavorites", ids),
  dbLoadFavorites: () => ipcRenderer.invoke("db:loadFavorites"),
  dbSaveRecentHistory: (ids) => ipcRenderer.invoke("db:saveRecentHistory", ids),
  dbLoadRecentHistory: () => ipcRenderer.invoke("db:loadRecentHistory"),
  dbSaveTrackCache: (tracks) => ipcRenderer.invoke("db:saveTrackCache", tracks),
  dbUpsertTrackCache: (track) => ipcRenderer.invoke("db:upsertTrackCache", track),
  dbLoadTrackCache: (opts) => ipcRenderer.invoke("db:loadTrackCache", opts),
  dbLoadTracksByIds: (ids) => ipcRenderer.invoke("db:loadTracksByIds", ids),
  dbDeleteTrackCache: (id) => ipcRenderer.invoke("db:deleteTrackCache", id),
  dbSavePlaylists: (lists) => ipcRenderer.invoke("db:savePlaylists", lists),
  dbLoadPlaylists: () => ipcRenderer.invoke("db:loadPlaylists"),
  settingsUpdate: (patch) => ipcRenderer.invoke("settings:update", patch),
  downloadStart: (item) => ipcRenderer.invoke("download:start", item),
  downloadPause: (id) => ipcRenderer.invoke("download:pause", id),
  downloadResume: (item) => ipcRenderer.invoke("download:start", item),
  downloadRemove: (id) => ipcRenderer.invoke("download:remove", id),
  onDownloadProgress: (cb) => listen("download:progress", cb),
  onDownloadComplete: (cb) => listen("download:complete", cb),
  dbSaveDownloads: (items) => ipcRenderer.invoke("db:saveDownloads", items),
  dbLoadDownloads: () => ipcRenderer.invoke("db:loadDownloads"),
  getDefaultScreenSourceId: () => ipcRenderer.invoke("system-audio:get-default-source-id"),
  recognizeSong: (fp, duration) => ipcRenderer.invoke("recognize-song", { fp, duration }),
  island: {
    setEnabled: (on) => ipcRenderer.invoke("island:set-enabled", on),
    setAlwaysOnTop: (on) => ipcRenderer.invoke("island:set-always-on-top", on),
    publish: (state) => ipcRenderer.send("island:publish", state),
    publishTick: (tick) => ipcRenderer.send("island:publish-tick", tick),
    onRemoteCommand: (cb) => listen("island:remote-command", cb),
  },
  lyricSync: {
    bindSession: (s) => ipcRenderer.send("lyric-sync:bind-session", s),
    bindTransport: (t) => ipcRenderer.send("lyric-sync:bind-transport", t),
    clock: (c) => ipcRenderer.send("lyric-sync:clock", c),
    reset: () => ipcRenderer.send("lyric-sync:reset"),
  },
  updateTrayState: (state) => ipcRenderer.send("update-tray-state", state),
  onTrayControl: (cb) => listen("tray-control", cb),
  smtcWatchdog: {
    start: () => ipcRenderer.invoke("smtc-watchdog-start"),
    stop: () => ipcRenderer.invoke("smtc-watchdog-stop"),
    onPreempted: (cb) => listen("smtc-preempted", cb),
  },
  onAppVisibility: (cb) => listen("app:visibility-changed", cb),
  setBackgroundThrottling: (on) => ipcRenderer.invoke("app:set-background-throttling", on),
  getMemoryInfo: () => ipcRenderer.invoke("app:get-memory-info"),
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  getLogInfo: () => ipcRenderer.invoke("app:getLogInfo"),
  writeAppLog: (level, tag, msg) => ipcRenderer.invoke("app:log", level, tag, msg),
  openLogDir: () => ipcRenderer.invoke("app:openLogDir"),
  m7Login: (user, pass) => ipcRenderer.invoke("m7:login", user, pass),
  m7Register: (user, pass, email, code) => ipcRenderer.invoke("m7:register", user, pass, email, code),
  m7SendCode: (email, purpose) => ipcRenderer.invoke("m7:sendCode", email, purpose),
  m7GetToken: () => ipcRenderer.invoke("m7:getToken"),
  m7GetMe: () => ipcRenderer.invoke("m7:getMe"),
  m7ClearToken: () => ipcRenderer.invoke("m7:clearToken"),
  m7ReportTrack: () => ipcRenderer.invoke("m7:reportTrack"),
  m7GetDeviceId: () => ipcRenderer.invoke("m7:getDeviceId"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  updater: {
    setFeedURL: (url) => ipcRenderer.invoke("app:update:setFeedURL", url),
    download: () => ipcRenderer.invoke("app:update:download"),
    install: () => ipcRenderer.invoke("app:update:install"),
    isDownloaded: () => ipcRenderer.invoke("app:update:isDownloaded"),
    onProgress: (cb) => listen("update:progress", cb),
    onDownloaded: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.removeListener("update:downloaded", handler);
    },
    onError: (cb) => listen("update:error", cb),
  },
  plugin: {
    getStatus: () => ipcRenderer.invoke("plugin:getStatus"),
    refresh: () => ipcRenderer.invoke("plugin:refresh"),
    import: () => ipcRenderer.invoke("plugin:import"),
    remove: () => ipcRenderer.invoke("plugin:remove"),
    canPlayOnline: () => ipcRenderer.invoke("plugin:canPlayOnline"),
  },
  lx: {
    list: () => ipcRenderer.invoke("lx:list"),
    importFile: () => ipcRenderer.invoke("lx:importFile"),
    importUrl: (url) => ipcRenderer.invoke("lx:importUrl", url),
    setEnabled: (id, on) => ipcRenderer.invoke("lx:setEnabled", id, on),
    remove: (id) => ipcRenderer.invoke("lx:remove", id),
    removeAll: () => ipcRenderer.invoke("lx:removeAll"),
    musicUrl: (req) => ipcRenderer.invoke("lx:musicUrl", req),
    saveTestResults: (id, report) => ipcRenderer.invoke("lx:saveTestResults", id, report),
    getTestReport: () => ipcRenderer.invoke("lx:getTestReport"),
  },
  cache: {
    getStats: () => ipcRenderer.invoke("cache:getStats"),
    clear: (scope) => ipcRenderer.invoke("cache:clear", scope),
    openDir: () => ipcRenderer.invoke("cache:openDir"),
    selectDir: () => ipcRenderer.invoke("cache:selectDir"),
  },
  data: {
    getDir: () => ipcRenderer.invoke("data:getDir"),
    selectDir: () => ipcRenderer.invoke("data:selectDir"),
  },
  webdav: {
    listAccounts: () => ipcRenderer.invoke("webdav:listAccounts"),
    saveAccount: (acc) => ipcRenderer.invoke("webdav:saveAccount", acc),
    deleteAccount: (id) => ipcRenderer.invoke("webdav:deleteAccount", id),
    testConnection: (id) => ipcRenderer.invoke("webdav:testConnection", id),
    testConnectionDraft: (draft) => ipcRenderer.invoke("webdav:testConnectionDraft", draft),
    browse: (id, path) => ipcRenderer.invoke("webdav:browse", id, path),
    getScanRoots: () => ipcRenderer.invoke("webdav:getScanRoots"),
    saveScanRoots: (roots) => ipcRenderer.invoke("webdav:saveScanRoots", roots),
    scan: (id, path) => ipcRenderer.invoke("webdav:scan", id, path),
    cancelScan: () => ipcRenderer.invoke("webdav:cancelScan"),
    getPlayUrl: webdavPlayUrl,
    getSidecarLyrics: (id, path) => ipcRenderer.invoke("webdav:getSidecarLyrics", id, path),
    onScanProgress: (cb) => listen("webdav:scanProgress", cb),
  },
  lyrics: {
    hasApiKey: () => ipcRenderer.invoke("lyrics:hasApiKey"),
    saveApiKey: (key) => ipcRenderer.invoke("lyrics:saveApiKey", key),
    testApiKey: (key) => ipcRenderer.invoke("lyrics:testApiKey", key),
    translate: (lines) => ipcRenderer.invoke("lyrics:translate", lines),
  },
  taskbar: {
    setEnabled: (on) => ipcRenderer.invoke("taskbar:set-enabled", on),
    setPerfConfig: (cfg) => ipcRenderer.invoke("taskbar:set-perf-config", cfg),
    setPosition: (pos) => ipcRenderer.invoke("taskbar:set-position", pos),
    setCoverMode: (mode) => ipcRenderer.invoke("taskbar:set-cover-mode", mode),
    setVisualizerEffect: (fx) => ipcRenderer.invoke("taskbar:set-visualizer-effect", fx),
    setLyricColorMode: (mode) => ipcRenderer.invoke("taskbar:set-lyric-color-mode", mode),
    setLayoutMode: (mode) => ipcRenderer.invoke("taskbar:set-layout-mode", mode),
    listMonitors: () => ipcRenderer.invoke("taskbar:list-monitors"),
    setMonitor: (id) => ipcRenderer.invoke("taskbar:set-monitor", id),
    onMonitorsChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("taskbar:monitors-changed", handler);
      return () => ipcRenderer.removeListener("taskbar:monitors-changed", handler);
    },
    onRemoteCommand: (cb) => listen("taskbar:remote-command", cb),
    sendSpectrumData: (data) => ipcRenderer.send("taskbar:spectrum-data", data),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
console.log("[kazam-preload] exposed electronAPI");
