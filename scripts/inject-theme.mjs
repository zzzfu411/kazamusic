import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function injectThemeFile(cssPath, themePath) {
  if (!existsSync(cssPath) || !existsSync(themePath)) return false;
  const theme = readFileSync(themePath, "utf8");
  const css = readFileSync(cssPath, "utf8");
  const mark = "/* kazam-theme */";
  const i = css.indexOf(mark);
  const head = i >= 0 ? css.slice(0, i) : css.endsWith("\n") ? css : `${css}\n`;
  writeFileSync(cssPath, head + theme, "utf8");
  return true;
}
