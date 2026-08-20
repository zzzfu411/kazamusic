import { BrandGlyph } from "../icons/Icons";

type Props = {
  size?: number;
  withWord?: boolean;
  stacked?: boolean;
};

export function BrandMark({ size = 28, withWord = true, stacked = false }: Props) {
  return (
    <span className={`brand-mark${stacked ? " is-stacked" : ""}`}>
      <span className="brand-glyph">
        <BrandGlyph size={size} />
      </span>
      {withWord ? (
        <span className="brand-word">
          <span className="brand-word-name">KAZAM!</span>
        </span>
      ) : null}
    </span>
  );
}
