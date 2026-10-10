// The contract-upload lock: an upload that arrives while a deploy or rollback switches builds waits (503 + Retry-After) instead of
// being written into the build that is about to stop. Fakes and scratch dirs only; the one server test copies src/ into a scratch
// `deploy/<version>/` and never touches the real deploy dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LOCK_NAME, MAX_AGE_MS, RETRY_AFTER_SEC, answerIfContractsLocked, deployDirOf, lockContracts, readContractsLock } from "./contracts-lock.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "trace-lock-"));
const fakeRes = () => { const r = { code: null, headers: null, body: null, ended: false, writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b; r.ended = true; } }; return r; };

test("deployDirOf: only a server running from deploy/<version> has a deploy dir to lock against", () => {
  assert.equal(deployDirOf("/x/deploy/1.0.0+abc"), "/x/deploy");
  assert.equal(deployDirOf("/x/project"), null, "a dev checkout");
  assert.equal(deployDirOf("/x/deployment/1.0.0"), null);
});

test("lock: taken, visible, released; releasing twice or after another holder took over removes nothing of theirs", () => {
  const dd = scratch();
  assert.equal(readContractsLock(dd), null);
  const release = lockContracts(dd);
  const l = readContractsLock(dd);
  assert.equal(l.pid, process.pid);
  assert.ok(fs.existsSync(path.join(dd, LOCK_NAME)));
  release();
  assert.equal(readContractsLock(dd), null);
  release(); // twice: no error
  // another holder wrote the file after this holder's lock went stale: the old holder's release must not delete it
  const r1 = lockContracts(dd, { pid: 111, alive: () => true });
  fs.writeFileSync(path.join(dd, LOCK_NAME), JSON.stringify({ pid: 222, at: Date.now() }));
  r1();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dd, LOCK_NAME), "utf8")).pid, 222);
});

test("lock: a live lock of another holder refuses a second one; a dead, expired or unreadable lock is ignored and replaced", () => {
  const dd = scratch();
  let t = 1_000_000;
  const opts = { now: () => t, alive: () => true };
  lockContracts(dd, { ...opts, pid: 111 });
  assert.throws(() => lockContracts(dd, { ...opts, pid: 222 }), /held by pid 111/);
  assert.deepEqual(readContractsLock(dd, opts), { pid: 111, at: 1_000_000 });
  assert.equal(readContractsLock(dd, { ...opts, alive: () => false }), null, "the holder is gone (a crashed deploy)");
  t += MAX_AGE_MS + 1;
  assert.equal(readContractsLock(dd, opts), null, "expired: a deploy never takes this long");
  lockContracts(dd, { ...opts, pid: 222 }); // replaces the expired one
  assert.equal(readContractsLock(dd, opts).pid, 222);
  for (const junk of ["", "{ nope", "[]", '{"pid":"x","at":1}', '{"pid":1}', "null"]) {
    fs.writeFileSync(path.join(dd, LOCK_NAME), junk);
    assert.equal(readContractsLock(dd, opts), null, `unreadable lock ${JSON.stringify(junk)} blocks nothing`);
  }
  assert.equal(readContractsLock(null), null, "no deploy dir");
  assert.equal(readContractsLock(path.join(dd, "missing")), null);
});

test("answerIfContractsLocked: 503 with Retry-After for the two contract writes while locked; nothing else is touched", () => {
  const dd = scratch();
  const res0 = fakeRes();
  assert.equal(answerIfContractsLocked("POST", "/api/openapi", res0, dd), false, "no lock, no answer");
  assert.equal(res0.ended, false);
  lockContracts(dd);
  for (const [m, p] of [["POST", "/api/openapi"], ["POST", "/api/demo/apply-fix"], ["post", "/api/openapi"]]) {
    const res = fakeRes();
    assert.equal(answerIfContractsLocked(m, p, res, dd), true, `${m} ${p}`);
    assert.equal(res.code, 503);
    assert.equal(res.headers["retry-after"], String(RETRY_AFTER_SEC));
    assert.match(JSON.parse(res.body).error, /Try again/);
  }
  for (const [m, p] of [["GET", "/api/contract"], ["GET", "/api/openapi"], ["POST", "/api/answer"], ["POST", "/api/run"], ["GET", "/api/health"], ["POST", "/api/openapi/x"]]) {
    const res = fakeRes();
    assert.equal(answerIfContractsLocked(m, p, res, dd), false, `${m} ${p} must not be blocked`);
    assert.equal(res.ended, false);
  }
  assert.equal(answerIfContractsLocked("POST", "/api/openapi", fakeRes(), null), false, "a dev checkout has no deploy dir and no lock");
});

// ---- the real server, running from a scratch deploy/<version> ----
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const request = (port, method, p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: t }));
  });
  r.on("error", reject); r.end(body);
});

test("the running server answers a contract upload with 503 while the lock is held, and saves it again once the lock is gone", async () => {
  const dd = path.join(scratch(), "deploy"), build = path.join(dd, "1.0.0+test000");
  fs.cpSync(path.join(root, "src"), path.join(build, "src"), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(build, "package.json"));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(build, "node_modules"));
  fs.mkdirSync(path.join(build, "examples", "products"), { recursive: true });
  for (const f of ["feature.json", "openapi.json", "page.jsx", "story.md"]) if (fs.existsSync(path.join(root, "examples", "products", f))) fs.copyFileSync(path.join(root, "examples", "products", f), path.join(build, "examples", "products", f));
  const before = fs.readFileSync(path.join(build, "examples", "products", "openapi.json"), "utf8");
  const port = await freePort();
  let log = "";
  const child = spawn(process.execPath, [path.join(build, "src", "server.mjs"), "--port", String(port), "--strict-port", "--no-open", "--out", path.join(dd, "out")], { cwd: build, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await request(port, "GET", "/api/health")).status === 200; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(up, "the scratch server started:\n" + log);
    const doc = JSON.stringify({ openapi: "3.0.0", info: { title: "uploaded" }, paths: { "/api/products": { get: { responses: { 200: { description: "ok", content: { "application/json": { example: [{ id: 1, name: "a" }] } } } } } } } });
    const upload = () => request(port, "POST", "/api/openapi?example=products", JSON.stringify({ name: "x.json", text: doc }));

    const release = lockContracts(dd); // this test process is the holder, and it is alive
    const blocked = await upload();
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers["retry-after"], String(RETRY_AFTER_SEC));
    assert.match(JSON.parse(blocked.text).error, /Try again/);
    assert.equal(fs.readFileSync(path.join(build, "examples", "products", "openapi.json"), "utf8"), before, "nothing was written while locked");
    assert.equal((await request(port, "GET", "/api/contract?example=products")).status, 200, "reads keep working");
    assert.equal((await request(port, "GET", "/api/health")).status, 200);

    release();
    const ok = await upload();
    assert.equal(ok.status, 200, ok.text);
    assert.notEqual(fs.readFileSync(path.join(build, "examples", "products", "openapi.json"), "utf8"), before, "saved once the lock is released");
  } finally { child.kill(); }
});
