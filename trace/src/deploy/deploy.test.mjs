// The deploy decisions, with every effect faked: no process is started, no port opened, nothing copied.
import test from "node:test";
import assert from "node:assert/strict";
import { deploy, rollback, parseTestSummary, createWatchController } from "./deploy.mjs";
import { versionsToPrune } from "./releases.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, carryUserContracts, userChangedContracts } from "../build-info.mjs";

const V1 = { version: "1.0.0+1111111", hash: "1".repeat(40) };
const V2 = { version: "1.0.0+2222222", hash: "2".repeat(40) };

// A fake world: what is "deployed", which servers "run", and a log of every effect in order.
function world({ tree = V2, state = { current: V1.version, pinnedHash: null }, releases = { [V1.version]: { ...V1, previousVersion: null } }, port = { state: "ours" },
  tests = { ok: true, summary: { total: 5, pass: 5, fail: 0, todo: 0 } }, healthy = () => true } = {}) {
  const log = [], w = { log, state: { ...state }, releases: { ...releases }, files: { written: null, failure: null } };
  const manifestOf = (v) => ({ [`${v}.txt`]: "x" });
  w.d = {
    computeState: async () => ({ info: { name: "Trace", version: tree.version, release: null, hash: tree.hash, files: 1, builtAt: "x" }, manifest: { "a.mjs": tree.hash } }),
    readState: async () => ({ ...w.state }),
    writeState: async (s) => { log.push(`state ${JSON.stringify(s)}`); w.state = { ...w.state, ...s }; },
    portStatus: async () => port,
    hasRelease: async (v) => v in w.releases,
    readManifest: async (v) => (v in w.releases ? manifestOf(v) : null),
    readBuildInfo: async (v) => w.releases[v] ?? null,
    runTests: async () => { log.push("tests"); return tests; },
    buildRelease: async ({ info, previous }) => { log.push(`build ${info.version}`); w.releases[info.version] = info; w.built = { info, previous }; },
    removeRelease: async (v) => { log.push(`remove ${v}`); delete w.releases[v]; },
    pruneCandidates: async () => [],
    pickFreePort: async () => 50001,
    start: async ({ version, port: p, temp }) => { log.push(`start ${version} ${p}${temp ? " temp" : ""}`); return { pid: 1 }; },
    stop: async (h) => { log.push(h ? "stop temp" : "stop"); },
    healthy: async (p, hash) => { const ok = healthy(p, hash, log); log.push(`health ${p} ${ok}`); return ok; },
    switchCurrent: async (v) => { log.push(`switch ${v}`); },
    writeFailure: async (t) => { log.push("failure"); w.files.failure = t; },
    clearFailure: async () => { log.push("clear-failure"); w.files.failure = null; },
    now: () => "2026-09-27T12:00:00.000Z",
  };
  return w;
}

test("an unchanged tree that is running and healthy: nothing happens, and it says so", async () => {
  const w = world({ tree: V1 });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "unchanged");
  assert.match(r.message, /already deployed/);
  assert.deepEqual(w.log, ["health 4200 true"]); // no tests, no copy, no restart
});

test("an unchanged tree that is not running is just started", async () => {
  const w = world({ tree: V1, port: { state: "free" } });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "started");
  assert.deepEqual(w.log.filter((l) => l.startsWith("start")), ["start 1.0.0+1111111 4200"]);
  assert.ok(!w.log.includes("tests"));
});

test("failing tests refuse the deploy, keep the old build running and write LAST-FAILURE", async () => {
  const w = world({ tests: { ok: false, summary: { total: 5, pass: 4, fail: 1, todo: 0 }, tail: "not ok 3 - the thing" } });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "tests-failed");
  assert.match(w.files.failure, /npm test failed/);
  assert.match(w.files.failure, /not ok 3/);
  assert.deepEqual(w.log, ["tests", "failure"]); // nothing copied, started, stopped or switched
  assert.equal(w.state.current, V1.version);
});

test("a good deploy: tests, copy, temporary health check, switch, restart, verify; records tests and changes", async () => {
  const w = world();
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "deployed");
  assert.deepEqual(w.log.filter((l) => !l.startsWith("state")), [
    "tests", `build ${V2.version}`,
    `start ${V2.version} 50001 temp`, "health 50001 true", "stop temp",
    `switch ${V2.version}`, "stop", `start ${V2.version} 4200`, "health 4200 true", "clear-failure",
  ]);
  assert.equal(w.state.current, V2.version);
  const { info, previous } = w.built;
  assert.equal(previous, V1.version);
  assert.equal(info.previousVersion, V1.version);
  assert.equal(info.builtAt, "2026-09-27T12:00:00.000Z");
  assert.deepEqual(info.tests, { total: 5, pass: 5, fail: 0, todo: 0 });
  assert.deepEqual(info.changesSincePrevious.counts, { added: 1, modified: 0, removed: 1 }); // a.mjs added, 1.0.0+1111111.txt removed
});

test("the first ever deploy has no previous build and no changes list", async () => {
  const w = world({ state: { current: null, pinnedHash: null }, releases: {}, port: { state: "free" } });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "deployed");
  assert.equal(w.built.info.previousVersion, null);
  assert.equal(w.built.info.changesSincePrevious, null);
});

test("a candidate that fails its temporary health check is discarded; the old build is never touched", async () => {
  const w = world({ healthy: (p) => p !== 50001 });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "candidate-failed");
  assert.ok(w.log.includes(`remove ${V2.version}`));
  assert.ok(!w.log.some((l) => l.startsWith("switch")) && !w.log.includes("stop"));
  assert.equal(w.state.current, V1.version);
  assert.ok(w.files.failure);
});

test("a build that fails the health check on the fixed port is rolled back to the previous one", async () => {
  let n = 0;
  const w = world({ healthy: (p) => p !== 4200 || ++n > 1 }); // first check on 4200 (the new build) fails, the next (the old one) passes
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "reverted");
  assert.match(r.message, new RegExp(V1.version.replace(/\+/g, "\\+")));
  const tail = w.log.slice(w.log.indexOf(`start ${V2.version} 4200`));
  assert.deepEqual(tail.filter((l) => !l.startsWith("state")), [`start ${V2.version} 4200`, "health 4200 false", "stop", `switch ${V1.version}`, `start ${V1.version} 4200`, "health 4200 true", "failure"]);
  assert.equal(w.state.current, V1.version);
  assert.match(w.files.failure, /rolled back to/);
});

test("with no previous build to go back to, a failed health check stops the server", async () => {
  const w = world({ state: { current: null, pinnedHash: null }, releases: {}, port: { state: "free" }, healthy: (p) => p !== 4200 });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "failed");
  assert.equal(w.log.at(-2), "stop");
});

test("a port held by another program is refused before anything happens", async () => {
  const w = world({ port: { state: "foreign", by: "another program" } });
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "port-busy");
  assert.match(r.message, /4200/);
  assert.match(r.message, /--port or TRACE_DEPLOY_PORT/);
  assert.deepEqual(w.log, []);
});

test("a tree that was rolled back from on purpose is skipped by the watcher's deploy, not by an explicit one", async () => {
  const w = world({ state: { current: V1.version, pinnedHash: V2.hash } });
  assert.equal((await deploy(w.d, { port: 4200, respectPin: true })).status, "pinned");
  assert.deepEqual(w.log, []);
  assert.equal((await deploy(w.d, { port: 4200 })).status, "deployed");
});

test("rollback goes to the build before the current one, pins the tree, and undoes itself if that build will not start", async () => {
  const A = { version: "1.0.0+aaaaaaa", hash: "a".repeat(40) };
  const releases = { [A.version]: { ...A, previousVersion: null }, [V2.version]: { ...V2, previousVersion: A.version } };
  const w = world({ tree: { version: "1.0.0+3333333", hash: "3".repeat(40) }, state: { current: V2.version, pinnedHash: null }, releases });
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "rolled-back");
  assert.equal(r.version, A.version);
  assert.equal(w.state.current, A.version);
  assert.equal(w.state.pinnedHash, "3".repeat(40));

  const bad = world({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases, healthy: (p, h) => h !== A.hash });
  const r2 = await rollback(bad.d, { port: 4200 });
  assert.equal(r2.status, "rollback-failed");
  assert.equal(bad.state.current, V2.version);
});

// ---- contracts uploaded in the running app, across a rollback and across the first redeploy (scratch dirs only) ----
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "trace-roll-"));
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
// a kept build: the files it shipped and its manifest.json, as the real deploy writes them
function keptBuild(deployDir, version, files) {
  const dir = path.join(deployDir, version);
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(buildManifest(dir)));
  return dir;
}

test("rollback carries the running build's uploaded contract into the older build, before switching, and says so", async () => {
  const A = { version: "1.0.0+aaaaaaa", hash: "a".repeat(40) };
  const releases = { [A.version]: { ...A, previousVersion: null }, [V2.version]: { ...V2, previousVersion: A.version } };
  const w = world({ tree: { version: "1.0.0+3333333", hash: "3".repeat(40) }, state: { current: V2.version, pinnedHash: null }, releases });
  const calls = [];
  w.d.carryContracts = async (from, to) => { calls.push([from, to]); w.log.push("carry"); return ["orders"]; };
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "rolled-back");
  assert.deepEqual(calls, [[V2.version, A.version], [V2.version, A.version]], "once before the switch, once after the old server is stopped (the re-carry)");
  assert.ok(w.log.indexOf("carry") < w.log.indexOf(`switch ${A.version}`), "carried first, switched after");
  assert.match(r.message, /kept for: orders/);
  // nothing carried: no note
  const w2 = world({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases });
  w2.d.carryContracts = async () => [];
  assert.doesNotMatch((await rollback(w2.d, { port: 4200 })).message, /kept for/);
});

test("rollback whose contract carry fails changes nothing: no switch, no restart, the running build keeps running", async () => {
  const A = { version: "1.0.0+aaaaaaa", hash: "a".repeat(40) };
  const releases = { [A.version]: { ...A, previousVersion: null }, [V2.version]: { ...V2, previousVersion: A.version } };
  const w = world({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases });
  w.d.carryContracts = async () => { throw new Error("disk full"); };
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "carry-failed");
  assert.match(r.message, /disk full/);
  assert.match(r.message, /nothing was changed/);
  assert.equal(w.state.current, V2.version);
  assert.deepEqual(w.log, []);
});

test("scratch deploy dir: a contract uploaded in the newer build survives a rollback, and then a later redeploy", async () => {
  const dd = scratch();
  const shippedA = '{"openapi":"3.0.0","info":{"title":"orders A"}}', shippedB = '{"openapi":"3.0.0","info":{"title":"orders B"}}';
  const uploaded = '{"openapi":"3.0.0","info":{"title":"UPLOADED by the user"}}';
  const A = keptBuild(dd, "1.0.0+aaaaaaa", { "examples/orders/openapi.json": shippedA, "examples/deals/openapi.json": '{"d":1}' });
  const B = keptBuild(dd, "1.0.0+bbbbbbb", { "examples/orders/openapi.json": shippedB, "examples/deals/openapi.json": '{"d":1}' });
  put(B, "examples/orders/openapi.json", uploaded); // uploaded in the running app (B is the running build)
  assert.deepEqual(userChangedContracts(B), { orders: ["openapi.json"] });

  const releases = { "1.0.0+aaaaaaa": { version: "1.0.0+aaaaaaa", hash: "a".repeat(40), previousVersion: null }, "1.0.0+bbbbbbb": { version: "1.0.0+bbbbbbb", hash: "b".repeat(40), previousVersion: "1.0.0+aaaaaaa" } };
  const w = world({ tree: V2, state: { current: "1.0.0+bbbbbbb", pinnedHash: null }, releases });
  w.d.carryContracts = async (from, to) => carryUserContracts(path.join(dd, from), path.join(dd, to)); // the real effect, on the scratch dir
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "rolled-back");
  assert.equal(read(A, "examples/orders/openapi.json"), uploaded, "the older build now serves the uploaded contract");
  assert.equal(read(A, "examples/deals/openapi.json"), '{"d":1}', "an untouched example is left alone");
  assert.deepEqual(fs.readdirSync(path.join(A, "examples/orders")).filter((f) => f.startsWith("openapi")), ["openapi.json"]);
  assert.deepEqual(userChangedContracts(A), { orders: ["openapi.json"] }, "and A's manifest still marks it as the user's, so the NEXT redeploy keeps it too");
  const C = path.join(dd, "1.0.0+ccccccc");
  put(C, "examples/orders/openapi.json", '{"openapi":"3.0.0","info":{"title":"orders C"}}');
  put(C, "examples/deals/openapi.json", '{"d":2}');
  assert.deepEqual(carryUserContracts(A, C), ["orders"]);
  assert.equal(read(C, "examples/orders/openapi.json"), uploaded);
  assert.equal(read(C, "examples/deals/openapi.json"), '{"d":2}', "a shipped source edit still wins where nobody uploaded anything");
});

test("scratch deploy dir: rolling back a build that has no user upload does not disturb the older build's contracts", async () => {
  const dd = scratch();
  const A = keptBuild(dd, "1.0.0+aaaaaaa", { "examples/orders/openapi.json": '{"a":1}' });
  const B = keptBuild(dd, "1.0.0+bbbbbbb", { "examples/orders/openapi.json": '{"b":1}' });
  assert.deepEqual(carryUserContracts(B, A), []);
  assert.equal(read(A, "examples/orders/openapi.json"), '{"a":1}');
});

test("first redeploy over a build whose manifest has no openapi entries: the new build's shipped contracts are not treated as user changes", () => {
  const dd = scratch();
  // the running build predates the contract migration: its manifest lists feature.json and a page, no openapi.* at all
  const running = keptBuild(dd, "0.9.0+old0000", { "examples/orders/feature.json": "{}", "examples/orders/page.jsx": "<div/>", "examples/orders/api-data.json": "[]" });
  assert.equal(Object.keys(JSON.parse(read(running, "manifest.json"))).some((k) => /openapi/.test(k)), false);
  assert.deepEqual(userChangedContracts(running), {}, "nothing on disk that looks like a contract");
  const next = path.join(dd, "1.0.0+new0000");
  put(next, "examples/orders/feature.json", "{}");
  put(next, "examples/orders/openapi.json", '{"shipped":true}');
  put(next, "examples/deals/openapi.yaml", "shipped: true\n");
  assert.deepEqual(carryUserContracts(running, next), []);
  assert.equal(read(next, "examples/orders/openapi.json"), '{"shipped":true}');
  assert.equal(read(next, "examples/deals/openapi.yaml"), "shipped: true\n");
  // ... but a contract found on disk that the manifest does not list WAS added in the app: it is the user's and is kept
  put(running, "examples/orders/openapi.json", '{"uploaded":true}');
  assert.deepEqual(carryUserContracts(running, next), ["orders"]);
  assert.equal(read(next, "examples/orders/openapi.json"), '{"uploaded":true}');
  assert.equal(read(next, "examples/deals/openapi.yaml"), "shipped: true\n", "an example the running app never touched keeps the new shipped file");
});

test("a running build with a missing or unreadable manifest keeps every contract it has (unknown provenance: never delete a user's file)", () => {
  const dd = scratch();
  const running = path.join(dd, "0.1.0+nomanif");
  put(running, "examples/orders/openapi.json", '{"maybe":"the user\'s"}');
  const next = path.join(dd, "1.0.0+new0000");
  put(next, "examples/orders/openapi.json", '{"shipped":true}');
  assert.deepEqual(carryUserContracts(running, next), ["orders"], "no manifest.json");
  put(next, "examples/orders/openapi.json", '{"shipped":true}');
  fs.writeFileSync(path.join(running, "manifest.json"), "{ not json");
  assert.deepEqual(carryUserContracts(running, next), ["orders"], "a corrupt manifest.json");
  assert.equal(read(next, "examples/orders/openapi.json"), '{"maybe":"the user\'s"}');
});

test("rollback with nothing earlier says so", async () => {
  const w = world();
  assert.equal((await rollback(w.d, { port: 4200 })).status, "no-previous");
  assert.deepEqual(w.log, []);
});

test("keep the last 3 builds, never the running one or the one it can roll back to", () => {
  const rel = ["v5", "v4", "v3", "v2", "v1"].map((version) => ({ version }));
  assert.deepEqual(versionsToPrune(rel, { current: "v5", previous: "v4" }), ["v2", "v1"]);
  assert.deepEqual(versionsToPrune(rel, { current: "v1", previous: null }), ["v2"]); // rolled back to the oldest: it stays
  assert.deepEqual(versionsToPrune(rel.slice(0, 2), { current: "v5" }), []);
});

test("parseTestSummary reads the node:test totals and takes the last summary", () => {
  const out = "ℹ tests 3\nℹ pass 3\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 1\n\nℹ tests 79\nℹ suites 4\nℹ pass 77\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 2\n";
  assert.deepEqual(parseTestSummary(out), { total: 79, pass: 77, fail: 0, todo: 2 });
  assert.equal(parseTestSummary("no summary here"), null);
});

// ---------- the watcher: debounce, one deploy at a time, never a loop ----------
function watchRig({ hashes, results }) {
  const timers = [], events = [], runs = [];
  let hi = 0;
  const ctrl = createWatchController({
    computeHash: () => hashes[Math.min(hi, hashes.length - 1)],
    deploy: async () => { runs.push(hashes[Math.min(hi, hashes.length - 1)]); return results.shift() ?? { status: "deployed", message: "ok" }; },
    quietMs: 20_000,
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    isRelevant: (rel) => !rel.startsWith("deploy/") && !rel.startsWith("node_modules/"),
    log: (m) => events.push(m),
  });
  const fire = async () => { const t = [...timers].reverse().find((x) => x.live); t.live = false; await t.fn(); };
  return { ctrl, timers, runs, events, fire, setHash: (i) => { hi = i; } };
}

test("watch: a burst of edits is one deploy after the quiet period; each edit restarts the clock", async () => {
  const r = watchRig({ hashes: ["h1", "h2"] });
  r.setHash(1);
  r.ctrl.onChange("src/a.mjs"); r.ctrl.onChange("src/b.mjs"); r.ctrl.onChange("src/c.mjs");
  assert.equal(r.timers.filter((t) => t.live).length, 1);
  assert.equal(r.timers[0].ms, 20_000);
  await r.fire();
  assert.deepEqual(r.runs, ["h2"]);
});

test("watch: files under deploy/ and node_modules/ never start the clock (a deploy cannot trigger itself)", () => {
  const r = watchRig({ hashes: ["h1"] });
  r.ctrl.onChange("deploy/1.0.0+abc/src/server.mjs");
  r.ctrl.onChange("node_modules/x/y.js");
  assert.equal(r.timers.length, 0);
});

test("watch: a failed deploy is not retried until the tree changes again (no loop)", async () => {
  const r = watchRig({ hashes: ["h1", "h2"], results: [{ status: "tests-failed", message: "no" }] });
  await r.ctrl.settleNow();
  assert.deepEqual(r.runs, ["h1"]);
  r.ctrl.onChange("src/x.mjs"); await r.fire(); // touched, but the content is the same
  r.ctrl.onChange("src/x.mjs"); await r.fire();
  assert.deepEqual(r.runs, ["h1"]);
  r.setHash(1);
  r.ctrl.onChange("src/x.mjs"); await r.fire(); // content changed: one more try
  assert.deepEqual(r.runs, ["h1", "h2"]);
});

test("watch: port-busy is retried on the next change, and an error in deploy does not stop the watcher", async () => {
  const r = watchRig({ hashes: ["h1"], results: [{ status: "port-busy", message: "busy" }] });
  await r.ctrl.settleNow();
  await r.ctrl.settleNow();
  assert.deepEqual(r.runs, ["h1", "h1"]);
  const bad = createWatchController({ computeHash: () => "h", deploy: async () => { throw new Error("boom"); }, schedule: () => () => {}, log: (m) => bad.logged.push(m) });
  bad.logged = [];
  await bad.settleNow();
  assert.match(bad.logged[0], /boom/);
});

test("watch: a change during a deploy queues exactly one more pass", async () => {
  const timers = [];
  let release, runs = 0, hash = "h1";
  const ctrl = createWatchController({
    computeHash: () => hash,
    deploy: () => { runs++; return new Promise((res) => { release = () => res({ status: "deployed", message: "ok" }); }); },
    schedule: (fn) => { const t = { fn, live: true }; timers.push(t); return () => { t.live = false; }; },
  });
  const first = ctrl.settleNow();
  hash = "h2";
  ctrl.onChange("src/a.mjs");
  await timers.at(-1).fn(); // fires while the first deploy is still running: deferred, not run in parallel
  assert.equal(runs, 1);
  release(); await first;
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.filter((t) => t.live).length, 1); // the queued pass is scheduled, not started
});

// ---------- the contract-upload lock and the re-carry (R1.1): an upload between the carry and the stop is never lost ----------
const A = { version: "1.0.0+aaaaaaa", hash: "a".repeat(40) };
const rollbackReleases = { [A.version]: { ...A, previousVersion: null }, [V2.version]: { ...V2, previousVersion: A.version } };
const lockedWorld = (opts = {}) => {
  const w = world(opts);
  w.d.lockContracts = async () => { w.log.push("lock"); return async () => { w.log.push("unlock"); }; };
  return w;
};

test("deploy holds the contract lock from before the copy to after the last check, and always releases it", async () => {
  const w = lockedWorld();
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "deployed");
  const l = w.log.filter((x) => !x.startsWith("state"));
  assert.equal(l.indexOf("lock"), l.indexOf("tests") + 1, "after the tests, right before the copy");
  assert.ok(l.indexOf("lock") < l.indexOf(`build ${V2.version}`));
  assert.equal(l[l.length - 1], "unlock", "released last, after the new build was verified");
  assert.equal(l.filter((x) => x === "lock").length, 1);
  assert.equal(l.filter((x) => x === "unlock").length, 1);
  // released on every other way out too
  const cand = lockedWorld({ healthy: (p) => p !== 50001 });
  assert.equal((await deploy(cand.d, { port: 4200 })).status, "candidate-failed");
  assert.equal(cand.log.at(-1), "unlock");
  let n = 0;
  const rev = lockedWorld({ healthy: (p) => p !== 4200 || ++n > 1 });
  assert.equal((await deploy(rev.d, { port: 4200 })).status, "reverted");
  assert.equal(rev.log.at(-1), "unlock");
  const boom = lockedWorld();
  boom.d.buildRelease = async () => { throw new Error("The source changed while it was being copied."); };
  await assert.rejects(deploy(boom.d, { port: 4200 }), /source changed/);
  assert.equal(boom.log.at(-1), "unlock", "even when the copy throws");
  // no lock for a run that changes nothing
  const same = lockedWorld({ tree: V1 });
  assert.equal((await deploy(same.d, { port: 4200 })).status, "unchanged");
  assert.ok(!same.log.includes("lock"));
  // a lock that cannot be taken changes nothing
  const fail = world();
  fail.d.lockContracts = async () => { throw new Error("the contract lock is held by pid 99"); };
  const rf = await deploy(fail.d, { port: 4200 });
  assert.equal(rf.status, "lock-failed");
  assert.deepEqual(fail.log.filter((x) => x !== "tests"), []);
});

test("deploy copies the uploaded contracts again once the old server is stopped, before the new one starts; if that copy fails the old build is running again", async () => {
  const w = lockedWorld();
  const calls = [];
  w.d.carryContracts = async (from, to) => { calls.push([from, to]); w.log.push("recarry"); return ["orders"]; };
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "deployed");
  assert.deepEqual(calls, [[V1.version, V2.version]]);
  const l = w.log.filter((x) => !x.startsWith("state"));
  assert.ok(l.indexOf("stop") < l.indexOf("recarry") && l.indexOf("recarry") < l.indexOf(`start ${V2.version} 4200`), l.join(" | "));

  const bad = lockedWorld();
  bad.d.carryContracts = async () => { throw new Error("disk full"); };
  const rb = await deploy(bad.d, { port: 4200 });
  assert.equal(rb.status, "carry-failed");
  assert.match(rb.message, /disk full/);
  assert.match(rb.message, /nothing was lost/);
  assert.equal(bad.state.current, V1.version, "the previous build is current again");
  const lb = bad.log.filter((x) => !x.startsWith("state"));
  assert.equal(lb.at(-1), "unlock");
  assert.ok(lb.lastIndexOf(`start ${V1.version} 4200`) > lb.indexOf("stop"), "and it is started again");
  assert.ok(!(V2.version in bad.releases), "the half-made build is discarded");
  // the very first deploy has nothing to carry from
  const first = lockedWorld({ state: { current: null, pinnedHash: null }, releases: {}, port: { state: "free" } });
  first.d.carryContracts = async () => { throw new Error("must not be called"); };
  assert.equal((await deploy(first.d, { port: 4200 })).status, "deployed");
});

test("rollback holds the lock across the carry, the switch and the restart, re-carries after the stop, and always releases", async () => {
  const w = lockedWorld({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases: rollbackReleases });
  w.d.carryContracts = async () => { w.log.push("carry"); return ["orders"]; };
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "rolled-back");
  assert.match(r.message, /kept for: orders/);
  const l = w.log.filter((x) => !x.startsWith("state"));
  assert.deepEqual(l.filter((x) => ["lock", "carry", `switch ${A.version}`, "stop", `start ${A.version} 4200`, "unlock"].includes(x)),
    ["lock", "carry", `switch ${A.version}`, "stop", "carry", `start ${A.version} 4200`, "unlock"]);

  // the first carry fails: nothing changes and the lock is released
  const f1 = lockedWorld({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases: rollbackReleases });
  f1.d.carryContracts = async () => { throw new Error("disk full"); };
  assert.equal((await rollback(f1.d, { port: 4200 })).status, "carry-failed");
  assert.deepEqual(f1.log, ["lock", "unlock"]);

  // the re-carry fails after the old server was stopped: it is started again, nothing is lost
  let n = 0;
  const f2 = lockedWorld({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases: rollbackReleases });
  f2.d.carryContracts = async () => { if (++n === 2) throw new Error("io error"); return []; };
  const r2 = await rollback(f2.d, { port: 4200 });
  assert.equal(r2.status, "carry-failed");
  assert.match(r2.message, /running again and nothing was lost/);
  assert.equal(f2.state.current, V2.version);
  const l2 = f2.log.filter((x) => !x.startsWith("state"));
  assert.ok(l2.lastIndexOf(`start ${V2.version} 4200`) > l2.indexOf("stop"));
  assert.equal(l2.at(-1), "unlock");

  // the older build will not start: the way back also releases the lock
  const f3 = lockedWorld({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases: rollbackReleases, healthy: (p, h) => h !== A.hash });
  assert.equal((await rollback(f3.d, { port: 4200 })).status, "rollback-failed");
  assert.equal(f3.log.at(-1), "unlock");

  // a lock that cannot be taken changes nothing
  const f4 = world({ tree: V2, state: { current: V2.version, pinnedHash: null }, releases: rollbackReleases });
  f4.d.lockContracts = async () => { throw new Error("held"); };
  assert.equal((await rollback(f4.d, { port: 4200 })).status, "lock-failed");
  assert.deepEqual(f4.log, []);
});

test("scratch deploy dir: an upload that lands in the running build AFTER the first carry and before the stop is still in the older build after a rollback", async () => {
  const dd = scratch();
  const B = keptBuild(dd, "1.0.0+bbbbbbb", { "examples/orders/openapi.json": '{"v":"B"}' });
  const Adir = keptBuild(dd, "1.0.0+aaaaaaa", { "examples/orders/openapi.json": '{"v":"A"}' });
  put(B, "examples/orders/openapi.json", '{"v":"first upload"}'); // before the rollback starts
  const releases = { "1.0.0+aaaaaaa": { version: "1.0.0+aaaaaaa", hash: "a".repeat(40), previousVersion: null }, "1.0.0+bbbbbbb": { version: "1.0.0+bbbbbbb", hash: "b".repeat(40), previousVersion: "1.0.0+aaaaaaa" } };
  const w = lockedWorld({ tree: V2, state: { current: "1.0.0+bbbbbbb", pinnedHash: null }, releases });
  w.d.carryContracts = async (from, to) => carryUserContracts(path.join(dd, from), path.join(dd, to));
  // the in-flight upload: it reaches the still-running server between the first carry and its stop
  const stop = w.d.stop;
  w.d.stop = async (h) => { if (!h) put(B, "examples/orders/openapi.json", '{"v":"in flight"}'); return stop(h); };
  const r = await rollback(w.d, { port: 4200 });
  assert.equal(r.status, "rolled-back");
  assert.equal(read(Adir, "examples/orders/openapi.json"), '{"v":"in flight"}', "the second copy caught it");
  // without the re-carry (the old behaviour) it would have been lost: prove the scenario is real
  put(Adir, "examples/orders/openapi.json", '{"v":"A"}');
  put(B, "examples/orders/openapi.json", '{"v":"first upload"}');
  const once = lockedWorld({ tree: V2, state: { current: "1.0.0+bbbbbbb", pinnedHash: null }, releases });
  let calls = 0;
  once.d.carryContracts = async (from, to) => (++calls === 1 ? carryUserContracts(path.join(dd, from), path.join(dd, to)) : []);
  once.d.stop = async (h) => { if (!h) put(B, "examples/orders/openapi.json", '{"v":"lost without a re-carry"}'); };
  await rollback(once.d, { port: 4200 });
  assert.equal(read(Adir, "examples/orders/openapi.json"), '{"v":"first upload"}', "one carry alone misses the in-flight upload");
});

test("scratch deploy dir: the first redeploy over a build with no openapi entries in its manifest keeps the new build's shipped contracts, with the lock held", async () => {
  const dd = scratch();
  keptBuild(dd, V1.version, { "examples/orders/feature.json": "{}", "examples/orders/page.jsx": "<div/>" }); // shipped before contracts existed
  const w = lockedWorld({ tree: V2, state: { current: V1.version, pinnedHash: null } });
  w.d.buildRelease = async ({ info, previous }) => { // what the script does: a new folder with the shipped contracts, then the carry
    const next = path.join(dd, info.version);
    put(next, "examples/orders/feature.json", "{}");
    put(next, "examples/orders/openapi.json", '{"shipped":"new"}');
    put(next, "examples/deals/openapi.yaml", "shipped: new\n");
    w.log.push(`build-carry ${JSON.stringify(carryUserContracts(path.join(dd, previous), next))}`);
    w.releases[info.version] = info;
  };
  w.d.carryContracts = async (from, to) => carryUserContracts(path.join(dd, from), path.join(dd, to));
  const r = await deploy(w.d, { port: 4200 });
  assert.equal(r.status, "deployed");
  assert.ok(w.log.includes("build-carry []"), "nothing counted as a user change");
  assert.equal(read(path.join(dd, V2.version), "examples/orders/openapi.json"), '{"shipped":"new"}');
  assert.equal(read(path.join(dd, V2.version), "examples/deals/openapi.yaml"), "shipped: new\n");
  assert.ok(w.log.indexOf("lock") < w.log.findIndex((x) => x.startsWith("build-carry")));
});
