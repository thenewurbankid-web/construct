import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDriftReport, driftPayload, handleDriftRoute } from "./drift-routes.mjs";
import { diffContracts } from "./drift.mjs";
import { decideDrift, storeDrift } from "./drift-policy.mjs";

const fakeRes = () => { const r = { code: null, headers: null, body: "", writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b; } }; return r; };
const call = (url) => { const res = fakeRes(); const handled = handleDriftRoute(url, res, { examplesDir: examplesDirFor(), known: (n) => n === "invoices" }); return { handled, res, json: () => JSON.parse(res.body) }; };

let examplesRoot;
function examplesDirFor() { return examplesRoot; }

function doc(paths) {
  return JSON.stringify({ openapi: "3.0.0", info: { title: "t", version: "1" }, paths });
}

function exampleWithStoredDrift() {
  examplesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trace-drift-routes-"));
  const exampleDir = path.join(examplesRoot, "invoices");
  fs.mkdirSync(exampleDir, { recursive: true });
  const before = doc({ "/orders": { get: { responses: { 200: { content: { "application/json": { example: { id: 1 } } } } } } } });
  const after = doc({
    "/orders": { get: { responses: { 200: { content: { "application/json": { example: { id: 1, extra: true } } } } } } },
    "/orders/new": { post: { responses: { 200: { content: { "application/json": { example: { ok: true } } } } } } },
  });
  const report = diffContracts(before, after);
  const decision = decideDrift(report, { block: false });
  storeDrift(exampleDir, report, decision);
  return exampleDir;
}

test("loadDriftReport returns null when no drift.json exists for the example", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-drift-routes-empty-"));
  fs.mkdirSync(path.join(root, "invoices"), { recursive: true });
  assert.equal(loadDriftReport(root, "invoices"), null);
});

test("loadDriftReport reads a real storeDrift-written record", () => {
  exampleWithStoredDrift();
  const stored = loadDriftReport(examplesRoot, "invoices");
  assert.equal(stored.report.hasDrift, true);
  assert.equal(stored.decision.status, "stale");
});

test("driftPayload is unavailable with no stored record", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-drift-routes-empty2-"));
  fs.mkdirSync(path.join(root, "invoices"), { recursive: true });
  assert.deepEqual(driftPayload(root, "invoices"), { available: false });
});

test("driftPayload shapes a real stored drift record for the UI", () => {
  exampleWithStoredDrift();
  const p = driftPayload(examplesRoot, "invoices");
  assert.equal(p.available, true);
  assert.equal(p.hasDrift, true);
  assert.equal(p.status, "stale");
  assert.equal(p.blocked, false);
  assert.ok(p.added.some((e) => e.path === "/orders/new"));
  assert.ok(p.changed.some((e) => e.kind === "response-changed"));
  assert.equal(p.affected.length, p.added.length + p.removed.length + p.changed.length);
});

test("handleDriftRoute /api/drift rejects an unknown example", () => {
  exampleWithStoredDrift();
  const { json, res } = call(new URL("http://x/api/drift?example=nope"));
  assert.equal(res.code, 404);
  assert.deepEqual(json(), { error: "unknown example" });
});

test("handleDriftRoute /api/drift serves the shaped payload for a known example", () => {
  exampleWithStoredDrift();
  const { json, res } = call(new URL("http://x/api/drift?example=invoices"));
  assert.equal(res.code, 200);
  assert.equal(json().available, true);
});

test("handleDriftRoute serves /drift and /ui/drift.mjs", () => {
  exampleWithStoredDrift();
  const page = call(new URL("http://x/drift"));
  assert.equal(page.res.headers["content-type"], "text/html; charset=utf-8");
  const mod = call(new URL("http://x/ui/drift.mjs"));
  assert.equal(mod.res.headers["content-type"], "text/javascript");
});

test("handleDriftRoute returns false for an unrelated path", () => {
  exampleWithStoredDrift();
  const res = fakeRes();
  assert.equal(handleDriftRoute(new URL("http://x/api/other"), res, { examplesDir: examplesRoot, known: () => true }), false);
});
