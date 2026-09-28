#!/usr/bin/env node
// Keep the latest build of Trace running locally on a fixed port (default 4200; the dev server uses 4177).
//
//   npm run deploy:local       test, copy to deploy/<version>/, health-check, switch, restart, verify (rolls back on failure)
//   npm run deploy:status      what is running, since when, on which port, and whether it answers
//   npm run deploy:stop        stop the server (the build stays; deploy:local starts it again)
//   npm run deploy:watch       redeploy when the source tree changes (20 s of quiet) and the tests pass
//   npm run deploy:rollback    go back to the build that ran before the current one
//   options: --port <n> (or env TRACE_DEPLOY_PORT), --quiet-ms <n> for the watcher
//
// The decisions live in src/deploy/deploy.mjs and are unit-tested; this file only supplies the real effects.
// Layout under deploy/ (git-ignored): <version>/ (one per kept build), current -> <version>, state.json, server.pid,
// server.log, LAST-FAILURE.txt, state/ (generated output of the running app, kept across deploys).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildManifest, computeBuildInfo, isDeployable, sortedJson, STATE_FILES, carryUserContracts } from "../src/build-info.mjs";
import { deploy, rollback, parseTestSummary, createWatchController } from "../src/deploy/deploy.mjs";
import { copyProductionModules } from "../src/deploy/prod-modules.mjs";
import { lockContracts } from "../src/deploy/contracts-lock.mjs";
import { listReleases, readBuildInfo, readManifest, readState, versionsToPrune } from "../src/deploy/releases.mjs";
import { relativeTime } from "../src/ui/build-badge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = path.join(root, "deploy");
const pidFile = path.join(deployDir, "server.pid");
const logFile = path.join(deployDir, "server.log");
const failFile = path.join(deployDir, "LAST-FAILURE.txt");
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "local";
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(opt("--port", process.env.TRACE_DEPLOY_PORT ?? 4200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = "") => console.log(s);

// ---------- small process and network helpers ----------
const readPid = () => { try { const n = Number(fs.readFileSync(pidFile, "utf8")); return n > 0 ? n : null; } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// pids get reused: only treat a pid as ours when it is alive and its command line points into deploy/
function isOurs(pid) {
  if (!pid || !alive(pid)) return false;
  try { return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(deployDir); } catch { return false; }
}
const getJson = async (p, route, ms = 2000) => {
  try { const r = await fetch(`http://127.0.0.1:${p}${route}`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; }
};
const connectable = (p) => new Promise((resolve) => {
  const s = net.connect(p, "127.0.0.1");
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// ---------- the real effects, in the shape src/deploy/deploy.mjs expects ----------
const real = {
  async computeState() {
    const manifest = buildManifest(root);
    return { info: computeBuildInfo(root, { manifest }), manifest };
  },
  readState: async () => readState(deployDir),
  async writeState(s) {
    fs.mkdirSync(deployDir, { recursive: true });
    fs.writeFileSync(path.join(deployDir, "state.json"), sortedJson({ ...s, port }));
  },
  hasRelease: async (v) => fs.existsSync(path.join(deployDir, v, "build-info.json")),
  readManifest: async (v) => readManifest(deployDir, v),
  readBuildInfo: async (v) => readBuildInfo(deployDir, v),
  now: () => new Date().toISOString(),
  pickFreePort: freePort,

  async portStatus(p) {
    if (!(await connectable(p))) return { state: "free" };
    const h = await getJson(p, "/api/health");
    const pid = readPid();
    if (h && pid && h.pid === pid && isOurs(pid)) return { state: "ours" };
    return { state: "foreign", by: h?.app === "trace" ? `another Trace server (pid ${h.pid}) that deploy:local did not start` : "another program" };
  },

  async runTests() {
    out("Running npm test ...");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const text = await new Promise((resolve) => {
      const child = spawn("npm", ["test"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      child.stdout.on("data", (c) => (buf += c));
      child.stderr.on("data", (c) => (buf += c));
      child.on("close", (code) => resolve({ code, buf }));
    });
    const summary = parseTestSummary(text.buf);
    if (summary) out(`  ${summary.pass} passed, ${summary.fail} failed, ${summary.todo} todo (${summary.total} tests)`);
    return { ok: text.code === 0, summary, tail: text.buf.split("\n").slice(-60).join("\n") };
  },

  // A verified copy: the manifest was taken a moment ago, so re-hash the copy and refuse if a file changed in between.
  async buildRelease({ info, manifest, previous }) {
    const dest = path.join(deployDir, info.version), tmp = `${dest}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const rel of Object.keys(manifest)) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(path.join(root, rel), path.join(tmp, rel));
    }
    const copied = buildManifest(tmp);
    if (JSON.stringify(copied) !== JSON.stringify(manifest)) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error("The source changed while it was being copied. Run the deploy again."); }
    // The production set of node_modules (package-lock.json marks the dev-only packages: esbuild and three, which only
    // `npm run build:hero` needs). Copied, not linked, so a later `npm install` in the source cannot change a build that is running.
    copyProductionModules(path.join(root, "node_modules"), path.join(tmp, "node_modules"), path.join(root, "package-lock.json"));
    // Saved answers, AI decisions and caches belong to the running app, not to a build: seed them from the source
    // examples, then let the previous build's copy win so nothing done in the app is lost by a redeploy.
    for (const from of [path.join(root, "examples"), previous ? path.join(deployDir, previous, "examples") : null].filter(Boolean)) {
      if (!fs.existsSync(from)) continue;
      for (const ex of fs.readdirSync(from, { withFileTypes: true }).filter((e) => e.isDirectory())) {
        if (!fs.existsSync(path.join(tmp, "examples", ex.name))) continue;
        for (const f of STATE_FILES) { const src = path.join(from, ex.name, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, "examples", ex.name, f)); }
      }
    }
    // An example's openapi.* is source (it came in with the manifest above): the new build's copy stands, unless the running app's
    // copy was changed or uploaded there, in which case that one is kept (and is the only openapi file the example has).
    if (previous) carryUserContracts(path.join(deployDir, previous), tmp);
    fs.mkdirSync(path.join(deployDir, "state", "demo-app-src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "build-info.json"), sortedJson(info));
    fs.writeFileSync(path.join(tmp, "manifest.json"), sortedJson(manifest));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  },
  // rollback: the running build's uploaded contracts go into the build it goes back to (see rollback() in src/deploy/deploy.mjs)
  carryContracts: async (from, to) => carryUserContracts(path.join(deployDir, from), path.join(deployDir, to)),
  // uploads to the running server answer 503 while a deploy or rollback switches builds (src/deploy/contracts-lock.mjs); returns release()
  lockContracts: async () => lockContracts(deployDir),
  removeRelease: async (v) => fs.rmSync(path.join(deployDir, v), { recursive: true, force: true }),
  pruneCandidates: async ({ current, previous }) => versionsToPrune(listReleases(deployDir, { current }), { current, previous, keep: 3 }),

  async switchCurrent(v) { // atomic: build the new link beside the old one, then rename over it
    const tmp = path.join(deployDir, `current.${process.pid}.tmp`);
    fs.rmSync(tmp, { force: true });
    fs.symlinkSync(v, tmp);
    fs.renameSync(tmp, path.join(deployDir, "current"));
  },

  async start({ version, port: p, temp = false }) {
    const dir = path.join(deployDir, version);
    const fd = fs.openSync(logFile, "a");
    fs.writeSync(fd, `\n--- ${new Date().toISOString()} start ${version} on ${p}${temp ? " (health check)" : ""} ---\n`);
    const child = spawn(process.execPath, [path.join(dir, "src", "server.mjs"), "--port", String(p), "--no-open", "--strict-port", "--out", path.join(deployDir, "state", "demo-app-src")], {
      cwd: dir, detached: true, stdio: ["ignore", fd, fd],
    });
    child.unref();
    fs.closeSync(fd);
    if (!temp) fs.writeFileSync(pidFile, String(child.pid));
    return { pid: child.pid };
  },
  async stop(handle) {
    const pid = handle?.pid ?? readPid();
    if (!pid) return;
    if (alive(pid) && (handle || isOurs(pid))) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
      if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } await sleep(200); }
    }
    if (!handle) fs.rmSync(pidFile, { force: true });
  },

  // healthy = answers /api/health and /api/build and reports the hash we expect, within 15 s
  async healthy(p, hash) {
    for (let i = 0; i < 50; i++) {
      const h = await getJson(p, "/api/health"), b = h && (await getJson(p, "/api/build"));
      if (h?.ok && b && (!hash || (h.hash === hash && b.hash === hash))) return true;
      await sleep(300);
    }
    return false;
  },

  async writeFailure(text) {
    fs.mkdirSync(deployDir, { recursive: true });
    fs.writeFileSync(failFile, `${new Date().toISOString()}\n${text}\n`);
  },
  clearFailure: async () => fs.rmSync(failFile, { force: true }),
};

// One deploy at a time (a manual run and the watcher could otherwise fight over the symlink and the port).
function withLock(fn) {
  const lock = path.join(deployDir, "deploy.lock");
  fs.mkdirSync(deployDir, { recursive: true });
  return async (...a) => {
    try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch {
      const other = Number(fs.readFileSync(lock, "utf8"));
      if (other && alive(other) && other !== process.pid) return { status: "busy", message: `Another deploy is running (pid ${other}).` };
      fs.writeFileSync(lock, String(process.pid));
    }
    try { return await fn(...a); } finally { fs.rmSync(lock, { force: true }); }
  };
}

const OK = new Set(["deployed", "unchanged", "started", "pinned", "rolled-back"]);
const finish = (r) => { out(r.message); process.exit(OK.has(r.status) ? 0 : 1); };

async function status() {
  const st = readState(deployDir), p = st.port ?? port;
  const info = st.current ? readBuildInfo(deployDir, st.current) : null;
  const pid = readPid(), running = isOurs(pid);
  const h = running ? await getJson(p, "/api/health") : null;
  const b = info?.builtAt ? info.builtAt : null;
  out("Trace local deploy");
  if (!info) out("  nothing deployed yet: run  npm run deploy:local");
  else {
    out(`  version   ${info.version}`);
    out(`  release   ${info.release ?? "none"}`);
    out(`  hash      ${info.hash}`);
    out(`  deployed  ${b ? `${new Date(b).toLocaleString()} (${relativeTime(Date.parse(b), Date.now())})` : "unknown"}`);
    if (info.tests) out(`  tests     ${info.tests.pass} passed, ${info.tests.fail} failed, ${info.tests.todo} todo (${info.tests.total})`);
  }
  out(`  port      ${p}   http://localhost:${p}`);
  out(`  pid       ${pid ?? "none"}${pid ? (running ? " (running)" : " (not running)") : ""}`);
  out(`  health    ${h?.ok ? "ok" : "not responding"}${h && info && h.hash !== info.hash ? "  (WARNING: running hash differs from the current build)" : ""}`);
  out(`  log       ${path.relative(root, logFile)}`);
  if (fs.existsSync(failFile)) out(`  last failure  ${path.relative(root, failFile)}: ${fs.readFileSync(failFile, "utf8").split("\n").slice(0, 2).join(" ").trim()}`);
  if (st.pinnedHash) out("  note      rolled back on purpose: the watcher will not redeploy this tree until a file changes");
  const rel = listReleases(deployDir);
  if (rel.length) out(`  kept      ${rel.map((r) => r.version + (r.current ? " (current)" : "")).join(", ")}`);
  process.exit(info && h?.ok ? 0 : 1);
}

if (Number.isNaN(port) || port < 1 || port > 65535) { console.error(`Invalid port: ${opt("--port", process.env.TRACE_DEPLOY_PORT)}`); process.exit(2); }
if (port === 4177 && cmd !== "status") { console.error("Port 4177 is the dev server's port (npm start). Use another port for the deploy."); process.exit(2); }

if (cmd === "status") await status();
else if (cmd === "stop") {
  await real.stop();
  out(`Stopped the server on port ${port} (if one was running). The build is kept; npm run deploy:local starts it again.`);
} else if (cmd === "rollback") finish(await withLock(() => rollback(real, { port }))());
else if (cmd === "local") finish(await withLock(() => deploy(real, { port }))());
else if (cmd === "watch") {
  const run = withLock(() => deploy(real, { port, respectPin: true }));
  const stamp = (m) => out(`[${new Date().toLocaleTimeString()}] ${m}`);
  const ctrl = createWatchController({
    computeHash: () => computeBuildInfo(root, { builtAt: null }).hash,
    deploy: () => run(),
    quietMs: Number(opt("--quiet-ms", 20_000)),
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    isRelevant: (rel) => isDeployable(rel.split(path.sep).join("/")),
    log: stamp,
  });
  fs.watch(root, { recursive: true }, (_ev, file) => file && ctrl.onChange(String(file)));
  stamp(`watching ${root} (redeploys after ${Number(opt("--quiet-ms", 20_000)) / 1000} s without changes, only when the tests pass)`);
  ctrl.settleNow(); // make sure the latest build is running right now, not only after the next edit
  process.on("SIGTERM", () => process.exit(0));
} else { console.error(`Unknown command "${cmd}". Use: local | status | stop | watch | rollback`); process.exit(2); }
