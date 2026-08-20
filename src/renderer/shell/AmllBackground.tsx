import { BackgroundRender, MeshGradientRenderer } from "@applemusic-like-lyrics/react";
import "@applemusic-like-lyrics/core/style.css";

type Props = {
  album: string;
  playing: boolean;
};

export function AmllBackground({ album, playing }: Props) {
  if (!album) return null;
  return (
    <div className="amll-bg-layer" aria-hidden>
      <BackgroundRender
        className="amll-bg-render"
        album={album}
        fps={30}
        flowSpeed={2}
        playing={playing}
        hasLyric
        renderScale={playing ? 0.5 : 0.35}
        renderer={MeshGradientRenderer}
      />
    </div>
  );
}
