// The pure parts of the 3D pill hero: no DOM, no Three.js, so they run (and are tested) under plain node.
// The pill is the Trace mark (src/ui/assets/trace-mark.svg): a 28 x 11 rounded rectangle with full round ends,
// stroke only. Units are the mark's own SVG units, centred on the origin, y up.

export const PILL = { length: 28, height: 11, stroke: 2.8 };
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- the outline ----------
// One point on the capsule's centre line, at arc length s (wraps). Counter-clockwise, starting at the middle of the
// bottom edge. Also returns the unit tangent (tx, ty) and the outward in-plane normal (nx, ny).
export function capsulePoint(s, length = PILL.length, height = PILL.height) {
  const r = height / 2, straight = Math.max(0, length - height), cap = Math.PI * r, per = 2 * straight + 2 * cap;
  s = ((s % per) + per) % per;
  // the walk starts at the middle of the bottom edge, so shift half a straight edge back
  s = (s + straight / 2) % per;
  let x, y, tx, ty;
  if (s < straight) { x = -straight / 2 + s; y = -r; tx = 1; ty = 0; }
  else if (s < straight + cap) {
    const a = -Math.PI / 2 + (s - straight) / r;
    x = straight / 2 + r * Math.cos(a); y = r * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a);
  } else if (s < 2 * straight + cap) { x = straight / 2 - (s - straight - cap); y = r; tx = -1; ty = 0; }
  else {
    const a = Math.PI / 2 + (s - 2 * straight - cap) / r;
    x = -straight / 2 + r * Math.cos(a); y = r * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a);
  }
  return { x, y, tx, ty, nx: ty, ny: -tx };
}
export const capsulePerimeter = (length = PILL.length, height = PILL.height) => 2 * Math.max(0, length - height) + Math.PI * height;

// n points evenly spaced by arc length, so a tube built on them has even segments.
export function capsuleLoop(n = 192, length = PILL.length, height = PILL.height) {
  const per = capsulePerimeter(length, height);
  return Array.from({ length: n }, (_, i) => capsulePoint((i / n) * per, length, height));
}

// ---------- colour ----------
// The mark's gradient runs from (4,4) to (44,44) in SVG user space. The pill is centred at (30,32.5) there and the
// SVG's y points down, so a point (x, y) of our y-up outline sits at (30 + x, 32.5 - y).
export function gradientT(x, y) {
  return clamp((30 + x + 32.5 - y - 8) / 80, 0, 1);
}
// "#rgb", "#rrggbb" or "rgb(r, g, b)" -> [r, g, b] in 0..1, or the fallback when it can't be read.
export function parseColor(text, fallback = [0.5, 0.5, 0.5]) {
  const s = String(text ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255);
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [m[1], m[2], m[3]].map((v) => clamp(Number(v) / 255, 0, 1));
  return fallback;
}
export const mixColor = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
export const luminance = ([r, g, b]) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (c1, c2) => { const [a, b] = [luminance(c1), luminance(c2)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
export const isDarkBackground = (rgb) => luminance(rgb) < 0.25;
// One colour per loop point, flat [r,g,b,...] (the Float32Array the scene uploads), from the two gradient stops.
export function loopColors(loop, a, b, out = new Float32Array(loop.length * 3)) {
  loop.forEach((p, i) => { const c = mixColor(a, b, gradientT(p.x, p.y)); out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; });
  return out;
}

// ---------- the tube ----------
// A tube around a closed planar loop (the loop lies in z = 0). Ring vertices are p + r (cos f * n + sin f * z), and
// wrap around both ways, so there is no seam. Returns positions, normals, indices and, per loop point, the gradient
// parameter, so a colour array can be built (and rebuilt when the theme changes) without touching the geometry.
export function tubeGeometry(loop, radius, radial = 12) {
  const N = loop.length, M = radial;
  const positions = new Float32Array(N * M * 3), normals = new Float32Array(N * M * 3), indices = new Uint16Array(N * M * 6);
  loop.forEach((p, i) => {
    for (let j = 0; j < M; j++) {
      const f = (j / M) * TAU, c = Math.cos(f), s = Math.sin(f), k = (i * M + j) * 3;
      const nx = c * p.nx, ny = c * p.ny, nz = s;
      positions[k] = p.x + radius * nx; positions[k + 1] = p.y + radius * ny; positions[k + 2] = radius * nz;
      normals[k] = nx; normals[k + 1] = ny; normals[k + 2] = nz;
    }
  });
  let q = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = ((i + 1) % N) * M + j, c = ((i + 1) % N) * M + ((j + 1) % M), d = i * M + ((j + 1) % M);
    indices[q++] = a; indices[q++] = b; indices[q++] = d;
    indices[q++] = b; indices[q++] = c; indices[q++] = d;
  }
  return { positions, normals, indices, vertexCount: N * M };
}
// Expand per-loop-point colours to per-vertex colours for a tube built with `radial` sides.
export function tubeColors(pointColors, radial, out = new Float32Array((pointColors.length / 3) * radial * 3)) {
  const N = pointColors.length / 3;
  for (let i = 0; i < N; i++) for (let j = 0; j < radial; j++) {
    const k = (i * radial + j) * 3;
    out[k] = pointColors[i * 3]; out[k + 1] = pointColors[i * 3 + 1]; out[k + 2] = pointColors[i * 3 + 2];
  }
  return out;
}

// ---------- motion ----------
export const MOTION = { period: 20, dwell: 0.55, phase: 0.6, pitch: 0.2, roll: -0.09 };
// The slow turn: a full revolution every `period` seconds, but it lingers when the pill faces the viewer (its speed
// there is (1 - dwell) of the average) and hurries through the edge-on moment, so it mostly reads as the mark.
// dwell must stay below 1 so it never runs backwards.
export function yawAt(t, { period = MOTION.period, dwell = MOTION.dwell, phase = MOTION.phase } = {}) {
  const th = (TAU * t) / period + phase;
  return th - (dwell / 2) * Math.sin(2 * th);
}
// Pose at time t (seconds): yaw about the vertical axis, a slow breathing tilt on pitch and a little roll.
export function poseAt(t, m = MOTION) {
  return { yaw: yawAt(t, m), pitch: m.pitch + 0.05 * Math.sin((TAU * t) / 11), roll: m.roll + 0.03 * Math.sin((TAU * t) / 13) };
}
// The single, well-posed frame for reduced motion: a three-quarter view that reads as the mark.
export const STATIC_POSE = { yaw: 0.62, pitch: 0.24, roll: -0.1 };
// Ease `current` toward `target`; frame-rate independent (rate is 1/seconds).
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));

// ---------- pointer parallax ----------
// Pointer position in the window -> a small offset in -1..1 on each axis (centre = 0, clamped at the edges).
export function pointerNorm(x, y, w, h) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0 };
  return { x: clamp((x - w / 2) / (w / 2), -1, 1), y: clamp((y - h / 2) / (h / 2), -1, 1) };
}
// ...and to the extra rotation and drift it causes (radians / scene units). Moving right turns the pill to the right.
export const PARALLAX = { yaw: 0.28, pitch: 0.16, shiftX: 0.9, shiftY: 0.5 };
export function parallaxTarget({ x, y }, k = PARALLAX) {
  return { yaw: x * k.yaw, pitch: y * k.pitch, dx: x * k.shiftX, dy: -y * k.shiftY };
}

// ---------- the pulse ----------
// A brief brightening when a run starts: quick rise, slower fall. Returns 0..1 (0 before the start and after the end).
export function pulseEnvelope(elapsed, duration = 0.9, attack = 0.18) {
  if (!(elapsed >= 0) || elapsed >= duration) return 0;
  const x = elapsed / duration;
  if (x < attack) { const u = x / attack; return u * u * (3 - 2 * u); }
  const u = (x - attack) / (1 - attack);
  return (1 - u) * (1 - u);
}

// ---------- the camera ----------
// How far back the camera must sit so the pill (whose turning bound is a circle of radius halfW, and whose height
// plus tilt reaches halfH) fits a viewport of the given aspect, with a margin for the glow.
export function fitDistance({ aspect, fovDeg = 26, halfW = PILL.length / 2 + PILL.stroke, halfH = PILL.height / 2 + PILL.stroke + 4, margin = 1.1 }) {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  return margin * Math.max(halfW / (tan * Math.max(aspect, 0.1)), halfH / tan);
}

// ---------- the loop's cadence ----------
export const FRAME_MS = 1000 / 60;
// Cap at 60 fps on displays that ask for more: draw only when at least a frame (less half a millisecond of
// jitter) has passed since the last drawn frame.
export const shouldDraw = (now, last, minMs = FRAME_MS) => last == null || now - last >= minMs - 0.5;

// ---------- which hero to show ----------
// Inputs: param ("off" | "svg" | null), webgl, reducedMotion, saveData, lowBattery, loadFailed, narrow (all booleans).
// Output mode: "off" (nothing), "svg" (the static mark), "static" (one 3D frame), "animated".
export function decideMode({ param = null, webgl = false, reducedMotion = false, saveData = false, lowBattery = false, loadFailed = false, narrow = false } = {}) {
  if (param === "off") return { mode: "off", reason: "turned off with ?hero=off" };
  if (narrow) return { mode: "off", reason: "window too narrow" };
  if (param === "svg") return { mode: "svg", reason: "forced with ?hero=svg" };
  if (loadFailed) return { mode: "svg", reason: "the 3D module didn't load" };
  if (!webgl) return { mode: "svg", reason: "no WebGL" };
  if (saveData) return { mode: "svg", reason: "data saver is on" };
  if (lowBattery) return { mode: "svg", reason: "battery is low" };
  if (reducedMotion) return { mode: "static", reason: "reduced motion" };
  return { mode: "animated", reason: "" };
}
