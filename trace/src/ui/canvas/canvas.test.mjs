// The canvas visuals' pure logic: geometry, easing, routes, the pulse queue, the Map's layout and hit-testing, and the
// facts (outcome, endpoint, sentence) drawn for each part. Nothing here touches a DOM or a canvas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import _parse from "@babel/parser";
import { runPipeline } from "../../pipeline.mjs";
import { readSpec } from "../../contract.mjs";
import { resetExample } from "../../reset.mjs";
import { SCENARIOS } from "../scenarios.mjs";
import { renderShell } from "../../demo-server.mjs";
import { summarize, bannedIn } from "../vocab.mjs";
import * as G from "./geometry.mjs";
import { createPulseQueue } from "./queue.mjs";
import * as L from "./layout.mjs";
import { buildParts, buildMap, sourceOf, partName, endpointKey, breakdownByEndpoint, partTotal } from "./parts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// ---------- geometry ----------
test("easing maps 0..1 to 0..1, never overshoots and is monotonic", () => {
  for (const f of [G.easeOutCubic, G.easeInOutSine, G.easeInOutCubic]) {
    near(f(0), 0); near(f(1), 1); near(f(-3), 0); near(f(9), 1);
    let last = -1;
    for (let i = 0; i <= 100; i++) { const v = f(i / 100); assert.ok(v >= last - 1e-12 && v >= 0 && v <= 1); last = v; }
  }
  near(G.easeInOutSine(0.5), 0.5);
});

test("colours: parse, mix in alpha, judge dark", () => {
  assert.deepEqual(G.parseColor("#3d4fd1"), { r: 61, g: 79, b: 209, a: 1 });
  assert.deepEqual(G.parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(G.withAlpha("#ff0000", 0.5), "rgba(255,0,0,0.500)");
  assert.equal(G.withAlpha("rgb(0, 128, 255)", 2), "rgba(0,128,255,1.000)", "alpha is clamped");
  assert.deepEqual(G.parseColor("nonsense"), { r: 128, g: 128, b: 128, a: 1 });
  assert.equal(G.isDarkColor("#171613"), true);
  assert.equal(G.isDarkColor("#f3efe6"), false);
});

test("a curve is sampled into a polyline whose slices add up", () => {
  const a = { x: 0, y: 0 }, b = { x: 300, y: 120 }, poly = G.curvePoly(a, b);
  near(poly.pts[0], 0); near(poly.pts[1], 0); near(poly.pts[poly.pts.length - 2], 300); near(poly.pts[poly.pts.length - 1], 120);
  assert.ok(poly.len > Math.hypot(300, 120) && poly.len < 500, "longer than the chord, not absurdly so");
  const whole = G.slice(poly, 0, 1), half1 = G.slice(poly, 0, 0.5), half2 = G.slice(poly, 0.5, 1);
  near(G.makePoly(whole).len, poly.len, 0.01);
  near(G.makePoly(half1).len + G.makePoly(half2).len, poly.len, 0.01);
  assert.deepEqual(G.slice(poly, 0.7, 0.7), [], "an empty stretch is empty");
  const mid = G.pointAt(poly, 0.5);
  near(mid.x, 150, 0.5); near(mid.y, 60, 0.5);
  assert.equal(G.pointAt(G.makePoly([5, 5, 5, 5]), 0.5).x, 5, "a zero-length line does not divide by zero");
});

test("curves leave and arrive horizontally", () => {
  const poly = G.curvePoly({ x: 0, y: 0 }, { x: 400, y: 200 });
  const n = poly.pts.length;
  assert.ok(Math.abs(poly.pts[3] - poly.pts[1]) < 0.2 * Math.abs(poly.pts[2] - poly.pts[0]), "starts flat");
  assert.ok(Math.abs(poly.pts[n - 1] - poly.pts[n - 3]) < 0.2 * Math.abs(poly.pts[n - 2] - poly.pts[n - 4]), "ends flat");
});

test("lanes and break points are stable and bounded", () => {
  for (const id of ["a", "list.status", "action.row.delete", "x".repeat(50)]) {
    assert.equal(G.laneOffset(id), G.laneOffset(id));
    assert.ok(Math.abs(G.laneOffset(id)) <= G.LANE);
    const b = G.BREAK_AT(id);
    assert.ok(b >= 0.5 && b <= 0.62, `break ${b}`);
  }
  assert.notEqual(G.laneOffset("a"), G.laneOffset("b"));
});

test("each outcome has its own route", () => {
  const from = { x: 10, y: 100 }, to = { x: 600, y: 300 };
  const fit = G.routeFor("fit", from, to, { id: "value.total" });
  assert.equal(fit.parts.length, 1);
  const end = fit.parts[0].poly.pts.slice(-2);
  near(end[0], 600); assert.ok(Math.abs(end[1] - 300) <= G.LANE + 1e-9, "arrives at the endpoint, within its lane");
  assert.equal(fit.marks[0].type, "ring");

  const gap = G.routeFor("gap", from, to, { id: "list.status" });
  const last = gap.parts[0].poly.pts.slice(-2);
  assert.ok(last[0] < 590 && last[0] > 200, `stops short of the contract at x=${last[0]}`);
  assert.equal(gap.marks[0].type, "break");
  assert.equal(G.tickAt(gap.marks[0].at).length, 4);

  const wait = G.routeFor("wait", from, to, { id: "list.maturity" });
  const wlast = wait.parts[0].poly.pts.slice(-2);
  assert.ok(wlast[0] > from.x && wlast[0] < from.x + (to.x - from.x) * 0.4, `pauses close to the part, at x=${wlast[0]}`);
  assert.equal(wait.marks[0].type, "pause", "an open ring, no terminator: nothing is cut off until someone settles it");
  assert.equal(wait.parts[0].tone, "wait"); assert.equal(wait.parts[0].dash, true);
  assert.ok(wait.marks.every((m) => m.type !== "break"));
  assert.deepEqual(G.routeFor("wait", from, to, { id: "list.maturity" }), wait, "a replay draws the same pause");

  const tie = G.routeFor("tie", from, to, { id: "list.owner" });
  assert.equal(tie.parts.length, 3, "one line that splits into two");
  assert.deepEqual(tie.parts.map((p) => [p.t0, p.t1]), [[0, 0.5], [0.5, 1], [0.5, 1]]);
  assert.deepEqual(tie.parts.map((p) => p.tone), ["accent", "tie", "tie"]);
  const [ea, eb] = [tie.parts[1].poly.pts.slice(-2), tie.parts[2].poly.pts.slice(-2)];
  assert.ok(eb[1] - ea[1] > 15, "the two ends are apart, at two candidate fields");
  const fork = tie.marks[0].at, mainEnd = tie.parts[0].poly.pts.slice(-2);
  near(fork.x, mainEnd[0], 1e-6); near(fork.y, mainEnd[1], 1e-6);

  const stub = G.routeFor("stub", from, to, { id: "x" });
  assert.equal(stub.parts[0].dash, true); assert.equal(stub.parts[0].tone, "stub"); assert.equal(stub.marks[0].type, "node");

  const kept = G.routeFor("kept", from, null);
  assert.deepEqual(kept.parts, []); assert.equal(kept.marks[0].type, "ring");
});

test("partProgress and pulsePhase run a pulse from start to a finished ring", () => {
  const part = { t0: 0.5, t1: 1 };
  assert.equal(G.partProgress(part, 0.25), 0); near(G.partProgress(part, 0.75), 0.5); assert.equal(G.partProgress(part, 1), 1);
  const a = G.pulsePhase(0, 1000), b = G.pulsePhase(500, 1000), c = G.pulsePhase(1200, 1000, 400), d = G.pulsePhase(1500, 1000, 400);
  assert.equal(a.T, 0); near(b.T, 0.5); assert.equal(b.arrived, false);
  assert.equal(c.arrived, true); near(c.ring, 0.5); assert.equal(c.done, false); assert.equal(d.done, true);
});

test("anchors: right edge of a part, left edge of an endpoint, and visibility in the scroller", () => {
  const r = { left: 10, right: 110, top: 20, bottom: 40 };
  assert.deepEqual(G.rectRight(r), { x: 113, y: 30 }); assert.deepEqual(G.rectLeft(r), { x: 8, y: 30 });
  assert.equal(G.rectVisible(r, { left: 0, right: 500, top: 0, bottom: 100 }), true);
  assert.equal(G.rectVisible(r, { left: 0, right: 500, top: 35, bottom: 100 }), false, "its middle is scrolled out");
  assert.equal(G.rectVisible(r, { left: 200, right: 500, top: 0, bottom: 100 }), false);
});

test("the seeded generator repeats", () => {
  const a = G.mulberry32(42), b = G.mulberry32(42);
  for (let i = 0; i < 20; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

// ---------- the pulse queue ----------
const drive = (q, ms = 60000, dt = 16) => {
  const log = { maxTravelling: 0, started: [], finished: [] };
  for (let t = 0; t < ms; t += dt) {
    const r = q.step(t);
    log.started.push(...r.started.map((p) => ({ ...p, at: t }))); log.finished.push(...r.finished);
    log.maxTravelling = Math.max(log.maxTravelling, q.travelling);
    if (q.idle) { log.end = t; break; }
  }
  return log;
};
test("the queue never runs more than its cap at once and keeps the order", () => {
  const q = createPulseQueue({ cap: 4 });
  for (let i = 0; i < 40; i++) q.push({ id: i });
  const log = drive(q);
  assert.ok(log.maxTravelling <= 4, `${log.maxTravelling} at once`);
  assert.deepEqual(log.started.map((p) => p.id), [...Array(40).keys()]);
  assert.equal(log.finished.length, 40);
  assert.ok(q.idle);
});
test("a long line speeds up, and speeds down as it drains", () => {
  const q = createPulseQueue({ cap: 6, maxSpeed: 4 });
  assert.equal(q.speed, 1);
  for (let i = 0; i < 6; i++) q.push({ id: i });
  assert.equal(q.speed, 1, "not longer than the cap: normal speed");
  for (let i = 6; i < 12; i++) q.push({ id: i });
  near(q.speed, 2);
  for (let i = 12; i < 100; i++) q.push({ id: i });
  assert.equal(q.speed, 4, "capped");
  const log = drive(q, 120000);
  const first = log.started[0], last = log.started[log.started.length - 1];
  assert.ok(first.dur < last.dur, "the pulses at the end of a drained line travel slower than at the start");
  assert.equal(last.dur, 900, "the last ones run at the calm speed");
});
test("results that stream in fast take bounded time instead of piling up", () => {
  const q = createPulseQueue({ cap: 6 });
  for (let i = 0; i < 44; i++) q.push({ id: i });
  const log = drive(q);
  assert.ok(log.end < 6000, `44 pulses drained in ${log.end} ms`);
});
test("slow mode (Presenter) stretches time but not the cap", () => {
  const a = createPulseQueue({ cap: 6 }), b = createPulseQueue({ cap: 6, slow: 1.6 });
  for (let i = 0; i < 10; i++) { a.push({ id: i }); b.push({ id: i }); }
  const la = drive(a), lb = drive(b);
  assert.ok(lb.end > la.end * 1.3);
  assert.ok(lb.maxTravelling <= 6);
});
test("drain empties the line for settling at once, and remove drops a waiting part", () => {
  const q = createPulseQueue({ cap: 2 });
  for (let i = 0; i < 5; i++) q.push({ id: i });
  q.step(0);
  q.remove((p) => p.id === 3);
  const all = q.drain();
  assert.deepEqual(all.map((p) => p.id), [0, 1, 2, 4]);
  assert.ok(q.idle);
});

// ---------- the Map: layout, view, hit-testing ----------
const small = () => L.layoutColumns({
  left: [{ id: "a", label: "A", term: "fit" }, { id: "b", label: "B", term: "gap" }, { id: "c", label: "C", term: "tie" }],
  right: [{ id: "e1", label: "GET /x", kind: "endpoint" }, { id: "f1", label: "f", kind: "field" }, { id: "e2", label: "POST /x", kind: "endpoint" }],
  edges: [{ from: "a", to: "f1", term: "fit" }, { from: "b", to: "e2", term: "gap" }, { from: "c", to: "nowhere", term: "tie" }],
});
test("the layout stacks each column, groups endpoints and drops edges to nothing", () => {
  const idx = small();
  assert.equal(idx.nodes.length, 6);
  assert.equal(idx.edges.n, 2, "the edge to a missing node is dropped");
  const ys = idx.nodes.filter((n) => n.side === 0).map((n) => n.y);
  assert.deepEqual(ys, [0, 30, 60]);
  const r = idx.nodes.filter((n) => n.side === 1);
  assert.ok(r[2].y - r[1].y > r[1].y - r[0].y, "a new endpoint group has air above it");
  assert.ok(idx.nodes.every((n) => n.x >= 0 && n.y >= 0));
  assert.ok(idx.bounds.right > idx.bounds.left && idx.bounds.bottom > 0);
  assert.deepEqual(idx.adj[idx.byId.get("a")], [0]);
});
test("the view: zoom keeps the point under the cursor, pan moves, fit fits", () => {
  const v = { k: 1, tx: 10, ty: 20 };
  const z = L.zoomAt(v, 200, 150, 2);
  const before = L.toWorld(v, 200, 150), after = L.toWorld(z, 200, 150);
  near(before.x, after.x); near(before.y, after.y);
  assert.equal(z.k, 2);
  assert.equal(L.zoomAt(v, 0, 0, 1e9).k, L.MAX_K); assert.equal(L.zoomAt(v, 0, 0, 1e-9).k, L.MIN_K);
  assert.deepEqual(L.panBy(v, 5, -5), { k: 1, tx: 15, ty: 15 });
  const idx = small(), f = L.fitView(idx.bounds, 800, 400);
  const tl = L.toScreen(f, idx.bounds.left, idx.bounds.top), br = L.toScreen(f, idx.bounds.right, idx.bounds.bottom);
  assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= 800 && br.y <= 400, "everything is on screen after fit");
  const c = L.centerOn(v, idx.nodes[1], 800, 400), mid = L.toScreen(c, idx.nodes[1].x + idx.nodes[1].w / 2, idx.nodes[1].y + idx.nodes[1].h / 2);
  near(mid.x, 400); near(mid.y, 200);
  const p = L.pinch([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: -50, y: 0 }, { x: 150, y: 0 }]);
  near(p.factor, 2); near(p.cx, 50);
  const vr = L.visibleRect({ k: 2, tx: 0, ty: -100 }, 400, 200);
  assert.deepEqual(vr, { left: 0, top: 50, right: 200, bottom: 150 });
});
test("hit-testing lands on the node you see, at any zoom and any DPR", () => {
  const idx = small();
  for (const k of [0.05, 0.3, 1, 2.5, 4]) for (const dpr of [1, 1.5, 2, 3]) for (const [tx, ty] of [[0, 0], [120, 40], [-30, 200]]) {
    const v = { k, tx, ty };
    idx.nodes.forEach((n, i) => {
      const c = L.toScreen(v, n.x + n.w / 2, n.y + n.h / 2);
      assert.equal(L.pickAt(idx, v, c.x, c.y, 0), i, `node ${i} at k=${k}`);
      // the drawing matrix and the pointer agree: a device pixel divided by dpr is the CSS px the hit test uses
      const m = L.deviceMatrix(v, dpr), dx = m[0] * (n.x + n.w / 2) + m[4], dy = m[3] * (n.y + n.h / 2) + m[5];
      assert.equal(L.pickAt(idx, v, dx / dpr, dy / dpr, 0), i);
    });
    const off = L.toScreen(v, -500, -500);
    assert.equal(L.pickAt(idx, v, off.x, off.y, 0), -1, "empty space hits nothing");
  }
});
test("a small slop makes a tiny node easy to hit, and never picks a far one", () => {
  const idx = small(), n = idx.nodes[0];
  const v = { k: 0.1, tx: 0, ty: 0 };
  const s = L.toScreen(v, n.x + n.w / 2, n.y + n.h + 2); // 2 world px below the node
  assert.equal(L.pickAt(idx, v, s.x, s.y, 3), 0);
  const far = L.toScreen(v, n.x + n.w / 2, n.y + n.h + 200);
  assert.equal(L.pickAt(idx, v, far.x, far.y, 3), -1);
});
test("culling: only nodes and edges near the view are visited", () => {
  const g = L.stressGraph({ nodes: 2000, edges: 4000 }), idx = L.layoutColumns(g);
  assert.equal(idx.nodes.length, 2000); assert.equal(idx.edges.n, 4000);
  const r = { left: 0, top: 0, right: 1000, bottom: 300 };
  const some = L.queryNodes(idx, r);
  assert.ok(some.length > 0 && some.length < 100, `${some.length} nodes in view`);
  for (const i of some) assert.ok(idx.nodes[i].y <= 300);
  let n = 0; L.forEachEdgeInRect(idx, r, () => n++);
  assert.ok(n > 0 && n < 4000 * 0.6, `${n} of 4000 edges in view`);
  const all = new Set(L.queryNodes(idx, idx.bounds));
  assert.equal(all.size, 2000, "a query of everything finds everything, once");
});
test("level of detail: labels only when zoomed in, dots when tiny, fainter edges when crowded", () => {
  assert.equal(L.lod({ k: 1 }).labels, true); assert.equal(L.lod({ k: 0.2 }).labels, false);
  assert.equal(L.lod({ k: 0.05 }).shape, "dot"); assert.equal(L.lod({ k: 0.5 }).shape, "box");
  assert.ok(L.lod({ k: 1 }, 3000).edgeAlpha < L.lod({ k: 1 }, 10).edgeAlpha);
});
test("the stress graph is repeatable and has the size asked for", () => {
  const a = L.stressGraph({ nodes: 2000, edges: 4000, seed: 3 }), b = L.stressGraph({ nodes: 2000, edges: 4000, seed: 3 });
  assert.deepEqual(a.edges.slice(0, 50), b.edges.slice(0, 50));
  assert.equal(a.left.length + a.right.length, 2000); assert.equal(a.edges.length, 4000);
});

// ---------- the facts drawn for each part ----------
const cell = (state, title, sub = "", extra = {}) => ({ state, title, sub, ...extra });
const APIS = [{ method: "GET", path: "/api/orders" }, { method: "POST", path: "/api/orders", request: { customer: "x" } }, { method: "PUT", path: "/api/orders/:id", request: { customer: "x" } }];
const leaf = (id, ...cells) => ({ id, cells });
test("a part traces to the endpoint the result names", () => {
  const get = "listOrders() · GET /api/orders";
  assert.deepEqual(sourceOf(leaf("list.total", cell("ok", "row.total"), cell("ok", "moneyFull"), cell("ok", "total", get)), "fit", APIS), { endpoint: "GET /api/orders", field: "total", need: null, kept: false });
  assert.deepEqual(sourceOf(leaf("value.orderCount", cell("ok", "orderCount"), cell("ok", "count"), cell("ok", "whole list", get)), "fit", APIS), { endpoint: "GET /api/orders", field: null, need: null, kept: false }, "the whole list has no single field");
  assert.equal(sourceOf(leaf("action.page.save", cell("ok", "save"), cell("ok", "create / update"), cell("ok", "POST / PUT", "createOrder / updateOrder() · /api/orders")), "fit", APIS).endpoint, "POST /api/orders");
  assert.equal(sourceOf(leaf("form.total", cell("ok", "input total"), cell("ok", "to number"), cell("ok", "total", "POST body")), "fit", APIS).endpoint, "POST /api/orders");
  assert.equal(sourceOf(leaf("action.row.edit", cell("ok", "edit"), cell("ok", "select row"), cell("static", "no API call")), "fit", APIS).kept, true, "nothing in the contract is involved");
  assert.equal(sourceOf(leaf("list.sort", cell("ok", "row order"), cell("static", "keep API order"), null), "fit", APIS).kept, true);
});
test("a Gap is aimed at where the part should have come from; a Tie names its endpoint; a Stub has none", () => {
  const gap = sourceOf(leaf("list.status", cell("ok", "row.status"), cell("missing", "no transform"), cell("missing", "not in API", "needs your answer", { waiting: true })), "gap", APIS);
  assert.equal(gap.endpoint, "GET /api/orders");
  const del = sourceOf(leaf("action.row.delete", cell("ok", "delete"), cell("ok", "delete"), cell("missing", "endpoint missing", "needs DELETE")), "gap", APIS);
  assert.equal(del.endpoint, null); assert.equal(del.need, "DELETE");
  assert.equal(sourceOf(leaf("action.page.save", cell("ok", "save"), cell("ok", "x"), cell("missing", "endpoint missing", "needs POST+PUT")), "gap", APIS).need, "POST and PUT");
  const notes = sourceOf(leaf("form.notes", cell("ok", "input notes"), cell("missing", "no request field"), cell("missing", "not in API", "notes would be dropped")), "gap", APIS);
  assert.equal(notes.endpoint, "POST /api/orders");
  const tie = sourceOf(leaf("list.owner", cell("ok", "row.owner"), cell("ask", "2 possible matches", "pick one"), cell("ask", "which field?", "GET /api/orders")), "tie", APIS);
  assert.equal(tie.endpoint, "GET /api/orders"); assert.equal(tie.field, null);
  const stub = sourceOf(leaf("list.x", cell("ok", "row.x"), cell("placeholder", "getX()"), cell("placeholder", "from the controller")), "stub", APIS);
  assert.equal(stub.endpoint, null); assert.equal(stub.kept, false);
});
test("part names and sentences are plain words", () => {
  assert.equal(partName(leaf("list.placedOn")), "Placed on");
  assert.equal(partName(leaf("list.sort")), "Row order");
  assert.equal(partName(leaf("action.row.delete")), "The delete button");
  assert.equal(partName(leaf("form.notes")), "Notes input");
  assert.equal(partName(leaf("form.missing.notes")), "Notes, which the API expects");
  const tree = { groups: [{ title: "List", leaves: [
    leaf("list.total", cell("ok", "row.total"), cell("ok", "moneyFull"), cell("ok", "total", "listOrders() · GET /api/orders")),
    leaf("list.status", cell("ok", "row.status"), cell("missing", "no transform"), cell("missing", "not in API")),
    leaf("list.owner", cell("ok", "row.owner"), cell("ask", "2 possible matches"), cell("ask", "which field?", "GET /api/orders")),
    leaf("list.x", cell("ok", "row.x"), cell("placeholder", "getX()"), cell("placeholder", "from the controller")),
    leaf("action.row.edit", cell("ok", "edit"), cell("ok", "select row"), cell("static", "no API call")),
  ] }] };
  const s = summarize(tree), parts = buildParts(tree, s.states, APIS);
  assert.deepEqual(parts.map((p) => p.term), ["fit", "gap", "tie", "stub", "fit"]);
  assert.equal(parts[0].text, "Total: Fit, from GET /api/orders (total)");
  assert.equal(parts[1].text, "Status: Gap, nothing behind it in the API");
  assert.equal(parts[2].text, "Owner: Tie, two or more fields fit equally in GET /api/orders, so someone has to choose");
  assert.equal(parts[3].text, "X: Stub, a marked stand-in until the API has it");
  assert.equal(parts[4].text, "The edit button: Fit, kept from the design, no API needed");
  assert.deepEqual(bannedIn(parts.map((p) => p.text).join(" ")), []);
  assert.deepEqual([...breakdownByEndpoint(parts)], [["GET /api/orders", { fit: 1, wait: 0, gap: 1, tie: 1 }]], "the Stub is not counted: it is not in the contract");
});
test("a part named twice is traced once, listed as x2, and still counts as two parts", () => {
  const tree = { groups: [{ title: "Actions", leaves: [leaf("action.page.suggest", cell("ok", "suggest"), cell("ask", "what should it do?"), cell("ask", "?")), leaf("action.page.suggest", cell("ok", "suggest"), cell("ask", "what should it do?"), cell("ask", "?")), leaf("list.total", cell("ok", "row.total"), cell("ok", "moneyFull"), cell("ok", "total", "listOrders() · GET /api/orders"))] }] };
  const parts = buildParts(tree, { "action.page.suggest": "wait", "list.total": "fit" }, APIS);
  assert.equal(parts.length, 2);
  assert.equal(partTotal(parts), 3, "the same total as the ring, which counts each part of the design");
  assert.equal(parts[0].count, 2);
  assert.equal(parts[0].name, "The suggest button ×2");
  assert.equal(parts[1].count, 1);
  assert.equal(parts[1].name, "Total");
});
test("a part that is waiting for an answer is aimed like a Gap but says it is open, and is not a defect", () => {
  const w = leaf("list.status", cell("ok", "row.status"), cell("missing", "no transform"), cell("missing", "not in API", "needs your answer", { waiting: true }));
  const src = sourceOf(w, "wait", APIS);
  assert.equal(src.endpoint, "GET /api/orders", "aimed at where it would come from");
  assert.equal(src.need, null);
  const tree = { groups: [{ title: "List", leaves: [w] }] };
  const [p] = buildParts(tree, summarize(tree).states, APIS);
  assert.equal(p.term, "wait");
  assert.equal(p.text, "Status: Waiting for you, an Ask is open, so nothing is decided yet");
  assert.deepEqual(bannedIn(p.text), []);
  assert.deepEqual([...breakdownByEndpoint([p])], [["GET /api/orders", { fit: 0, wait: 1, gap: 0, tie: 0 }]]);
});
test("the Map's nodes and edges follow the parts", () => {
  const parts = ["fit", "gap", "tie", "stub"].map((term, i) => ({ id: `p${i}`, name: `P${i}`, term, src: term === "fit" ? { endpoint: "GET /api/orders", field: "total", kept: false } : term === "tie" ? { endpoint: "GET /api/orders", field: null, kept: false } : { endpoint: null, field: null, kept: false } }));
  parts.push({ id: "k", name: "K", term: "fit", src: { endpoint: null, field: null, kept: true } });
  const withWait = buildMap([...parts, { id: "w", name: "W", term: "wait", src: { endpoint: "GET /api/orders", field: null, kept: false } }], APIS);
  assert.deepEqual(withWait.right.map((n) => n.id).slice(-4), ["wait", "gap", "stub", "kept"], "Waiting has its own node, before Gap");
  assert.deepEqual(withWait.edges.at(-1), { from: "w", to: "wait", term: "wait" });
  const m = buildMap(parts, APIS);
  assert.equal(m.left.length, 5);
  assert.deepEqual(m.right.map((n) => n.id), ["ep:GET /api/orders", "f:GET /api/orders:total", "tie:GET /api/orders", "ep:POST /api/orders", "ep:PUT /api/orders/:id", "gap", "stub", "kept"]);
  assert.deepEqual(m.edges.map((e) => [e.from, e.to]), [["p0", "f:GET /api/orders:total"], ["p1", "gap"], ["p2", "tie:GET /api/orders"], ["p3", "stub"], ["k", "kept"]]);
  const idx = L.layoutColumns(m);
  assert.equal(idx.edges.n, 5, "every edge lands on a node");
});

// ---------- real results from the three scenarios ----------
test("every part of the three scenarios gets an outcome, a source in the real contract and plain words", async () => {
  for (const s of SCENARIOS) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-test-"));
    const dir = path.join(tmp, s.example);
    fs.cpSync(path.join(root, "examples", s.example), dir, { recursive: true });
    resetExample(dir);
    const spec = readSpec(dir); // feature.json + the contract (openapi file) through the one loader
    let tree = null, items = [];
    await runPipeline({ dir, outRoot: path.join(tmp, "out"), useSaved: false, prompt: async () => ({ skip: true }), emit: (t, d) => { if (t === "tree") tree = d.tree; if (t === "items") items = d.items; } });
    fs.rmSync(tmp, { recursive: true, force: true });
    const sum = summarize(tree, { items: Object.fromEntries(items.map((i) => [i.id, i])) });
    const parts = buildParts(tree, sum.states, spec.apis), keys = new Set(spec.apis.map(endpointKey));
    const distinct = new Set(tree.groups.flatMap((g) => g.leaves.map((l) => l.id))).size; // two buttons with one name (Portfolio's "suggest") trace once
    assert.equal(parts.length, distinct, `${s.id}: one entry per distinct part`);
    assert.equal(partTotal(parts), sum.total, `${s.id}: the trace's parts add up to the ring's total (a shared name counts each part)`);
    for (const p of parts) {
      assert.equal(p.term, sum.states[p.id]);
      if (p.src.endpoint) assert.ok(keys.has(p.src.endpoint), `${s.id} ${p.id}: ${p.src.endpoint} is in the contract`);
      if (p.term === "fit") assert.ok(p.src.endpoint || p.src.kept, `${s.id} ${p.id}: a Fit traces to an endpoint or is kept from the design`);
      if (p.term === "stub") assert.equal(p.src.endpoint, null);
      assert.deepEqual(bannedIn(p.text), [], p.text);
    }
    const m = buildMap(parts, spec.apis), idx = L.layoutColumns(m);
    assert.equal(idx.edges.n, parts.length, `${s.id}: every part has one edge on the Map`);
  }
});

// ---------- the canvas code keeps to the shell's rules ----------
test("nothing the canvas modules say (strings) uses the words the demo path avoids", () => {
  const parse = _parse.parse ?? _parse.default?.parse;
  for (const f of fs.readdirSync(here).filter((x) => x.endsWith(".mjs") && !x.endsWith(".test.mjs"))) {
    const out = [];
    const walk = (n) => {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "StringLiteral") out.push(n.value);
      if (n.type === "TemplateElement") out.push(n.value.cooked ?? n.value.raw);
      for (const k of Object.keys(n)) if (k !== "loc" && k !== "start" && k !== "end") for (const c of [].concat(n[k])) if (c && typeof c.type === "string") walk(c);
    };
    walk(parse(fs.readFileSync(path.join(here, f), "utf8"), { sourceType: "module" }).program);
    const bad = out.flatMap((s) => bannedIn(s).map((w) => `${f}: "${w}" in ${JSON.stringify(s.slice(0, 60))}`));
    assert.deepEqual(bad, []);
  }
});

// ---------- the page: decorative canvases, served scripts ----------
test("the shell has decorative canvases, a text list of every fact, and only the words of the demo", () => {
  const html = renderShell();
  assert.match(html, /<canvas id="traceCanvas"[^>]*aria-hidden="true"/);
  assert.match(html, /<canvas id="mapCanvas"[^>]*aria-hidden="true"/);
  assert.match(html, /id="traceList"/, "the same facts, as text");
  assert.match(html, /Replay the trace|id="bTrace"/);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  assert.deepEqual(bannedIn(text), []);
});

test("the canvas scripts are served (and only the listed ones)", async () => {
  const port = 5500 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--no-open", "--port", String(port)], { cwd: root });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
    for (const f of ["geometry", "queue", "parts", "layout", "render", "map", "trace"]) {
      const r = await fetch(`http://localhost:${port}/demo/canvas/${f}.mjs`);
      assert.equal(r.status, 200, f);
      assert.match(r.headers.get("content-type"), /javascript/);
    }
    assert.equal((await fetch(`http://localhost:${port}/demo/canvas/canvas.test.mjs`)).status, 404, "tests are not served");
    assert.equal((await fetch(`http://localhost:${port}/demo/canvas/..%2Fdemo.mjs`)).status, 404);
  } finally { p.kill(); }
});
