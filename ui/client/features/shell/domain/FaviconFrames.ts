// Pure (DOMAIN-001): the Cockpit's tab icon as the logo's toggle mark, frame by frame. The mark flips while the framework is working
// (the same knob and bar keyframes as app/brand.css `brand-toggle-knob` / `brand-toggle-bar`, 1.5 s per flip like the busy logo), so the
// tab shows that work is going on even when the Cockpit is in a background tab. Drawn from the clock, never from a counter, so a
// throttled background tab is choppier, never out of step. The static icon is app/icon.svg; the frame at rest IS that drawing.

/** One flip of the toggle, in ms (the busy logo's cadence). */
export const FLIP_CYCLE_MS = 1500;

type Stops = [number, number][];
// Percent-of-cycle -> value, straight from brand.css. Between two stops the value eases in and out, like the CSS animation.
const KNOB_X: Stops = [[0, 0], [38, 0], [50, -20], [84, -20], [96, 0], [100, 0]];
const BAR_OPACITY: Stops = [[0, 1], [36, 1], [40, 0], [44, 0], [45, 0], [82, 0], [86, 1], [92, 1], [93, 0], [94, 0], [95, 1], [100, 1]];
const BAR_X: Stops = [[0, 0], [36, 0], [40, 0], [44, 0], [45, 17], [82, 17], [86, 17], [92, 17], [93, 17], [94, 17], [95, 0], [100, 0]];

const ease = (u: number) => u * u * (3 - 2 * u);
function sample(stops: Stops, pct: number): number {
  for (let i = 1; i < stops.length; i += 1) {
    const [p1, v1] = stops[i];
    if (pct <= p1) {
      const [p0, v0] = stops[i - 1];
      return p1 === p0 ? v1 : v0 + (v1 - v0) * ease((pct - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

export type ToggleFrame = { knobX: number; barX: number; barOpacity: number };

/** The toggle `tMs` into the loop (any time; it wraps). */
export function toggleFrame(tMs: number): ToggleFrame {
  const pct = ((((tMs % FLIP_CYCLE_MS) + FLIP_CYCLE_MS) % FLIP_CYCLE_MS) / FLIP_CYCLE_MS) * 100;
  return { knobX: sample(KNOB_X, pct), barX: sample(BAR_X, pct), barOpacity: sample(BAR_OPACITY, pct) };
}

/** At rest: knob right, bar showing, nothing shifted. A stopping favicon waits for this so it never freezes mid-flip. */
export const isAtRest = (f: ToggleFrame): boolean => f.knobX === 0 && f.barX === 0 && f.barOpacity === 1;

const r = (n: number) => Math.round(n * 4) / 4;

/** The frame as an SVG document (the drawing in app/icon.svg, with the knob and bar moved). */
export function toggleFaviconSvg(f: ToggleFrame): string {
  const bar = f.barOpacity === 1 && f.barX === 0 ? '' : ` transform="translate(${r(f.barX)} 0)" opacity="${Math.round(f.barOpacity * 100) / 100}"`;
  const knob = f.knobX === 0 ? '' : ` transform="translate(${r(f.knobX)} 0)"`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><style>:root{--ink:#0d0f12}@media (prefers-color-scheme:dark){:root{--ink:#f2f4f7}}</style>' +
    '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="44" y2="44"><stop offset="0" stop-color="#8fb0ff"/><stop offset="1" stop-color="#4b63f5"/></linearGradient></defs>' +
    '<rect x="4" y="15" width="40" height="18" rx="9" fill="none" stroke="var(--ink)" stroke-width="2.6"/>' +
    `<rect x="10" y="21.6" width="13" height="4.8" rx="2.4" fill="var(--ink)"${bar}/>` +
    `<circle cx="34" cy="24" r="5" fill="url(#g)"${knob}/></svg>`
  );
}

export const toDataUrl = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;
