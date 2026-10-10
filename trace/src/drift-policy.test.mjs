// T27.2: the drift adapter/decision layer. Deterministic given a report and options; no clock, no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideDrift, storeDrift } from "./drift-policy.mjs";

const CLEAN = { added: [], removed: [], changed: [], hasDrift: false };
const DRIFTED = {
  added: [{ method: "PATCH", path: "/api/widgets/:widgetId" }],
  removed: [{ method: "DELETE", path: "/api/widgets/:id" }],
  changed: [{ kind: "response-changed", method: "GET", path: "/api/widgets", before: "{price:number}", after: "{}" }],
  hasDrift: true,
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-drift-policy-"));

test("clean report: status clean, nothing affected, never blocked even if asked", () => {
  const d = decideDrift(CLEAN, { block: true });
  assert.equal(d.status, "clean");
  assert.deepEqual(d.affected, []);
  assert.equal(d.blocked, false);
  assert.equal(d.reason, null);
});

test("drifted report, block not requested: status stale, affected listed, not blocked", () => {
  const d = decideDrift(DRIFTED);
  assert.equal(d.status, "stale");
  assert.deepEqual(d.affected.map((a) => a.label), ["PATCH /api/widgets/:widgetId", "DELETE /api/widgets/:id", "GET /api/widgets"]);
  assert.equal(d.blocked, false);
  assert.equal(d.reason, null);
});

test("drifted report, block requested: blocked, with a reason naming the affected endpoints", () => {
  const d = decideDrift(DRIFTED, { block: true });
  assert.equal(d.blocked, true);
  assert.ok(d.reason.includes("--block-on-drift"));
  assert.ok(d.reason.includes("DELETE /api/widgets/:id"));
});

test("decideDrift is pure: same inputs give the same output, called twice", () => {
  assert.deepEqual(decideDrift(DRIFTED, { block: true }), decideDrift(DRIFTED, { block: true }));
});

test("no timestamp is added: asOf is only what the caller passed, defaulting to null", () => {
  assert.equal(decideDrift(DRIFTED).asOf, null);
  assert.equal(decideDrift(DRIFTED, { asOf: "build-42" }).asOf, "build-42");
});

test("storeDrift writes report+decision as JSON, readable back unchanged", () => {
  const dir = tmp();
  const decision = decideDrift(DRIFTED, { block: true });
  const p = storeDrift(dir, DRIFTED, decision);
  assert.equal(p, path.join(dir, "drift.json"));
  const back = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.deepEqual(back, { report: DRIFTED, decision });
  // no leftover temp file
  assert.deepEqual(fs.readdirSync(dir), ["drift.json"]);
});

test("storeDrift overwrites a previous file at the same path", () => {
  const dir = tmp();
  storeDrift(dir, CLEAN, decideDrift(CLEAN));
  storeDrift(dir, DRIFTED, decideDrift(DRIFTED));
  const back = JSON.parse(fs.readFileSync(path.join(dir, "drift.json"), "utf8"));
  assert.equal(back.report.hasDrift, true);
});
