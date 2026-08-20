import { useEffect, useMemo, useState } from "react";
import { Button, Input, message } from "antd";
import { IconClose } from "../icons/Icons";

export type ImportPlaylistSource = "netease" | "qq" | "kugou" | "kuwo";

export type ImportedPlaylist = {
  source: string;
  id: string;
  url: string;
};

export type ImportPlaylistDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported: (payload: ImportedPlaylist) => void;
};

const PLATFORMS: Array<{ id: ImportPlaylistSource; label: string }> = [
  { id: "netease", label: "网易云" },
  { id: "qq", label: "QQ 音乐" },
  { id: "kugou", label: "酷狗" },
  { id: "kuwo", label: "酷我" },
];

const PLACEHOLDER: Record<ImportPlaylistSource, string> = {
  netease: "歌单 ID 或 https://music.163.com/playlist?id=43800095",
  qq: "歌单 ID 或 https://y.qq.com/n/ryqq/playlist/8513233778",
  kugou: "歌单 ID 或 https://www.kugou.com/yy/special/single/546903.html",
  kuwo: "歌单 ID 或 https://www.kuwo.cn/playlist_detail/1082685103",
};

export function parseNeteasePlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromQuery = text.match(/playlist\?id=(\d+)/i) || text.match(/[?&#]id=(\d+)/i);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromPath = text.match(/\/playlist\/(\d+)/i);
  if (fromPath?.[1]) return fromPath[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}

export function parseQqPlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.pathname.toLowerCase().includes("playlist")) {
      for (const key of ["id", "disstid", "dissid"]) {
        const value = url.searchParams.get(key);
        if (value && /^\d+$/.test(value)) return value;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((part) => part.toLowerCase() === "playlist");
      if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) return parts[idx + 1];
    }
  } catch {
    /* not a URL */
  }
  const fromPath = text.match(/(?:^|\/)playlist\/(\d+)(?:[/?#]|$)/i);
  if (fromPath?.[1]) return fromPath[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}

export function parseKugouPlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const html = text.match(/special\/single\/(\d+)\.html/i);
  if (html?.[1]) return html[1];
  const gcid = text.match(/songlist\/(gcid_[a-zA-Z0-9]+)/i);
  if (gcid?.[1]) return gcid[1];
  const generic = text.match(/\/playlist\/(\d+)/i) || text.match(/[?&#]id=(\d+)/i);
  if (generic?.[1]) return generic[1];
  if (/^\d+$/.test(text) || /^gcid_[a-zA-Z0-9]+$/i.test(text)) return text;
  return null;
}

export function parseKuwoPlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromPath = text.match(/playlist_detail\/(\d+)/i) || text.match(/\/playlist\/(\d+)/i);
  if (fromPath?.[1]) return fromPath[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}

export function parsePlaylistId(source: string, input: string): string | null {
  if (source === "netease") return parseNeteasePlaylistId(input);
  if (source === "qq") return parseQqPlaylistId(input);
  if (source === "kugou") return parseKugouPlaylistId(input);
  if (source === "kuwo") return parseKuwoPlaylistId(input);
  return parseNeteasePlaylistId(input) || parseQqPlaylistId(input);
}

function hasNeteaseQrPost(): boolean {
  return typeof window.electronAPI?.neteaseQrPost === "function";
}

export function ImportPlaylistDialog({ open, onClose, onImported }: ImportPlaylistDialogProps) {
  const [source, setSource] = useState<ImportPlaylistSource>("netease");
  const [mode, setMode] = useState<"link" | "qr">("link");
  const [url, setUrl] = useState("");
  const qrAvailable = useMemo(() => hasNeteaseQrPost(), [open]);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setMode("link");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = () => {
    const raw = url.trim();
    if (!raw) {
      message.warning("请输入歌单 ID 或链接");
      return;
    }
    const id = parsePlaylistId(source, raw);
    if (!id) {
      message.warning("无法从链接解析歌单 ID");
      return;
    }
    onImported({ source, id, url: raw });
    setUrl("");
    onClose();
  };

  const showQr = source === "netease" && qrAvailable;

  return (
    <div className="ipd-overlay" onClick={onClose}>
      <style>{DIALOG_CSS}</style>
      <div
        className="ipd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="导入歌单"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ipd-header">
          <div>
            <div className="ipd-kicker">Library</div>
            <h3 className="ipd-title">导入歌单</h3>
          </div>
          <button type="button" className="ipd-close" onClick={onClose} aria-label="关闭">
            <IconClose size={16} />
          </button>
        </header>

        <div className="ipd-platforms">
          {PLATFORMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`ipd-chip${source === item.id ? " is-active" : ""}`}
              onClick={() => {
                setSource(item.id);
                setMode(item.id === "netease" && qrAvailable ? mode : "link");
              }}
            >
              {item.label}
              {item.id === "kuwo" ? <span className="ipd-badge">仅链接</span> : null}
            </button>
          ))}
        </div>

        {showQr ? (
          <div className="ipd-modes" role="tablist">
            <button
              type="button"
              className={`ipd-mode${mode === "link" ? " is-active" : ""}`}
              onClick={() => setMode("link")}
            >
              链接导入
            </button>
            <button
              type="button"
              className={`ipd-mode${mode === "qr" ? " is-active" : ""}`}
              onClick={() => setMode("qr")}
            >
              扫码导入
            </button>
          </div>
        ) : null}

        {showQr && mode === "qr" ? (
          <div className="ipd-qr">
            <p>已检测到网易云扫码通道（neteaseQrPost）。可用网易云 App 扫码登录后导入歌单，或切换到「链接导入」粘贴歌单地址。</p>
            <p className="ipd-qr-note">扫码会话由父级路由接入，本对话框负责解析歌单 ID。</p>
          </div>
        ) : (
          <label className="ipd-field" htmlFor="import-playlist-url">
            <span>
              输入{source === "netease" ? "网易云" : source === "qq" ? "QQ" : source === "kugou" ? "酷狗" : "酷我"}
              歌单链接
            </span>
            <Input.TextArea
              id="import-playlist-url"
              value={url}
              rows={4}
              placeholder={PLACEHOLDER[source]}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) confirm();
              }}
            />
          </label>
        )}

        <footer className="ipd-footer">
          <Button onClick={onClose}>取消</Button>
          {!(showQr && mode === "qr") ? (
            <Button type="primary" disabled={!url.trim()} onClick={confirm}>
              导入
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

export default ImportPlaylistDialog;

const DIALOG_CSS = `
.ipd-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,#1a1a2e 46%,transparent);padding:24px}
.ipd-modal{width:min(540px,calc(100vw - 48px));background:var(--paper,#fffef9);color:var(--ink,#1a1a2e);border-radius:16px;border:1px solid var(--line,rgba(26,26,46,.12));box-shadow:var(--shadow-pop,3px 3px 0 #1a1a2e);padding:18px 20px 16px}
.ipd-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.ipd-kicker{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#173a52}
.ipd-title{margin:4px 0 0;font-size:22px;letter-spacing:-.6px}
.ipd-close{width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.ipd-close:hover{background:var(--bg-hover,rgba(250,204,21,.22))}
.ipd-platforms{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.ipd-chip{border:1px solid var(--line,rgba(26,26,46,.14));background:var(--paper,#fffef9);color:inherit;border-radius:999px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-weight:600}
.ipd-chip.is-active{background:#facc15;border-color:#1a1a2e;color:#1a1a2e}
html[data-theme="dark"] .ipd-chip.is-active{background:#173a52;border-color:#5a8fad;color:#e8eef4}
.ipd-badge{font-size:10px;font-weight:700;opacity:.7}
.ipd-modes{display:flex;gap:8px;margin-bottom:12px}
.ipd-mode{border:0;background:color-mix(in srgb,#173a52 8%,var(--paper,#fffef9));color:inherit;border-radius:10px;padding:8px 12px;cursor:pointer;font-weight:600}
.ipd-mode.is-active{background:#173a52;color:#fffef9}
html[data-theme="dark"] .ipd-mode.is-active{background:#facc15;color:#1a1a2e}
.ipd-field{display:flex;flex-direction:column;gap:8px;font-size:13px;font-weight:600}
.ipd-qr{padding:16px;border-radius:12px;background:color-mix(in srgb,#173a52 8%,var(--paper,#fffef9));line-height:1.6;font-size:13px}
.ipd-qr p{margin:0 0 8px}
.ipd-qr-note{color:var(--ink-muted,#555570);font-size:12px}
.ipd-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
`;
