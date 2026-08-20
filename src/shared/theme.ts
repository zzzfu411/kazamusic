export type ThemePreference = "dark" | "light" | "system";
export type ThemeResolved = "dark" | "light";

export function resolveTheme(
  preference: string | undefined,
  prefersLight: boolean,
): ThemeResolved {
  if (preference === "light") return "light";
  if (preference === "system") return prefersLight ? "light" : "dark";
  return "dark";
}

export function themeFromSettings(settings: { appearance?: { theme?: string } } | null | undefined): string {
  return settings?.appearance?.theme || "dark";
}
