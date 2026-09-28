import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, carryUserContracts, computeBuildInfo, diffManifests, hashManifest, isDeployable, listDeployableFiles, readRelease, sortedJson, STATE_FILES, CONTRACT_FILES, userChangedContracts } from "./build-info.mjs";
import { CONTRACT_FILES as LOADER_CONTRACT_FILES } from "./contract.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "trace-bi-"));
function tree(dir, extra = {}) {
  const files = {
    "package.json": JSON.stringify({ name: "x", version: "2.3.4" }),
    "package-lock.json": "{}",
    "src/a.mjs": "export const a = 1;\n",
    "src/ui/index.html": "<p>hi</p>",
    "examples/one/feature.json": "{}",
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test("same content in two different directories gives the same hash", () => {
  const a = tree(tmp()), b = tree(tmp());
  assert.equal(computeBuildInfo(a).hash, computeBuildInfo(b).hash);
});

test("a changed byte changes the hash; so does a new or removed file", () => {
  const a = tree(tmp());
  const h0 = computeBuildInfo(a).hash;
  fs.appendFileSync(path.join(a, "src/a.mjs"), "// x\n");
  const h1 = computeBuildInfo(a).hash;
  assert.notEqual(h0, h1);
  fs.writeFileSync(path.join(a, "src/b.mjs"), "");
  assert.notEqual(computeBuildInfo(a).hash, h1);
  fs.rmSync(path.join(a, "src/b.mjs"));
  assert.equal(computeBuildInfo(a).hash, h1);
});

test("mtime changes and the time of the build do not change the hash", () => {
  const a = tree(tmp());
  const h0 = computeBuildInfo(a, { builtAt: "2020-01-01T00:00:00.000Z" }).hash;
  const past = new Date("2001-01-01T00:00:00Z");
  for (const f of listDeployableFiles(a)) fs.utimesSync(path.join(a, f), past, past);
  assert.equal(computeBuildInfo(a, { builtAt: "2030-01-01T00:00:00.000Z" }).hash, h0);
});

test("a rename changes the hash even when the bytes are the same", () => {
  const a = tree(tmp()), b = tree(tmp());
  fs.renameSync(path.join(b, "src/a.mjs"), path.join(b, "src/z.mjs"));
  assert.notEqual(computeBuildInfo(a).hash, computeBuildInfo(b).hash);
});

test("build info has the documented shape and version = package version + first 7 hash chars", () => {
  const d = tree(tmp());
  const i = computeBuildInfo(d, { release: "R0", builtAt: "2026-09-27T10:00:00.000Z" });
  assert.deepEqual(Object.keys(i).sort(), ["builtAt", "files", "hash", "major", "minor", "name", "release", "version"]);
  assert.equal(i.name, "Trace");
  assert.match(i.hash, /^[0-9a-f]{40}$/);
  assert.equal(i.version, `2.3.4+${i.hash.slice(0, 7)}`);
  assert.equal(i.release, "R0");
  assert.equal(i.major, "R0");
  assert.equal(i.minor, null);
  assert.equal(i.files, 5);
  assert.equal(i.builtAt, "2026-09-27T10:00:00.000Z");
});

test("generated, dependency, screenshot and state files are not part of the build", () => {
  const d = tree(tmp(), {
    "node_modules/x/index.js": "1", "deploy/1/a": "1", ".git/HEAD": "1", "docs/theme/shot.png": "1", "docs/NOTES.md": "n",
    "src/shot.png": "1", "examples/one/ai-cache.json": "1", "examples/one/answers.json": "1", "examples/one/decisions.json": "1",
    "examples/one/answers.history.jsonl": "1",
    "eval/out/r.json": "1", "demo-app/src/g.js": "1", "scratch.txt": "1", "server.log": "1",
  });
  assert.deepEqual(listDeployableFiles(d), ["docs/NOTES.md", "examples/one/feature.json", "package-lock.json", "package.json", "src/a.mjs", "src/ui/index.html"]);
  assert.deepEqual(STATE_FILES, ["answers.json", "answers.history.jsonl", "decisions.json", "ai-cache.json"], "the undo history is state");
  assert.equal(isDeployable("examples/one/answers.json"), false);
  assert.equal(isDeployable("src/deploy/deploy.mjs"), true);
  assert.equal(isDeployable("deploy/current/src/x.mjs"), false);
});

test("release comes from RELEASE, else the newest dated CHANGELOG section, else null", () => {
  const d = tree(tmp());
  assert.equal(readRelease(d), null);
  fs.writeFileSync(path.join(d, "CHANGELOG.md"), "## Unreleased\n- feat: x\n## R3 — 2026-01-01\n- fix: y\n");
  assert.equal(readRelease(d), "R3");
  fs.writeFileSync(path.join(d, "RELEASE"), "\nR7\n");
  assert.equal(readRelease(d), "R7");
  assert.equal(computeBuildInfo(d).release, "R7");
  assert.equal(computeBuildInfo(d, { release: null }).release, null);
});

test("a minor release id in RELEASE gives release R0.1, major R0, minor R0.1; an id that is not R<n>[.<m>] gives no major or minor", () => {
  const d = tree(tmp());
  fs.writeFileSync(path.join(d, "RELEASE"), "R0.1\n");
  const i = computeBuildInfo(d);
  assert.equal(i.release, "R0.1");
  assert.equal(i.major, "R0");
  assert.equal(i.minor, "R0.1");
  assert.deepEqual(computeBuildInfo(d, { release: "R12.30" }).minor, "R12.30");
  const odd = computeBuildInfo(d, { release: "beta" });
  assert.deepEqual([odd.release, odd.major, odd.minor], ["beta", null, null]);
  const none = computeBuildInfo(d, { release: null });
  assert.deepEqual([none.release, none.major, none.minor], [null, null, null]);
  // without a RELEASE file the newest section, including its newest minor, is the release
  fs.rmSync(path.join(d, "RELEASE"));
  fs.writeFileSync(path.join(d, "CHANGELOG.md"), "## R2 — 2026-01-01\n- feat: a\n### R2.1 — 2026-01-02\n- fix: b\n### R2.2 — 2026-01-03\n- fix: c\n");
  assert.equal(readRelease(d), "R2.2");
});

test("the manifest diff lists added, modified and removed files, sorted, with counts and a cap", () => {
  const prev = { "a": "1", "b": "1", "c": "1" }, next = { "a": "1", "b": "2", "d": "1", "e": "1" };
  const d = diffManifests(prev, next);
  assert.deepEqual(d.added, ["d", "e"]);
  assert.deepEqual(d.modified, ["b"]);
  assert.deepEqual(d.removed, ["c"]);
  assert.deepEqual(d.counts, { added: 2, modified: 1, removed: 1 });
  const capped = diffManifests({}, next, { cap: 1 });
  assert.deepEqual(capped.added, ["a"]);
  assert.equal(capped.counts.added, 4);
  assert.equal(capped.truncated.added, 3);
  assert.deepEqual(diffManifests(next, next).counts, { added: 0, modified: 0, removed: 0 });
});

test("manifest keys are sorted and the hash follows the content only", () => {
  const d = tree(tmp());
  const m = buildManifest(d);
  assert.deepEqual(Object.keys(m), [...Object.keys(m)].sort());
  assert.equal(hashManifest(m), hashManifest(Object.fromEntries(Object.entries(m).reverse())));
});

test("sortedJson sorts keys recursively", () => {
  assert.equal(sortedJson({ b: { z: 1, a: 2 }, a: [{ y: 1, x: 2 }] }), '{\n  "a": [\n    {\n      "x": 2,\n      "y": 1\n    }\n  ],\n  "b": {\n    "a": 2,\n    "z": 1\n  }\n}\n');
});

// ---------- the contract: source when shipped, the user's when changed in the running app ----------
test("a shipped openapi file is source: it is in the build, and editing it makes a new hash", () => {
  assert.deepEqual(CONTRACT_FILES, LOADER_CONTRACT_FILES, "the same list the loader uses");
  const d = tree(tmp(), { "examples/one/openapi.json": '{"a":1}', "examples/one/fixed.openapi.json": "{}", "examples/one/openapi.yaml": "a: 1" });
  for (const f of ["openapi.json", "openapi.yaml", "fixed.openapi.json"]) assert.equal(isDeployable(`examples/one/${f}`), true, f);
  const before = computeBuildInfo(d).hash;
  fs.writeFileSync(path.join(d, "examples/one/openapi.json"), '{"a":2}');
  assert.notEqual(computeBuildInfo(d).hash, before);
});

// a deployed build folder: the files it shipped + its manifest.json
function deployed(files) {
  const d = tree(tmp(), files);
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(buildManifest(d)));
  return d;
}

test("redeploy: an untouched shipped contract is NOT state; the new build's copy is used", () => {
  const running = deployed({ "examples/one/openapi.json": '{"v":1}' });
  assert.deepEqual(userChangedContracts(running), {});
  const next = tree(tmp(), { "examples/one/openapi.json": '{"v":2}' }); // the source was edited and rebuilt
  assert.deepEqual(carryUserContracts(running, next), []);
  assert.equal(fs.readFileSync(path.join(next, "examples/one/openapi.json"), "utf8"), '{"v":2}', "a source edit must redeploy");
});

test("redeploy: a contract changed or uploaded in the running app is kept, and stays the only openapi file", () => {
  const running = deployed({ "examples/one/openapi.json": '{"v":1}', "examples/two/feature.json": "{}" });
  fs.writeFileSync(path.join(running, "examples/one/openapi.json"), '{"v":"edited in the app"}'); // "Backend ships the fix" or an upload of the same name
  fs.writeFileSync(path.join(running, "examples/two/openapi.yaml"), "openapi: 3.0.0\n"); // uploaded into an example that shipped without one
  assert.deepEqual(userChangedContracts(running), { one: ["openapi.json"], two: ["openapi.yaml"] });
  const next = tree(tmp(), { "examples/one/openapi.json": '{"v":2}', "examples/two/feature.json": "{}", "examples/two/openapi.json": "{}" });
  assert.deepEqual(carryUserContracts(running, next), ["one", "two"]);
  assert.equal(fs.readFileSync(path.join(next, "examples/one/openapi.json"), "utf8"), '{"v":"edited in the app"}');
  assert.deepEqual(fs.readdirSync(path.join(next, "examples/two")).filter((f) => f.startsWith("openapi")), ["openapi.yaml"]);
});

test("redeploy: another extension counts as changed, a shipped file that is missing does not, an old build without a manifest keeps what it has", () => {
  const running = deployed({ "examples/one/openapi.json": "{}" });
  fs.rmSync(path.join(running, "examples/one/openapi.json"));
  fs.writeFileSync(path.join(running, "examples/one/openapi.yaml"), "x: 1\n");
  assert.deepEqual(userChangedContracts(running), { one: ["openapi.yaml"] });
  const gone = deployed({ "examples/one/openapi.json": "{}" });
  fs.rmSync(path.join(gone, "examples/one/openapi.json"));
  assert.deepEqual(userChangedContracts(gone), {}, "a reset puts it back from .original; nothing to carry");
  const old = tree(tmp(), { "examples/one/openapi.json": "{}" }); // no manifest.json
  assert.deepEqual(userChangedContracts(old), { one: ["openapi.json"] });
  assert.deepEqual(userChangedContracts(path.join(tmp(), "nothing-here")), {});
});

// ---------- the carry is atomic: a failure at any step never leaves the older build without a contract ----------
// A running build with two user-changed contracts: `one` replaced its shipped openapi.json, `two` uploaded a yaml over a shipped json.
function carryWorld() {
  const running = deployed({ "examples/one/openapi.json": '{"v":1}', "examples/two/openapi.json": '{"t":1}' });
  fs.writeFileSync(path.join(running, "examples/one/openapi.json"), '{"v":"uploaded"}');
  fs.rmSync(path.join(running, "examples/two/openapi.json"));
  fs.writeFileSync(path.join(running, "examples/two/openapi.yaml"), "t: uploaded\n");
  const next = tree(tmp(), { "examples/one/openapi.json": '{"v":2}', "examples/two/openapi.json": '{"t":2}' });
  return { running, next };
}
const contractsIn = (next, ex) => fs.readdirSync(path.join(next, "examples", ex)).filter((f) => f.startsWith("openapi"));
const leftovers = (next) => ["one", "two"].flatMap((ex) => fs.readdirSync(path.join(next, "examples", ex)).filter((f) => f.endsWith(".tmp")));

test("carry: success replaces the shipped file, leaves exactly one openapi file per example and no temp file", () => {
  const { running, next } = carryWorld();
  assert.deepEqual(carryUserContracts(running, next), ["one", "two"]);
  assert.equal(fs.readFileSync(path.join(next, "examples/one/openapi.json"), "utf8"), '{"v":"uploaded"}');
  assert.deepEqual(contractsIn(next, "two"), ["openapi.yaml"]);
  assert.deepEqual(leftovers(next), []);
});

// ops that record every call and check, BEFORE each one, that the target example still has a contract; `failOn` throws on the n-th call of a kind
function spyOps(next, failOn = {}) {
  const calls = [], counts = {};
  const wrap = (kind, fn) => (...a) => {
    for (const ex of ["one", "two"]) assert.ok(contractsIn(next, ex).length >= 1, `before ${kind}(${path.basename(String(a[0]))}): ${ex} had no contract`);
    counts[kind] = (counts[kind] ?? 0) + 1;
    calls.push(kind);
    if (failOn[kind] === counts[kind]) throw Object.assign(new Error(`injected ${kind} failure`), { code: "EIO" });
    return fn(...a);
  };
  return { ops: { copyFileSync: wrap("copy", fs.copyFileSync), renameSync: wrap("rename", fs.renameSync), rmSync: wrap("rm", fs.rmSync) }, calls };
}

test("carry: a failure at each step (copy, rename, remove of the other file) leaves every example with a contract, throws, and cleans its temp files", () => {
  for (const [kind, n] of [["copy", 1], ["copy", 2], ["rename", 1], ["rename", 2], ["rm", 1]]) {
    const { running, next } = carryWorld();
    const { ops } = spyOps(next, { [kind]: n });
    assert.throws(() => carryUserContracts(running, next, ops), new RegExp(`injected ${kind} failure`), `${kind} #${n}`);
    for (const ex of ["one", "two"]) assert.ok(contractsIn(next, ex).length >= 1, `${kind} #${n}: ${ex} has no contract left`);
    assert.deepEqual(leftovers(next), [], `${kind} #${n}: temp files remain`);
    // what is there is one of the two complete versions, never a half-written file
    for (const [ex, f, versions] of [["one", "openapi.json", ['{"v":"uploaded"}', '{"v":2}']]]) assert.ok(versions.includes(fs.readFileSync(path.join(next, "examples", ex, f), "utf8")), `${kind} #${n}`);
  }
});

test("carry: the other openapi file is removed only AFTER the replacement is renamed into place (never remove, then copy)", () => {
  const { running, next } = carryWorld();
  const { ops, calls } = spyOps(next);
  carryUserContracts(running, next, ops);
  // per example: copy, then rename, and only then rm for the openapi names that were not carried
  assert.deepEqual(calls.filter((c) => c !== "rm"), ["copy", "rename", "copy", "rename"]);
  const firstRm = calls.indexOf("rm");
  assert.ok(firstRm > calls.indexOf("rename"), "the first removal comes after the first rename");
  // the failure that matters: the copy of `two`'s yaml fails; its shipped json must still be there, untouched
  const w = carryWorld();
  const s = spyOps(w.next, { copy: 2 });
  assert.throws(() => carryUserContracts(w.running, w.next, s.ops));
  assert.equal(fs.readFileSync(path.join(w.next, "examples/two/openapi.json"), "utf8"), '{"t":2}', "the shipped contract of `two` was not removed before its replacement existed");
});

test("carry: a copy that does not match the original is refused before it replaces anything", () => {
  const { running, next } = carryWorld();
  const truncating = { copyFileSync: (from, to) => fs.writeFileSync(to, fs.readFileSync(from, "utf8").slice(0, 3)) };
  assert.throws(() => carryUserContracts(running, next, truncating), /does not match the original/);
  assert.equal(fs.readFileSync(path.join(next, "examples/one/openapi.json"), "utf8"), '{"v":2}', "the target is untouched");
  assert.deepEqual(leftovers(next), []);
});
