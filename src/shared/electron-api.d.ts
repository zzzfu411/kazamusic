export type MediaCommand = "toggle" | "next" | "previous" | "stop";

export interface ElectronAPI {
  minimize: () => void;
  maximize: () => Promise<boolean> | void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
  close: () => void;
  powerSaveBlocker: {
    acquire: () => void;
    release: () => void;
  };
  openFiles: () => Promise<unknown>;
  openFolder: () => Promise<unknown>;
  selectImage: () => Promise<string | undefined>;
  selectVideo: () => Promise<string | undefined>;
  scanFolder: (path: string, opts?: unknown) => Promise<unknown>;
  scanFolders: (paths: string[], opts?: unknown) => Promise<unknown>;
  readFiles: (paths: string[]) => Promise<unknown>;
  cancelScan: () => Promise<unknown>;
  onScanProgress: (cb: (payload: unknown) => void) => () => void;
  getLocalUrl: (filePath: string) => string;
  getLocalScanRoots: () => Promise<unknown>;
  saveLocalScanRoots: (roots: unknown) => Promise<unknown>;
  getDurationFilter: () => Promise<unknown>;
  setDurationFilter: (value: unknown) => Promise<unknown>;
  getLocalFileMetadata: (path: string) => Promise<unknown>;
  getLocalFileLyrics: (path: string) => Promise<unknown>;
  getLocalFileLyricsDetailed: (path: string) => Promise<unknown>;
  localFileExists: (path: string) => Promise<boolean>;
  getFileMtimes: (paths: string[]) => Promise<unknown>;
  writeCover: (path: string, data: unknown) => Promise<unknown>;
  validateCovers: (items: unknown) => Promise<unknown>;
  onMediaCommand: (cb: (cmd: MediaCommand) => void) => () => void;
  neteasePost: (url: string, body?: unknown, headers?: unknown) => Promise<unknown>;
  neteaseQrPost: (url: string, body?: unknown, headers?: unknown) => Promise<unknown>;
  kuwoSearchKey: (key: string) => Promise<unknown>;
  neteaseEapi: (path: string, data: unknown) => Promise<unknown>;
  neteaseRedirect: (url: string, headers?: unknown) => Promise<unknown>;
  qqGet: (url: string, headers?: unknown) => Promise<unknown>;
  qqPost: (url: string, body?: unknown, headers?: unknown) => Promise<unknown>;
  fetchQQQrImage: (url: string) => Promise<unknown>;
  qqGetCookieValue: (url: string, name: string) => Promise<unknown>;
  qqFetchRedirectCookies: (url: string, headers?: unknown) => Promise<unknown>;
  qqExtractWxCookies: (url: string) => Promise<unknown>;
  kugouGet: (url: string, cookie?: string) => Promise<unknown>;
  kugouLoginGet: (url: string, extra?: unknown) => Promise<unknown>;
  kugouPost: (url: string, body?: unknown, headers?: unknown, extra?: unknown) => Promise<unknown>;
  kugouExtractCookies: (url: string) => Promise<unknown>;
  kugouGetDeviceCookies: () => Promise<unknown>;
  kugouResolveShortLink: (url: string) => Promise<unknown>;
  kuwoGet: (url: string) => Promise<unknown>;
  sodaDecrypt: (a: unknown, b: unknown, c: unknown) => Promise<unknown>;
  loadDefaultBg: () => Promise<string | undefined>;
  fetchImage: (url: string) => Promise<unknown>;
  dbSavePlayback: (state: unknown) => Promise<unknown>;
  dbFlush: () => Promise<unknown>;
  dbGetPlayback: () => Promise<unknown>;
  dbSaveFavorites: (ids: unknown) => Promise<unknown>;
  dbLoadFavorites: () => Promise<unknown>;
  dbSaveRecentHistory: (ids: unknown) => Promise<unknown>;
  dbLoadRecentHistory: () => Promise<unknown>;
  dbSaveTrackCache: (tracks: unknown) => Promise<unknown>;
  dbUpsertTrackCache: (track: unknown) => Promise<unknown>;
  dbLoadTrackCache: (opts?: unknown) => Promise<unknown>;
  dbLoadTracksByIds: (ids: string[]) => Promise<unknown>;
  dbDeleteTrackCache: (id: string) => Promise<unknown>;
  dbSavePlaylists: (lists: unknown) => Promise<unknown>;
  dbLoadPlaylists: () => Promise<unknown>;
  settingsUpdate: (patch: unknown) => Promise<unknown>;
  downloadStart: (item: unknown) => Promise<unknown>;
  downloadPause: (id: string) => Promise<unknown>;
  downloadResume: (item: unknown) => Promise<unknown>;
  downloadRemove: (id: string) => Promise<unknown>;
  onDownloadProgress: (cb: (p: unknown) => void) => () => void;
  onDownloadComplete: (cb: (p: unknown) => void) => () => void;
  dbSaveDownloads: (items: unknown) => Promise<unknown>;
  dbLoadDownloads: () => Promise<unknown>;
  getDefaultScreenSourceId: () => Promise<string | undefined>;
  recognizeSong: (fp: unknown, duration: number) => Promise<import("./types").RecognizeSongResponse | null | undefined>;
  island: {
    setEnabled: (on: boolean) => Promise<unknown>;
    setAlwaysOnTop: (on: boolean) => Promise<unknown>;
    publish: (state: unknown) => void;
    publishTick: (tick: unknown) => void;
    onRemoteCommand: (cb: (cmd: unknown) => void) => () => void;
  };
  lyricSync: {
    bindSession: (s: unknown) => void;
    bindTransport: (t: unknown) => void;
    clock: (c: unknown) => void;
    reset: () => void;
  };
  updateTrayState: (state: unknown) => void;
  onTrayControl: (cb: (cmd: unknown) => void) => () => void;
  smtcWatchdog: {
    start: () => Promise<unknown>;
    stop: () => Promise<unknown>;
    onPreempted: (cb: (info: unknown) => void) => () => void;
  };
  onAppVisibility: (cb: (visible: unknown) => void) => () => void;
  setBackgroundThrottling: (on: boolean) => Promise<unknown>;
  getMemoryInfo: () => Promise<unknown>;
  getAppInfo: () => Promise<unknown>;
  getLogInfo: () => Promise<unknown>;
  writeAppLog: (level: string, tag: string, msg: string) => Promise<unknown>;
  openLogDir: () => Promise<unknown>;
  m7Login: (user: string, pass: string) => Promise<unknown>;
  m7Register: (user: string, pass: string, email: string, code: string) => Promise<unknown>;
  m7SendCode: (email: string, purpose?: string) => Promise<unknown>;
  m7GetToken: () => Promise<string | null>;
  m7GetMe: () => Promise<unknown>;
  m7ClearToken: () => Promise<unknown>;
  m7ReportTrack: () => Promise<unknown>;
  m7GetDeviceId: () => Promise<unknown>;
  checkForUpdates: () => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  updater: {
    setFeedURL: (url: string) => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<unknown>;
    isDownloaded: () => Promise<unknown>;
    onProgress: (cb: (p: unknown) => void) => () => void;
    onDownloaded: (cb: () => void) => () => void;
    onError: (cb: (e: unknown) => void) => () => void;
  };
  plugin: {
    getStatus: () => Promise<unknown>;
    refresh: () => Promise<unknown>;
    import: () => Promise<unknown>;
    remove: () => Promise<unknown>;
    canPlayOnline: () => Promise<unknown>;
  };
  lx: {
    list: () => Promise<unknown[]>;
    importFile: () => Promise<unknown>;
    importUrl: (url: string) => Promise<unknown>;
    setEnabled: (id: string, on: boolean) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    removeAll: () => Promise<unknown>;
    musicUrl: (req: unknown) => Promise<unknown>;
    saveTestResults: (id: string, report: unknown) => Promise<unknown>;
    getTestReport: () => Promise<unknown>;
  };
  cache: {
    getStats: () => Promise<unknown>;
    clear: (scope?: unknown) => Promise<unknown>;
    openDir: () => Promise<unknown>;
    selectDir: () => Promise<unknown>;
  };
  data: {
    getDir: () => Promise<unknown>;
    selectDir: () => Promise<unknown>;
  };
  webdav: {
    listAccounts: () => Promise<unknown>;
    saveAccount: (acc: unknown) => Promise<unknown>;
    deleteAccount: (id: string) => Promise<unknown>;
    testConnection: (id: string) => Promise<unknown>;
    testConnectionDraft: (draft: unknown) => Promise<unknown>;
    browse: (id: string, path: string) => Promise<unknown>;
    getScanRoots: () => Promise<unknown>;
    saveScanRoots: (roots: unknown) => Promise<unknown>;
    scan: (id: string, path: string) => Promise<unknown>;
    cancelScan: () => Promise<unknown>;
    getPlayUrl: (accountId: string, filePath: string) => string;
    getSidecarLyrics: (id: string, path: string) => Promise<unknown>;
    onScanProgress: (cb: (p: unknown) => void) => () => void;
  };
  lyrics: {
    hasApiKey: () => Promise<boolean>;
    saveApiKey: (key: string) => Promise<unknown>;
    testApiKey: (key: string) => Promise<unknown>;
    translate: (lines: unknown) => Promise<unknown>;
  };
  taskbar: {
    setEnabled: (on: boolean) => Promise<unknown>;
    setPerfConfig: (cfg: unknown) => Promise<unknown>;
    setPosition: (pos: unknown) => Promise<unknown>;
    setCoverMode: (mode: unknown) => Promise<unknown>;
    setVisualizerEffect: (fx: unknown) => Promise<unknown>;
    setLyricColorMode: (mode: unknown) => Promise<unknown>;
    setLayoutMode: (mode: unknown) => Promise<unknown>;
    listMonitors: () => Promise<unknown[]>;
    setMonitor: (id: unknown) => Promise<unknown>;
    onMonitorsChanged: (cb: () => void) => () => void;
    onRemoteCommand: (cb: (cmd: unknown) => void) => () => void;
    sendSpectrumData: (data: unknown) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    GenerateFP?: (samples: Float32Array) => Promise<string> | string;
  }
}

export {};
