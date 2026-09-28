// T27.1: contract drift. Two small synthetic OpenAPI documents with a deliberate drift:
//   - DELETE /api/widgets/{id} removed
//   - GET /api/widgets/{id} -> GET /api/widgets/{widgetId} (the path parameter renamed)
//   - GET /api/widgets response loses its "price" field (response shape changed)
//   - PATCH /api/widgets/{widgetId} added
// and confirms diffContracts catches exactly that, nothing more and nothing less.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diffContracts } from "./drift.mjs";

const widget = (extra = {}) => ({ type: "object", properties: { id: { type: "integer", example: 1 }, name: { type: "string", example: "Widget" }, ...extra } });

const BEFORE = {
  openapi: "3.0.3",
  info: { title: "Widgets", version: "1" },
  paths: {
    "/api/widgets": {
      get: { responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Widget" } }, example: [{ id: 1, name: "Widget", price: 10 }] } } } } },
      post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/WidgetInput" }, example: { name: "Widget", price: 10 } } } }, responses: { 201: { content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" }, example: { id: 2, name: "Widget", price: 10 } } } } } },
    },
    "/api/widgets/{id}": {
      get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" }, example: { id: 1, name: "Widget", price: 10 } } } } } },
      delete: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 204: { description: "gone" } } },
    },
  },
  components: { schemas: { Widget: widget({ price: { type: "number", example: 10 } }), WidgetInput: { type: "object", properties: { name: { type: "string", example: "Widget" }, price: { type: "number", example: 10 } } } } },
};

const AFTER = {
  openapi: "3.0.3",
  info: { title: "Widgets", version: "1" },
  paths: {
    "/api/widgets": {
      // response shape changed: "price" dropped from the list item
      get: { responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Widget" } }, example: [{ id: 1, name: "Widget" }] } } } } },
      post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/WidgetInput" }, example: { name: "Widget", price: 10 } } } }, responses: { 201: { content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" }, example: { id: 2, name: "Widget", price: 10 } } } } } },
    },
    // "id" renamed to "widgetId"; DELETE removed; PATCH added
    "/api/widgets/{widgetId}": {
      get: { parameters: [{ name: "widgetId", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" }, example: { id: 1, name: "Widget", price: 10 } } } } } },
      patch: { parameters: [{ name: "widgetId", in: "path", required: true, schema: { type: "integer" } }], requestBody: { content: { "application/json": { example: { name: "New name" } } } }, responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" }, example: { id: 1, name: "New name", price: 10 } } } } } },
    },
  },
  components: { schemas: { Widget: widget({ price: { type: "number", example: 10 } }), WidgetInput: { type: "object", properties: { name: { type: "string", example: "Widget" }, price: { type: "number", example: 10 } } } } },
};

const beforeText = JSON.stringify(BEFORE);
const afterText = JSON.stringify(AFTER);
const here = path.dirname(fileURLToPath(import.meta.url));

test("identical documents: no drift", () => {
  const r = diffContracts(beforeText, beforeText);
  assert.deepEqual(r, { added: [], removed: [], changed: [], hasDrift: false });
});

test("catches exactly the deliberate drift: removed, added, renamed param, changed response shape", () => {
  const r = diffContracts(beforeText, afterText);
  assert.equal(r.hasDrift, true);
  assert.deepEqual(r.removed, [{ method: "DELETE", path: "/api/widgets/:id" }]);
  assert.deepEqual(r.added, [{ method: "PATCH", path: "/api/widgets/:widgetId" }]);
  assert.equal(r.changed.length, 2);
  const renamed = r.changed.find((c) => c.kind === "param-renamed");
  assert.deepEqual(renamed, { kind: "param-renamed", method: "GET", before: "/api/widgets/:id", after: "/api/widgets/:widgetId" });
  const respChanged = r.changed.find((c) => c.kind === "response-changed");
  assert.equal(respChanged.method, "GET");
  assert.equal(respChanged.path, "/api/widgets");
  assert.ok(respChanged.before.includes("price"));
  assert.ok(!respChanged.after.includes("price"));
  // POST /api/widgets is untouched: no entry for it anywhere
  assert.ok(!r.changed.some((c) => c.path === "/api/widgets" && c.method === "POST"));
});

test("without CONSTRUCT_ROOT, changed entries have no textDiff (the structural fields are unaffected)", () => {
  const r = diffContracts(beforeText, afterText);
  for (const c of r.changed) assert.equal("textDiff" in c, false);
});

// ---------- Construct reuse: buildDiffView (core/text-diff.mjs), same pattern as src/import/import.test.mjs ----------
const CONSTRUCT_CHECKOUT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";
const hasConstruct = fs.existsSync(path.join(CONSTRUCT_CHECKOUT, "packages", "core", "text-diff.mjs"));

test("with CONSTRUCT_ROOT set, a response-changed entry carries a textDiff from Construct's buildDiffView", { skip: hasConstruct ? false : `no Construct checkout at ${CONSTRUCT_CHECKOUT}; set CONSTRUCT_ROOT to run this` }, () => {
  const script = `
    import { diffContracts } from ${JSON.stringify(path.join(here, "drift.mjs"))};
    const before = ${JSON.stringify(beforeText)};
    const after = ${JSON.stringify(afterText)};
    const r = diffContracts(before, after);
    console.log(JSON.stringify(r.changed.find((c) => c.kind === "response-changed")));
  `;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lm-drift-")), "probe.mjs");
  fs.writeFileSync(tmp, script);
  const res = spawnSync(process.execPath, [tmp], { env: { ...process.env, CONSTRUCT_ROOT: CONSTRUCT_CHECKOUT }, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const entry = JSON.parse(res.stdout);
  assert.ok(entry.textDiff, "expected a textDiff field");
  assert.ok(Array.isArray(entry.textDiff.rows));
  assert.ok(entry.textDiff.stats);
  // "price" is removed between before and after: buildDiffView should show it as a removed row
  assert.ok(entry.textDiff.rows.some((row) => row.kind === "removed" && row.text.includes("price")));
});
