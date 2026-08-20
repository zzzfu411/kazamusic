import { memo, useCallback, useEffect, useState } from "react";
import type { SearchSong } from "../../shared/types";
import { IconClose, IconPlay } from "../icons/Icons";

export type RelatedPanelProps = {
  songId: string | null;
  open: boolean;
  onClose: () => void;
  onPlaySong: (song: SearchSong) => void;
};

type LoadState = "idle" | "loading" | "done" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (isRecord(value)) {
    if ("body" in value && (typeof value.body === "string" || isRecord(value.body))) {
      const nested = asRecord(value.body);
      if (nested) return nested;
    }
    return value;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

async function neteaseEapiJson(path: string, data: unknown): Promise<Record<string, unknown> | null> {
  const eapi = window.electronAPI?.neteaseEapi;
  if (!eapi) throw new Error("electronAPI.neteaseEapi 不可用");
  return asRecord(await eapi(path, JSON.stringify(data)));
}

function pickSongs(body: Record<string, unknown> | null): unknown[] {
  if (!body) return [];
  if (Array.isArray(body.songs)) return body.songs;
  if (Array.isArray(body.data)) return body.data;
  if (isRecord(body.data) && Array.isArray(body.data.songs)) return body.data.songs;
  if (Array.isArray(body.result)) return body.result;
  return [];
}

function isSuccess(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const code = body.code;
  return code === undefined || code === 200 || code === 0;
}

function mapSong(raw: unknown): SearchSong | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id) || asString(raw.songid) || asString(raw.songId);
  if (!id) return null;
  const artistsRaw = raw.ar ?? raw.artists ?? raw.singer ?? [];
  const artists = Array.isArray(artistsRaw)
    ? artistsRaw
        .map((item) => (isRecord(item) ? asString(item.name) : asString(item)))
        .filter(Boolean)
    : [];
  const album = isRecord(raw.al) ? raw.al : isRecord(raw.album) ? raw.album : null;
  const durationMs = Number(raw.dt ?? raw.duration ?? 0) || 0;
  const cover =
    (album ? asString(album.picUrl) : "") ||
    asString(raw.cover) ||
    asString(raw.albumPic) ||
    asString(raw.picUrl);
  const fee = Number(raw.fee ?? (isRecord(raw.privilege) ? raw.privilege.fee : 0) ?? 0) || 0;
  return {
    id,
    name: asString(raw.name) || asString(raw.title) || "未知歌曲",
    artist: artists.join("、") || asString(raw.artist) || "未知艺术家",
    album: album ? asString(album.name) : asString(raw.albumName),
    albumId: album ? asString(album.id) : undefined,
    duration: durationMs > 1000 ? Math.floor(durationMs / 1000) : Math.floor(durationMs),
    cover,
    link: `https://music.163.com/#/song?id=${id}`,
    source: "netease",
    vip: fee === 1,
    extra: { song_id: id },
  };
}

async function fetchSimilarSongs(songId: string): Promise<SearchSong[]> {
  const paths = ["/eapi/v1/discovery/simiSong", "/eapi/song/similar"] as const;
  let lastError: unknown;
  for (const path of paths) {
    const payloads = [{ songid: songId }, { id: songId }];
    for (const payload of payloads) {
      try {
        const body = await neteaseEapiJson(path, {
          ...payload,
          limit: 30,
          offset: 0,
          csrf_token: "",
        });
        if (!isSuccess(body)) {
          lastError = new Error(`相似歌曲失败 code=${asString(body?.code)}`);
          continue;
        }
        const songs = pickSongs(body)
          .map(mapSong)
          .filter((song): song is SearchSong => Boolean(song));
        if (songs.length > 0) return songs;
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (lastError) throw lastError;
  return [];
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function RelatedPanelInner({ songId, open, onClose, onPlaySong }: RelatedPanelProps) {
  const [status, setStatus] = useState<LoadState>("idle");
  const [songs, setSongs] = useState<SearchSong[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (id: string) => {
    setStatus("loading");
    setError("");
    setSongs([]);
    try {
      const next = await fetchSimilarSongs(id);
      setSongs(next);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "推荐获取失败");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!songId) {
      setStatus("idle");
      setSongs([]);
      setError("");
      return;
    }
    void load(songId);
  }, [open, songId, load]);

  if (!open) return null;

  const empty = status === "done" && songs.length === 0;
  const idle = status === "idle" && !songId;

  return (
    <aside className="related-panel" aria-label="相似推荐">
      <style>{PANEL_CSS}</style>
      <header className="rp-hero">
        <div>
          <div className="rp-kicker">You Might Also Like</div>
          <h2 className="rp-title">相似推荐</h2>
          <p className="rp-sub">{songId ? `基于歌曲 ${songId}` : "播放在线音乐后查看相似歌曲"}</p>
        </div>
        <button type="button" className="rp-close" onClick={onClose} aria-label="关闭" title="关闭">
          <IconClose size={16} />
        </button>
      </header>

      <div className="rp-body">
        {status === "loading" ? (
          <div className="rp-empty">
            <div className="rp-empty-title">正在寻找相似音乐…</div>
            <div className="rp-empty-sub">通过网易云相似歌曲接口匹配</div>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="rp-empty">
            <div className="rp-empty-title">推荐获取失败</div>
            <div className="rp-empty-sub">{error || "请稍后重试或重新打开面板"}</div>
            {songId ? (
              <button type="button" className="rp-retry" onClick={() => void load(songId)}>
                重试
              </button>
            ) : (
              <button type="button" className="rp-retry" onClick={onClose}>
                关闭
              </button>
            )}
          </div>
        ) : null}

        {idle ? (
          <div className="rp-empty">
            <div className="rp-empty-title">暂无推荐</div>
            <div className="rp-empty-sub">播放在线音乐后查看相似推荐</div>
          </div>
        ) : null}

        {empty ? (
          <div className="rp-empty">
            <div className="rp-empty-title">暂无相似推荐</div>
            <div className="rp-empty-sub">试试播放其他歌曲</div>
          </div>
        ) : null}

        {status === "done" && songs.length > 0 ? (
          <ul className="rp-songs">
            {songs.map((song, index) => (
              <li key={`${song.source}:${song.id}`}>
                <button
                  type="button"
                  className="rp-song"
                  onClick={() => onPlaySong(song)}
                  title={`${song.name} — ${song.artist}`}
                >
                  <span className="rp-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="rp-cover">
                    {song.cover ? <img src={song.cover} alt="" loading="lazy" /> : <span>♪</span>}
                    <span className="rp-play">
                      <IconPlay size={14} />
                    </span>
                  </span>
                  <span className="rp-meta">
                    <span className="rp-name">{song.name}</span>
                    <span className="rp-artist">{song.artist}</span>
                  </span>
                  {song.duration > 0 ? (
                    <span className="rp-duration">{formatDuration(song.duration)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}

export const RelatedPanel = memo(RelatedPanelInner);
export default RelatedPanel;

const PANEL_CSS = `
.related-panel{height:100%;display:flex;flex-direction:column;background:var(--paper,#fffef9);color:var(--ink,#1a1a2e);border-left:1px solid var(--line,rgba(26,26,46,.12));min-width:300px;width:min(360px,42vw)}
.rp-hero{display:flex;justify-content:space-between;gap:12px;padding:18px 16px 12px;border-bottom:1px solid var(--line,rgba(26,26,46,.12))}
.rp-kicker{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#173a52}
.rp-title{margin:4px 0 2px;font-size:22px;letter-spacing:-.6px}
.rp-sub{margin:0;font-size:12px;color:var(--ink-muted,#555570)}
.rp-close{width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.rp-close:hover{background:var(--bg-hover,rgba(250,204,21,.22))}
.rp-body{flex:1;min-height:0;overflow:auto;padding:8px 10px 16px}
.rp-empty{padding:36px 16px;text-align:center}
.rp-empty-title{font-weight:700;margin-bottom:6px}
.rp-empty-sub{font-size:12px;color:var(--ink-muted,#555570);line-height:1.5}
.rp-retry{margin-top:14px;border:0;border-radius:999px;background:#facc15;color:#1a1a2e;font-weight:700;padding:8px 16px;cursor:pointer}
html[data-theme="dark"] .rp-retry{background:#173a52;color:#e8eef4}
.rp-songs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.rp-song{width:100%;display:grid;grid-template-columns:28px 44px minmax(0,1fr) auto;gap:10px;align-items:center;border:0;background:transparent;color:inherit;text-align:left;padding:8px;border-radius:10px;cursor:pointer}
.rp-song:hover{background:var(--bg-hover,rgba(250,204,21,.22))}
.rp-index{font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink-muted,#555570)}
.rp-cover{position:relative;width:44px;height:44px;border-radius:8px;overflow:hidden;background:#173a52;color:#facc15;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rp-cover img{width:100%;height:100%;object-fit:cover;display:block}
.rp-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a2e88;color:#fff;opacity:0}
.rp-song:hover .rp-play{opacity:1}
.rp-meta{min-width:0;display:flex;flex-direction:column;gap:2px}
.rp-name,.rp-artist{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-name{font-weight:700;font-size:13px}
.rp-artist{font-size:12px;color:var(--ink-muted,#555570)}
.rp-duration{font-size:12px;color:var(--ink-muted,#555570);font-variant-numeric:tabular-nums}
`;
