import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Switch, message } from "antd";

export type WebDavPageProps = {
  onScanComplete?: (tracks: unknown[], meta: { accountId: string; path: string }) => void;
};

type AccountDraft = {
  id: string;
  name: string;
  url: string;
  user: string;
  pass: string;
  rootPath: string;
  enabled: boolean;
  allowInsecureTls: boolean;
};

type WebDavAccount = AccountDraft;

type BrowseItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  lastmod?: string;
};

type ScanRoot = {
  accountId: string;
  remotePath: string;
};

type ScanProgress = {
  phase?: string;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
};

function api() {
  return window.electronAPI;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function newAccountId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `wd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function emptyDraft(partial?: Partial<AccountDraft>): AccountDraft {
  return {
    id: partial?.id || newAccountId(),
    name: partial?.name ?? "",
    url: partial?.url ?? "",
    user: partial?.user ?? "",
    pass: partial?.pass ?? "",
    rootPath: partial?.rootPath || "/",
    enabled: partial?.enabled ?? true,
    allowInsecureTls: partial?.allowInsecureTls ?? false,
  };
}

function asAccount(raw: unknown): WebDavAccount | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const url = asString(raw.baseUrl) || asString(raw.url);
  if (!id && !name && !url) return null;
  return {
    id,
    name,
    url,
    user: asString(raw.username) || asString(raw.user),
    pass: asString(raw.password) || asString(raw.pass),
    rootPath: asString(raw.rootPath, "/") || "/",
    enabled: raw.enabled !== false,
    allowInsecureTls: asBool(raw.allowInsecureTls),
  };
}

function asAccountList(raw: unknown): WebDavAccount[] {
  const rows = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.accounts)
      ? raw.accounts
      : [];
  return rows.map(asAccount).filter((row): row is WebDavAccount => Boolean(row));
}

function asBrowseItems(raw: unknown): BrowseItem[] {
  const rows = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : isRecord(raw) && Array.isArray(raw.files)
        ? raw.files
        : [];
  const out: BrowseItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const path = asString(row.path) || asString(row.filename) || asString(row.href);
    const name =
      asString(row.name) ||
      asString(row.basename) ||
      path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
      path;
    if (!path && !name) continue;
    const typeRaw = asString(row.type).toLowerCase();
    const isDir =
      typeRaw === "directory" ||
      typeRaw === "dir" ||
      row.directory === true ||
      row.isDir === true;
    const lastmod =
      asString(row.lastmod) ||
      asString(row.lastModified) ||
      (row.lastmod instanceof Date ? row.lastmod.toISOString() : "");
    out.push({
      name: name || path,
      path: path || name,
      type: isDir ? "directory" : "file",
      size: asNumber(row.size),
      lastmod,
    });
  }
  return out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
}

function asScanRoots(raw: unknown): ScanRoot[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ScanRoot[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const accountId = asString(row.accountId);
    const remotePath = asString(row.remotePath) || asString(row.path) || "/";
    if (!accountId) continue;
    out.push({ accountId, remotePath: remotePath || "/" });
  }
  return out;
}

function asScanProgress(raw: unknown): ScanProgress {
  if (!isRecord(raw)) return {};
  return {
    phase: asString(raw.phase) || undefined,
    current: asNumber(raw.current),
    total: asNumber(raw.total),
    message: asString(raw.message) || undefined,
    error: asString(raw.error) || undefined,
  };
}

function asOkResult(raw: unknown): { ok: boolean; error?: string } {
  if (!isRecord(raw)) return { ok: false, error: "无响应" };
  return {
    ok: raw.ok === true,
    error: asString(raw.error) || undefined,
  };
}

function asTrackList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.tracks)) return raw.tracks;
  if (isRecord(raw) && Array.isArray(raw.items)) return raw.items;
  return [];
}

function parentPath(path: string): string {
  if (!path || path === "/") return "/";
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function phaseLabel(phase?: string): string {
  if (phase === "collecting") return "正在收集远程文件";
  if (phase === "parsing" || phase === "reading") return "正在解析音频";
  if (phase === "done" || phase === "complete") return "扫描完成";
  if (phase === "error") return "扫描出错";
  return "正在扫描";
}

function toSavePayload(draft: AccountDraft) {
  return {
    id: draft.id.trim() || undefined,
    name: draft.name.trim(),
    baseUrl: draft.url.trim(),
    url: draft.url.trim(),
    username: draft.user.trim(),
    user: draft.user.trim(),
    password: draft.pass,
    pass: draft.pass,
    rootPath: draft.rootPath.trim() || "/",
    enabled: draft.enabled,
    allowInsecureTls: draft.allowInsecureTls,
  };
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="wd-row">
      <span className="wd-row-text">
        <span className="wd-row-label">{label}</span>
        {hint ? <span className="wd-row-hint">{hint}</span> : null}
      </span>
      <span className="wd-row-control">{children}</span>
    </label>
  );
}

function WebDavPageInner({ onScanComplete }: WebDavPageProps) {
  const [accounts, setAccounts] = useState<WebDavAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [browsePath, setBrowsePath] = useState("/");
  const [entries, setEntries] = useState<BrowseItem[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([]);
  const [lastScanCount, setLastScanCount] = useState<number | null>(null);

  const selected = useMemo(
    () => accounts.find((item) => item.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  const loadAccounts = useCallback(async () => {
    const webdav = api()?.webdav;
    if (!webdav) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = asAccountList(await webdav.listAccounts());
      setAccounts(list);
      setSelectedId((current) => current || list[0]?.id || "");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法读取 WebDAV 账号");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadScanRoots = useCallback(async () => {
    const webdav = api()?.webdav;
    if (!webdav) return;
    try {
      setScanRoots(asScanRoots(await webdav.getScanRoots()));
    } catch {
      setScanRoots([]);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadScanRoots();
  }, [loadAccounts, loadScanRoots]);

  useEffect(() => {
    const off = api()?.webdav?.onScanProgress?.((payload) => {
      setProgress(asScanProgress(payload));
    });
    return () => off?.();
  }, []);

  const browse = useCallback(async (accountId: string, path: string) => {
    const webdav = api()?.webdav;
    if (!webdav || !accountId) return;
    setBrowsing(true);
    try {
      const items = asBrowseItems(await webdav.browse(accountId, path || "/"));
      setEntries(items);
      setBrowsePath(path || "/");
    } catch (error) {
      setEntries([]);
      message.error(error instanceof Error ? error.message : "无法打开目录");
    } finally {
      setBrowsing(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEntries([]);
      setBrowsePath("/");
      return;
    }
    const account = accounts.find((item) => item.id === selectedId);
    void browse(selectedId, account?.rootPath || "/");
  }, [selectedId, accounts, browse]);

  const patchDraft = (patch: Partial<AccountDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const handleTest = async () => {
    const webdav = api()?.webdav;
    if (!webdav) {
      message.error("WebDAV 通道不可用");
      return;
    }
    const target = draft ?? selected;
    if (!target) {
      message.warning("请先选择或填写账号");
      return;
    }
    setTesting(true);
    try {
      const known = accounts.some((item) => item.id === target.id);
      let result: { ok: boolean; error?: string };
      if (known && target.id) {
        result = asOkResult(await webdav.testConnection(target.id));
      } else if (typeof webdav.testConnectionDraft === "function") {
        result = asOkResult(await webdav.testConnectionDraft(toSavePayload(target)));
      } else {
        result = asOkResult(await webdav.testConnection(target.id));
      }
      if (result.ok) message.success("连接成功");
      else message.error(result.error || "连接失败");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const webdav = api()?.webdav;
    if (!webdav || !draft) return;
    if (!draft.name.trim() || !draft.url.trim() || !draft.user.trim()) {
      message.warning("请填写名称、地址和用户名");
      return;
    }
    const isNew = !accounts.some((item) => item.id === draft.id);
    if (isNew && !draft.pass.trim()) {
      message.warning("新账号需要填写密码");
      return;
    }
    setSaving(true);
    try {
      const saved = asAccount(await webdav.saveAccount(toSavePayload(draft)));
      message.success("已保存");
      setDraft(null);
      await loadAccounts();
      if (saved?.id) setSelectedId(saved.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const webdav = api()?.webdav;
    if (!webdav) return;
    const account = accounts.find((item) => item.id === id);
    if (!window.confirm(`删除账号「${account?.name || id}」？`)) return;
    try {
      await webdav.deleteAccount(id);
      message.success("已删除");
      if (draft?.id === id) setDraft(null);
      if (selectedId === id) setSelectedId("");
      await loadAccounts();
      await loadScanRoots();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleScan = async () => {
    const webdav = api()?.webdav;
    if (!webdav || !selectedId) {
      message.warning("请先选择 WebDAV 账号");
      return;
    }
    setScanning(true);
    setProgress({ phase: "collecting", current: 0, total: 0, message: "开始扫描…" });
    try {
      const tracks = asTrackList(await webdav.scan(selectedId, browsePath || "/"));
      await loadScanRoots();
      setLastScanCount(tracks.length);
      if (tracks.length === 0) {
        message.warning("该目录下未找到音频文件");
      } else {
        message.success(`已扫描 ${tracks.length} 首 WebDAV 歌曲`);
        onScanComplete?.(tracks, { accountId: selectedId, path: browsePath || "/" });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  };

  const handleCancelScan = async () => {
    try {
      await api()?.webdav?.cancelScan();
      message.info("已取消扫描");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消失败");
    } finally {
      setScanning(false);
    }
  };

  const handleSaveCurrentRoot = async () => {
    const webdav = api()?.webdav;
    if (!webdav || !selectedId) return;
    const next = [
      ...scanRoots.filter((root) => !(root.accountId === selectedId && root.remotePath === browsePath)),
      { accountId: selectedId, remotePath: browsePath || "/" },
    ];
    try {
      setScanRoots(asScanRoots(await webdav.saveScanRoots(next)));
      message.success("已加入扫描根目录");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存扫描目录失败");
    }
  };

  const handleRemoveRoot = async (root: ScanRoot) => {
    const webdav = api()?.webdav;
    if (!webdav) return;
    const next = scanRoots.filter(
      (item) => !(item.accountId === root.accountId && item.remotePath === root.remotePath),
    );
    try {
      setScanRoots(asScanRoots(await webdav.saveScanRoots(next)));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "移除失败");
    }
  };

  const percent =
    progress && progress.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.current ?? 0) / progress.total) * 100))
      : 0;

  return (
    <div className="webdav-page">
      <style>{PAGE_CSS}</style>
      <header className="wd-hero">
        <div>
          <div className="wd-kicker">Library</div>
          <h1 className="wd-title">WebDAV 网络库</h1>
          <p className="wd-sub">连接群晖、极空间、坚果云。浏览远程目录并扫描音频加入曲库。</p>
        </div>
      </header>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>账号</h2>
          <Button type="primary" onClick={() => setDraft(emptyDraft())}>
            添加账号
          </Button>
        </div>
        {loading ? (
          <p className="wd-muted">加载中…</p>
        ) : accounts.length === 0 && !draft ? (
          <p className="wd-muted">尚未添加 WebDAV 账号</p>
        ) : (
          <ul className="wd-account-list">
            {accounts.map((account) => (
              <li
                key={account.id}
                className={`wd-account${selectedId === account.id ? " is-active" : ""}${account.enabled ? "" : " is-off"}`}
              >
                <button
                  type="button"
                  className="wd-account-main"
                  onClick={() => setSelectedId(account.id)}
                >
                  <span className="wd-account-name">{account.name || "未命名"}</span>
                  <span className="wd-account-meta">
                    {account.url} · {account.user || "无用户名"}
                    {account.enabled ? "" : " · 已停用"}
                  </span>
                </button>
                <span className="wd-account-actions">
                  <Button
                    size="small"
                    onClick={() => {
                      setSelectedId(account.id);
                      setDraft({ ...account, pass: "" });
                    }}
                  >
                    编辑
                  </Button>
                  <Button size="small" danger onClick={() => void handleDelete(account.id)}>
                    删除
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft ? (
        <section className="wd-card">
          <div className="wd-card-head">
            <h2>{accounts.some((item) => item.id === draft.id) ? "编辑账号" : "添加账号"}</h2>
          </div>
          <div className="wd-form">
            <FormRow label="ID" hint="可留空自动生成">
              <Input
                value={draft.id}
                onChange={(ev) => patchDraft({ id: ev.target.value })}
                placeholder="自动生成"
              />
            </FormRow>
            <FormRow label="名称">
              <Input
                value={draft.name}
                onChange={(ev) => patchDraft({ name: ev.target.value })}
                placeholder="家庭 NAS"
              />
            </FormRow>
            <FormRow label="地址" hint="群晖 :5006 · 极空间 /dav/ · 坚果云 dav.jianguoyun.com/dav/">
              <Input
                value={draft.url}
                onChange={(ev) => patchDraft({ url: ev.target.value })}
                placeholder="https://nas.example.com:5006"
              />
            </FormRow>
            <FormRow label="用户名">
              <Input
                value={draft.user}
                onChange={(ev) => patchDraft({ user: ev.target.value })}
                autoComplete="off"
              />
            </FormRow>
            <FormRow label="密码" hint={draft.id && accounts.some((item) => item.id === draft.id) ? "留空则保持原密码" : undefined}>
              <Input.Password
                value={draft.pass}
                onChange={(ev) => patchDraft({ pass: ev.target.value })}
                autoComplete="new-password"
              />
            </FormRow>
            <FormRow label="音乐根目录" hint="远程路径，通常为 / 或 /Music">
              <Input
                value={draft.rootPath}
                onChange={(ev) => patchDraft({ rootPath: ev.target.value })}
                placeholder="/"
              />
            </FormRow>
            <FormRow label="允许不受信证书" hint="内网 NAS 自签名 HTTPS 可开启">
              <Switch
                checked={draft.allowInsecureTls}
                onChange={(checked) => patchDraft({ allowInsecureTls: checked })}
              />
            </FormRow>
            <FormRow label="启用" hint="关闭后无法浏览与扫描">
              <Switch checked={draft.enabled} onChange={(checked) => patchDraft({ enabled: checked })} />
            </FormRow>
            <div className="wd-form-actions">
              <Button onClick={() => void handleTest()} loading={testing} disabled={saving}>
                {testing ? "测试中…" : "测试连接"}
              </Button>
              <Button onClick={() => setDraft(null)}>取消</Button>
              <Button type="primary" onClick={() => void handleSave()} loading={saving}>
                保存
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>浏览与扫描</h2>
          <div className="wd-browse-tools">
            <select
              className="wd-select"
              value={selectedId}
              onChange={(ev) => setSelectedId(ev.target.value)}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 ? <option value="">请先添加账号</option> : null}
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <Button
              disabled={!selectedId || browsePath === "/" || browsing}
              onClick={() => void browse(selectedId, parentPath(browsePath))}
            >
              上级
            </Button>
            <Button disabled={!selectedId || browsing} onClick={() => void browse(selectedId, browsePath || "/")}>
              刷新
            </Button>
          </div>
        </div>
        <div className="wd-path">{browsePath || "/"}</div>
        <div className="wd-browse-list">
          {browsing ? (
            <div className="wd-muted">加载中…</div>
          ) : !selectedId ? (
            <div className="wd-muted">请先在上方添加并选择 WebDAV 账号</div>
          ) : entries.length === 0 ? (
            <div className="wd-muted">此目录为空</div>
          ) : (
            entries.map((item) => (
              <button
                type="button"
                className="wd-browse-item"
                key={item.path}
                disabled={item.type !== "directory"}
                onClick={() => {
                  if (item.type === "directory") void browse(selectedId, item.path);
                }}
              >
                <span className="wd-browse-kind">{item.type === "directory" ? "文件夹" : "文件"}</span>
                <span className="wd-browse-name">{item.name}</span>
                <span className="wd-browse-meta">
                  {item.type === "directory" ? "" : formatSize(item.size)}
                </span>
              </button>
            ))
          )}
        </div>
        {(scanning || progress) && (
          <div className="wd-progress">
            <div className="wd-progress-meta">
              <span>{progress?.message || phaseLabel(progress?.phase)}</span>
              {progress?.total ? <span>{percent}%</span> : null}
            </div>
            <div className="wd-progress-track">
              <div
                className={`wd-progress-bar${progress?.total ? "" : " is-indeterminate"}`}
                style={progress?.total ? { width: `${percent}%` } : undefined}
              />
            </div>
            {progress?.error ? <div className="wd-progress-error">{progress.error}</div> : null}
          </div>
        )}
        <div className="wd-scan-footer">
          <p className="wd-muted">将扫描当前目录及子文件夹中的音频。扫描根目录会自动保存。</p>
          <div className="wd-form-actions">
            <Button disabled={!selectedId || scanning} onClick={() => void handleSaveCurrentRoot()}>
              设为扫描根目录
            </Button>
            {scanning ? (
              <Button danger onClick={() => void handleCancelScan()}>
                取消扫描
              </Button>
            ) : (
              <Button type="primary" disabled={!selectedId || browsing} onClick={() => void handleScan()}>
                扫描此目录
              </Button>
            )}
          </div>
          {lastScanCount != null ? <p className="wd-muted">最近一次扫描：{lastScanCount} 首</p> : null}
        </div>
      </section>

      <section className="wd-card">
        <div className="wd-card-head">
          <h2>扫描根目录</h2>
        </div>
        {scanRoots.length === 0 ? (
          <p className="wd-muted">尚未保存扫描根目录。浏览到音乐文件夹后点击「扫描此目录」。</p>
        ) : (
          <ul className="wd-root-list">
            {scanRoots.map((root) => {
              const account = accounts.find((item) => item.id === root.accountId);
              return (
                <li className="wd-root-item" key={`${root.accountId}:${root.remotePath}`}>
                  <div>
                    <div className="wd-account-name">{account?.name || root.accountId}</div>
                    <div className="wd-account-meta">{root.remotePath}</div>
                  </div>
                  <div className="wd-form-actions">
                    <Button
                      size="small"
                      onClick={() => {
                        setSelectedId(root.accountId);
                        void browse(root.accountId, root.remotePath);
                      }}
                    >
                      打开
                    </Button>
                    <Button size="small" danger onClick={() => void handleRemoveRoot(root)}>
                      移除
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export const WebDavPage = memo(WebDavPageInner);
export default WebDavPage;

const PAGE_CSS = `
.webdav-page{padding:24px 36px 48px;height:100%;overflow:auto;box-sizing:border-box;color:var(--ink,#1a1a2e)}
.wd-hero{margin-bottom:22px}
.wd-kicker{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--signal-deep,#173a52)}
.wd-title{margin:6px 0 4px;font-size:32px;letter-spacing:-1px}
.wd-sub{margin:0;color:var(--ink-muted,#555570);font-size:13px;max-width:52ch;line-height:1.5}
.wd-card{background:var(--paper,#fffef9);border-radius:var(--radius-lg,10px);box-shadow:var(--shadow,0 10px 32px rgba(26,26,46,.08));padding:18px 20px;margin-bottom:16px;border:1px solid var(--line,rgba(26,26,46,.12))}
.wd-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.wd-card-head h2{margin:0;font-size:16px}
.wd-muted{color:var(--ink-muted,#555570);font-size:13px;margin:0}
.wd-account-list,.wd-root-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.wd-account,.wd-root-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--line,rgba(26,26,46,.12));background:color-mix(in srgb, var(--paper,#fffef9) 88%, #facc15 12%)}
.wd-account.is-active{outline:2px solid #173a52;background:#facc15}
html[data-theme="dark"] .wd-account.is-active{outline-color:#5a8fad;background:#173a52;color:#e8eef4}
.wd-account.is-off{opacity:.62}
.wd-account-main{border:0;background:transparent;text-align:left;cursor:pointer;min-width:0;flex:1;color:inherit;display:flex;flex-direction:column;gap:2px}
.wd-account-name{font-weight:700}
.wd-account-meta{font-size:12px;color:var(--ink-muted,#555570);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-account-actions,.wd-form-actions,.wd-browse-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.wd-form{display:flex;flex-direction:column}
.wd-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--line,rgba(26,26,46,.12))}
.wd-row-text{min-width:0;display:flex;flex-direction:column;gap:2px}
.wd-row-label{font-weight:600}
.wd-row-hint{font-size:12px;color:var(--ink-muted,#555570);line-height:1.4}
.wd-row-control{flex:0 1 280px;min-width:180px}
.wd-form-actions{margin-top:14px}
.wd-select{height:34px;border-radius:999px;border:1px solid var(--line,rgba(26,26,46,.14));background:var(--paper,#fffef9);color:inherit;padding:0 12px;min-width:180px}
.wd-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb, #173a52 8%, var(--paper,#fffef9));margin-bottom:10px;word-break:break-all}
.wd-browse-list{display:flex;flex-direction:column;max-height:320px;overflow:auto;border:1px solid var(--line,rgba(26,26,46,.12));border-radius:10px}
.wd-browse-item{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 12px;border:0;border-bottom:1px solid var(--line,rgba(26,26,46,.08));background:transparent;color:inherit;text-align:left;cursor:pointer}
.wd-browse-item:last-child{border-bottom:0}
.wd-browse-item:hover:not(:disabled){background:var(--bg-hover,rgba(250,204,21,.22))}
.wd-browse-item:disabled{cursor:default;opacity:.82}
.wd-browse-kind{font-size:11px;font-weight:700;color:#173a52}
html[data-theme="dark"] .wd-browse-kind{color:#facc15}
.wd-browse-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-browse-meta{font-size:12px;color:var(--ink-muted,#555570)}
.wd-progress{margin:12px 0}
.wd-progress-meta{display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;color:var(--ink-muted,#555570)}
.wd-progress-track{height:6px;border-radius:999px;background:rgba(23,58,82,.16);overflow:hidden}
.wd-progress-bar{height:100%;width:32%;background:#173a52;border-radius:999px}
html[data-theme="dark"] .wd-progress-bar{background:#facc15}
.wd-progress-bar.is-indeterminate{animation:wd-indet 1.2s ease-in-out infinite}
.wd-progress-error{margin-top:6px;color:#ff4d6a;font-size:12px}
.wd-scan-footer{margin-top:12px;display:flex;flex-direction:column;gap:10px}
@keyframes wd-indet{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
`;
