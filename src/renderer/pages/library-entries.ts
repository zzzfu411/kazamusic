import { ImportPlaylistDialog } from "./ImportPlaylistDialog";
import { WebDavPage } from "./WebDavPage";
import { RelatedPanel } from "../shell/RelatedPanel";

export { WebDavPage, ImportPlaylistDialog, RelatedPanel };

export const libraryEntries = [
  { id: "webdav", path: "webdav", label: "WebDAV", component: WebDavPage },
  { id: "import-playlist", path: "import-playlist", label: "导入歌单", component: ImportPlaylistDialog },
  { id: "related", path: "related", label: "相似推荐", component: RelatedPanel },
] as const;
