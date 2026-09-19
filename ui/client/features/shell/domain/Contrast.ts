// Pure (DOMAIN-001): WCAG 2.x relative-luminance contrast, used to guard the
// design tokens. Colours are [r, g, b] (0-255); translucent colours are
// composited over a backdrop first.
export type Rgb = [number, number, number];

/** Parses #rgb, #rrggbb and rgba(r,g,b,a) (composited over `over`, default black). */
export function parseColor(value: string, over: Rgb = [0, 0, 0]): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (rgba) {
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    const fg = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + over[i] * (1 - a))) as Rgb;
  }
  throw new Error(`Unsupported colour: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
