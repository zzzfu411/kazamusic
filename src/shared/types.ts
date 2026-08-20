export type MusicPlatform = "netease" | "kuwo" | "qq" | "kugou" | "migu" | "soda";

export type TrackSource = "online" | "local" | "webdav";

export type SearchTab = "songs" | "playlists" | "albums" | "mvs" | "lyrics";

export interface TrackExtra {
  vip?: string | boolean;
  song_id?: string;
  rid?: string;
  mid?: string;
  hash?: string;
  content_id?: string;
  copyright_id?: string;
  track_id?: string;
  quality?: string;
  fl?: string;
  fee?: string;
  type?: string;
  company?: string;
  publishTime?: string;
  [key: string]: unknown;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  source: TrackSource;
  platform?: MusicPlatform | string;
  coverUrl?: string;
  playUrl?: string;
  filePath?: string;
  extra?: TrackExtra;
}

export type PlaylistSourceType =
  | "netease-pl"
  | "netease-album"
  | "qq-pl"
  | "kugou-pl"
  | "kuwo-pl"
  | "local-folder";

export interface UserPlaylist {
  id: string;
  name: string;
  coverUrl?: string;
  createdAt: number;
  trackIds?: string[];
  sourceType?: PlaylistSourceType | string;
  sourceId?: string;
}

export interface CollectionSummary {
  id: string;
  name: string;
  cover?: string;
  trackCount?: number;
  playCount?: number;
  creator?: string;
  description?: string;
  link?: string;
  source?: string;
  extra?: TrackExtra;
}

export interface PlaylistPatch {
  name?: string;
  coverUrl?: string;
}

export interface SearchSong {
  id: string;
  name: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration: number;
  cover?: string;
  link?: string;
  source: MusicPlatform | string;
  vip?: boolean;
  playable?: boolean;
  playUrl?: string;
  searchRank?: number;
  lyricSnippet?: string;
  extra?: TrackExtra;
}

export interface SearchPlaylist {
  id: string;
  name: string;
  cover?: string;
  trackCount: number;
  playCount: number;
  creator?: string;
  description?: string;
  source: MusicPlatform | string;
  link?: string;
  updateFrequency?: string;
}

export interface SearchAlbum {
  id: string;
  name: string;
  cover?: string;
  trackCount: number;
  creator?: string;
  description?: string;
  source: MusicPlatform | string;
  link?: string;
  extra?: TrackExtra;
}

export interface SearchMv {
  id: string;
  name: string;
  cover?: string;
  artistName?: string;
  artistId?: string;
  duration: number;
  playCount: number;
  description?: string;
  source: MusicPlatform | string;
  link?: string;
}

export type SearchLyric = SearchSong;

/** Empty playUrl must never enter the playback queue. */
export function canEnqueuePlayUrl(playUrl: string | null | undefined): playUrl is string {
  return typeof playUrl === "string" && playUrl.trim().length > 0;
}

export type RecognizeStatus = "idle" | "initializing" | "recording" | "success" | "failed";

export type RecognizeHit = {
  id: string;
  name: string;
  artist: string;
  album: string;
  coverUrl: string;
  startTime: number;
};

export type RecognizeArtist = string | { name?: string };

export type RecognizeSongPayload = {
  id?: string | number;
  name?: string;
  artist?: RecognizeArtist | RecognizeArtist[];
  artists?: RecognizeArtist | RecognizeArtist[];
  album?: {
    name?: string;
    picUrl?: string;
    blurPicUrl?: string;
  };
};

export type RecognizeMatch = {
  startTime?: number;
  song?: RecognizeSongPayload;
};

export type RecognizeSongResponse = {
  data?: {
    result?: RecognizeMatch[];
  };
};

export type DownloadStatus =
  | "downloading"
  | "paused"
  | "queued"
  | "failed"
  | "missing"
  | "completed";

export interface DownloadTrack extends Omit<Track, "source"> {
  source?: TrackSource | string;
  fileSize?: number;
  filePath?: string;
  lyrics?: string;
  downloadStatus?: DownloadStatus | string;
  downloadProgress?: number;
  downloadSpeed?: string;
  downloadedAt?: string;
}

export interface DownloadProgressPayload {
  id: string;
  progress?: number;
  receivedBytes?: number;
  totalBytes?: number;
  speed?: string;
  status?: string;
  error?: string;
}

export interface DownloadCompletePayload {
  id: string;
  filePath: string;
}

export interface DownloadStartItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  downloadDir: string;
  nameFormat?: string;
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
    lyrics?: string;
  };
  embedMetadata?: boolean;
  sidecar?: boolean;
}

export type MvSummary = {
  id: string;
  name: string;
  cover?: string;
  artistName?: string;
  artistId?: string;
  duration: number;
  playCount?: number;
  description?: string;
  link?: string;
  source?: string;
  brs?: number[];
};

export function createEmptyMvSummary(id = ""): MvSummary {
  return {
    id,
    name: "",
    cover: "",
    artistName: "",
    duration: 0,
    playCount: 0,
    description: "",
    source: "netease",
  };
}
