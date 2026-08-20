import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ size = 16, children, ...rest }: IconProps) {
  const labeled = Boolean(rest["aria-label"] || rest["aria-labelledby"]);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={labeled ? undefined : true}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function BrandGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-glyph-svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="#173A52" />
      <g fill="#facc15">
        <ellipse cx="12.4" cy="22.4" rx="5.1" ry="3.7" transform="rotate(-20 12.4 22.4)" />
        <rect x="16.6" y="6.4" width="2.35" height="16.4" rx="0.85" />
        <path d="M18.95 6.4c7.1 1.5 8.05 9.4 3.35 11.7l-3.35-2.15Z" />
      </g>
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 3.5 14.1 5.1l2.55.35 1.45 2.15 2.05 1.7-.2 2.7.2 2.7-2.05 1.7-1.45 2.15-2.55.35L12 20.5l-2.1-1.6-2.55-.35-1.45-2.15-2.05-1.7.2-2.7-.2-2.7 2.05-1.7 1.45-2.15 2.55-.35Z"
        {...stroke}
      />
      <circle cx="12" cy="12" r="2.85" {...stroke} />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.6 4.4A8.1 8.1 0 1 0 19.7 14.2 6.3 6.3 0 0 1 15.6 4.4Z" {...stroke} />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.4" {...stroke} />
      <path
        d="M12 3.2v1.8M12 19v1.8M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3.2 12h1.8M19 12h1.8M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3"
        {...stroke}
      />
    </Svg>
  );
}

export function IconSystem(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7.2" {...stroke} />
      <path d="M12 4.8a7.2 7.2 0 0 1 0 14.4Z" fill="currentColor" />
    </Svg>
  );
}

export function IconIsland(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="8.2" width="17.6" height="7.6" rx="3.8" {...stroke} />
      <circle cx="9.2" cy="12" r="1.15" fill="currentColor" />
      <circle cx="14.8" cy="12" r="1.15" fill="currentColor" />
    </Svg>
  );
}

export function IconTaskbar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.4" y="4.4" width="17.2" height="12.2" rx="2.4" {...stroke} />
      <path d="M3.4 19.2h17.2" {...stroke} />
    </Svg>
  );
}

export function IconRecommend(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 3.4 13.7 9h5.9l-4.8 3.5 1.8 5.6L12 14.8 7.4 18.1l1.8-5.6L4.4 9h5.9Z"
        {...stroke}
      />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.2" {...stroke} />
      <path d="m15.8 15.8 4.1 4.1" {...stroke} />
    </Svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5.2" width="12.4" height="13.6" rx="2.2" {...stroke} />
      <path d="M16.4 8.2h2.2a1.4 1.4 0 0 1 1.4 1.4v9.2a1.4 1.4 0 0 1-1.4 1.4H8.4" {...stroke} />
      <circle cx="10.2" cy="14.4" r="1.7" fill="currentColor" />
      <path d="M11.7 8.6v5.8" {...stroke} />
    </Svg>
  );
}

export function IconPlaylists(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.4 7h10.4M4.4 12h7.2M4.4 17h7.2" {...stroke} />
      <circle cx="17.4" cy="15.6" r="2.3" {...stroke} />
      <path d="M19.7 9.2v6.4" {...stroke} />
    </Svg>
  );
}

export function IconRecognize(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9.1" y="3.6" width="5.8" height="10.2" rx="2.9" {...stroke} />
      <path d="M7.2 11.4a4.8 4.8 0 0 0 9.6 0M12 16.2v4.2M8.6 20.4h6.8" {...stroke} />
    </Svg>
  );
}

export function IconPrev(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18.2 5.4v13.2L8.6 12Z" fill="currentColor" />
      <rect x="5.4" y="5.6" width="2.2" height="12.8" rx="0.9" fill="currentColor" />
    </Svg>
  );
}

export function IconNext(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.8 5.4v13.2L15.4 12Z" fill="currentColor" />
      <rect x="16.4" y="5.6" width="2.2" height="12.8" rx="0.9" fill="currentColor" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.2 5.2v13.6L18.8 12Z" fill="currentColor" />
    </Svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.4" y="5.2" width="3.4" height="13.6" rx="1.2" fill="currentColor" />
      <rect x="14.2" y="5.2" width="3.4" height="13.6" rx="1.2" fill="currentColor" />
    </Svg>
  );
}

export function IconSequence(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.2 12h14.2M14.2 7.2 19.4 12l-5.2 4.8" {...stroke} />
    </Svg>
  );
}

export function IconShuffle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.4 7.2h3.4l8.4 9.6h3.4M16.2 7.2h3.4M4.4 16.8h3.4" {...stroke} />
      <path d="m16.6 5.2 3 2-3 2M16.6 14.8l3 2-3 2" {...stroke} />
    </Svg>
  );
}

export function IconRepeat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.2 7.2h9.2a3.2 3.2 0 0 1 3.2 3.2v1.4M16.8 16.8H7.6A3.2 3.2 0 0 1 4.4 13.6v-1.4" {...stroke} />
      <path d="m14.4 4.8 2.8 2.4-2.8 2.2M9.6 19.2 6.8 16.8l2.8-2.2" {...stroke} />
    </Svg>
  );
}

export function IconRepeatOne(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.2 7.2h9.2a3.2 3.2 0 0 1 3.2 3.2v1.4M16.8 16.8H7.6A3.2 3.2 0 0 1 4.4 13.6v-1.4" {...stroke} />
      <path d="m14.4 4.8 2.8 2.4-2.8 2.2M9.6 19.2 6.8 16.8l2.8-2.2" {...stroke} />
      <path d="M11.4 10.4v5.2M11.4 10.4 10 11.6" {...stroke} />
    </Svg>
  );
}

export function IconQueue(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.6 7h14.8M4.6 12h14.8M4.6 17h9.4" {...stroke} />
    </Svg>
  );
}

export function IconMinimize(props: IconProps) {
  return (
    <Svg size={10} viewBox="0 0 10 10" {...props}>
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <Svg size={10} viewBox="0 0 10 10" {...props}>
      <rect
        x="1.2"
        y="1.2"
        width="7.6"
        height="7.6"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </Svg>
  );
}

export function IconRestore(props: IconProps) {
  return (
    <Svg size={10} viewBox="0 0 10 10" {...props}>
      <rect x="2.4" y="1.1" width="6.2" height="6.2" rx="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.4 3.4V8.2A1.1 1.1 0 0 0 2.5 9.3H7.3" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg size={10} viewBox="0 0 10 10" {...props}>
      <path
        d="M2 2l6 6M8 2 2 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconVolume({ muted = false, ...props }: IconProps & { muted?: boolean }) {
  return (
    <Svg {...props}>
      <path
        d="M4.4 9.1h3.2L12.2 5.6v12.8l-4.6-3.5H4.4A1.3 1.3 0 0 1 3.1 13.6v-3.2A1.3 1.3 0 0 1 4.4 9.1Z"
        fill="currentColor"
      />
      {muted ? (
        <path d="m15.1 9.1 4.4 4.4M19.5 9.1l-4.4 4.4" {...stroke} />
      ) : (
        <path d="M15.2 9.3a3.5 3.5 0 0 1 0 5.4M17.7 7.1a6.4 6.4 0 0 1 0 9.8" {...stroke} />
      )}
    </Svg>
  );
}

export function IconHeart({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  const d =
    "M12 20s-7.4-4.52-9.15-9.35C1.58 7.5 3.46 4.7 6.5 4.7c1.72 0 3.18.96 3.96 2.42C11.24 5.66 12.7 4.7 14.42 4.7c3.04 0 4.92 2.8 3.65 5.95C16.32 15.48 12 20 12 20Z";
  return (
    <Svg {...props}>
      {filled ? <path d={d} fill="currentColor" /> : <path d={d} {...stroke} />}
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.2v10.4M8.1 11.3 12 15.2l3.9-3.9M5 18.6h14" {...stroke} />
    </Svg>
  );
}
