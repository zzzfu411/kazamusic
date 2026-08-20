import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, message } from "antd";

export const NETEASE_COOKIE_KEY = "kazam.netease.cookie";

const UNIKEY_URL = "https://interface.music.163.com/api/login/qrcode/unikey";
const QR_LOGIN_URL = "https://interface.music.163.com/api/login/qrcode/client/login";
const QR_FORM_TYPE = "application/x-www-form-urlencoded";
const POLL_MS = 2000;
const QR_CODEKEY = "https://music.163.com/login?codekey=";

type QrStatus = "idle" | "loading" | "waiting" | "scanned" | "success" | "expired" | "failed";

type M7User = {
  username?: string;
  email?: string;
};

function api(): Window["electronAPI"] | undefined {
  return typeof window === "undefined" ? undefined : window.electronAPI;
}

function readNeteaseCookie(): string {
  try {
    return (localStorage.getItem(NETEASE_COOKIE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeNeteaseCookie(value: string): void {
  const next = value.trim();
  try {
    if (next) localStorage.setItem(NETEASE_COOKIE_KEY, next);
    else localStorage.removeItem(NETEASE_COOKIE_KEY);
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new CustomEvent("kazam:netease-cookie", { detail: next }));
}

function parseQrPost(raw: unknown): { body: Record<string, unknown>; headerCookies: string } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if ("unikey" in obj || "code" in obj || "cookie" in obj) {
      return { body: obj, headerCookies: "" };
    }
  }
  const text = typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw);
  const nl = text.indexOf("\n");
  const head = (nl >= 0 ? text.slice(0, nl) : text).trim();
  const cookies = nl >= 0 ? text.slice(nl + 1).trim() : "";
  let body: Record<string, unknown> = { code: -1 };
  try {
    if (head) body = JSON.parse(head) as Record<string, unknown>;
  } catch {
    throw new Error(`网易云响应解析失败: ${head.slice(0, 80)}`);
  }
  return { body, headerCookies: cookies };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function requestUnikey(): Promise<string> {
  const electron = api();
  if (electron?.neteaseQrPost) {
    const raw = await electron.neteaseQrPost(UNIKEY_URL, "type=3", QR_FORM_TYPE);
    const { body } = parseQrPost(raw);
    const key = body.unikey;
    if (Number(body.code) === 200 && key) return String(key);
    throw new Error(String(body.message || body.msg || `获取二维码失败(code=${body.code})`));
  }
  if (electron?.neteaseEapi) {
    const raw = await electron.neteaseEapi("/eapi/login/qrcode/unikey", JSON.stringify({ type: 3 }));
    const json = asRecord(raw);
    const key = json?.unikey;
    if (key) return String(key);
    throw new Error(String(json?.message || json?.msg || "获取二维码失败"));
  }
  throw new Error("当前构建未暴露网易云扫码接口");
}

async function pollQrLogin(key: string): Promise<{ status: QrStatus; cookie?: string; message?: string }> {
  const electron = api();
  let body: Record<string, unknown> = { code: -1 };
  let headerCookies = "";
  if (electron?.neteaseQrPost) {
    const raw = await electron.neteaseQrPost(
      QR_LOGIN_URL,
      `key=${encodeURIComponent(key)}&type=3`,
      QR_FORM_TYPE,
    );
    const parsed = parseQrPost(raw);
    body = parsed.body;
    headerCookies = parsed.headerCookies;
  } else if (electron?.neteaseEapi) {
    const raw = await electron.neteaseEapi(
      "/eapi/login/qrcode/client/login",
      JSON.stringify({ key, type: 3 }),
    );
    body = asRecord(raw) || { code: -1 };
  } else {
    throw new Error("当前构建未暴露网易云扫码接口");
  }
  const code = Number(body.code);
  const status: QrStatus =
    code === 803
      ? "success"
      : code === 802
        ? "scanned"
        : code === 801
          ? "waiting"
          : code === 800
            ? "expired"
            : "failed";
  if (status === "success") {
    let cookie = String(body.cookie || "").trim();
    if (!cookie) cookie = headerCookies;
    if (!cookie) return { status: "failed", message: "登录成功但未获取到 cookie，请重试" };
    return { status, cookie };
  }
  return {
    status,
    message: typeof body.message === "string" ? body.message : undefined,
  };
}

async function qrImageForUrl(url: string): Promise<string> {
  try {
    return encodeQrDataUrl(url);
  } catch {
    /* fall through to remote renderer */
  }
  const remote = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(url)}`;
  try {
    const fetched = await api()?.fetchImage?.(remote);
    if (typeof fetched === "string" && fetched.startsWith("data:")) return fetched;
  } catch {
    /* use remote url */
  }
  return remote;
}

function cookieLoggedIn(cookie: string): boolean {
  return /MUSIC_U=|MUSIC_A=|__csrf=/i.test(cookie) || cookie.length > 12;
}

function pickM7User(raw: unknown): M7User | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const nested = asRecord(rec.user);
  const src = nested || rec;
  const username = typeof src.username === "string" ? src.username : typeof src.name === "string" ? src.name : "";
  const email = typeof src.email === "string" ? src.email : "";
  if (!username && !email) return null;
  return { username: username || email, email };
}

function qrStatusText(status: QrStatus): string {
  if (status === "loading") return "正在获取二维码…";
  if (status === "waiting") return "请用网易云音乐 App 扫描二维码";
  if (status === "scanned") return "已扫码，请在手机上确认登录";
  if (status === "expired") return "二维码已过期";
  if (status === "failed") return "获取失败";
  if (status === "success") return "登录成功";
  return "";
}

export function UserCenter() {
  const [cookie, setCookie] = useState(readNeteaseCookie);
  const [cookieDraft, setCookieDraft] = useState(() => readNeteaseCookie());
  const [qrStatus, setQrStatus] = useState<QrStatus>("idle");
  const [qrImage, setQrImage] = useState("");
  const [qrError, setQrError] = useState("");
  const [m7User, setM7User] = useState<M7User | null>(null);
  const [m7Name, setM7Name] = useState("");
  const [m7Pass, setM7Pass] = useState("");
  const [m7Busy, setM7Busy] = useState(false);
  const [m7Loading, setM7Loading] = useState(true);

  const pollRef = useRef<number | null>(null);
  const qrGen = useRef(0);

  const neteaseOn = cookieLoggedIn(cookie);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const persistCookie = useCallback((value: string) => {
    writeNeteaseCookie(value);
    setCookie(value.trim());
    setCookieDraft(value.trim());
  }, []);

  const startQrLogin = useCallback(async () => {
    stopPoll();
    const gen = ++qrGen.current;
    setQrError("");
    setQrImage("");
    setQrStatus("loading");
    try {
      const key = await requestUnikey();
      if (gen !== qrGen.current) return;
      const url = `${QR_CODEKEY}${encodeURIComponent(key)}`;
      const image = await qrImageForUrl(url);
      if (gen !== qrGen.current) return;
      setQrImage(image);
      setQrStatus("waiting");
      let fails = 0;
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const result = await pollQrLogin(key);
            if (gen !== qrGen.current) return;
            fails = 0;
            setQrStatus(result.status);
            if (result.status === "success" && result.cookie) {
              stopPoll();
              persistCookie(result.cookie);
              setQrImage("");
              message.success("网易云登录成功");
            } else if (result.status === "expired" || result.status === "failed") {
              stopPoll();
              if (result.message) setQrError(result.message);
            }
          } catch (err) {
            fails += 1;
            if (gen !== qrGen.current) return;
            if (fails >= 3) {
              stopPoll();
              setQrStatus("failed");
              setQrError(err instanceof Error ? err.message : "扫码状态查询失败");
            }
          }
        })();
      }, POLL_MS);
    } catch (err) {
      if (gen !== qrGen.current) return;
      setQrStatus("failed");
      setQrError(err instanceof Error ? err.message : "获取二维码失败");
    }
  }, [persistCookie, stopPoll]);

  useEffect(() => () => {
    qrGen.current += 1;
    stopPoll();
  }, [stopPoll]);

  useEffect(() => {
    let cancelled = false;
    const electron = api();
    void (async () => {
      try {
        const token = await electron?.m7GetToken?.();
        if (!token) return;
        const me = await electron?.m7GetMe?.();
        if (!cancelled) setM7User(pickM7User(me));
      } catch {
        if (!cancelled) setM7User(null);
      } finally {
        if (!cancelled) setM7Loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveCookie = () => {
    const next = cookieDraft.trim();
    if (!next) {
      message.warning("请粘贴网易云 Cookie");
      return;
    }
    persistCookie(next);
    message.success("已保存网易云 Cookie");
  };

  const logoutNetease = () => {
    stopPoll();
    qrGen.current += 1;
    persistCookie("");
    setQrStatus("idle");
    setQrImage("");
    setQrError("");
    message.info("已退出网易云");
  };

  const loginM7 = async () => {
    const user = m7Name.trim();
    if (!user || !m7Pass) {
      message.warning("请输入 KAZAM 账号和密码");
      return;
    }
    setM7Busy(true);
    try {
      const result = await api()?.m7Login?.(user, m7Pass);
      const parsed = pickM7User(result);
      setM7User(parsed || { username: user });
      setM7Pass("");
      message.success("KAZAM 账号已登录");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "KAZAM 登录失败");
    } finally {
      setM7Busy(false);
    }
  };

  const logoutM7 = async () => {
    setM7Busy(true);
    try {
      await api()?.m7ClearToken?.();
      setM7User(null);
      message.info("已退出 KAZAM 账号");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "退出失败");
    } finally {
      setM7Busy(false);
    }
  };

  return (
    <div className="user-center-page">
      <style>{USER_CENTER_CSS}</style>
      <header className="uc-header">
        <h1 className="uc-title">用户中心</h1>
        <p className="uc-subtitle">网易云登录用于红心和歌单；KAZAM 账号可选。</p>
      </header>

      <section className="uc-card">
        <div className="uc-card-head">
          <h2 className="uc-card-title">网易云音乐</h2>
          <span className={`uc-badge${neteaseOn ? " is-on" : ""}`}>{neteaseOn ? "已登录" : "未登录"}</span>
        </div>
        <p className="uc-card-desc">
          扫码或粘贴 Cookie。登录后可用于收藏、歌单同步与部分取链。
        </p>

        {neteaseOn ? (
          <div className="uc-logged">
            <div className="uc-avatar" aria-hidden>
              云
            </div>
            <div className="uc-logged-copy">
              <div className="uc-logged-name">网易云已连接</div>
              <div className="uc-logged-meta">Cookie 已保存在本地</div>
            </div>
            <Button danger onClick={logoutNetease}>
              退出
            </Button>
          </div>
        ) : (
          <>
            <div className="uc-actions">
              <Button type="primary" onClick={() => void startQrLogin()} loading={qrStatus === "loading"}>
                扫码登录
              </Button>
              {(qrStatus === "expired" || qrStatus === "failed") && (
                <Button onClick={() => void startQrLogin()}>重新获取</Button>
              )}
            </div>
            {qrImage ? (
              <div className="uc-qr">
                <div className="uc-qr-wrap">
                  <img src={qrImage} alt="扫码登录" className="uc-qr-img" />
                  {qrStatus === "expired" ? (
                    <button type="button" className="uc-qr-overlay" onClick={() => void startQrLogin()}>
                      <span>↻</span>
                      <span>点击刷新</span>
                    </button>
                  ) : null}
                </div>
                <div className="uc-qr-status">
                  <span className={`uc-qr-dot is-${qrStatus}`} />
                  <span>{qrStatusText(qrStatus)}</span>
                </div>
              </div>
            ) : qrStatus === "loading" ? (
              <p className="uc-hint">正在获取二维码…</p>
            ) : null}
            {qrError ? <p className="uc-error">{qrError}</p> : null}
          </>
        )}

        <div className="uc-cookie">
          <div className="uc-cookie-label">Cookie</div>
          <Input.TextArea
            value={cookieDraft}
            onChange={(event) => setCookieDraft(event.target.value)}
            placeholder="MUSIC_U=… ; __csrf=…"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <div className="uc-actions">
            <Button type="primary" onClick={saveCookie}>
              保存
            </Button>
            {cookie ? (
              <Button onClick={logoutNetease}>清除</Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="uc-card uc-card-m7">
        <div className="uc-card-head">
          <h2 className="uc-card-title">KAZAM 账号</h2>
          <span className={`uc-badge${m7User ? " is-on" : ""}`}>
            {m7Loading ? "…" : m7User ? "已登录" : "可选"}
          </span>
        </div>
        <p className="uc-card-desc">产品账号，与网易云登录相互独立，不影响扫码。</p>
        {m7User ? (
          <div className="uc-logged">
            <div className="uc-avatar is-m7" aria-hidden>
              {(m7User.username || "K").slice(0, 1).toUpperCase()}
            </div>
            <div className="uc-logged-copy">
              <div className="uc-logged-name">{m7User.username || "KAZAM"}</div>
              <div className="uc-logged-meta">{m7User.email || "已登录"}</div>
            </div>
            <Button onClick={() => void logoutM7()} loading={m7Busy}>
              退出
            </Button>
          </div>
        ) : (
          <div className="uc-m7-form">
            <Input
              value={m7Name}
              onChange={(event) => setM7Name(event.target.value)}
              placeholder="邮箱 / 用户名"
              autoComplete="username"
            />
            <Input.Password
              value={m7Pass}
              onChange={(event) => setM7Pass(event.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              onPressEnter={() => void loginM7()}
            />
            <Button type="primary" onClick={() => void loginM7()} loading={m7Busy}>
              登录
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

export default UserCenter;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGenerator(ec: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ec; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ec: number): Uint8Array {
  const gen = rsGenerator(ec);
  const res = new Uint8Array(data.length + ec);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i]!;
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j]!, coef);
  }
  return res.slice(data.length);
}

const QR_VERSIONS = [
  { version: 1, size: 21, data: 19, ec: 7, align: 0 },
  { version: 2, size: 25, data: 34, ec: 10, align: 18 },
  { version: 3, size: 29, data: 55, ec: 15, align: 22 },
  { version: 4, size: 33, data: 80, ec: 20, align: 26 },
  { version: 5, size: 37, data: 108, ec: 26, align: 30 },
] as const;

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function encodeQrDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const spec = QR_VERSIONS.find((item) => bytes.length + 2 <= item.data);
  if (!spec) throw new Error("qr too long");
  const totalBits = spec.data * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const term = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let pad = 0;
  while (bits.length < totalBits) {
    push(pads[pad % 2]!, 8);
    pad += 1;
  }
  const data = new Uint8Array(spec.data);
  for (let i = 0; i < spec.data; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i * 8 + j] || 0);
    data[i] = v;
  }
  const ec = rsEncode(data, spec.ec);
  const codewords = new Uint8Array(spec.data + spec.ec);
  codewords.set(data);
  codewords.set(ec, spec.data);
  const stream: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) stream.push((cw >>> i) & 1);
  }

  const size = spec.size;
  const reserved: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const stamp = (row: number, col: number) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    reserved[row]![col] = true;
  };
  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) stamp(row + r, col + c);
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 0; i < size; i++) {
    stamp(6, i);
    stamp(i, 6);
  }
  if (spec.align) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) stamp(spec.align + r, spec.align + c);
    }
  }
  for (let i = 0; i < 9; i++) {
    stamp(8, i);
    stamp(i, 8);
  }
  stamp(8, 7);
  stamp(7, 8);
  for (let i = 0; i < 8; i++) stamp(size - 1 - i, 8);
  for (let i = 0; i < 8; i++) stamp(8, size - 1 - i);

  const paintFinder = (matrix: boolean[][], row: number, col: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const on = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[row + r]![col + c] = on;
      }
    }
  };

  const build = (mask: number): boolean[][] => {
    const matrix: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    paintFinder(matrix, 0, 0);
    paintFinder(matrix, 0, size - 7);
    paintFinder(matrix, size - 7, 0);
    for (let i = 8; i < size - 8; i++) {
      matrix[6]![i] = i % 2 === 0;
      matrix[i]![6] = i % 2 === 0;
    }
    if (spec.align) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          matrix[spec.align + r]![spec.align + c] =
            Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
    matrix[size - 8]![8] = true;
    let bit = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (reserved[row]![c]!) continue;
          let dark = bit < stream.length ? stream[bit] === 1 : false;
          if (maskBit(mask, row, c)) dark = !dark;
          matrix[row]![c] = dark;
          bit += 1;
        }
      }
      upward = !upward;
    }
    const fmt = formatBits(mask);
    const putFmt = (row: number, col: number, index: number) => {
      matrix[row]![col] = ((fmt >>> index) & 1) === 1;
    };
    const order: Array<[number, number]> = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8],
    ];
    order.forEach(([row, col], index) => putFmt(row, col, index));
    for (let i = 0; i < 8; i++) putFmt(size - 1 - i, 8, i);
    for (let i = 0; i < 7; i++) putFmt(8, size - 1 - i, i + 8);
    return matrix;
  };

  let best = build(0);
  let bestScore = qrPenalty(best);
  for (let mask = 1; mask < 8; mask++) {
    const matrix = build(mask);
    const score = qrPenalty(matrix);
    if (score < bestScore) {
      best = matrix;
      bestScore = score;
    }
  }
  return matrixToDataUrl(best);
}

function qrPenalty(matrix: boolean[][]): number {
  const n = matrix.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  };
  for (let r = 0; r < n; r++) line((c) => matrix[r]![c]!);
  for (let c = 0; c < n; c++) line((r) => matrix[r]![c]!);
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = matrix[r]![c];
      if (v === matrix[r]![c + 1] && v === matrix[r + 1]![c] && v === matrix[r + 1]![c + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  const k = Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
  score += k * 10;
  return score;
}

function matrixToDataUrl(matrix: boolean[][]): string {
  const cell = 8;
  const margin = 2;
  const n = matrix.length;
  const size = (n + margin * 2) * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fffef9";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#1a1a2e";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y]![x]) continue;
      ctx.fillRect((x + margin) * cell, (y + margin) * cell, cell, cell);
    }
  }
  return canvas.toDataURL("image/png");
}

const USER_CENTER_CSS = `
.user-center-page{
  min-height:100%;
  padding:28px 32px 48px;
  color:var(--ink,#1a1a2e);
  box-sizing:border-box;
}
.uc-header{margin-bottom:22px;max-width:720px}
.uc-title{margin:0;font-size:28px;font-weight:700;letter-spacing:-1px}
.uc-subtitle{margin:6px 0 0;color:var(--ink-muted,#555570);font-size:13px}
.uc-card{
  max-width:720px;
  margin-bottom:18px;
  padding:20px 22px 22px;
  background:var(--paper,#fffef9);
  border-radius:var(--radius-lg,10px);
  box-shadow:var(--shadow,0 10px 32px rgba(26,26,46,.08));
}
.uc-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.uc-card-title{margin:0;font-size:16px;font-weight:700}
.uc-card-desc{margin:8px 0 16px;color:var(--ink-muted,#555570);font-size:13px;line-height:1.5}
.uc-badge{
  font-size:12px;font-weight:700;
  padding:4px 10px;border-radius:999px;
  background:rgba(26,26,46,.08);color:var(--ink-muted,#555570);
}
.uc-badge.is-on{background:#173a52;color:#e8eef4}
html[data-theme="light"] .uc-badge.is-on{background:#173a52;color:#fffef9}
.uc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.uc-logged{display:flex;align-items:center;gap:12px;margin:4px 0 12px}
.uc-avatar{
  width:44px;height:44px;border-radius:14px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:#facc15;color:#1a1a2e;font-weight:700;
}
.uc-avatar.is-m7{background:#173a52;color:#e8eef4}
.uc-logged-name{font-weight:700}
.uc-logged-meta{font-size:12px;color:var(--ink-muted,#555570);margin-top:2px}
.uc-qr{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:14px}
.uc-qr-wrap{position:relative;width:220px;height:220px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:3px 3px 0 #173a52}
.uc-qr-img{width:100%;height:100%;object-fit:cover;display:block}
.uc-qr-overlay{
  position:absolute;inset:0;border:0;cursor:pointer;
  background:#1a1a2ecc;color:#fffef9;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-weight:700;
}
.uc-qr-status{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.uc-qr-dot{width:8px;height:8px;border-radius:50%;background:#9999b0}
.uc-qr-dot.is-waiting{background:#facc15;box-shadow:0 0 0 4px #facc1533}
.uc-qr-dot.is-scanned{background:#173a52}
.uc-qr-dot.is-success{background:#16a34a}
.uc-qr-dot.is-expired,.uc-qr-dot.is-failed{background:#ff4d6a}
.uc-hint,.uc-error{margin:10px 0 0;font-size:13px}
.uc-error{color:#ff4d6a}
.uc-cookie{margin-top:18px;padding-top:16px;border-top:1px solid var(--line,rgba(26,26,46,.12))}
.uc-cookie-label{font-weight:600;margin-bottom:8px}
.uc-m7-form{display:flex;flex-direction:column;gap:10px;max-width:360px}
.uc-card-m7{opacity:.96}
html[data-theme="dark"] .uc-card{background:#111;box-shadow:none;border:1px solid rgba(255,255,255,.08)}
html[data-theme="dark"] .uc-qr-wrap{box-shadow:3px 3px 0 #5a8fad}
`;
