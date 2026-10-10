// Pure geometry for the canvas visuals: curves, easing, routes for each outcome, colours. No DOM and no canvas here, so
// every function runs in node and is unit-tested. The drawing code (render.mjs) only turns these numbers into strokes.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- easing (all map 0..1 to 0..1) ----------
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutSine = (t) => (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2;
export const easeInOutCubic = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// A stable number in [0, 1) from a string, so a part always gets the same lane and break point (no randomness in a replay).
export function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}

// A small seeded random generator (the stress graph must be the same every time it is built).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colours (the palette is read from CSS custom properties at draw time; these only do arithmetic) ----------
export function parseColor(input) {
  const s = String(input ?? "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4] };
  return { r: 128, g: 128, b: 128, a: 1 }; // unreadable: a neutral grey rather than an exception
}
export const withAlpha = (color, a) => { const c = parseColor(color); return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${clamp(a * c.a, 0, 1).toFixed(3)})`; };
export const isDarkColor = (color) => { const c = parseColor(color); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 < 0.5; };

// ---------- curves and polylines ----------
// A curve is sampled once into a polyline with running lengths; partial strokes (the travelling pulse) slice it by fraction.
export function cubicAt(p0, c1, c2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}
// Curves leave and arrive horizontally, like a signal running along a wire: the stretch in the middle does the bending.
export function sideControls(a, b) {
  const dx = clamp(Math.abs(b.x - a.x) * 0.5, 28, 280);
  return [{ x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }];
}
export function makePoly(flat) {
  const n = flat.length / 2, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(flat[2 * i] - flat[2 * i - 2], flat[2 * i + 1] - flat[2 * i - 1]));
  return { pts: flat, cum, len: cum[n - 1] || 0, n };
}
export function curvePoly(a, b, steps = 28) {
  const [c1, c2] = sideControls(a, b), flat = [];
  for (let i = 0; i <= steps; i++) { const p = cubicAt(a, c1, c2, b, i / steps); flat.push(p.x, p.y); }
  return makePoly(flat);
}
// Where a point at fraction f (of the length) sits, and which way the line is heading there.
export function pointAt(poly, f) {
  if (poly.n < 2 || poly.len === 0) return { x: poly.pts[0] ?? 0, y: poly.pts[1] ?? 0, angle: 0 };
  const d = clamp(f, 0, 1) * poly.len;
  let i = 1;
  while (i < poly.n - 1 && poly.cum[i] < d) i++;
  const seg = poly.cum[i] - poly.cum[i - 1] || 1, t = (d - poly.cum[i - 1]) / seg;
  const x0 = poly.pts[2 * i - 2], y0 = poly.pts[2 * i - 1], x1 = poly.pts[2 * i], y1 = poly.pts[2 * i + 1];
  return { x: lerp(x0, x1, t), y: lerp(y0, y1, t), angle: Math.atan2(y1 - y0, x1 - x0) };
}
// The stretch of the polyline between two fractions, as a flat [x, y, ...] list with exact end points.
export function slice(poly, f0, f1) {
  f0 = clamp(f0, 0, 1); f1 = clamp(f1, 0, 1);
  if (f1 <= f0 || poly.n < 2) return [];
  const a = pointAt(poly, f0), b = pointAt(poly, f1), out = [a.x, a.y];
  const d0 = f0 * poly.len, d1 = f1 * poly.len;
  for (let i = 1; i < poly.n - 1; i++) if (poly.cum[i] > d0 && poly.cum[i] < d1) out.push(poly.pts[2 * i], poly.pts[2 * i + 1]);
  out.push(b.x, b.y);
  return out;
}

// ---------- routes: what each outcome looks like ----------
// A route is a list of parts (each a polyline that runs during a slice of the pulse's time) plus marks for the ends.
//   fit   one line that arrives at the endpoint
//   wait  a short dashed line that pauses at an open ring near the part: an Ask is open, nothing is settled, so no terminator
//   gap   one line that stops short at a small terminator, never reaching the contract
//   tie   one line that forks at the middle into two, ending at two candidate fields of the endpoint
//   stub  one dashed line to the stub node
//   kept  no line: a part kept from the design has nothing to trace to, so only a ring on the part itself
// Coordinates are all in the same space (the canvas's).
export const LANE = 7; // lines that share an endpoint fan out by up to this many px so they do not merge into one stroke
export const laneOffset = (id) => (hash01(String(id)) - 0.5) * 2 * LANE;
export const BREAK_AT = (id) => 0.5 + 0.12 * hash01(`${id}#break`); // the fraction of the way at which a Gap's line stops
export const PAUSE_AT = (id) => 0.16 + 0.06 * hash01(`${id}#pause`); // ... and where a waiting part's line pauses: close to the part

export function routeFor(kind, from, to, { id = "", spread = 11 } = {}) {
  if (kind === "kept" || !to) return { kind, parts: [], marks: [{ type: "ring", at: from, tone: "fit" }] };
  const end = { x: to.x, y: to.y + laneOffset(id) };
  if (kind === "wait") {
    const full = curvePoly(from, end), f = PAUSE_AT(id);
    const stop = pointAt(full, f), cut = makePoly(slice(full, 0, f));
    return { kind, parts: [{ poly: cut, t0: 0, t1: 1, tone: "wait", dash: true }], marks: [{ type: "pause", at: stop, tone: "wait" }] };
  }
  if (kind === "gap") {
    const full = curvePoly(from, end), f = BREAK_AT(id);
    const stop = pointAt(full, f), cut = makePoly(slice(full, 0, f));
    return { kind, parts: [{ poly: cut, t0: 0, t1: 1, tone: "accent" }], marks: [{ type: "break", at: stop, tone: "gap" }] };
  }
  if (kind === "tie") {
    const base = curvePoly(from, end), fork = pointAt(base, 0.5), main = makePoly(slice(base, 0, 0.5));
    const a = { x: end.x, y: to.y - spread }, b = { x: end.x, y: to.y + spread };
    return {
      kind,
      parts: [
        { poly: main, t0: 0, t1: 0.5, tone: "accent" },
        { poly: curvePoly(fork, a, 16), t0: 0.5, t1: 1, tone: "tie" },
        { poly: curvePoly(fork, b, 16), t0: 0.5, t1: 1, tone: "tie" },
      ],
      marks: [{ type: "fork", at: fork, tone: "tie" }, { type: "ring", at: a, tone: "tie" }, { type: "ring", at: b, tone: "tie" }],
    };
  }
  const poly = curvePoly(from, end);
  if (kind === "stub") return { kind, parts: [{ poly, t0: 0, t1: 1, tone: "stub", dash: true }], marks: [{ type: "node", at: end, tone: "stub" }] };
  return { kind: "fit", parts: [{ poly, t0: 0, t1: 1, tone: "accent" }], marks: [{ type: "ring", at: end, tone: "fit" }] };
}

// How much of a part of a route is drawn at overall progress T (0..1).
export const partProgress = (part, T) => clamp((T - part.t0) / (part.t1 - part.t0 || 1), 0, 1);

// The two ends of a short perpendicular tick, for the Gap terminator.
export function tickAt(p, len = 10) {
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  return [p.x - nx * len / 2, p.y - ny * len / 2, p.x + nx * len / 2, p.y + ny * len / 2];
}

// The lifecycle of one pulse, given its age in ms and its travel time: where the head is, how far the ring has grown and
// how much of the "just happened" brightness is left. The line itself stays after the pulse (settled) at a faint alpha.
export function pulsePhase(age, dur, ringMs = 520) {
  const travel = clamp(age / dur, 0, 1);
  const arrived = age >= dur;
  const ring = arrived ? clamp((age - dur) / ringMs, 0, 1) : 0;
  return { T: easeInOutSine(travel), travel, arrived, ring, done: arrived && ring >= 1 };
}

// Where a rect's anchors are. Rects are {left, top, right, bottom} (a DOMRect works).
export const rectRight = (r, pad = 3) => ({ x: r.right + pad, y: (r.top + r.bottom) / 2 });
export const rectLeft = (r, pad = 2) => ({ x: r.left - pad, y: (r.top + r.bottom) / 2 });
export const rectVisible = (r, box) => (r.top + r.bottom) / 2 >= box.top && (r.top + r.bottom) / 2 <= box.bottom && r.right > box.left && r.left < box.right;
