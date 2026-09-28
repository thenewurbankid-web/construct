import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aboutPayload, createBuildContext, handleBuildRoute, loadRunningBuild } from "./build-routes.mjs";

const fakeRes = () => { const r = { code: null, headers: null, body: "", writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b; } }; return r; };
const call = (p, ctx) => { const res = fakeRes(); const handled = handleBuildRoute(p, res, ctx); return { handled, res, json: () => JSON.parse(res.body) }; };

const INFO = (v, hash, extra = {}) => ({ name: "Trace", version: `1.0.0+${v}`, release: "R0", hash, files: 3, builtAt: "2026-09-27T10:00:00.000Z", tests: { total: 5, pass: 5, fail: 0, todo: 0 }, ...extra });

// a fake deployed layout: <tmp>/deploy/<version>/{build-info.json,CHANGELOG.md}, <tmp>/deploy/state.json
function deployed() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trace-routes-")), dd = path.join(base, "deploy");
  const mk = (v, info) => { fs.mkdirSync(path.join(dd, `1.0.0+${v}`), { recursive: true }); fs.writeFileSync(path.join(dd, `1.0.0+${v}`, "build-info.json"), JSON.stringify(info)); };
  mk("aaaaaaa", INFO("aaaaaaa", "a".repeat(40), { builtAt: "2026-09-26T10:00:00.000Z" }));
  mk("bbbbbbb", INFO("bbbbbbb", "b".repeat(40), { previousVersion: "1.0.0+aaaaaaa", changesSincePrevious: { added: ["x"], modified: [], removed: [], counts: { added: 1, modified: 0, removed: 0 }, truncated: { added: 0, modified: 0, removed: 0 } } }));
  fs.writeFileSync(path.join(dd, "state.json"), JSON.stringify({ current: "1.0.0+bbbbbbb", pinnedHash: null }));
  const root = path.join(dd, "1.0.0+bbbbbbb");
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), "## R0 — 2026-09-27\n- feat: first\n");
  return root;
}

test("/api/health answers for the deploy script's health check", () => {
  const ctx = createBuildContext({ root: deployed() });
  const { handled, res, json } = call("/api/health", ctx);
  assert.equal(handled, true);
  assert.equal(res.code, 200);
  assert.deepEqual(json(), { app: "trace", hash: "b".repeat(40), ok: true, pid: process.pid, version: "1.0.0+bbbbbbb" });
});

test("/api/build returns the running build's info from build-info.json, without the long file lists", () => {
  const ctx = createBuildContext({ root: deployed() });
  const b = call("/api/build", ctx).json();
  assert.equal(b.version, "1.0.0+bbbbbbb");
  assert.equal(b.hash, "b".repeat(40));
  assert.equal(b.release, "R0");
  assert.equal(b.builtAt, "2026-09-27T10:00:00.000Z");
  assert.equal(b.dev, undefined);
  assert.equal("changesSincePrevious" in b, false);
});

test("a dev checkout without build-info.json is computed live and marked dev", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-dev-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "9.9.9" }));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.mjs"), "1");
  const b = call("/api/build", createBuildContext({ root: dir })).json();
  assert.equal(b.dev, true);
  assert.equal(b.builtAt, null);
  assert.match(b.version, /^9\.9\.9\+[0-9a-f]{7}$/);
  assert.equal(loadRunningBuild(dir).hash, b.hash);
});

test("/api/about has everything the About page needs", () => {
  let t = 1_000_000;
  const ctx = createBuildContext({ root: deployed(), getPort: () => 4200, now: () => t });
  t += 125_000;
  const a = call("/api/about", ctx).json();
  assert.deepEqual(Object.keys(a).sort(), ["build", "changelog", "changesSincePrevious", "history", "node", "port", "previousVersion", "tests", "uptimeSec"]);
  assert.equal(a.build.version, "1.0.0+bbbbbbb");
  assert.equal(a.port, 4200);
  assert.equal(a.node, process.version);
  assert.equal(a.uptimeSec, 125);
  assert.deepEqual(a.tests, { total: 5, pass: 5, fail: 0, todo: 0 });
  assert.equal(a.changelog.releases[0].id, "R0");
  assert.equal(a.changelog.releases[0].items[0].kind, "feat");
  assert.equal(a.previousVersion, "1.0.0+aaaaaaa");
  assert.deepEqual(a.changesSincePrevious.counts, { added: 1, modified: 0, removed: 0 });
  assert.deepEqual(a.history.map((h) => [h.version, h.current, h.rollbackAvailable]), [["1.0.0+bbbbbbb", true, false], ["1.0.0+aaaaaaa", false, true]]);
  assert.equal(a.history[0].deployedAt, "2026-09-27T10:00:00.000Z");
});

test("/api/about in a dev checkout has no history and no deploy-time tests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-dev-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
  const a = aboutPayload(createBuildContext({ root: dir }));
  assert.deepEqual(a.history, []);
  assert.equal(a.tests, null);
  assert.deepEqual(a.changelog, { releases: [], ignored: 0 });
  assert.equal(a.build.dev, true);
});

test("the About page, its modules and the docs are served; unknown paths are left to the server", () => {
  const ctx = createBuildContext({ root: deployed() });
  const about = call("/about", ctx);
  assert.equal(about.res.code, 200);
  assert.match(about.res.headers["content-type"], /text\/html/);
  assert.match(about.res.body, /mountAbout/);
  for (const m of ["/ui/about.mjs", "/ui/build-badge.mjs"]) {
    const r = call(m, ctx);
    assert.equal(r.res.code, 200);
    assert.match(r.res.headers["content-type"], /javascript/);
  }
  assert.equal(call("/doc/CHANGELOG.md", ctx).res.code, 200);
  assert.equal(call("/doc/README.md", ctx).res.code, 404); // this fake build has no README
  assert.equal(call("/api/examples", ctx).handled, false);
  assert.equal(call("/doc/../../etc/passwd", ctx).handled, false); // only the three whitelisted docs
});
