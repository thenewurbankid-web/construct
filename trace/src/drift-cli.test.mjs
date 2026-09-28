// T27 CLI: wires diffContracts -> decideDrift -> storeDrift/buildDriftNotification/writeDriftReport together.
// Off by default (no --block-on-drift): always exits 0. Only blocks when both asked and drift is present.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "drift-cli.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-drift-cli-"));

const BEFORE = { openapi: "3.0.3", info: { title: "T", version: "1" }, paths: { "/api/x": { get: { responses: { 200: { content: { "application/json": { example: [{ a: 1 }] } } } } } }, "/api/x/{id}": { delete: { responses: { 204: {} } } } } };
const AFTER = { openapi: "3.0.3", info: { title: "T", version: "1" }, paths: { "/api/x": { get: { responses: { 200: { content: { "application/json": { example: [{ a: 1 }] } } } } } } } };

function write(dir, name, doc) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(doc));
  return p;
}

test("no drift: exits 0, prints a clean subject", () => {
  const dir = tmp();
  const before = write(dir, "before.json", BEFORE);
  const same = write(dir, "same.json", BEFORE);
  const r = spawnSync(process.execPath, [cli, before, same], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Subject: No contract drift/);
});

test("drift, no --block-on-drift: exits 0 even though drift was found", () => {
  const dir = tmp();
  const before = write(dir, "before.json", BEFORE);
  const after = write(dir, "after.json", AFTER);
  const r = spawnSync(process.execPath, [cli, before, after], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Contract drift detected/);
});

test("drift with --block-on-drift: exits 1 and explains why on stderr", () => {
  const dir = tmp();
  const before = write(dir, "before.json", BEFORE);
  const after = write(dir, "after.json", AFTER);
  const r = spawnSync(process.execPath, [cli, before, after, "--block-on-drift"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--block-on-drift/);
});

test("--out writes drift.json and drift-notification.txt into that directory", () => {
  const dir = tmp();
  const outDir = tmp();
  const before = write(dir, "before.json", BEFORE);
  const after = write(dir, "after.json", AFTER);
  const r = spawnSync(process.execPath, [cli, before, after, "--out", outDir, "--feature", "x"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const stored = JSON.parse(fs.readFileSync(path.join(outDir, "drift.json"), "utf8"));
  assert.equal(stored.report.hasDrift, true);
  assert.equal(stored.decision.blocked, false);
  const notified = fs.readFileSync(path.join(outDir, "drift-notification.txt"), "utf8");
  assert.match(notified, /Contract drift detected for "x"/);
});

test("--out pointing at a directory that does not exist yet: creates it instead of crashing", () => {
  const dir = tmp();
  const outDir = path.join(tmp(), "nested", "does-not-exist-yet");
  const before = write(dir, "before.json", BEFORE);
  const after = write(dir, "after.json", AFTER);
  const r = spawnSync(process.execPath, [cli, before, after, "--out", outDir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(outDir, "drift.json")), true);
  assert.equal(fs.existsSync(path.join(outDir, "drift-notification.txt")), true);
});

test("no positional files: usage message, exit 2", () => {
  const r = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
