// T16.10: buffered, all-or-nothing writes (src/write-transaction.mjs). Same fixture runs against both the
// fallback (no CONSTRUCT_ROOT) and Construct's real createTransaction (CONSTRUCT_ROOT set), same pattern as
// src/import/import.test.mjs and src/drift.test.mjs: identical behavior is the point of a swap-in adapter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWriteTransaction } from "./write-transaction.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-txn-"));
}

test("nothing is written until commit()", () => {
  const root = scratchDir();
  const txn = createWriteTransaction(root);
  txn.writeFile("a.txt", "hello");
  txn.writeFile("nested/b.txt", "world");
  assert.equal(fs.existsSync(path.join(root, "a.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "nested/b.txt")), false);
  assert.deepEqual(txn.pendingFiles().sort(), ["a.txt", "nested/b.txt"]);

  const result = txn.commit();
  assert.equal(result.committed, true);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "hello");
  assert.equal(fs.readFileSync(path.join(root, "nested/b.txt"), "utf8"), "world");
});

test("readFile sees a staged write before commit, and falls through to disk otherwise", () => {
  const root = scratchDir();
  fs.writeFileSync(path.join(root, "existing.txt"), "old");
  const txn = createWriteTransaction(root);
  assert.equal(txn.readFile("existing.txt"), "old");
  txn.writeFile("existing.txt", "new");
  assert.equal(txn.readFile("existing.txt"), "new");
  assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "old"); // not committed yet
});

test("reset() discards staged writes without touching disk", () => {
  const root = scratchDir();
  const txn = createWriteTransaction(root);
  txn.writeFile("a.txt", "hello");
  txn.reset();
  assert.deepEqual(txn.pendingFiles(), []);
  txn.commit();
  assert.equal(fs.existsSync(path.join(root, "a.txt")), false);
});

test("a later writeFile for the same path replaces the earlier one", () => {
  const root = scratchDir();
  const txn = createWriteTransaction(root);
  txn.writeFile("a.txt", "first");
  txn.writeFile("a.txt", "second");
  txn.commit();
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "second");
});

test("commit() never runs Construct's default architecture validator (no violations even with mismatched layer folders)", () => {
  const root = scratchDir();
  const txn = createWriteTransaction(root);
  // A folder name architecture-enforcer.mjs would reject outright ("not a recognized architecture layer") if the
  // default validator ran, since Trace's generated layers are singular (controller/, service/, ...), not the
  // plural folders Construct's DEFAULT_LAYERS expects.
  txn.writeFile("features/x/controller/X.jsx", "export default function X() {}\n");
  const result = txn.commit();
  assert.equal(result.committed, true);
  assert.deepEqual(result.violations, []);
});

// ---------- Construct reuse: transactionalWriter (packages/engine/transactionalWriter.mjs) ----------
const CONSTRUCT_CHECKOUT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";
const hasConstruct = fs.existsSync(path.join(CONSTRUCT_CHECKOUT, "packages", "engine", "transactionalWriter.mjs"));

test("with CONSTRUCT_ROOT set, the same fixture commits through Construct's createTransaction", { skip: hasConstruct ? false : `no Construct checkout at ${CONSTRUCT_CHECKOUT}; set CONSTRUCT_ROOT to run this` }, () => {
  const root = scratchDir();
  const script = `
    import { createWriteTransaction } from ${JSON.stringify(path.join(here, "write-transaction.mjs"))};
    const txn = createWriteTransaction(${JSON.stringify(root)});
    txn.writeFile("features/x/controller/X.jsx", "export default function X() {}\\n");
    const result = txn.commit();
    console.log(JSON.stringify(result));
  `;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lm-txn-probe-")), "probe.mjs");
  fs.writeFileSync(tmp, script);
  const res = spawnSync(process.execPath, [tmp], { env: { ...process.env, CONSTRUCT_ROOT: CONSTRUCT_CHECKOUT }, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.equal(result.committed, true);
  assert.deepEqual(result.violations, []);
  assert.equal(fs.readFileSync(path.join(root, "features/x/controller/X.jsx"), "utf8"), "export default function X() {}\n");
});
