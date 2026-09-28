import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PILL, capsulePoint, capsulePerimeter, capsuleLoop, gradientT, parseColor, mixColor, contrast, isDarkBackground, loopColors, tubeGeometry, tubeColors, yawAt, poseAt, STATIC_POSE, MOTION, damp, pointerNorm, parallaxTarget, pulseEnvelope, fitDistance, shouldDraw, decideMode } from "./geometry.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("capsule: the outline stays on the stadium, is closed and evenly spaced", () => {
  const n = 240, loop = capsuleLoop(n), r = PILL.height / 2, straight = PILL.length - PILL.height;
  for (const p of loop) {
    // distance to the centre segment [-straight/2, straight/2] on the x axis equals the radius
    const dx = Math.max(Math.abs(p.x) - straight / 2, 0);
    near(Math.hypot(dx, p.y), r, 1e-9);
    near(Math.hypot(p.tx, p.ty), 1); near(Math.hypot(p.nx, p.ny), 1);
    near(p.tx * p.nx + p.ty * p.ny, 0);
  }
  assert.ok(Math.max(...loop.map((p) => p.x)) <= PILL.length / 2 + 1e-9);
  assert.ok(Math.min(...loop.map((p) => p.x)) >= -PILL.length / 2 - 1e-9);
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const gaps = loop.map((p, i) => gap(p, loop[(i + 1) % n])); // includes the wrap-around
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.02, "even spacing, so the tube segments are even");
  near(capsulePoint(0).x, 0); near(capsulePoint(0).y, -r);
  near(capsulePoint(capsulePerimeter() + 3).x, capsulePoint(3).x);
});

test("capsule: the normal points away from the centre, and the outline runs counter-clockwise", () => {
  for (const p of capsuleLoop(120)) {
    const cx = Math.max(-(PILL.length - PILL.height) / 2, Math.min((PILL.length - PILL.height) / 2, p.x));
    assert.ok((p.x - cx) * p.nx + p.y * p.ny > 0, "outward");
    assert.ok(p.x * p.ty - p.y * p.tx > 0, "counter-clockwise");
  }
});

test("colour: the gradient follows the mark's diagonal and the parsers read the tokens", () => {
  assert.ok(gradientT(-14, 5.5) < gradientT(14, -5.5), "top-left is the first stop's side, bottom-right the second's");
  near(gradientT(0, 0), (30 + 32.5 - 8) / 80);
  assert.equal(gradientT(-999, 999), 0); assert.equal(gradientT(999, -999), 1);
  assert.deepEqual(parseColor("#8fb0ff").map((v) => Math.round(v * 255)), [0x8f, 0xb0, 0xff]);
  assert.deepEqual(parseColor(" #FFF ").map((v) => Math.round(v * 255)), [255, 255, 255]);
  assert.deepEqual(parseColor("rgb(255, 0, 51)").map((v) => Math.round(v * 255)), [255, 0, 51]);
  assert.deepEqual(parseColor("nonsense", [1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(mixColor([0, 0, 0], [1, 1, 1], 0.25), [0.25, 0.25, 0.25]);
  const loop = capsuleLoop(32), c = loopColors(loop, [1, 0, 0], [0, 0, 1]);
  assert.equal(c.length, 96);
  assert.ok(c.every((v) => v >= 0 && v <= 1));
});

test("colour: the mark's tube stays 3:1 against the page in both themes", () => {
  const cases = [
    { name: "dark", bg: parseColor("#171613"), a: parseColor("#8fb0ff"), b: parseColor("#4b63f5") },
    { name: "light", bg: parseColor("#f3efe6"), a: parseColor("#5a72f2"), b: parseColor("#3448d6") },
  ];
  for (const { name, bg, a, b } of cases) {
    assert.equal(isDarkBackground(bg), name === "dark");
    for (const c of [a, b, mixColor(a, b, 0.5)]) assert.ok(contrast(c, bg) >= 3, `${name}: ${contrast(c, bg).toFixed(2)}`);
  }
});

test("tube: sizes, indices in range, no degenerate triangles, faces agree with the vertex normals", () => {
  const loop = capsuleLoop(64), M = 10, g = tubeGeometry(loop, 1.2, M);
  assert.equal(g.vertexCount, 64 * M);
  assert.equal(g.positions.length, 64 * M * 3);
  assert.equal(g.indices.length, 64 * M * 6);
  assert.ok(g.indices.every((i) => i < g.vertexCount));
  assert.ok(g.positions.every(Number.isFinite) && g.normals.every(Number.isFinite));
  // every vertex sits exactly `radius` from its centre-line point
  for (let i = 0; i < 64; i++) for (let j = 0; j < M; j++) {
    const k = (i * M + j) * 3, dx = g.positions[k] - loop[i].x, dy = g.positions[k + 1] - loop[i].y, dz = g.positions[k + 2];
    near(Math.hypot(dx, dy, dz), 1.2, 1e-5);
  }
  // winding: the geometric normal of each triangle points the same way as its vertex normals (front faces face out)
  let bad = 0;
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
    const P = (i) => [0, 1, 2].map((d) => g.positions[i * 3 + d]), pa = P(a), pb = P(b), pc = P(c);
    const u = pb.map((v, d) => v - pa[d]), v = pc.map((w, d) => w - pa[d]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    assert.ok(len > 1e-9, "no degenerate triangle");
    const vn = [0, 1, 2].map((d) => g.normals[a * 3 + d]);
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] <= 0) bad++;
  }
  assert.equal(bad, 0);
  const col = tubeColors(loopColors(loop, [1, 0, 0], [0, 0, 1]), M);
  assert.equal(col.length, g.positions.length);
});

test("motion: a full turn per period that lingers when facing the viewer and never runs backwards", () => {
  const P = MOTION.period, ts = Array.from({ length: 2001 }, (_, i) => (i / 2000) * P);
  const ys = ts.map((t) => yawAt(t));
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1], "monotonic");
  near(ys.at(-1) - ys[0], Math.PI * 2, 1e-9);
  const speed = (t) => (yawAt(t + 1e-4) - yawAt(t - 1e-4)) / 2e-4;
  const tFront = ((0 - MOTION.phase) / (Math.PI * 2)) * P + P; // yaw phase 0: facing the viewer
  const tEdge = tFront + P / 4;
  assert.ok(speed(tFront) < speed(tEdge) * 0.5, "slower face-on than edge-on");
  // slow: under one revolution per 15 s at its fastest
  assert.ok(Math.max(...ts.map(speed)) < (Math.PI * 2) / 12);
});

test("motion: the pose stays gentle and finite, the static pose is a three-quarter view", () => {
  for (let t = 0; t < 120; t += 0.7) {
    const p = poseAt(t);
    assert.ok(Math.abs(p.pitch) < 0.35 && Math.abs(p.roll) < 0.2 && Number.isFinite(p.yaw));
  }
  assert.ok(STATIC_POSE.yaw > 0.3 && STATIC_POSE.yaw < 1.0 && Math.abs(STATIC_POSE.pitch) < 0.4);
  near(damp(0, 10, 5, 0), 0);
  assert.ok(damp(0, 10, 5, 0.1) > 0 && damp(0, 10, 5, 0.1) < 10);
  near(damp(0, 10, 5, 100), 10, 1e-6);
});

test("parallax: pointer to rotation is centred, clamped and signed", () => {
  assert.deepEqual(pointerNorm(720, 450, 1440, 900), { x: 0, y: 0 });
  assert.deepEqual(pointerNorm(-500, 5000, 1440, 900), { x: -1, y: 1 });
  assert.deepEqual(pointerNorm(1, 1, 0, 0), { x: 0, y: 0 });
  const right = parallaxTarget({ x: 1, y: 0 }), up = parallaxTarget({ x: 0, y: -1 });
  assert.ok(right.yaw > 0 && right.dx > 0 && up.pitch < 0 && up.dy > 0);
  assert.deepEqual(parallaxTarget({ x: 0, y: 0 }), { yaw: 0, pitch: 0, dx: 0, dy: -0 });
  assert.ok(Math.abs(right.yaw) < 0.4, "a nudge, not a swing");
});

test("pulse: zero outside, peaks once, then falls", () => {
  assert.equal(pulseEnvelope(-1), 0); assert.equal(pulseEnvelope(0), 0); assert.equal(pulseEnvelope(2), 0); assert.equal(pulseEnvelope(NaN), 0);
  const xs = Array.from({ length: 91 }, (_, i) => pulseEnvelope(i * 0.01));
  const peak = Math.max(...xs), at = xs.indexOf(peak);
  near(peak, 1, 1e-2); near(pulseEnvelope(0.9 * 0.18), 1, 1e-9);
  assert.ok(at > 5 && at < 40);
  for (let i = 1; i <= at; i++) assert.ok(xs[i] >= xs[i - 1]);
  for (let i = at + 1; i < xs.length; i++) assert.ok(xs[i] <= xs[i - 1]);
});

test("camera: farther for a narrow box than a wide one, and the pill always fits", () => {
  const wide = fitDistance({ aspect: 2 }), narrow = fitDistance({ aspect: 0.8 });
  assert.ok(narrow > wide);
  for (const aspect of [0.8, 1.2, 1.7, 2.4]) {
    const d = fitDistance({ aspect, fovDeg: 26, margin: 1 }), tan = Math.tan((26 * Math.PI) / 360);
    assert.ok(d * tan * aspect >= PILL.length / 2 - 1e-9 && d * tan >= PILL.height / 2);
  }
});

test("the loop is capped at 60 fps", () => {
  assert.equal(shouldDraw(100, null), true);
  assert.equal(shouldDraw(108, 100), false);   // a 120 Hz display: skip every other frame
  assert.equal(shouldDraw(116.7, 100), true);
  assert.equal(shouldDraw(200, 100), true);
  assert.equal(shouldDraw(100, 100), false);
});

test("fallback decision: every reason gives the right hero", () => {
  const ok = { webgl: true };
  assert.equal(decideMode(ok).mode, "animated");
  assert.equal(decideMode({}).mode, "svg");
  assert.equal(decideMode({ ...ok, reducedMotion: true }).mode, "static");
  assert.equal(decideMode({ webgl: false, reducedMotion: true }).mode, "svg", "reduced motion without WebGL still shows the mark");
  assert.equal(decideMode({ ...ok, saveData: true }).mode, "svg");
  assert.equal(decideMode({ ...ok, lowBattery: true }).mode, "svg");
  assert.equal(decideMode({ ...ok, loadFailed: true }).mode, "svg");
  assert.equal(decideMode({ ...ok, narrow: true }).mode, "off");
  assert.equal(decideMode({ ...ok, param: "off" }).mode, "off");
  assert.equal(decideMode({ ...ok, param: "svg" }).mode, "svg");
  assert.equal(decideMode({ param: "off", webgl: false }).mode, "off");
  assert.ok(decideMode({ webgl: false }).reason);
});

test("hero3d: the bundle is vendored (no CDN), small, and exposes createScene", { skip: !fs.existsSync(new URL("./hero.bundle.mjs", import.meta.url)) && "run npm run build:hero first" }, () => {
  const url = new URL("./hero.bundle.mjs", import.meta.url), text = fs.readFileSync(url, "utf8");
  assert.ok(fs.statSync(url).size < 900 * 1024, "the bundle stays under 900 KB raw");
  assert.ok(!/https?:\/\/(cdn|unpkg|esm\.sh|cdnjs|jsdelivr)/i.test(text), "nothing is loaded from a CDN");
  assert.match(text, /export\s*\{[^}]*createScene/);
  assert.match(text, /SPDX-License-Identifier: MIT/, "Three.js's licence notice is kept");
});
