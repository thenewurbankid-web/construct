// The HTTP side of the page story (LIN-106): GET/POST /api/story (saved story.md), plus a check that the
// existing GET /api/story/draft (LIN-105) route still dispatches and isn't shadowed by the new pathname checks.
// Exercises storyRoute() directly (a real http.createServer round trip, no child process), same pattern as
// src/demo-server-release.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storyRoute } from "./story-routes.mjs";
import { readJsonBody } from "./http-guard.mjs";
import { loadStory } from "./ai/context.mjs";

function mkExample(examplesDir, name) {
  const dir = path.join(examplesDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify({ feature: name, route: "/x", page: "page.jsx" }));
  fs.writeFileSync(path.join(dir, "page.jsx"), "export default function P(){ return <main/>; }");
  return dir;
}

async function withServer(t, { examples = ["ex"] } = {}) {
  const examplesDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-story-"));
  for (const e of examples) mkExample(examplesDir, e);
  const known = (n) => examples.includes(n);
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    storyRoute(req, res, url, { examplesDir, known, readBody: readJsonBody })
      .then((handled) => { if (!handled) res.writeHead(404).end("not found"); })
      .catch((e) => res.writeHead(500).end(String(e)));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  t.after(() => new Promise((r) => srv.close(r)));
  const call = (method, qpath, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: qpath, headers: { "content-type": "application/json" } }, (res) => {
      let t2 = ""; res.on("data", (c) => (t2 += c)); res.on("end", () => { let json = null; try { json = JSON.parse(t2); } catch {} resolve({ status: res.statusCode, body: json, text: t2 }); });
    });
    r.on("error", reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { examplesDir, call };
}

test("GET /api/story before any save: empty story, hasStory false", async (t) => {
  const { call } = await withServer(t);
  const r = await call("GET", "/api/story?example=ex");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { goal: "", criteria: [], hasStory: false });
});

test("POST /api/story with valid body: 200, and the file is written (round trip through loadStory)", async (t) => {
  const { call, examplesDir } = await withServer(t);
  const r = await call("POST", "/api/story?example=ex", { goal: "As a user, I want X.", criteria: ["First.", "", "  Second.  "] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { goal: "As a user, I want X.", criteria: ["First.", "Second."], hasStory: true });
  assert.deepEqual(loadStory(path.join(examplesDir, "ex")), { goal: "As a user, I want X.", criteria: ["First.", "Second."] });
});

test("POST /api/story with criteria not an array: 400", async (t) => {
  const { call } = await withServer(t);
  const r = await call("POST", "/api/story?example=ex", { goal: "g", criteria: "not an array" });
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
});

test("POST /api/story with goal not a string: 400", async (t) => {
  const { call } = await withServer(t);
  const r = await call("POST", "/api/story?example=ex", { goal: 5, criteria: [] });
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
});

test("GET /api/story after a POST: returns the saved values", async (t) => {
  const { call } = await withServer(t);
  await call("POST", "/api/story?example=ex", { goal: "Saved goal.", criteria: ["A."] });
  const r = await call("GET", "/api/story?example=ex");
  assert.deepEqual(r.body, { goal: "Saved goal.", criteria: ["A."], hasStory: true });
});

test("unknown example: 404 on both GET and POST /api/story", async (t) => {
  const { call } = await withServer(t);
  const g = await call("GET", "/api/story?example=nope");
  assert.equal(g.status, 404);
  const p = await call("POST", "/api/story?example=nope", { goal: "g", criteria: [] });
  assert.equal(p.status, 404);
});

test("the existing GET /api/story/draft route still dispatches (not shadowed by the new /api/story checks)", async (t) => {
  const { call } = await withServer(t);
  const r = await call("GET", "/api/story/draft?example=ex");
  // No model is reachable in this environment, so this resolves to a 502 (the model call failed) rather than
  // hanging or falling through to a 404 — which is exactly what proves the route is still matched and dispatched.
  assert.notEqual(r.status, 404);
});

test("unknown example: 404 on the draft route too", async (t) => {
  const { call } = await withServer(t);
  const r = await call("GET", "/api/story/draft?example=nope");
  assert.equal(r.status, 404);
});
