// T27: on-demand, per-feature drift check wired into the main CLI via --check-drift / --block-on-drift.
// Off by default: with no --check-drift, behavior is unchanged (no "Subject:" line, the feature always runs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "cli.mjs");
const fixture = path.join(here, "..", "examples", "orders");

// A private copy of the "orders" example, so a run's answers.json/ai-cache.json writes never touch the fixture.
function copyOrders() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cli-test-"));
  const featureDir = path.join(dir, "orders");
  fs.mkdirSync(featureDir);
  for (const f of fs.readdirSync(fixture)) {
    const s = path.join(fixture, f), st = fs.statSync(s);
    if (st.isFile()) fs.copyFileSync(s, path.join(featureDir, f));
  }
  return { dir, featureDir };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("no --check-drift: behavior unchanged, no drift notification printed", () => {
  const { featureDir } = copyOrders();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cli-out-"));
  const r = run([featureDir, "--out", outDir, "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^Subject:/m);
  assert.match(r.stdout, /Wrote \d+ files/);
});

test("--check-drift, no --block-on-drift: prints the notification and still runs the feature", () => {
  const { featureDir } = copyOrders();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cli-out-"));
  const after = path.join(featureDir, "fixed.openapi.json");
  const r = run([featureDir, "--check-drift", after, "--out", outDir, "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Subject: Contract drift detected for "orders"/m);
  assert.match(r.stdout, /Wrote \d+ files/); // the run was NOT skipped
  assert.equal(fs.existsSync(path.join(outDir, "features", "orders", "drift.json")), true);
  assert.equal(fs.existsSync(path.join(outDir, "features", "orders", "drift-notification.txt")), true);
});

test("--check-drift --block-on-drift: prints the notification, skips the feature, process still exits 0", () => {
  const { featureDir } = copyOrders();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cli-out-"));
  const after = path.join(featureDir, "fixed.openapi.json");
  const r = run([featureDir, "--check-drift", after, "--block-on-drift", "--out", outDir, "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Subject: Contract drift detected for "orders"/m);
  assert.match(r.stderr, /run blocked \(--block-on-drift\)/);
  assert.doesNotMatch(r.stdout, /Wrote \d+ files/); // the run was skipped, not just drift-flagged
  assert.equal(fs.existsSync(path.join(outDir, "features", "orders", "drift.json")), true); // the drift check itself still wrote its own files
  assert.equal(fs.existsSync(path.join(outDir, "features", "orders", "REPORT.md")), false); // but the pipeline never ran for this feature
});

test("--check-drift against an identical contract: clean subject, feature still runs", () => {
  const { featureDir } = copyOrders();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cli-out-"));
  const same = path.join(featureDir, "openapi.json");
  const r = run([featureDir, "--check-drift", same, "--out", outDir, "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Subject: No contract drift for "orders"/m);
  assert.match(r.stdout, /Wrote \d+ files/);
});
