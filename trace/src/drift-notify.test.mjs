// T27.3: the drift notification (email draft / written report). Fixed text, deterministic, no model — same
// rule as the run summary's email composer. Recipients are never invented: with none given, the body still
// names roles ("Backend", "Frontend"), never a guessed name or address.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideDrift } from "./drift-policy.mjs";
import { buildDriftNotification, writeDriftReport } from "./drift-notify.mjs";

const CLEAN = { added: [], removed: [], changed: [], hasDrift: false };
const DRIFTED = {
  added: [{ method: "PATCH", path: "/api/widgets/:widgetId" }],
  removed: [{ method: "DELETE", path: "/api/widgets/:id" }],
  changed: [
    { kind: "param-renamed", method: "GET", before: "/api/widgets/:id", after: "/api/widgets/:widgetId" },
    { kind: "response-changed", method: "GET", path: "/api/widgets", before: "{id:number,name:string,price:number}", after: "{id:number,name:string}" },
  ],
  hasDrift: true,
};

test("no drift: a short, unambiguous subject and body, nobody flagged", () => {
  const n = buildDriftNotification(CLEAN, decideDrift(CLEAN), { feature: "widgets" });
  assert.equal(n.subject, 'No contract drift for "widgets"');
  assert.match(n.body, /No drift found/);
  assert.match(n.body, /Affected: no one \(no drift\)/);
});

test("drift found: subject counts the changes, body lists each entry and names both teams", () => {
  const n = buildDriftNotification(DRIFTED, decideDrift(DRIFTED), { feature: "widgets", contractFile: "openapi.json" });
  assert.equal(n.subject, 'Contract drift detected for "widgets": 4 changes');
  assert.match(n.body, /openapi\.json/);
  assert.match(n.body, /DELETE \/api\/widgets\/:id/);
  assert.match(n.body, /PATCH \/api\/widgets\/:widgetId/);
  assert.match(n.body, /\/api\/widgets\/:id -> \/api\/widgets\/:widgetId/);
  assert.match(n.body, /Backend and Frontend/);
  assert.match(n.body, /Affected: Backend and Frontend, Frontend/);
});

test("no recipients given: to/cc are empty, and no name or address is invented in the body", () => {
  const n = buildDriftNotification(DRIFTED, decideDrift(DRIFTED));
  assert.deepEqual(n.to, []);
  assert.deepEqual(n.cc, []);
  assert.ok(!/@/.test(n.body));
});

test("recipients passed through unchanged", () => {
  const n = buildDriftNotification(DRIFTED, decideDrift(DRIFTED), { to: ["be@example.com"], cc: ["fe@example.com"] });
  assert.deepEqual(n.to, ["be@example.com"]);
  assert.deepEqual(n.cc, ["fe@example.com"]);
});

test("a blocked decision's reason is included in the body", () => {
  const decision = decideDrift(DRIFTED, { block: true });
  const n = buildDriftNotification(DRIFTED, decision);
  assert.match(n.body, /This run was blocked/);
  assert.match(n.body, /--block-on-drift/);
});

test("buildDriftNotification is deterministic: same inputs, same text", () => {
  const a = buildDriftNotification(DRIFTED, decideDrift(DRIFTED), { feature: "widgets" });
  const b = buildDriftNotification(DRIFTED, decideDrift(DRIFTED), { feature: "widgets" });
  assert.deepEqual(a, b);
});

test("writeDriftReport writes a plain-text file with Subject/To/Cc header and the body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drift-notify-"));
  const n = buildDriftNotification(DRIFTED, decideDrift(DRIFTED), { feature: "widgets", to: ["be@example.com"], cc: ["fe@example.com"] });
  const p = writeDriftReport(dir, n);
  assert.equal(p, path.join(dir, "drift-notification.txt"));
  const text = fs.readFileSync(p, "utf8");
  assert.match(text, /^Subject: Contract drift detected for "widgets": 4 changes/);
  assert.match(text, /^To: be@example\.com/m);
  assert.match(text, /^Cc: fe@example\.com/m);
  assert.deepEqual(fs.readdirSync(dir), ["drift-notification.txt"]);
});

test("writeDriftReport: no Cc line when there are no cc recipients", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drift-notify-"));
  const n = buildDriftNotification(CLEAN, decideDrift(CLEAN));
  const p = writeDriftReport(dir, n);
  const text = fs.readFileSync(p, "utf8");
  assert.ok(!text.includes("Cc:"));
  assert.match(text, /^To: \(unassigned\)/m);
});
