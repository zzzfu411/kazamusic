import cover01 from "./cover-01.jpg";
import cover02 from "./cover-02.jpg";
import cover03 from "./cover-03.jpg";
import emptyLibrary from "./empty-library.jpg";
import emptyLyrics from "./empty-lyrics.jpg";
import emptyRecognize from "./empty-recognize.jpg";
import emptySearch from "./empty-search.jpg";
import mark from "./mark.jpg";
import markBolt from "./mark-bolt.jpg";
import markSignal from "./mark-signal.jpg";
import textureVu from "./texture-vu.jpg";
import wallpaperDark from "./wallpaper-dark.jpg";
import wallpaperLight from "./wallpaper-light.jpg";

export const brand = {
  name: "KAZAM",
  callsign: "KZ-AM",
  tagline: "music",
  mark,
  markBolt,
  markSignal,
  wallpaperDark,
  wallpaperLight,
  textureVu,
  covers: [cover01, cover02, cover03] as const,
  empty: {
    search: emptySearch,
    library: emptyLibrary,
    lyrics: emptyLyrics,
    recognize: emptyRecognize,
  },
} as const;

export type BrandAssets = typeof brand;
