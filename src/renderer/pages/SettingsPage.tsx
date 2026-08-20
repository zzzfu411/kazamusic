import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, ConfigProvider, Input, Radio, Slider, Switch, message } from "antd";
import { appMeta } from "../../shared/appMeta";
import { resolveTheme, type ThemePreference } from "../../shared/theme";
import { createAntdTheme } from "../antd-theme";
import { brand } from "../brand/assets";
import {
  TASKBAR_DEFAULT_WIDTH,
  useSettings,
  type HomeBgMode,
  type HomeBgScope,
  type LyricSourcePriority,
  type LyricTranslateMode,
  type LxMode,
  type PlayerBgMode,
  type TaskbarPosition,
} from "../stores/settings";
import "../styles/settings-theme.css";

type NavKey = "appearance" | "island" | "taskbar" | "lx" | "cache" | "about";

type LxSource = {
  id: string;
  name: string;
  version?: string;
  author?: string;
  enabled: boolean;
  status?: string;
  origin?: string;
  error?: string;
  sources?: Record<string, unknown>;
  configFields?: string[];
};

type CacheStats = {
  cacheDir?: string;
  audioCache?: { count: number; size: number };
  trackCache?: { count: number; size: number };
};

type AppInfo = {
  version?: string;
  electron?: string;
  node?: string;
  chrome?: string;
};

type LogInfo = {
  userDataDir?: string;
  logDir?: string;
  currentLogFile?: string;
};

const NAV: Array<{ key: NavKey; label: string; desc: string }> = [
  { key: "appearance", label: "外观", desc: "主题、背景与歌词" },
  { key: "island", label: "灵动岛", desc: "桌面歌词胶囊" },
  { key: "taskbar", label: "任务栏", desc: "宽度与位置" },
  { key: "lx", label: "LX 音源", desc: "洛雪脚本" },
  { key: "cache", label: "缓存", desc: "清理占用" },
  { key: "about", label: "关于", desc: appMeta.name },
];

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "dark", label: "暗色" },
  { value: "light", label: "白日" },
  { value: "system", label: "跟随系统" },
];

const LX_MODE_OPTIONS: Array<{ value: LxMode; label: string }> = [
  { value: "fallback", label: "智能模式" },
  { value: "prefer", label: "优先模式" },
  { value: "only", label: "独占模式" },
];

const LX_MODE_HINT: Record<LxMode, string> = {
  fallback: "优先使用内置音源；无法播放或音质不达标时，自动调用已导入的 LX 音源。",
  prefer: "优先使用 LX 音源，失败后回退内置音源。",
  only: "仅使用 LX 音源，停用内置在线取链。",
};

const TASKBAR_POSITIONS: Array<{ value: TaskbarPosition; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "left", label: "靠左" },
  { value: "right", label: "靠右" },
  { value: "custom", label: "自定义" },
];

function formatBytes(value: number | undefined): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function api() {
  return window.electronAPI;
}

function SettingsRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {desc ? <div className="settings-row-desc">{desc}</div> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function AppearanceGroup() {
  const { settings, update } = useSettings();
  const bg = settings.appearance.playerBg;
  const home = settings.appearance.homeBg;
  const lyrics = settings.appearance.lyrics;
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState<"save" | "test" | null>(null);

  const patchBg = (patch: Partial<typeof bg>) =>
    update("appearance", { playerBg: { ...bg, ...patch } });
  const patchHome = (patch: Partial<typeof home>) =>
    update("appearance", { homeBg: { ...home, ...patch } });
  const patchLyrics = (patch: Partial<typeof lyrics>) =>
    update("appearance", { lyrics: { ...lyrics, ...patch } });

  const refreshKey = useCallback(async () => {
    try {
      setHasKey(Boolean(await api()?.lyrics?.hasApiKey?.()));
    } catch {
      setHasKey(false);
    }
  }, []);

  useEffect(() => {
    void refreshKey();
  }, [refreshKey]);

  const saveApiKey = async () => {
    const lyricsApi = api()?.lyrics;
    if (!lyricsApi || keyBusy) return;
    const trimmed = apiKey.trim();
    if (!trimmed && !hasKey) {
      message.warning("请填写 API Key");
      return;
    }
    setKeyBusy("save");
    try {
      await lyricsApi.saveApiKey(trimmed);
      setApiKey("");
      await refreshKey();
      message.success(trimmed ? "已保存 API Key" : "已清除 API Key");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setKeyBusy(null);
    }
  };

  const testApiKey = async () => {
    const lyricsApi = api()?.lyrics;
    if (!lyricsApi || keyBusy) return;
    setKeyBusy("test");
    try {
      const result = (await lyricsApi.testApiKey(apiKey.trim())) as { ok?: boolean; error?: string };
      if (result?.ok) message.success("连接成功");
      else message.error(result?.error || "连接失败");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "连接失败");
    } finally {
      setKeyBusy(null);
    }
  };

  return (
    <>
      <section className="settings-group" id="sg-appearance-theme">
        <h2 className="settings-group-title">界面主题</h2>
        <p className="settings-group-desc">白日奶油黄、夜里藏青黑，圆角苹果风。可跟随系统。</p>
        <SettingsRow label="主题" desc="浅色：奶油底 + 明黄；深色：纯黑 + 藏青">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={settings.appearance.theme}
            options={THEME_OPTIONS}
            onChange={(e) => update("appearance", { theme: e.target.value })}
          />
        </SettingsRow>
      </section>
      <section className="settings-group" id="sg-appearance-player-bg">
        <h2 className="settings-group-title">播放详情背景</h2>
        <p className="settings-group-desc">展开单曲沉浸页时的全屏背景。磨砂玻璃用当前封面模糊，也可换成自己的图片。</p>
        <SettingsRow label="背景模式" desc="磨砂玻璃：当前封面高斯模糊；自定义：使用你选择的图片">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={bg.mode}
            options={[
              { value: "frosted", label: "磨砂玻璃" },
              { value: "custom", label: "自定义背景图" },
            ]}
            onChange={(e) => {
              const mode = e.target.value as PlayerBgMode;
              patchBg({
                mode,
                blur: mode === "custom" && bg.blur >= 48 ? 8 : bg.blur,
              });
            }}
          />
        </SettingsRow>
        {bg.mode === "custom" ? (
          <SettingsRow label="背景图片" desc={bg.image ? fileName(bg.image) : "还没有选择图片，将暂时回退到封面磨砂"}>
            <div className="settings-bg-image-actions">
              <Button
                size="small"
                onClick={async () => {
                  const picked = await api()?.selectImage?.();
                  if (typeof picked === "string" && picked) patchBg({ image: picked });
                }}
              >
                选择图片
              </Button>
              {bg.image ? (
                <Button size="small" danger onClick={() => patchBg({ image: "" })}>
                  清除
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
        <SettingsRow label="模糊度" desc="0 为清晰，数值越大越像磨砂">
          <div className="settings-slider">
            <Slider min={0} max={80} value={bg.blur} onChange={(blur) => patchBg({ blur })} />
            <span className="settings-slider-value">{bg.blur}px</span>
          </div>
        </SettingsRow>
        <SettingsRow label="遮罩" desc="叠在背景上的主题色遮罩，越大字越清楚">
          <div className="settings-slider">
            <Slider min={0} max={80} value={bg.overlay} onChange={(overlay) => patchBg({ overlay })} />
            <span className="settings-slider-value">{bg.overlay}%</span>
          </div>
        </SettingsRow>
      </section>
      <section className="settings-group" id="sg-appearance-home-bg">
        <h2 className="settings-group-title">主页背景</h2>
        <p className="settings-group-desc">主区壁纸。播放详情页仍用上面的磨砂/自定义图，除非开启「应用到播放详情」。</p>
        <SettingsRow label="背景模式" desc="自动封面：当前歌曲封面模糊；自定义图 / 纯色 / 视频为固定壁纸">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={home.mode}
            options={[
              { value: "auto", label: "自动封面" },
              { value: "custom", label: "自定义图" },
              { value: "color", label: "纯色" },
              { value: "video", label: "视频" },
            ]}
            onChange={(e) => patchHome({ mode: e.target.value as HomeBgMode })}
          />
        </SettingsRow>
        {home.mode === "custom" ? (
          <>
            <SettingsRow label="应用范围" desc="全局始终使用自定义图；无封面时仅在当前曲目没有封面时启用">
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={home.scope}
                options={[
                  { value: "global", label: "全局启用" },
                  { value: "no-cover", label: "无封面时启用" },
                ]}
                onChange={(e) => patchHome({ scope: e.target.value as HomeBgScope })}
              />
            </SettingsRow>
            <SettingsRow label="背景图片" desc={home.image ? fileName(home.image) : "还没有选择图片"}>
              <div className="settings-bg-image-actions">
                <Button
                  size="small"
                  onClick={async () => {
                    const picked = await api()?.selectImage?.();
                    if (typeof picked === "string" && picked) patchHome({ image: picked });
                  }}
                >
                  选择图片
                </Button>
                {home.image ? (
                  <Button size="small" danger onClick={() => patchHome({ image: "" })}>
                    清除
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
            <SettingsRow label="模糊度" desc="0 为清晰，数值越大越像磨砂">
              <div className="settings-slider">
                <Slider min={0} max={100} value={home.blur} onChange={(blur) => patchHome({ blur })} />
                <span className="settings-slider-value">{home.blur}px</span>
              </div>
            </SettingsRow>
            <SettingsRow label="遮罩" desc="叠在背景上的黑色遮罩，越大字越清楚">
              <div className="settings-slider">
                <Slider min={0} max={100} value={home.overlay} onChange={(overlay) => patchHome({ overlay })} />
                <span className="settings-slider-value">{home.overlay}%</span>
              </div>
            </SettingsRow>
          </>
        ) : null}
        {home.mode === "color" ? (
          <SettingsRow label="背景颜色" desc="纯色铺满主区">
            <input
              className="settings-color-input"
              type="color"
              value={home.color}
              onChange={(e) => patchHome({ color: e.target.value })}
              aria-label="主页背景颜色"
            />
          </SettingsRow>
        ) : null}
        {home.mode === "video" ? (
          <>
            <SettingsRow label="视频文件" desc={home.videoPath ? fileName(home.videoPath) : "选择本地视频作为动态壁纸"}>
              <div className="settings-bg-image-actions">
                <Button
                  size="small"
                  onClick={async () => {
                    const picked = await api()?.selectVideo?.();
                    if (typeof picked === "string" && picked) patchHome({ videoPath: picked });
                  }}
                >
                  选择视频
                </Button>
                {home.videoPath ? (
                  <Button size="small" danger onClick={() => patchHome({ videoPath: "" })}>
                    清除
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
            <SettingsRow label="应用到播放详情" desc="打开沉浸页时用这段视频替换详情背景">
              <Switch
                checked={home.applyVideoToDetail}
                onChange={(applyVideoToDetail) => patchHome({ applyVideoToDetail })}
              />
            </SettingsRow>
            <SettingsRow label="模糊度" desc="视频高斯模糊半径">
              <div className="settings-slider">
                <Slider min={0} max={100} value={home.blur} onChange={(blur) => patchHome({ blur })} />
                <span className="settings-slider-value">{home.blur}px</span>
              </div>
            </SettingsRow>
            <SettingsRow label="遮罩" desc="叠在视频上的黑色遮罩">
              <div className="settings-slider">
                <Slider min={0} max={100} value={home.overlay} onChange={(overlay) => patchHome({ overlay })} />
                <span className="settings-slider-value">{home.overlay}%</span>
              </div>
            </SettingsRow>
          </>
        ) : null}
      </section>
      <section className="settings-group" id="sg-appearance-scrollbar">
        <h2 className="settings-group-title">滚动条</h2>
        <p className="settings-group-desc">自定义细滚动条；关闭则隐藏。</p>
        <SettingsRow label="自定义滚动条" desc="开启后显示 8px 细条，颜色跟随主题">
          <Switch
            checked={settings.appearance.customScrollbar}
            onChange={(customScrollbar) => update("appearance", { customScrollbar })}
          />
        </SettingsRow>
      </section>
      <section className="settings-group" id="sg-appearance-font">
        <h2 className="settings-group-title">歌词字体</h2>
        <p className="settings-group-desc">详情、灵动岛与任务栏歌词使用的字体族。留空则为 DM Sans。</p>
        <SettingsRow label="字体名称" desc="填写系统已安装字体族名，例如 Microsoft YaHei">
          <Input
            className="settings-font-input"
            size="small"
            value={settings.appearance.lyricFontFamily}
            placeholder="DM Sans"
            onChange={(e) => update("appearance", { lyricFontFamily: e.target.value })}
          />
        </SettingsRow>
      </section>
      <section className="settings-group" id="sg-appearance-lyrics-translate">
        <h2 className="settings-group-title">歌词翻译</h2>
        <p className="settings-group-desc">手动：详情页点翻译；自动：满足条件时请求 DeepSeek。</p>
        <SettingsRow label="翻译方式" desc="自动需要本机已保存 DeepSeek API Key">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={lyrics.translateMode}
            options={[
              { value: "manual", label: "手动" },
              { value: "auto", label: "自动" },
            ]}
            onChange={(e) => patchLyrics({ translateMode: e.target.value as LyricTranslateMode })}
          />
        </SettingsRow>
        <SettingsRow
          label="DeepSeek API Key"
          desc={hasKey ? "当前已配置 API Key，留空保存可清除" : "在 platform.deepseek.com 获取，仅保存在本机"}
        >
          <div className="settings-key-row">
            <Input.Password
              size="small"
              value={apiKey}
              placeholder={hasKey ? "已配置（留空保存可清除）" : "sk-..."}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
              onPressEnter={() => void saveApiKey()}
            />
            <Button size="small" disabled={!!keyBusy} onClick={() => void saveApiKey()}>
              {keyBusy === "save" ? "保存中…" : "保存"}
            </Button>
            <Button size="small" disabled={!!keyBusy} onClick={() => void testApiKey()}>
              {keyBusy === "test" ? "测试中…" : "测试"}
            </Button>
          </div>
        </SettingsRow>
      </section>
      <section className="settings-group" id="sg-appearance-lyrics-source">
        <h2 className="settings-group-title">歌词来源</h2>
        <p className="settings-group-desc">自动依次尝试内嵌、旁路文件与在线搜索。</p>
        <SettingsRow label="歌词来源" desc="内嵌：音轨标签；旁路：同目录 .lrc；在线：全平台搜索">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={lyrics.sourcePriority}
            options={[
              { value: "auto", label: "自动" },
              { value: "embedded", label: "内嵌" },
              { value: "sidecar", label: "旁路" },
              { value: "online", label: "在线" },
            ]}
            onChange={(e) => patchLyrics({ sourcePriority: e.target.value as LyricSourcePriority })}
          />
        </SettingsRow>
      </section>
    </>
  );
}

function IslandGroup() {
  const { settings, update } = useSettings();
  const island = settings.island;
  return (
    <section className="settings-group" id="sg-island">
      <h2 className="settings-group-title">灵动岛</h2>
      <p className="settings-group-desc">桌面顶部 Dynamic Island 风格歌词胶囊。液态玻璃已关闭。</p>
      <SettingsRow label="灵动岛歌词" desc="在桌面顶部显示歌词胶囊">
        <Switch checked={island.enabled} onChange={(enabled) => update("island", { enabled })} />
      </SettingsRow>
      {island.enabled ? (
        <>
          <SettingsRow label="背景不透明度" desc="胶囊底色深浅，100% 为完全不透明">
            <div className="settings-slider">
              <Slider
                min={0}
                max={100}
                value={island.capsuleOpacity}
                onChange={(capsuleOpacity) => update("island", { capsuleOpacity })}
              />
              <span className="settings-slider-value">{island.capsuleOpacity}%</span>
            </div>
          </SettingsRow>
          <SettingsRow label="歌词行数" desc="双行显示译文或下一句；单行仅当前一句">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              size="small"
              value={island.lineMode}
              options={[
                { value: "dual", label: "双行" },
                { value: "single", label: "单行" },
              ]}
              onChange={(e) => update("island", { lineMode: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="窗口置顶" desc="开启后覆盖所有窗口（含全屏应用）">
            <Switch
              checked={island.alwaysOnTop}
              onChange={(alwaysOnTop) => update("island", { alwaysOnTop })}
            />
          </SettingsRow>
        </>
      ) : null}
    </section>
  );
}

function TaskbarGroup() {
  const { settings, update } = useSettings();
  const taskbar = settings.taskbar;
  const maxOffset =
    typeof window !== "undefined" ? Math.max(0, Math.round(window.screen.width - taskbar.width)) : 0;
  const offsetX = taskbar.position === "custom" && taskbar.offsetX >= 0 ? taskbar.offsetX : 0;

  return (
    <section className="settings-group" id="sg-taskbar">
      <h2 className="settings-group-title">任务栏播控</h2>
      <p className="settings-group-desc">嵌入 Windows 任务栏的播放控制条。默认靠右，宽度 {TASKBAR_DEFAULT_WIDTH}。</p>
      <SettingsRow label="启用任务栏播控条" desc="在任务栏显示播放控制（实验性）">
        <Switch checked={taskbar.enabled} onChange={(enabled) => update("taskbar", { enabled })} />
      </SettingsRow>
      {taskbar.enabled ? (
        <>
          <SettingsRow label="显示位置" desc="自动避让托盘；靠右为默认，永远靠右避让托盘">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              size="small"
              value={taskbar.position}
              options={TASKBAR_POSITIONS}
              onChange={(e) => update("taskbar", { position: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="播控条宽度" desc={`默认 ${TASKBAR_DEFAULT_WIDTH}px`}>
            <div className="settings-slider">
              <Slider
                min={180}
                max={640}
                step={10}
                value={taskbar.width}
                onChange={(width) => update("taskbar", { width })}
              />
              <span className="settings-slider-value">{taskbar.width}px</span>
            </div>
          </SettingsRow>
          {taskbar.position === "custom" ? (
            <>
              <SettingsRow label="水平位置" desc={`自定义 X 坐标，范围 0 – ${maxOffset}`}>
                <div className="settings-slider">
                  <Slider
                    min={0}
                    max={maxOffset}
                    step={10}
                    value={offsetX}
                    onChange={(next) => update("taskbar", { offsetX: next })}
                  />
                  <span className="settings-slider-value">{offsetX}px</span>
                </div>
              </SettingsRow>
              <SettingsRow label="恢复默认位置" desc="靠右，宽度 280">
                <Button
                  size="small"
                  onClick={() =>
                    update("taskbar", {
                      position: "right",
                      offsetX: -1,
                      width: TASKBAR_DEFAULT_WIDTH,
                    })
                  }
                >
                  恢复默认
                </Button>
              </SettingsRow>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function LxGroup() {
  const { settings, update } = useSettings();
  const [items, setItems] = useState<LxSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");

  const refresh = useCallback(async (silent = false) => {
    const lx = api()?.lx;
    if (!lx) {
      setLoading(false);
      return [];
    }
    try {
      const list = (await lx.list()) as LxSource[];
      setItems(Array.isArray(list) ? list : []);
      return list;
    } catch (err) {
      if (!silent) message.error(err instanceof Error ? err.message : "加载失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="settings-group" id="sg-lx-scripts">
      <h2 className="settings-group-title">LX 音源</h2>
      <p className="settings-group-desc">导入洛雪（LX Music）自定义源脚本。本地与 WebDAV 播放不受影响。无 VIP 门槛。</p>
      <SettingsRow label="插件模式" desc={LX_MODE_HINT[settings.lx.mode]}>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          size="small"
          value={settings.lx.mode}
          options={LX_MODE_OPTIONS}
          onChange={(e) => {
            const mode = e.target.value as LxMode;
            update("lx", { mode });
            message.info(LX_MODE_HINT[mode]);
          }}
        />
      </SettingsRow>
      {loading ? (
        <div className="lx-source-empty">加载中…</div>
      ) : items.length === 0 ? (
        <div className="lx-source-empty">尚未导入音源脚本。脚本需自行获取（.js 文件或在线链接），导入后自动生效。</div>
      ) : (
        <ul className="lx-source-list">
          {items.map((item) => (
            <li className={`lx-source-item${item.enabled ? "" : " is-off"}`} key={item.id}>
              <div className="lx-source-info">
                <div className="lx-source-name">
                  {item.name}
                  {item.version ? <span className="lx-source-version">{item.version}</span> : null}
                </div>
                <div className="lx-source-meta">
                  {item.enabled ? item.status ?? "ok" : "已禁用"}
                  {item.author ? ` · ${item.author}` : ""}
                  {item.origin === "url" ? " · 在线导入" : ""}
                  {item.error ? ` · ${item.error}` : ""}
                </div>
              </div>
              <div className="lx-source-actions">
                <Button
                  size="small"
                  disabled={!!busy}
                  onClick={() =>
                    run(`toggle:${item.id}`, async () => {
                      await api()?.lx.setEnabled(item.id, !item.enabled);
                      await refresh(true);
                    })
                  }
                >
                  {item.enabled ? "禁用" : "启用"}
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={!!busy}
                  onClick={() =>
                    run(`remove:${item.id}`, async () => {
                      await api()?.lx.remove(item.id);
                      message.info(`已移除「${item.name}」`);
                      const next = await refresh(true);
                      if (settings.lx.mode !== "fallback" && !next.some((s) => s.enabled)) {
                        update("lx", { mode: "fallback" });
                        message.info("已没有启用中的 LX 脚本，插件模式切回智能模式");
                      }
                    })
                  }
                >
                  移除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="lx-import-row">
        <Button
          type="primary"
          size="small"
          disabled={!!busy}
          onClick={() =>
            run("importFile", async () => {
              const result = (await api()?.lx.importFile()) as {
                canceled?: boolean;
                ok?: boolean;
                error?: string;
                info?: { name?: string; status?: string; error?: string };
              };
              if (!result || result.canceled) return;
              if (!result.ok) {
                message.error(result.error || "导入失败");
                return;
              }
              if (result.info?.status === "error") {
                message.warning(`已导入「${result.info.name}」，但初始化失败：${result.info.error || "未知错误"}`);
              } else {
                message.success(`已导入「${result.info?.name ?? "音源脚本"}」`);
              }
              await refresh(true);
            })
          }
        >
          {busy === "importFile" ? "导入中…" : "导入脚本文件"}
        </Button>
        <Button size="small" disabled={!!busy} onClick={() => setShowUrl((v) => !v)}>
          从链接导入
        </Button>
        <Button size="small" disabled={!!busy || loading} onClick={() => run("refresh", () => refresh().then(() => undefined))}>
          刷新状态
        </Button>
      </div>
      {showUrl ? (
        <div className="lx-import-url-row">
          <Input
            placeholder="粘贴脚本链接，如 https://…/latest.js"
            value={url}
            disabled={busy === "importUrl"}
            onChange={(e) => setUrl(e.target.value)}
            onPressEnter={() => {
              void run("importUrl", async () => {
                const trimmed = url.trim();
                if (!trimmed) {
                  message.warning("请输入脚本链接");
                  return;
                }
                const result = (await api()?.lx.importUrl(trimmed)) as {
                  ok?: boolean;
                  error?: string;
                  info?: { name?: string; status?: string; error?: string };
                };
                if (!result?.ok) {
                  message.error(result?.error || "导入失败");
                  return;
                }
                if (result.info?.status === "error") {
                  message.warning(`已导入「${result.info.name}」，但初始化失败：${result.info.error || "未知错误"}`);
                } else {
                  message.success(`已导入「${result.info?.name ?? "音源脚本"}」`);
                }
                setUrl("");
                setShowUrl(false);
                await refresh(true);
              });
            }}
          />
          <Button
            type="primary"
            disabled={!!busy}
            onClick={() =>
              run("importUrl", async () => {
                const trimmed = url.trim();
                if (!trimmed) {
                  message.warning("请输入脚本链接");
                  return;
                }
                const result = (await api()?.lx.importUrl(trimmed)) as {
                  ok?: boolean;
                  error?: string;
                  info?: { name?: string; status?: string; error?: string };
                };
                if (!result?.ok) {
                  message.error(result?.error || "导入失败");
                  return;
                }
                if (result.info?.status === "error") {
                  message.warning(`已导入「${result.info.name}」，但初始化失败：${result.info.error || "未知错误"}`);
                } else {
                  message.success(`已导入「${result.info?.name ?? "音源脚本"}」`);
                }
                setUrl("");
                setShowUrl(false);
                await refresh(true);
              })
            }
          >
            {busy === "importUrl" ? "导入中…" : "导入"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CacheGroup() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async () => {
    const cache = api()?.cache;
    if (!cache) return;
    setBusy(true);
    try {
      setStats((await cache.getStats()) as CacheStats);
    } catch {
      message.error("获取缓存信息失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const clear = async (scope: "audio" | "all") => {
    const cache = api()?.cache;
    if (!cache || busy) return;
    setBusy(true);
    try {
      await cache.clear(scope);
      message.success(scope === "audio" ? "音频缓存已清理" : "已清理音频缓存、曲目缓存和网页缓存");
      setStats((await cache.getStats()) as CacheStats);
    } catch {
      message.error("清理缓存失败");
    } finally {
      setBusy(false);
    }
  };

  const audioCount = stats?.audioCache?.count ?? 0;

  return (
    <section className="settings-group" id="sg-cache">
      <h2 className="settings-group-title">缓存管理</h2>
      <p className="settings-group-desc">管理应用缓存数据，清理后可释放磁盘空间。</p>
      <SettingsRow label="缓存目录" desc={stats?.cacheDir || "加载中..."}>
        <Button
          size="small"
          className="settings-dir-btn"
          onClick={async () => {
            try {
              await api()?.cache.openDir();
            } catch {
              message.error("打开缓存目录失败");
            }
          }}
        >
          打开目录
        </Button>
      </SettingsRow>
      <SettingsRow
        label="音频缓存"
        desc={stats ? `${audioCount} 个文件 · ${formatBytes(stats.audioCache?.size)}（解密音频）` : "加载中..."}
      >
        <Button size="small" className="settings-dir-btn" disabled={busy || audioCount === 0} onClick={() => void clear("audio")}>
          清理
        </Button>
      </SettingsRow>
      <div className="cache-footer">
        <Button size="small" className="settings-dir-btn" disabled={busy} onClick={() => void loadStats()}>
          {busy ? "刷新中…" : "刷新统计"}
        </Button>
        <Button size="small" className="settings-dir-btn" disabled={busy} onClick={() => void clear("all")}>
          清理全部缓存
        </Button>
      </div>
    </section>
  );
}

function AboutGroup() {
  const { reset } = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [log, setLog] = useState<LogInfo | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const electron = api();
    if (!electron) return;
    void electron.getAppInfo?.().then((value) => setInfo((value as AppInfo) ?? null)).catch(() => {});
    void electron.getLogInfo?.().then((value) => setLog((value as LogInfo) ?? null)).catch(() => {});
  }, []);

  const version = info?.version ?? appMeta.version;

  return (
    <section className="settings-group" id="sg-about">
      <h2 className="settings-group-title">关于</h2>
      <p className="settings-group-desc">应用信息与开源致谢</p>
      <div className="about-card">
        <img className="about-brand-art" src={brand.mark} alt="" />
        <div className="about-name">{appMeta.name}</div>
        <div className="about-tagline">{brand.callsign} · {brand.tagline}</div>
        <div className="about-version">版本 {version}</div>
        <div className="about-actions">
          <Button
            size="small"
            className="settings-dir-btn"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                const result = await api()?.checkForUpdates();
                message.info(result ? "已发起更新检查" : "当前已是最新，或更新通道不可用");
              } catch (err) {
                message.error(err instanceof Error ? err.message : "检查更新失败");
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "检查中…" : "检查更新"}
          </Button>
        </div>
      </div>
      <div className="about-section">
        <h3 className="about-section-title">技术栈</h3>
        <p className="about-section-desc">
          {[info?.electron ? `Electron ${info.electron}` : "Electron", "React 18", "TypeScript", "Vite", "Ant Design 6"].join(" · ")}
        </p>
        {info ? (
          <p className="about-section-sub">
            Node {info.node} · Chromium {info.chrome}
          </p>
        ) : null}
      </div>
      <div className="about-section">
        <h3 className="about-section-title">诊断日志</h3>
        {log ? (
          <>
            <p className="about-section-sub" title={log.userDataDir}>
              用户数据：{log.userDataDir}
            </p>
            <p className="about-section-sub" title={log.logDir}>
              日志目录：{log.logDir}
            </p>
            <p className="about-section-sub">当前日志文件：{log.currentLogFile?.split(/[/\\]/).pop()}</p>
          </>
        ) : (
          <p className="about-section-sub">正在读取日志目录…</p>
        )}
        <Button
          size="small"
          className="settings-dir-btn"
          disabled={!log}
          onClick={async () => {
            const result = (await api()?.openLogDir()) as { ok?: boolean; error?: string } | undefined;
            if (result && result.ok === false) message.warning(result.error || "无法打开日志目录");
          }}
        >
          打开日志目录
        </Button>
      </div>
      <SettingsRow label="重置全部设置" desc="外观 / 灵动岛 / 任务栏 / LX 模式恢复默认（不会清空音乐库）">
        <Button
          danger
          size="small"
          onClick={() => {
            if (window.confirm("确认恢复全部默认设置？")) {
              reset();
              message.success("已恢复默认设置");
            }
          }}
        >
          恢复全部默认
        </Button>
      </SettingsRow>
    </section>
  );
}

const GROUPS: Record<NavKey, () => ReactNode> = {
  appearance: AppearanceGroup,
  island: IslandGroup,
  taskbar: TaskbarGroup,
  lx: LxGroup,
  cache: CacheGroup,
  about: AboutGroup,
};

export function SettingsPage() {
  const { settings } = useSettings();
  const [nav, setNav] = useState<NavKey>("appearance");
  const prefersLight =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches;
  const resolved = resolveTheme(settings.appearance.theme, prefersLight);
  const Active = GROUPS[nav];

  const antdConfig = useMemo(() => createAntdTheme(resolved), [resolved]);

  return (
    <ConfigProvider theme={antdConfig}>
      <div className="settings-page" data-theme={resolved}>
        <nav className="settings-nav" aria-label="设置分组">
          {NAV.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`settings-nav-item${nav === item.key ? " active" : ""}`}
              onClick={() => setNav(item.key)}
            >
              <span className="settings-nav-label">{item.label}</span>
              <span className="settings-nav-desc">{item.desc}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <header className="settings-header">
            <h1 className="settings-title">设置</h1>
            <p className="settings-subtitle">{NAV.find((item) => item.key === nav)?.desc}</p>
          </header>
          <Active />
        </div>
      </div>
    </ConfigProvider>
  );
}

export default SettingsPage;
