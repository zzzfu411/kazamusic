import { useEffect, useState } from "react";
import type { ThemePreference } from "../../shared/theme";
import { themeFromSettings } from "../../shared/theme";
import { applyResolvedTheme } from "../theme-runtime";

export const SETTINGS_KEY = "m7.settings.v1";
export const TASKBAR_DEFAULT_WIDTH = 280;
export const TASKBAR_DEFAULT_POSITION = "right" as const;

export type LxMode = "fallback" | "prefer" | "only";
export type TaskbarPosition = "auto" | "left" | "right" | "custom";
export type IslandLineMode = "dual" | "single";

export type PlayerBgMode = "frosted" | "custom";
export type HomeBgMode = "auto" | "custom" | "color" | "video";
export type HomeBgScope = "global" | "no-cover";
export type LyricSourcePriority = "auto" | "embedded" | "sidecar" | "online";
export type LyricTranslateMode = "manual" | "auto";

export type PlayerBgSettings = {
  mode: PlayerBgMode;
  image: string;
  blur: number;
  overlay: number;
};

export type HomeBgSettings = {
  mode: HomeBgMode;
  image: string;
  color: string;
  videoPath: string;
  blur: number;
  overlay: number;
  scope: HomeBgScope;
  applyVideoToDetail: boolean;
};

export type LyricSettings = {
  sourcePriority: LyricSourcePriority;
  translateMode: LyricTranslateMode;
};

export type AppearanceSettings = {
  theme: ThemePreference;
  playerBg: PlayerBgSettings;
  homeBg: HomeBgSettings;
  lyricFontFamily: string;
  customScrollbar: boolean;
  lyrics: LyricSettings;
};

export type IslandSettings = {
  enabled: boolean;
  alwaysOnTop: boolean;
  capsuleOpacity: number;
  lineMode: IslandLineMode;
};

export type TaskbarSettings = {
  enabled: boolean;
  position: TaskbarPosition;
  offsetX: number;
  width: number;
};

export type LxSettings = {
  mode: LxMode;
};

export type AppSettings = {
  appearance: AppearanceSettings;
  island: IslandSettings;
  taskbar: TaskbarSettings;
  lx: LxSettings;
};

export const DEFAULT_HOME_BG: HomeBgSettings = {
  mode: "auto",
  image: "",
  color: "#fdf6e3",
  videoPath: "",
  blur: 34,
  overlay: 12,
  scope: "global",
  applyVideoToDetail: false,
};

export const DEFAULT_LYRICS: LyricSettings = {
  sourcePriority: "auto",
  translateMode: "manual",
};

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: "dark",
    playerBg: { mode: "frosted", image: "", blur: 60, overlay: 42 },
    homeBg: { ...DEFAULT_HOME_BG },
    lyricFontFamily: "",
    customScrollbar: true,
    lyrics: { ...DEFAULT_LYRICS },
  },
  island: {
    enabled: false,
    alwaysOnTop: false,
    capsuleOpacity: 100,
    lineMode: "dual",
  },
  taskbar: {
    enabled: false,
    position: TASKBAR_DEFAULT_POSITION,
    offsetX: -1,
    width: TASKBAR_DEFAULT_WIDTH,
  },
  lx: { mode: "fallback" },
};

type SettingsListener = (settings: AppSettings) => void;

const listeners = new Set<SettingsListener>();

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asTheme(value: unknown): ThemePreference {
  if (value === "light" || value === "system" || value === "dark") return value;
  return "dark";
}

function asPosition(value: unknown): TaskbarPosition {
  if (value === "auto" || value === "left" || value === "right" || value === "custom") return value;
  return TASKBAR_DEFAULT_POSITION;
}

function asLxMode(value: unknown): LxMode {
  if (value === "prefer" || value === "only" || value === "fallback") return value;
  return "fallback";
}

function asPlayerBg(value: unknown): PlayerBgSettings {
  const src = pickObject(value);
  return {
    mode: src.mode === "custom" ? "custom" : "frosted",
    image: typeof src.image === "string" ? src.image : "",
    blur: clamp(Number(src.blur ?? 60), 0, 80),
    overlay: clamp(Number(src.overlay ?? 42), 0, 80),
  };
}

function asHomeBgMode(value: unknown): HomeBgMode {
  if (value === "custom" || value === "color" || value === "video" || value === "auto") return value;
  return "auto";
}

function asColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, a, b, c] = raw;
    return `#${a}${a}${b}${b}${c}${c}`;
  }
  return fallback;
}

function asHomeBg(value: unknown): HomeBgSettings {
  const src = pickObject(value);
  return {
    mode: asHomeBgMode(src.mode),
    image: typeof src.image === "string" ? src.image : "",
    color: asColor(src.color, DEFAULT_HOME_BG.color),
    videoPath: typeof src.videoPath === "string" ? src.videoPath : "",
    blur: clamp(Number(src.blur ?? DEFAULT_HOME_BG.blur), 0, 100),
    overlay: clamp(Number(src.overlay ?? DEFAULT_HOME_BG.overlay), 0, 100),
    scope: src.scope === "no-cover" ? "no-cover" : "global",
    applyVideoToDetail: Boolean(src.applyVideoToDetail),
  };
}

function asLyrics(value: unknown): LyricSettings {
  const src = pickObject(value);
  const sourcePriority: LyricSourcePriority =
    src.sourcePriority === "embedded" || src.sourcePriority === "sidecar" || src.sourcePriority === "online"
      ? src.sourcePriority
      : "auto";
  return {
    sourcePriority,
    translateMode: src.translateMode === "auto" ? "auto" : "manual",
  };
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeSettings(raw: Record<string, unknown> | null | undefined): AppSettings {
  const src = raw ?? {};
  const appearance = pickObject(src.appearance);
  const island = pickObject(src.island);
  const taskbar = pickObject(src.taskbar);
  const lx = pickObject(src.lx);

  return {
    appearance: {
      theme: asTheme(themeFromSettings({ appearance: { theme: String(appearance.theme ?? "") } })),
      playerBg: asPlayerBg(appearance.playerBg ?? appearance.background),
      homeBg: asHomeBg(appearance.homeBg ?? appearance.background),
      lyricFontFamily: typeof appearance.lyricFontFamily === "string" ? appearance.lyricFontFamily : "",
      customScrollbar: asBool(appearance.customScrollbar, true),
      lyrics: asLyrics(appearance.lyrics ?? src.lyrics),
    },
    island: {
      enabled: Boolean(island.enabled),
      alwaysOnTop: Boolean(island.alwaysOnTop),
      capsuleOpacity: clamp(Number(island.capsuleOpacity ?? 100), 0, 100),
      lineMode: island.lineMode === "single" ? "single" : "dual",
    },
    taskbar: {
      enabled: Boolean(taskbar.enabled),
      position: asPosition(taskbar.position ?? TASKBAR_DEFAULT_POSITION),
      offsetX: typeof taskbar.offsetX === "number" ? taskbar.offsetX : -1,
      width: clamp(Number(taskbar.width ?? TASKBAR_DEFAULT_WIDTH), 180, 640),
    },
    lx: {
      mode: asLxMode(lx.mode),
    },
  };
}

function persist(next: AppSettings): void {
  const prev = readRaw();
  const merged = {
    ...prev,
    appearance: { ...pickObject(prev.appearance), ...next.appearance },
    island: { ...pickObject(prev.island), ...next.island, glassEffect: false },
    taskbar: { ...pickObject(prev.taskbar), ...next.taskbar },
    lx: { ...pickObject(prev.lx), ...next.lx },
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
}

function notifyMain(next: AppSettings): void {
  const api = window.electronAPI;
  if (!api) return;
  void api.settingsUpdate?.({
    appearance: next.appearance,
    island: next.island,
    taskbar: next.taskbar,
    lx: next.lx,
  });
}

function applyIsland(prev: IslandSettings, next: IslandSettings): void {
  const island = window.electronAPI?.island;
  if (!island) return;
  if (prev.enabled !== next.enabled) void island.setEnabled(next.enabled);
  if (prev.alwaysOnTop !== next.alwaysOnTop) void island.setAlwaysOnTop(next.alwaysOnTop);
}

function applyTaskbar(prev: TaskbarSettings, next: TaskbarSettings): void {
  const taskbar = window.electronAPI?.taskbar;
  if (!taskbar) return;
  if (prev.enabled !== next.enabled) void taskbar.setEnabled(next.enabled);
  if (
    prev.position !== next.position ||
    prev.offsetX !== next.offsetX ||
    prev.width !== next.width
  ) {
    void taskbar.setPosition({
      position: next.position,
      offsetX: next.offsetX,
      width: next.width,
    });
  }
}

let current = normalizeSettings(readRaw());
kzApplyTheme(current);
applyChrome(current);
applyIsland(DEFAULT_SETTINGS.island, current.island);
applyTaskbar(DEFAULT_SETTINGS.taskbar, current.taskbar);

/** Recovered `kzApplyTheme`: resolve appearance.theme and set `html[data-theme]`. */
export function kzApplyTheme(
  settings?: { appearance?: { theme?: string } } | null,
): ThemePreference {
  const theme = asTheme(themeFromSettings(settings ?? current));
  applyResolvedTheme(theme);
  return theme;
}

/** Scrollbar + lyric font + optional detail video flag on `documentElement`. */
export function applyChrome(settings: AppSettings = current): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const appearance = settings.appearance;
  root.dataset.customScrollbar = appearance.customScrollbar ? "1" : "0";
  root.style.setProperty("--lyric-font", appearance.lyricFontFamily || "DM Sans, sans-serif");
  const home = appearance.homeBg;
  if (home.mode === "video" && home.applyVideoToDetail && home.videoPath) {
    root.dataset.detailVideoBg = "1";
  } else {
    delete root.dataset.detailVideoBg;
  }
}

function commit(next: AppSettings): void {
  const prev = current;
  current = next;
  persist(next);
  notifyMain(next);
  if (prev.appearance.theme !== next.appearance.theme) {
    kzApplyTheme(next);
  }
  applyChrome(next);
  applyIsland(prev.island, next.island);
  applyTaskbar(prev.taskbar, next.taskbar);
  for (const listener of listeners) listener(next);
}

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings<K extends keyof AppSettings>(
  section: K,
  patch: Partial<AppSettings[K]>,
): AppSettings {
  commit({
    ...current,
    [section]: {
      ...current[section],
      ...patch,
    },
  });
  return current;
}

export function cycleTheme(): ThemePreference {
  const order: ThemePreference[] = ["dark", "light", "system"];
  const idx = order.indexOf(current.appearance.theme);
  const next = order[(idx < 0 ? 0 : idx + 1) % order.length];
  updateSettings("appearance", { theme: next });
  return next;
}

export function resetSettings(): AppSettings {
  commit({
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      playerBg: { ...DEFAULT_SETTINGS.appearance.playerBg },
      homeBg: { ...DEFAULT_SETTINGS.appearance.homeBg },
      lyrics: { ...DEFAULT_SETTINGS.appearance.lyrics },
    },
    island: { ...DEFAULT_SETTINGS.island },
    taskbar: { ...DEFAULT_SETTINGS.taskbar },
    lx: { ...DEFAULT_SETTINGS.lx },
  });
  return current;
}

export function useSettings(): {
  settings: AppSettings;
  update: typeof updateSettings;
  reset: typeof resetSettings;
} {
  const [settings, setSettings] = useState(current);
  useEffect(() => {
    const onChange: SettingsListener = (next) => setSettings(next);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return { settings, update: updateSettings, reset: resetSettings };
}
