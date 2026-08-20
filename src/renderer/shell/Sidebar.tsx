import type { ComponentType } from "react";
import {
  IconLibrary,
  IconPlaylists,
  IconRecommend,
  IconRecognize,
  IconSearch,
  IconSettings,
  type IconProps,
} from "../icons/Icons";

const ITEMS: {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
}[] = [
  { id: "recommend", label: "推荐", Icon: IconRecommend },
  { id: "search", label: "搜索", Icon: IconSearch },
  { id: "download", label: "曲库", Icon: IconLibrary },
  { id: "playlists", label: "列表", Icon: IconPlaylists },
  { id: "recognize", label: "识曲", Icon: IconRecognize },
  { id: "webdav", label: "云盘", Icon: IconLibrary },
  { id: "import", label: "导入", Icon: IconPlaylists },
  { id: "account", label: "账户", Icon: IconSettings },
];

type Props = {
  active: string;
  onSelect: (id: string) => void;
};

function isActive(id: string, page: string): boolean {
  if (id === "recommend") return page === "recommend";
  if (id === "search") return page === "search";
  if (id === "download") return page === "download" || page === "local";
  if (id === "recognize") return page === "recognize";
  if (id === "playlists") {
    return (
      page === "playlists" ||
      page.startsWith("playlist:") ||
      page.startsWith("netease-pl:") ||
      page.startsWith("netease-album:")
    );
  }
  return page === id;
}

export function Sidebar({ active, onSelect }: Props) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-kicker">Library</div>
      <nav className="sidebar-menu">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar-menu-item${isActive(item.id, active) ? " active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <item.Icon className="sidebar-icon" size={18} />
            <span className="sidebar-menu-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">KAZAM · 2.1.4</div>
    </aside>
  );
}
