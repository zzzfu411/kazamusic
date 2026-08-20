import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import type { ThemeResolved } from "../shared/theme";

export function createAntdTheme(resolved: ThemeResolved): ThemeConfig {
  const light = resolved === "light";
  return {
    algorithm: light ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
    token: {
      colorPrimary: light ? "#173A52" : "#5a8fad",
      colorBgContainer: light ? "#fffef9" : "#0c0c0c",
      colorBgElevated: light ? "#fffef9" : "#111111",
      colorText: light ? "#1a1a2e" : "#f0f0f0",
      colorTextSecondary: light ? "#555570" : "#a3a3a3",
      colorBorder: light ? "rgba(26,26,46,0.14)" : "rgba(255,255,255,0.12)",
      colorBorderSecondary: light ? "rgba(26,26,46,0.08)" : "rgba(255,255,255,0.08)",
      borderRadius: 8,
      fontFamily: '"DM Sans","PingFang SC",-apple-system,"Microsoft YaHei",sans-serif',
      fontSize: 13,
    },
    components: {
      Button: { borderRadius: 999, controlHeight: 34 },
      Input: { borderRadius: 8, controlHeight: 36 },
      Segmented: { borderRadius: 8, trackBg: light ? "#f8f5ec" : "#111111" },
      Slider: { railSize: 4 },
    },
  };
}
