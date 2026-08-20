import { useEffect, useState } from "react";
import { BrandMark } from "../brand/BrandMark";
import {
  IconClose,
  IconIsland,
  IconMaximize,
  IconMinimize,
  IconMoon,
  IconRestore,
  IconSettings,
  IconSun,
  IconSystem,
  IconTaskbar,
} from "../icons/Icons";
import { cycleTheme, useSettings } from "../stores/settings";
import { usePlayer } from "../stores/player";

type Props = {
  onOpenSettings?: () => void;
};

function formatClock(date: Date): string {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function ThemeIcon({ theme }: { theme: string }) {
  if (theme === "light") return <IconMoon size={16} />;
  if (theme === "system") return <IconSystem size={16} />;
  return <IconSun size={16} />;
}

export function Titlebar({ onOpenSettings }: Props) {
  const { settings, update } = useSettings();
  const player = usePlayer();
  const api = window.electronAPI;
  const theme = settings.appearance.theme;
  const islandOn = settings.island.enabled;
  const taskbarOn = settings.taskbar.enabled;
  const live = player.state === "playing" || player.state === "loading";
  const themeTitle =
    theme === "light" ? "切换暗色" : theme === "system" ? "切换主题（跟随系统）" : "切换白日";
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void api?.isMaximized?.().then((value) => setMaximized(Boolean(value)));
    return api?.onMaximizedChange?.((value) => setMaximized(Boolean(value)));
  }, [api]);

  const toggleMax = () => {
    void Promise.resolve(api?.maximize()).then((value) => {
      if (typeof value === "boolean") setMaximized(value);
    });
  };

  return (
    <header
      className="titlebar"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".titlebar-controls, .titlebar-brand, button")) return;
        toggleMax();
      }}
    >
      <div className="titlebar-brand">
        <BrandMark size={28} withWord />
        <span className={`titlebar-live${live ? " is-on" : ""}`}>
          <span className="titlebar-live-dot" />
          {live ? "播放中" : "就绪"}
        </span>
      </div>
      <div className="titlebar-clock titlebar-drag">{clock}</div>
      <div className="titlebar-controls">
        {onOpenSettings ? (
          <button
            type="button"
            className="titlebar-settings-btn"
            title="设置 (Ctrl+,)"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <IconSettings size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="titlebar-toggle-btn kazam-theme-btn"
          title={themeTitle}
          aria-label="切换主题"
          onClick={() => cycleTheme()}
        >
          <ThemeIcon theme={theme} />
        </button>
        <button
          type="button"
          className={`titlebar-toggle-btn${islandOn ? " is-active" : ""}`}
          title={islandOn ? "关闭灵动岛桌面歌词" : "开启灵动岛桌面歌词"}
          aria-label="灵动岛桌面歌词"
          aria-pressed={islandOn}
          onClick={() => update("island", { enabled: !islandOn })}
        >
          <IconIsland size={16} />
        </button>
        <button
          type="button"
          className={`titlebar-toggle-btn${taskbarOn ? " is-active" : ""}`}
          title={taskbarOn ? "关闭任务栏播控" : "开启任务栏播控"}
          aria-label="任务栏播控"
          aria-pressed={taskbarOn}
          onClick={() => update("taskbar", { enabled: !taskbarOn })}
        >
          <IconTaskbar size={16} />
        </button>
        <div className="titlebar-divider" aria-hidden="true" />
        <button type="button" onClick={() => api?.minimize()} title="最小化" aria-label="最小化">
          <IconMinimize />
        </button>
        <button
          type="button"
          className="titlebar-max-btn"
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原" : "最大化"}
          onClick={toggleMax}
        >
          {maximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button type="button" className="titlebar-close" onClick={() => api?.close()} title="关闭" aria-label="关闭">
          <IconClose />
        </button>
      </div>
    </header>
  );
}
