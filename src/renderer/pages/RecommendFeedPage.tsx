import { useCallback, useEffect, useRef, useState } from "react";
import { canEnqueuePlayUrl, type SearchPlaylist, type SearchSong } from "../../shared/types";
import { brand } from "../brand/assets";

const NETEASE_NEW_SONGS_PLAYLIST_ID = "3779629";
const NETEASE_HOT_SONGS_PLAYLIST_ID = "3778678";

export type RecommendFeedPageProps = {
  onOpenPlaylist?: (playlist: SearchPlaylist) => void;
  onPlaySong?: (song: SearchSong) => void;
};

type NeteaseCodeBody = {
  code?: number;
};

type PersonalizedPlaylistRaw = {
  id?: string | number;
  name?: string;
  picUrl?: string;
  trackCount?: number;
  playCount?: number;
  copywriter?: string;
};

type PersonalizedResponse = NeteaseCodeBody & {
  result?: PersonalizedPlaylistRaw[];
};

type ToplistRaw = {
  id?: string | number;
  name?: string;
  coverImgUrl?: string;
  trackCount?: number;
  playCount?: number;
  description?: string;
  updateFrequency?: string;
  creator?: { nickname?: string };
};

type ToplistResponse = NeteaseCodeBody & {
  list?: ToplistRaw[];
};

type PlaylistSearchSongRaw = {
  id?: string | number;
  name?: string;
  dt?: number;
  duration?: number;
  fee?: number;
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { id?: string | number; name?: string; picUrl?: string };
  album?: { id?: string | number; name?: string; picUrl?: string };
  privilege?: { fee?: number; fl?: number };
};

type PlaylistDetailRaw = {
  id?: string | number;
  name?: string;
  coverImgUrl?: string;
  trackCount?: number;
  playCount?: number;
  description?: string;
  creator?: { nickname?: string };
  tracks?: PlaylistSearchSongRaw[];
  trackIds?: { id?: string | number }[];
};

type PlaylistDetailResponse = NeteaseCodeBody & {
  playlist?: PlaylistDetailRaw;
};

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function formatPlayCount(count: number): string {
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function hasPlayUrl(song: SearchSong): boolean {
  return canEnqueuePlayUrl(song.playUrl);
}

async function neteaseEapiJson<T>(path: string, data: unknown): Promise<T> {
  const raw = await window.electronAPI.neteaseEapi(path, JSON.stringify(data));
  if (typeof raw === "string") return JSON.parse(raw) as T;
  return raw as T;
}

function mapRecommendedPlaylist(raw: PersonalizedPlaylistRaw): SearchPlaylist {
  const id = String(raw.id ?? "");
  return {
    id,
    name: raw.name ?? "",
    cover: raw.picUrl,
    trackCount: raw.trackCount ?? 0,
    playCount: Math.floor(raw.playCount ?? 0),
    creator: raw.copywriter || "网易云推荐",
    description: raw.copywriter || "",
    link: `https://music.163.com/#/playlist?id=${id}`,
    source: "netease",
  };
}

function mapToplist(raw: ToplistRaw): SearchPlaylist {
  const id = String(raw.id ?? "");
  return {
    id,
    name: raw.name ?? "",
    cover: raw.coverImgUrl,
    trackCount: raw.trackCount ?? 0,
    playCount: Math.floor(raw.playCount ?? 0),
    creator: raw.creator?.nickname || "网易云音乐",
    description: raw.description || raw.updateFrequency || "",
    link: `https://music.163.com/#/playlist?id=${id}`,
    source: "netease",
    updateFrequency: raw.updateFrequency,
  };
}

function mapSearchPlaylist(raw: PlaylistDetailRaw): SearchPlaylist {
  const id = String(raw.id ?? "");
  return {
    id,
    name: raw.name ?? "",
    cover: raw.coverImgUrl,
    trackCount: raw.trackCount ?? 0,
    playCount: Math.floor(raw.playCount ?? 0),
    creator: raw.creator?.nickname || "",
    description: raw.description || "",
    link: `https://music.163.com/#/playlist?id=${id}`,
    source: "netease",
  };
}

function mapSong(raw: PlaylistSearchSongRaw): SearchSong {
  const artists = raw.ar || raw.artists || [];
  const album = raw.al || raw.album;
  const durationMs = raw.dt ?? raw.duration ?? 0;
  const fee = raw.fee ?? raw.privilege?.fee ?? 0;
  const id = String(raw.id ?? "");
  return {
    id,
    name: raw.name ?? "",
    artist: artists.map((item) => item.name).filter(Boolean).join("、"),
    album: album?.name || "",
    albumId: String(album?.id ?? 0),
    duration: Math.floor(durationMs / 1000),
    cover: album?.picUrl || "",
    link: `https://music.163.com/#/song?id=${id}`,
    source: "netease",
    vip: fee === 1,
  };
}

async function fetchRecommendedPlaylists(limit = 30): Promise<SearchPlaylist[]> {
  const body = await neteaseEapiJson<PersonalizedResponse>("/eapi/personalized/playlist", {
    limit,
    total: true,
    n: 1000,
  });
  if (body.code !== 200) {
    throw new Error(`netease recommended playlists error: code=${body.code}`);
  }
  return (body.result || []).map(mapRecommendedPlaylist);
}

async function fetchToplists(): Promise<SearchPlaylist[]> {
  const body = await neteaseEapiJson<ToplistResponse>("/eapi/toplist", {
    csrf_token: "",
  });
  if (body.code !== 200) {
    throw new Error(`netease toplist error: code=${body.code}`);
  }
  return (body.list || []).map(mapToplist);
}

async function fetchPlaylistDetail(id: string): Promise<{ playlist: SearchPlaylist; songs: SearchSong[] }> {
  const body = await neteaseEapiJson<PlaylistDetailResponse>("/eapi/v3/playlist/detail", {
    id,
    n: 100000,
    s: 8,
    csrf_token: "",
  });
  if (body.code !== 200 || !body.playlist) {
    throw new Error(`netease playlist detail error: code=${body.code}`);
  }
  const raw = body.playlist;
  const byId = new Map<string, PlaylistSearchSongRaw>();
  for (const track of raw.tracks || []) {
    if (track?.id != null) byId.set(String(track.id), track);
  }
  const orderedIds = (raw.trackIds || []).map((item) => String(item.id));
  const songs = (orderedIds.length ? orderedIds : [...byId.keys()])
    .map((trackId) => byId.get(trackId))
    .filter((track): track is PlaylistSearchSongRaw => Boolean(track))
    .map(mapSong);
  return {
    playlist: mapSearchPlaylist(raw),
    songs,
  };
}

function CoverFallbackIcon() {
  return (
    <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M866.9 169.9L527.1 54.1C523 52.7 517.5 52 512 52s-11 .7-15.1 2.1L157.1 169.9c-8.3 2.8-15.1 12.4-15.1 21.2v482.4c0 8.8 5.7 20.4 12.6 25.9L499.3 968c3.5 2.7 8 4.1 12.6 4.1s9.2-1.4 12.6-4.1l344.7-268.6c6.9-5.4 12.6-17 12.6-25.9V191.1c.2-8.8-6.6-18.3-14.9-21.2zM810 654.3L512 886.5 214 654.3V226.7l298-101.6 298 101.6v427.6zM512 424c-66.2 0-120 53.8-120 120s53.8 120 120 120 120-53.8 120-120-53.8-120-120-120zm0 160c-22.1 0-40-17.9-40-40s17.9-40 40-40 40 17.9 40 40-17.9 40-40 40z" />
    </svg>
  );
}

function PlayCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm144.1 454.9L437.7 677.8a8.02 8.02 0 01-12.7-6.5V353.7a8 8 0 0112.7-6.5L656.1 506a7.9 7.9 0 010 12.9z" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden>
      <path d="M909.1 209.3l-56.4 44.1C775.8 155.1 656.2 92 521.9 92 290 92 102.3 279.5 102 511.5 101.7 743.7 289.8 932 521.9 932c181.3 0 335.8-115 394.6-276.1 1.5-4.2-.7-8.9-4.9-10.3l-56.7-19.5a8 8 0 00-10.1 4.8c-1.8 5-3.8 10-5.9 14.9-17.3 41-42.1 77.8-73.7 109.4A344.77 344.77 0 01655.9 829c-42.3 17.9-87.4 27-133.8 27-46.5 0-91.5-9.1-133.8-27A341.5 341.5 0 01279 755.2a342.16 342.16 0 01-73.7-109.4c-17.9-42.4-27-87.4-27-133.9s9.1-91.5 27-133.9c17.3-41 42.1-77.8 73.7-109.4 31.6-31.6 68.4-56.4 109.3-73.8 42.3-17.9 87.4-27 133.8-27 46.5 0 91.5 9.1 133.8 27a341.5 341.5 0 01109.3 73.8c9.9 9.9 19.2 20.4 27.8 31.4l-60.2 47a8 8 0 003 14.1l175.6 43c5 1.2 9.9-2.6 9.9-7.7l.8-180.9c-.1-6.6-7.8-10.3-13-6.2z" />
    </svg>
  );
}

function PlaylistCard({
  playlist,
  onOpen,
}: {
  playlist: SearchPlaylist;
  onOpen: (playlist: SearchPlaylist) => void;
}) {
  const meta = playlist.updateFrequency
    ? playlist.updateFrequency
    : (playlist.playCount ?? 0) > 0
      ? `${formatPlayCount(playlist.playCount ?? 0)}播放`
      : playlist.creator;
  return (
    <div className="search-card" onClick={() => onOpen(playlist)} role="button" tabIndex={0}>
      <div className="search-card-cover">
        {playlist.cover ? (
          <img src={playlist.cover} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="search-card-cover-inner">
            <CoverFallbackIcon />
          </div>
        )}
        <PlayCircleIcon className="search-card-play-icon" />
      </div>
      <div className="search-card-info">
        <div className="search-card-title">{playlist.name}</div>
        <div className="search-card-meta">{meta}</div>
      </div>
    </div>
  );
}

function SongRow({
  song,
  index,
  onPlay,
}: {
  song: SearchSong;
  index: number;
  onPlay: (song: SearchSong) => void;
}) {
  return (
    <div className="recommend-song-row" onClick={() => onPlay(song)} role="button" tabIndex={0}>
      <span className="song-index">{index + 1}</span>
      {song.cover ? <img className="song-cover" src={song.cover} alt="" loading="lazy" draggable={false} /> : null}
      <div className="song-info">
        <div className="song-name">{song.name}</div>
        <div className="song-artist">{song.artist}</div>
      </div>
      {song.duration > 0 ? <span className="song-duration">{formatDuration(song.duration)}</span> : null}
      <PlayCircleIcon className="song-play-icon" />
    </div>
  );
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="recommend-section-error">
      加载失败
      <button type="button" className="retry-btn" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function PlaylistCardSkeleton() {
  return (
    <div className="search-card is-skeleton">
      <div className="search-card-cover" />
      <div className="search-card-info">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--meta" />
      </div>
    </div>
  );
}

function SongRowSkeleton() {
  return (
    <div className="recommend-song-row is-skeleton">
      <span className="song-index" />
      <div className="song-cover" />
      <div className="song-info">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--meta" />
      </div>
    </div>
  );
}

function PlaylistCardSkeletonGrid({
  count,
  variant,
}: {
  count: number;
  variant: "row" | "two-rows" | "auto";
}) {
  return (
    <div className={`search-card-grid search-card-grid--${variant}`}>
      {Array.from({ length: count }).map((_, index) => (
        <PlaylistCardSkeleton key={index} />
      ))}
    </div>
  );
}

function SongRowSkeletonList({ count = 10 }: { count?: number }) {
  return (
    <div className="recommend-song-list">
      {Array.from({ length: count }).map((_, index) => (
        <SongRowSkeleton key={index} />
      ))}
    </div>
  );
}

export function RecommendFeedPage({ onOpenPlaylist, onPlaySong }: RecommendFeedPageProps) {
  const [recommendedPlaylists, setRecommendedPlaylists] = useState<SearchPlaylist[]>([]);
  const [toplists, setToplists] = useState<SearchPlaylist[]>([]);
  const [newSongs, setNewSongs] = useState<SearchSong[]>([]);
  const [hotSongs, setHotSongs] = useState<SearchSong[]>([]);
  const [randomPlaylists, setRandomPlaylists] = useState<SearchPlaylist[]>([]);
  const [newSongsPlaylist, setNewSongsPlaylist] = useState<SearchPlaylist | null>(null);
  const [hotSongsPlaylist, setHotSongsPlaylist] = useState<SearchPlaylist | null>(null);
  const [recommendedLoading, setRecommendedLoading] = useState(true);
  const [toplistsLoading, setToplistsLoading] = useState(true);
  const [newSongsLoading, setNewSongsLoading] = useState(true);
  const [hotSongsLoading, setHotSongsLoading] = useState(true);
  const [recommendedError, setRecommendedError] = useState(false);
  const [toplistsError, setToplistsError] = useState(false);
  const [newSongsError, setNewSongsError] = useState(false);
  const [hotSongsError, setHotSongsError] = useState(false);
  const allRecommendedRef = useRef<SearchPlaylist[]>([]);

  const loadRecommendedPlaylists = useCallback(async () => {
    setRecommendedLoading(true);
    setRecommendedError(false);
    try {
      const lists = await fetchRecommendedPlaylists(30);
      allRecommendedRef.current = lists;
      setRecommendedPlaylists(lists.slice(0, 10));
      setRandomPlaylists(shuffle(lists).slice(0, 10));
    } catch (error) {
      console.error("[recommend-feed] recommended playlists failed:", error);
      setRecommendedError(true);
    } finally {
      setRecommendedLoading(false);
    }
  }, []);

  const loadToplists = useCallback(async () => {
    setToplistsLoading(true);
    setToplistsError(false);
    try {
      setToplists(await fetchToplists());
    } catch (error) {
      console.error("[recommend-feed] toplists failed:", error);
      setToplistsError(true);
    } finally {
      setToplistsLoading(false);
    }
  }, []);

  const loadNewSongs = useCallback(async () => {
    setNewSongsLoading(true);
    setNewSongsError(false);
    try {
      const { playlist, songs } = await fetchPlaylistDetail(NETEASE_NEW_SONGS_PLAYLIST_ID);
      setNewSongsPlaylist(playlist);
      setNewSongs(songs.slice(0, 5));
    } catch (error) {
      console.error("[recommend-feed] new songs failed:", error);
      setNewSongsError(true);
    } finally {
      setNewSongsLoading(false);
    }
  }, []);

  const loadHotSongs = useCallback(async () => {
    setHotSongsLoading(true);
    setHotSongsError(false);
    try {
      const { playlist, songs } = await fetchPlaylistDetail(NETEASE_HOT_SONGS_PLAYLIST_ID);
      setHotSongsPlaylist(playlist);
      setHotSongs(songs.slice(0, 5));
    } catch (error) {
      console.error("[recommend-feed] hot songs failed:", error);
      setHotSongsError(true);
    } finally {
      setHotSongsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecommendedPlaylists();
    void loadToplists();
    void loadNewSongs();
    void loadHotSongs();
  }, [loadRecommendedPlaylists, loadToplists, loadNewSongs, loadHotSongs]);

  const reshuffleRandomPlaylists = useCallback(() => {
    if (allRecommendedRef.current.length !== 0) {
      setRandomPlaylists(shuffle(allRecommendedRef.current).slice(0, 10));
    }
  }, []);

  const handleOpenPlaylist = useCallback(
    (playlist: SearchPlaylist) => {
      onOpenPlaylist?.(playlist);
    },
    [onOpenPlaylist],
  );

  const handlePlaySong = useCallback(
    (song: SearchSong) => {
      if (!hasPlayUrl(song) && !onPlaySong) {
        console.warn("[recommend-feed] skip enqueue: empty playUrl", song.id);
        return;
      }
      onPlaySong?.(song);
    },
    [onPlaySong],
  );

  return (
    <div className="recommend-feed-page">
      <style>{PAGE_CSS}</style>
      <section className="kazam-hero" aria-label="KAZAM">
        <div className="kazam-hero-copy">
          <div className="kazam-hero-kicker">KAZAM!</div>
          <h1 className="kazam-hero-title">今日推荐</h1>
          <p className="kazam-hero-sub">歌单、搜索、曲库都在这里。奶油白天，藏青夜里。</p>
        </div>
        <img className="kazam-hero-art" src={brand.covers[1]} alt="" draggable={false} />
      </section>
      <section className="recommend-section">
        <h2 className="recommend-section-title">歌单推荐</h2>
        {recommendedLoading ? (
          <PlaylistCardSkeletonGrid count={10} variant="row" />
        ) : recommendedError ? (
          <SectionError onRetry={loadRecommendedPlaylists} />
        ) : (
          <div className="search-card-grid search-card-grid--row">
            {recommendedPlaylists.map((playlist) => (
              <PlaylistCard playlist={playlist} onOpen={handleOpenPlaylist} key={playlist.id} />
            ))}
          </div>
        )}
      </section>

      <section className="recommend-section recommend-charts-row">
        <div className="recommend-chart-col">
          <h2 className="recommend-section-title">
            新歌榜
            {newSongsPlaylist ? (
              <button type="button" className="chart-more-btn" onClick={() => handleOpenPlaylist(newSongsPlaylist)}>
                查看更多
              </button>
            ) : null}
          </h2>
          {newSongsLoading ? (
            <SongRowSkeletonList count={5} />
          ) : newSongsError ? (
            <SectionError onRetry={loadNewSongs} />
          ) : (
            <div className="recommend-song-list">
              {newSongs.map((song, index) => (
                <SongRow song={song} index={index} onPlay={handlePlaySong} key={song.id} />
              ))}
            </div>
          )}
        </div>
        <div className="recommend-chart-col">
          <h2 className="recommend-section-title">
            热歌榜
            {hotSongsPlaylist ? (
              <button type="button" className="chart-more-btn" onClick={() => handleOpenPlaylist(hotSongsPlaylist)}>
                查看更多
              </button>
            ) : null}
          </h2>
          {hotSongsLoading ? (
            <SongRowSkeletonList count={5} />
          ) : hotSongsError ? (
            <SectionError onRetry={loadHotSongs} />
          ) : (
            <div className="recommend-song-list">
              {hotSongs.map((song, index) => (
                <SongRow song={song} index={index} onPlay={handlePlaySong} key={song.id} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="recommend-section">
        <h2 className="recommend-section-title">
          <span>随机歌单</span>
          <button
            type="button"
            className="refresh-btn"
            onClick={reshuffleRandomPlaylists}
            disabled={allRecommendedRef.current.length === 0}
          >
            <ReloadIcon /> 换一批
          </button>
        </h2>
        {recommendedLoading ? (
          <PlaylistCardSkeletonGrid count={10} variant="two-rows" />
        ) : recommendedError ? (
          <SectionError onRetry={loadRecommendedPlaylists} />
        ) : (
          <div className="search-card-grid search-card-grid--two-rows">
            {randomPlaylists.map((playlist) => (
              <PlaylistCard playlist={playlist} onOpen={handleOpenPlaylist} key={`rand-${playlist.id}`} />
            ))}
          </div>
        )}
      </section>

      <section className="recommend-section">
        <h2 className="recommend-section-title">网易云榜单</h2>
        {toplistsLoading ? (
          <PlaylistCardSkeletonGrid count={12} variant="auto" />
        ) : toplistsError ? (
          <SectionError onRetry={loadToplists} />
        ) : (
          <div className="search-card-grid search-card-grid--auto">
            {toplists.map((playlist) => (
              <PlaylistCard playlist={playlist} onOpen={handleOpenPlaylist} key={playlist.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const PAGE_CSS = `
.recommend-feed-page{padding:24px 40px 40px;overflow-y:auto;height:100%;box-sizing:border-box}
.recommend-feed-page .search-card-grid{gap:14px}
.recommend-feed-page .search-card-cover{border-radius:8px}
.recommend-feed-page .search-card-info{padding:8px 2px 0}
.recommend-feed-page .search-card-title{font-size:12.5px}
.recommend-feed-page .search-card-meta{margin-top:2px;font-size:10.5px}
.recommend-feed-page .search-card-play-icon{font-size:30px}
.recommend-section{margin-bottom:36px}
.recommend-section:last-child{margin-bottom:0}
.recommend-section-title{font-size:18px;font-weight:600;color:var(--text-primary);margin:0 0 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.recommend-section-title .refresh-btn{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:400;color:var(--text-secondary);cursor:pointer;padding:4px 10px;border-radius:var(--ui-radius-sm,6px);background:var(--ui-control-bg);border:none;transition:background .12s ease,color .12s ease}
.recommend-section-title .refresh-btn:hover:not(:disabled){background:var(--ui-control-bg-hover);color:var(--text-primary)}
.recommend-section-title .refresh-btn:disabled{opacity:.5;cursor:not-allowed}
.recommend-section-error{color:var(--text-secondary);padding:24px 0;text-align:center;font-size:13px}
.recommend-section-error .retry-btn{margin-left:8px;color:var(--color-primary,var(--accent,#173A52));cursor:pointer;background:none;border:none;font-size:13px;padding:0}
.recommend-section-error .retry-btn:hover{text-decoration:underline}
.recommend-charts-row{display:flex;gap:24px}
.recommend-chart-col{flex:1;min-width:0;background:var(--ui-control-bg);border-radius:12px;padding:16px 18px}
.recommend-chart-col .recommend-section-title{margin-bottom:12px;color:var(--ui-control-fg,rgba(255,255,255,.92))}
.chart-more-btn{margin-left:auto;font-size:12px;font-weight:400;color:var(--ui-control-fg-muted,rgba(255,255,255,.62));background:none;border:none;cursor:pointer;padding:2px 0;transition:color .12s ease}
.chart-more-btn:hover{color:var(--ui-control-fg,rgba(255,255,255,.92))}
.search-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.search-card-grid--row{grid-template-columns:repeat(10,1fr);gap:12px}
.search-card-grid--two-rows{grid-template-columns:repeat(5,1fr);gap:14px}
.search-card-grid--auto{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px}
.search-card{cursor:pointer;min-width:0}
.search-card-cover{position:relative;width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--ui-control-bg,#ffffff0a)}
.search-card-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}
.search-card:hover .search-card-cover img,.search-card:hover .search-card-cover-inner{transform:scale(1.03)}
.search-card-cover-inner{width:100%;height:100%;display:flex;align-items:center;justify-content:center;transition:transform .2s ease;font-size:32px;color:var(--ui-control-fg-subtle)}
.search-card-play-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:30px;color:#ffffffeb;opacity:0;transition:opacity .18s ease;text-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none}
.search-card:hover .search-card-play-icon{opacity:1}
.search-card-info{padding:8px 2px 0}
.search-card-title{font-size:12.5px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search-card-meta{margin-top:2px;font-size:10.5px;color:var(--ui-control-fg-subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recommend-song-list{display:flex;flex-direction:column;gap:2px}
.recommend-song-row{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:var(--ui-radius-sm,6px);cursor:pointer;transition:background .12s ease}
.recommend-song-row:hover{background:#ffffff0f}
.recommend-song-row .song-index{width:24px;text-align:center;color:var(--ui-control-fg-subtle,rgba(255,255,255,.45));font-size:13px;font-variant-numeric:tabular-nums;flex-shrink:0}
.recommend-song-row .song-cover{width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0}
.recommend-song-row .song-info{flex:1;min-width:0}
.recommend-song-row .song-name{font-size:14px;color:var(--ui-control-fg,rgba(255,255,255,.92));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recommend-song-row .song-artist{font-size:12px;color:var(--ui-control-fg-muted,rgba(255,255,255,.62));margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recommend-song-row .song-duration{font-size:12px;color:var(--ui-control-fg-subtle,rgba(255,255,255,.45));font-variant-numeric:tabular-nums;flex-shrink:0;margin-right:4px}
.recommend-song-row .song-play-icon{color:var(--ui-control-fg-subtle,rgba(255,255,255,.45));font-size:18px;opacity:0;transition:opacity .12s ease,color .12s ease;flex-shrink:0}
.recommend-song-row:hover .song-play-icon{opacity:1;color:var(--color-primary,var(--accent,#173A52))}
.skeleton-line{border-radius:4px;background:var(--ui-control-bg);position:relative;overflow:hidden}
.skeleton-line--title{width:80%;height:12px}
.skeleton-line--meta{width:55%;height:10px;margin-top:4px}
.search-card.is-skeleton .search-card-cover,.recommend-song-row.is-skeleton .song-cover,.recommend-song-row.is-skeleton .song-index{background:var(--ui-control-bg);position:relative;overflow:hidden}
.recommend-song-row.is-skeleton .song-index{display:block;height:14px;border-radius:4px}
.search-card.is-skeleton .search-card-cover:after,.recommend-song-row.is-skeleton .song-cover:after,.recommend-song-row.is-skeleton .song-index:after,.skeleton-line:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.08) 50%,transparent 100%);animation:skeleton-shimmer 1.4s ease-in-out infinite}
@keyframes skeleton-shimmer{0%{transform:translate(-100%)}to{transform:translate(100%)}}
@media (max-width:1200px){.search-card-grid--row{grid-template-columns:repeat(5,1fr)}}
@media (max-width:760px){.recommend-charts-row{flex-direction:column;gap:36px}.search-card-grid--row,.search-card-grid--two-rows{grid-template-columns:repeat(3,1fr)}.search-card-grid--auto{grid-template-columns:repeat(2,1fr)}}
`;

export default RecommendFeedPage;
