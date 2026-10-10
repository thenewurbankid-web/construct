#!/usr/bin/env node
// Stage: the last stable RELEASE, running on its own port (default 4300), next to dev (deploy/, port 4200).
//   node scripts/stage.mjs promote   copy dev's running build to stage if it is a newer release with 0 failing tests
//   node scripts/stage.mjs status    what stage runs, and whether dev has something newer
//   node scripts/stage.mjs watch     promote now, then check every 60 s (for the LaunchAgent)
//   node scripts/stage.mjs stop      stop the stage server
// Dev = the last build that passed `npm test` (deploy-local.mjs watch). Stage never builds from source: it takes the
// exact build dev is running (same folder, same hash), so what stage runs was already tested and health-checked on dev.
// Owner decision 2026-09-28. Everything lives under deploy-stage/ (not part of the build's allow-list).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareReleaseIds } from "../src/changelog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devDir = path.join(root, "deploy");
const stageDir = path.join(root, "deploy-stage");
const port = Number(process.env.TRACE_STAGE_PORT ?? 4300);
const pidFile = path.join(stageDir, "server.pid");
const logFile = path.join(stageDir, "server.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const devInfo = () => { const s = readJson(path.join(devDir, "state.json")); return s?.current ? readJson(path.join(devDir, s.current, "build-info.json")) : null; };
const stageState = () => readJson(path.join(stageDir, "state.json")) ?? {};
const stageInfo = () => { const s = stageState(); return s.current ? readJson(path.join(stageDir, s.current, "build-info.json")) : null; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ours = (pid) => { try { return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(stageDir); } catch { return false; } };
const stable = (b) => !!b?.release && /^R\d+(\.\d+)?$/.test(b.release) && (b.tests?.fail ?? 1) === 0;

async function health(hash) {
  for (let i = 0; i < 50; i++) {
    try {
      const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      if (h?.ok && (!hash || h.hash === hash)) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  return false;
}

async function stop() {
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8") : 0);
  if (pid && alive(pid) && ours(pid)) {
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  fs.rmSync(pidFile, { force: true });
}

function start(version) {
  const dir = path.join(stageDir, version);
  fs.mkdirSync(path.join(stageDir, "state", "demo-app-src"), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} start ${version} on ${port} ---\n`);
  const child = spawn(process.execPath, [path.join(dir, "src", "server.mjs"), "--port", String(port), "--no-open", "--strict-port", "--out", path.join(stageDir, "state", "demo-app-src")], { cwd: dir, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  fs.closeSync(fd);
  fs.writeFileSync(pidFile, String(child.pid));
}

async function ensureRunning() {
  const s = stageState();
  if (!s.current) return;
  const info = stageInfo();
  if (await health(info?.hash).then((ok) => ok, () => false)) return;
  console.log(`${now()} stage ${s.current} not answering; starting it`);
  await stop();
  start(s.current);
  if (!(await health(info?.hash))) console.log(`${now()} stage ${s.current} failed to start; see deploy-stage/server.log`);
}

async function promote() {
  const dev = devInfo(), cur = stageInfo();
  if (!stable(dev)) { console.log(`${now()} dev ${dev?.version ?? "none"} (${dev?.release ?? "no release"}) is not a stable release; stage unchanged`); return ensureRunning(); }
  if (cur && compareReleaseIds(dev.release, cur.release) <= 0) { console.log(`${now()} stage already on ${cur.release} (${cur.version}); dev is ${dev.release}`); return ensureRunning(); }
  const src = path.join(devDir, dev.version), dest = path.join(stageDir, dev.version), tmp = `${dest}.tmp`;
  fs.mkdirSync(stageDir, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(src, tmp, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  const previous = stageState().current ?? null;
  await stop();
  start(dev.version);
  if (!(await health(dev.hash))) {
    console.log(`${now()} ${dev.release} (${dev.version}) unhealthy on stage; rolling back to ${previous ?? "nothing"}`);
    await stop();
    fs.rmSync(dest, { recursive: true, force: true });
    if (previous) { start(previous); await health(); }
    fs.writeFileSync(path.join(stageDir, "LAST-FAILURE.txt"), `${new Date().toISOString()} ${dev.version} failed its health check on stage\n`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(path.join(stageDir, "state.json"), JSON.stringify({ current: dev.version, release: dev.release, previous, port, promotedAt: new Date().toISOString() }, null, 2) + "\n");
  fs.rmSync(path.join(stageDir, "LAST-FAILURE.txt"), { force: true });
  // keep the running build and the one before it
  for (const d of fs.readdirSync(stageDir)) if (/^\d+\.\d+\.\d+\+/.test(d) && ![dev.version, previous].includes(d)) fs.rmSync(path.join(stageDir, d), { recursive: true, force: true });
  console.log(`${now()} stage promoted to ${dev.release} (${dev.version}) on http://localhost:${port}`);
}

async function status() {
  const s = stageState(), cur = stageInfo(), dev = devInfo();
  const up = cur ? await health(cur.hash).catch(() => false) : false;
  console.log(`stage: ${cur ? `${cur.release} (${cur.version}), promoted ${s.promotedAt}` : "empty"} · port ${port} · ${up ? "healthy" : "NOT answering"}`);
  console.log(`dev:   ${dev ? `${dev.release} (${dev.version}), tests ${dev.tests?.pass}/${dev.tests?.total} pass, ${dev.tests?.fail} fail` : "not deployed"}`);
  if (dev && stable(dev) && (!cur || compareReleaseIds(dev.release, cur.release) > 0)) console.log("dev has a newer stable release: run `node scripts/stage.mjs promote`");
  process.exitCode = up ? 0 : 1;
}

const cmd = process.argv[2] ?? "status";
if (cmd === "promote") await promote();
else if (cmd === "status") await status();
else if (cmd === "stop") await stop();
else if (cmd === "watch") { for (;;) { try { await promote(); } catch (e) { console.log(`${now()} error: ${e.message}`); } await sleep(60000); } }
else { console.error("usage: stage.mjs promote|status|watch|stop"); process.exitCode = 2; }
