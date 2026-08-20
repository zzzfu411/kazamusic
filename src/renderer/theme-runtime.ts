import { resolveTheme, themeFromSettings, type ThemePreference } from "../shared/theme";

const SETTINGS_KEY = "m7.settings.v1";

type SettingsShape = { appearance?: { theme?: string } };

function readSettings(): SettingsShape {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as SettingsShape) : {};
  } catch {
    return {};
  }
}

function writeThemePreference(theme: ThemePreference): void {
  const current = readSettings();
  const next = {
    ...current,
    appearance: { ...current.appearance, theme },
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

export function readThemePreference(): ThemePreference {
  const value = themeFromSettings(readSettings());
  if (value === "light" || value === "system" || value === "dark") return value;
  return "dark";
}

export function applyResolvedTheme(preference: ThemePreference = readThemePreference()): ThemePreference {
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.setAttribute("data-theme", resolveTheme(preference, prefersLight));
  return preference;
}

export function cycleThemePreference(): ThemePreference {
  const current = readThemePreference();
  const next: ThemePreference = current === "dark" ? "light" : current === "light" ? "system" : "dark";
  writeThemePreference(next);
  applyResolvedTheme(next);
  return next;
}
