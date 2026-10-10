import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapterFile, loadAdapters, getAdapterFor, saveAdapterFor } from "./adapter-store.mjs";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-adapter-"));

test("getAdapterFor on a fresh example dir (no adapters.json yet) is null, not an error", () => {
  assert.equal(getAdapterFor(tmpDir(), "GET /api/orders", "status_code"), null);
});

test("saveAdapterFor writes adapters.json keyed by operation id then field, and getAdapterFor reads it back", () => {
  const dir = tmpDir();
  saveAdapterFor(dir, "GET /api/orders", "status_code", { transform: "map", params: { table: { 1: "open" } } });
  const got = getAdapterFor(dir, "GET /api/orders", "status_code");
  assert.equal(got.transform, "map");
  assert.deepEqual(got.params, { table: { 1: "open" } });
  assert.ok(got.savedAt);
  assert.ok(fs.existsSync(adapterFile(dir)));
  // storage shape is a direct x-trace-adapter candidate: operationId -> field -> mapping, no run-state-only ids
  const raw = loadAdapters(dir);
  assert.deepEqual(Object.keys(raw), ["GET /api/orders"]);
  assert.deepEqual(Object.keys(raw["GET /api/orders"]), ["status_code"]);
  assert.deepEqual(Object.keys(raw["GET /api/orders"].status_code).sort(), ["params", "savedAt", "transform"]);
});

test("saveAdapterFor for a second field on the same operation keeps the first field's mapping", () => {
  const dir = tmpDir();
  saveAdapterFor(dir, "GET /api/orders", "a", { transform: "passthrough" });
  saveAdapterFor(dir, "GET /api/orders", "b", { transform: "stringify" });
  assert.equal(getAdapterFor(dir, "GET /api/orders", "a").transform, "passthrough");
  assert.equal(getAdapterFor(dir, "GET /api/orders", "b").transform, "stringify");
});

test("saveAdapterFor for a different operation doesn't touch another operation's mappings", () => {
  const dir = tmpDir();
  saveAdapterFor(dir, "GET /api/orders", "a", { transform: "passthrough" });
  saveAdapterFor(dir, "GET /api/customers", "b", { transform: "stringify" });
  assert.equal(getAdapterFor(dir, "GET /api/orders", "a").transform, "passthrough");
  assert.equal(getAdapterFor(dir, "GET /api/customers", "b").transform, "stringify");
});

test("saveAdapterFor for a field that already has one replaces just that field's mapping", () => {
  const dir = tmpDir();
  saveAdapterFor(dir, "GET /api/orders", "a", { transform: "passthrough" });
  saveAdapterFor(dir, "GET /api/orders", "a", { transform: "stringify" });
  const raw = loadAdapters(dir);
  assert.equal(Object.keys(raw["GET /api/orders"]).length, 1);
  assert.equal(raw["GET /api/orders"].a.transform, "stringify");
});

test("saveAdapterFor never writes into the contract file, only adapters.json", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "openapi.json"), JSON.stringify({ openapi: "3.0.0" }));
  const before = fs.readFileSync(path.join(dir, "openapi.json"), "utf8");
  saveAdapterFor(dir, "GET /api/orders", "a", { transform: "passthrough" });
  const after = fs.readFileSync(path.join(dir, "openapi.json"), "utf8");
  assert.equal(after, before);
});

test("the persisted mapping carries no run-state-only identifier (no question id, no wire id) — only what an x-trace-adapter extension would carry", () => {
  const dir = tmpDir();
  saveAdapterFor(dir, "GET /api/orders", "status_code", { transform: "map", params: { table: { 1: "open" } } });
  const raw = loadAdapters(dir);
  const mapping = raw["GET /api/orders"].status_code;
  assert.deepEqual(Object.keys(mapping).sort(), ["params", "savedAt", "transform"]);
});
