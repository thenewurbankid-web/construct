// POST /api/demo/release (LIN-90): a closed tab may leave a run waiting on an Ask, and that should not block a
// Reset or a fresh Wire it. But it must never yank a question someone just opened — named to one run, or global,
// it only ever touches a question that has sat open past a grace period. Exercises demoRoute() directly (a real
// http.createServer round trip, but no child process and no real pipeline run): fast, and lets the test control
// run.waiting/run.waitingSince/run.finished exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demoRoute } from "./demo-server.mjs";

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { const t = Buffer.concat(chunks).toString("utf8"); resolve(t.trim() ? JSON.parse(t) : {}); });
  req.on("error", reject);
});
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const file = () => {};

async function withServer(t, runsSeed) {
  const runs = new Map(Object.entries(runsSeed));
  const examplesDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-release-"));
  const srv = http.createServer((req, res) => {
    demoRoute(req, res, new URL(req.url, "http://x"), { examplesDir, readBody, json, file, runs }).catch((e) => { res.writeHead(500).end(String(e)); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  t.after(() => new Promise((r) => srv.close(r)));
  const release = (body) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/demo/release", headers: { "content-type": "application/json" } }, (res) => {
      let t2 = ""; res.on("data", (c) => (t2 += c)); res.on("end", () => resolve(JSON.parse(t2)));
    });
    r.on("error", reject);
    r.end(JSON.stringify(body ?? {}));
  });
  return { runs, release };
}
const run = (over = {}) => ({ id: "r", finished: false, waiting: null, waitingSince: 0, ...over });

test("a question that just opened is not released, named: an immediate call sees it as still too fresh", async (t) => {
  let skipped = null;
  const r = run({ waiting: (a) => (skipped = a), waitingSince: Date.now() });
  const { release } = await withServer(t, { r });
  assert.deepEqual(await release({ run: "r" }), { released: 0, stillRunning: 1 });
  assert.equal(skipped, null);
});

test("a question that just opened is not released, unnamed: the sweep leaves it alone before it finishes on its own", async (t) => {
  let skipped = null;
  const r = run({ waiting: (a) => (skipped = a), waitingSince: Date.now() });
  const { release } = await withServer(t, { r });
  setTimeout(() => { r.finished = true; }, 150); // well inside the 2s grace period: the sweep exits before it would age into being releasable
  assert.deepEqual(await release({}), { released: 0, stillRunning: 0 });
  assert.equal(skipped, null);
});

test("named: releases only that one run, however long anything else has been open", async (t) => {
  let skippedA = null, skippedB = null;
  const a = run({ id: "a", waiting: (x) => (skippedA = x), waitingSince: Date.now() - 5000 });
  const b = run({ id: "b", waiting: (x) => (skippedB = x), waitingSince: Date.now() - 5000 });
  const { release, runs } = await withServer(t, { a, b });
  assert.deepEqual(await release({ run: "a" }), { released: 1, stillRunning: 1 });
  assert.deepEqual(skippedA, { skip: true });
  assert.equal(skippedB, null, "b is untouched: a caller that names its run never sweeps every other run");
  assert.equal(runs.get("a").waiting, null);
});

test("named: an unknown or already-finished run releases nothing and does not throw", async (t) => {
  const { release } = await withServer(t, {});
  assert.deepEqual(await release({ run: "missing" }), { released: 0, stillRunning: 0 });
  const done = run({ finished: true, waiting: () => assert.fail("a finished run has nothing to skip") });
  const { release: release2 } = await withServer(t, { done });
  assert.deepEqual(await release2({ run: "done" }), { released: 0, stillRunning: 0 });
});

test("unnamed (global fallback): a stale run's question is released; a fresh one is left alone even mid-sweep", async (t) => {
  let skippedOld = null, skippedFresh = null;
  const stale = run({ id: "stale", waiting: (x) => { skippedOld = x; stale.finished = true; }, waitingSince: Date.now() - 5000 });
  const fresh = run({ id: "fresh", waiting: (x) => (skippedFresh = x), waitingSince: Date.now() });
  const { release } = await withServer(t, { stale, fresh });
  setTimeout(() => { fresh.finished = true; }, 300); // the sweep would otherwise keep polling for up to 30s
  const result = await release({});
  assert.equal(result.released, 1);
  assert.deepEqual(skippedOld, { skip: true });
  assert.equal(skippedFresh, null, "never released, even though the sweep kept running while it waited");
});
