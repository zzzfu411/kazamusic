import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { appMeta } from "../shared/appMeta";
import { resolveTheme } from "../shared/theme";
import { createAntdTheme } from "./antd-theme";
import {
  createEmptyMvSummary,
  type SearchAlbum,
  type SearchMv,
  type SearchPlaylist,
  type SearchSong,
  type Track,
} from "../shared/types";
import CollectionDetailPage from "./pages/CollectionDetailPage";
import { DownloadPage } from "./pages/DownloadPage";
import { MvPlayerPage } from "./pages/MvPlayerPage";
import { RecognizePage } from "./pages/RecognizePage";
import { RecommendFeedPage } from "./pages/RecommendFeedPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UserCenter } from "./pages/UserCenter";
import { WebDavPage } from "./pages/WebDavPage";
import { ImportPlaylistDialog } from "./pages/ImportPlaylistDialog";
import { startDesktopPlaybackBridge } from "./desktop/media-session";
import { DetailPanel } from "./shell/DetailPanel";
import { HomeBackground } from "./shell/HomeBackground";
import { PlayerBar } from "./shell/PlayerBar";
import { RelatedPanel } from "./shell/RelatedPanel";
import { Sidebar } from "./shell/Sidebar";
import { Titlebar } from "./shell/Titlebar";
import {
  handlePlaySong,
  next as playSkipNext,
  playNext,
  playTrack,
  playTracks,
  previous as playSkipPrevious,
  setPlayMode,
  toggle,
  toggleQueue,
  usePlayer,
} from "./stores/player";
import { useFavorites } from "./stores/favorites";
import { getSettings, kzApplyTheme, useSettings } from "./stores/settings";

export function App() {
  const { settings } = useSettings();
  const player = usePlayer();
  const favorites = useFavorites();
  const [page, setPage] = useState("recommend");
  const [importOpen, setImportOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const prefersLight =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches;
  const resolved = resolveTheme(settings.appearance.theme, prefersLight);
  const antdTheme = useMemo(() => createAntdTheme(resolved), [resolved]);

  useEffect(() => startDesktopPlaybackBridge(), []);

  useEffect(() => {
    kzApplyTheme(settings);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => kzApplyTheme(getSettings());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  useEffect(() => {
    const api = window.electronAPI;
    const onCmd = (cmd: unknown) => {
      const type =
        typeof cmd === "object" && cmd && "type" in cmd ? String((cmd as { type: unknown }).type) : String(cmd);
      if (type === "toggle" || type === "playpause") toggle();
      else if (type === "next") void playSkipNext();
      else if (type === "previous" || type === "prev") void playSkipPrevious();
    };
    const offIsland = api?.island?.onRemoteCommand?.(onCmd);
    const offTaskbar = api?.taskbar?.onRemoteCommand?.(onCmd);
    const offTray = api?.onTrayControl?.((payload) => {
      const raw = String(payload);
      if (raw === "openSettings") setPage("settings");
      else if (raw === "prev") void playSkipPrevious();
      else if (raw === "next") void playSkipNext();
      else if (raw.startsWith("mode:")) setPlayMode(raw.slice(5));
    });
    return () => {
      offIsland?.();
      offTaskbar?.();
      offTray?.();
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.updateTrayState) return;
    const track = player.currentTrack;
    api.updateTrayState({
      song: track ? { title: track.title || "", artist: track.artist || "" } : null,
      isPlaying: player.state === "playing",
      isLiked: Boolean(track && favorites.isFavorite(track.id)),
      playMode: player.playMode === "loop" ? "repeat-all" : player.playMode,
    });
  }, [player.currentTrack, player.state, player.playMode, favorites.ids]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setPage("settings");
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "p" || event.key === "P")) {
        event.preventDefault();
        toggleQueue();
      }
      if (event.code === "Space" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSearch = useCallback(() => {
    setPage("search");
  }, []);

  const selectPage = useCallback((id: string) => {
    if (id === "import") {
      setImportOpen(true);
      return;
    }
    setPage(id);
  }, []);

  useEffect(() => {
    const onSearch = (event: Event) => {
      const name = String((event as CustomEvent<string>).detail || "").trim();
      setPage("search");
      if (!name) return;
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("kazam:fill-search", { detail: name }));
      }, 0);
    };
    window.addEventListener("kazam:search", onSearch);
    return () => window.removeEventListener("kazam:search", onSearch);
  }, []);

  const openPlaylist = useCallback((playlist: SearchPlaylist) => {
    setPage(`netease-pl:${playlist.id}`);
  }, []);

  const openAlbum = useCallback((album: SearchAlbum) => {
    setPage(`netease-album:${album.id}`);
  }, []);

  const openMv = useCallback((mv: SearchMv) => {
    setPage(`netease-mv:${mv.id}`);
  }, []);

  const onPlaySong = useCallback((song: SearchSong) => {
    void handlePlaySong(song);
  }, []);
  const onPlayTrack = useCallback((track: Track, allTracks?: Track[]) => {
    if (allTracks && allTracks.length > 0) {
      const idx = allTracks.findIndex((item) => item.id === track.id);
      void playTracks(allTracks, idx >= 0 ? idx : 0);
      return;
    }
    void playTrack(track);
  }, []);
  const onPlayAll = useCallback((tracks: Track[]) => {
    void playTracks(tracks, 0);
  }, []);
  const onPlayNext = useCallback((track: Track) => {
    void playNext(track);
  }, []);

  const currentTrackId = player.currentTrack?.id;

  let outlet: ReactNode;
  if (page === "settings") {
    outlet = <SettingsPage />;
  } else if (page === "search") {
    outlet = (
      <SearchPage
        currentTrackId={currentTrackId}
        onPlaySong={onPlaySong}
        onPlayAll={onPlayAll}
        onPlayNext={onPlayNext}
        onOpenPlaylist={openPlaylist}
        onOpenAlbum={openAlbum}
        onOpenMv={openMv}
      />
    );
  } else if (page === "recommend") {
    outlet = <RecommendFeedPage onOpenPlaylist={openPlaylist} onPlaySong={onPlaySong} />;
  } else if (page.startsWith("netease-pl:")) {
    const id = page.slice("netease-pl:".length);
    outlet = (
      <CollectionDetailPage
        variant="netease"
        kind="playlist"
        id={id}
        summary={{ id, name: "歌单", source: "netease" }}
        currentTrackId={currentTrackId}
        onPlayAll={onPlayAll}
        onPlayTrack={onPlayTrack}
        onPlayNext={onPlayNext}
      />
    );
  } else if (page.startsWith("netease-album:")) {
    const id = page.slice("netease-album:".length);
    outlet = (
      <CollectionDetailPage
        variant="netease"
        kind="album"
        id={id}
        summary={{ id, name: "专辑", source: "netease" }}
        currentTrackId={currentTrackId}
        onPlayAll={onPlayAll}
        onPlayTrack={onPlayTrack}
        onPlayNext={onPlayNext}
      />
    );
  } else if (page === "playlists" || page.startsWith("playlist:")) {
    outlet = (
      <CollectionDetailPage
        currentTrackId={currentTrackId}
        onPlayAll={onPlayAll}
        onPlayTrack={onPlayTrack}
        onPlayNext={onPlayNext}
      />
    );
  } else if (page === "download" || page === "local") {
    outlet = <DownloadPage />;
  } else if (page === "recognize") {
    outlet = <RecognizePage onSearchSong={() => openSearch()} />;
  } else if (page === "webdav") {
    outlet = <WebDavPage />;
  } else if (page === "account") {
    outlet = <UserCenter />;
  } else if (page === "mv" || page.startsWith("netease-mv:")) {
    const id = page.startsWith("netease-mv:") ? page.slice("netease-mv:".length) : "";
    outlet = <MvPlayerPage id={id} summary={createEmptyMvSummary(id)} />;
  } else {
    outlet = (
      <div className="app-outlet">
        <h1>{appMeta.name}</h1>
        <p>主区</p>
      </div>
    );
  }

  return (
    <ConfigProvider theme={antdTheme}>
      <div className="app">
        <HomeBackground />
        <Titlebar onOpenSettings={() => setPage("settings")} />
        <div className="app-body">
          <Sidebar active={page} onSelect={selectPage} />
          <main className="app-main">{outlet}</main>
        </div>
        <div className="player-dock">
          <PlayerBar />
        </div>
        <DetailPanel />
        <RelatedPanel
          open={relatedOpen && player.detailOpen}
          songId={
            player.currentTrack?.id?.startsWith("netease:")
              ? player.currentTrack.id.slice("netease:".length)
              : player.currentTrack?.extra?.song_id
                ? String(player.currentTrack.extra.song_id)
                : player.currentTrack?.platform === "netease"
                  ? player.currentTrack.id
                  : null
          }
          onClose={() => setRelatedOpen(false)}
          onPlaySong={(song) => void onPlaySong(song)}
        />
        {player.detailOpen ? (
          <button
            type="button"
            className="related-fab"
            title="相似歌曲"
            onClick={() => setRelatedOpen((v) => !v)}
          >
            相似
          </button>
        ) : null}
        <ImportPlaylistDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={(payload) => {
            setImportOpen(false);
            if (payload.source === "netease" && payload.id) {
              setPage(`netease-pl:${payload.id}`);
            }
          }}
        />
      </div>
    </ConfigProvider>
  );
}
