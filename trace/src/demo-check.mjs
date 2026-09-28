#!/usr/bin/env node
// Preflight for the demo: run it before going on stage (`npm run demo:check`; `npm run demo` runs it first).
// Anything that would embarrass a live demo is a FAIL (exit 1): missing files, a busy port, a scenario that errors or
// drifts from the numbers in docs/DEMO.md. Things that only reduce the demo are a WARN: the helper for Suggest not
// running (the demo works completely without it), a Ledger left over from an earlier take.
//
//   node src/demo-check.mjs [--port 4177]
// A busy port is only a WARN: the server (without --strict-port) moves to the next free port and prints its address.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.mjs";
import { resetExample } from "./reset.mjs";
import { saveContract } from "./contract.mjs";
import { suggestReady, scenarioStatus } from "./demo-server.mjs";
import { SCENARIOS } from "./ui/scenarios.mjs";
import { summarize, headline, PRODUCT } from "./ui/vocab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const examplesDir = path.join(root, "examples");
const args = process.argv.slice(2);
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : process.env.PORT ?? 4177);

const rows = [];
const add = (level, name, detail = "") => rows.push({ level, name, detail });

// ---------- checks ----------
const major = Number(process.versions.node.split(".")[0]);
add(major >= 20 ? "PASS" : "FAIL", "Node version", major >= 20 ? `v${process.versions.node}` : `v${process.versions.node}: needs 20 or newer`);

add(fs.existsSync(path.join(root, "node_modules", "@babel", "parser")) ? "PASS" : "FAIL", "Dependencies installed", "run npm install if this fails");

const shell = ["demo.html", "demo.mjs", "demo.css", "demo-tokens.css", "vocab.mjs", "scenarios.mjs", "icons.mjs", "wire-delay.mjs", "thumb.mjs", "assets/trace-mark.svg", "assets/trace-favicon.svg"];
const missingShell = shell.filter((f) => !fs.existsSync(path.join(here, "ui", f)));
add(missingShell.length ? "FAIL" : "PASS", `${PRODUCT.name} shell files`, missingShell.length ? `missing: ${missingShell.join(", ")}` : `${shell.length} files`);

for (const s of SCENARIOS) {
  const dir = path.join(examplesDir, s.example);
  const need = ["feature.json", "openapi.json", "page.jsx", ...(s.fix ? [s.fix] : [])];
  const missing = need.filter((f) => !fs.existsSync(path.join(dir, f)));
  let parsed = missing.length ? "" : "ok";
  if (!missing.length) for (const f of need.filter((f) => f.endsWith(".json"))) { try { JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { parsed = `${f} is not valid JSON`; } }
  add(missing.length || parsed !== "ok" ? "FAIL" : "PASS", `Scenario files: ${s.title}`, missing.length ? `examples/${s.example} is missing ${missing.join(", ")}` : parsed === "ok" ? `examples/${s.example}` : parsed);
}

// The server takes the first free port from `port` up (server.mjs tries 10 in a row), so a busy 4177 is not a failure: the
// preflight names the port the server will really use. Only "no port free at all" (or another error) is a FAIL.
const tryPort = (p) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once("error", (e) => resolve(e.code === "EADDRINUSE" ? "busy" : e.message));
  probe.once("listening", () => probe.close(() => resolve("free")));
  probe.listen(p, "127.0.0.1");
});
{
  let use = null, problem = null;
  for (let p = port; p <= port + 10 && use === null; p++) {
    const r = await tryPort(p);
    if (r === "free") use = p; else if (r !== "busy") { problem = r; break; }
  }
  if (use === port) add("PASS", `Port ${port} is free`);
  else if (use !== null) add("WARN", `Port ${port} is busy`, `something else is listening there. The server will use ${use} instead (watch its first line for the address)`);
  else add("FAIL", `A port from ${port} to ${port + 10} is free`, problem ?? "all are busy. Stop what is using them");
}

// Suggest is optional: with it off the demo runs completely, every Ask is answered with a click.
const suggestOk = await suggestReady();
add(suggestOk ? "PASS" : "WARN", "Suggest helper reachable", suggestOk ? "" : "not running. That is fine: the demo works completely without it (turn Suggest off, or leave it unavailable)");

for (const st of scenarioStatus(examplesDir)) {
  if (st.ledger) add("WARN", `Clean Ledger (${st.id})`, `${st.ledger} saved decision${st.ledger === 1 ? "" : "s"} from an earlier take: Wire it will not ask about those. Use Reset demo for a clean take`);
  if (st.fixed) add("WARN", `Original contract (${st.id})`, "the prepared fix is already applied. Use Reset demo to undo it");
}

// Each scenario, end to end, in a scratch copy, with every Ask skipped (what a run with no answers does). The numbers are the
// ones docs/DEMO.md promises; a drift means the script needs updating.
async function runScenario(s, { fixed = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-check-"));
  const dir = path.join(tmp, s.example);
  fs.cpSync(path.join(examplesDir, s.example), dir, { recursive: true });
  resetExample(dir); // the scratch copy starts clean, whatever state an earlier take left in examples/
  if (fixed) saveContract(dir, fs.readFileSync(path.join(dir, s.fix), "utf8")); // what "Backend ships the fix" does
  let tree = null, items = [], error = null;
  try {
    await runPipeline({ dir, outRoot: path.join(tmp, "out"), useSaved: false, auto: true, emit: (type, d) => { if (type === "tree") tree = d.tree; if (type === "items") items = d.items; } });
  } catch (e) { error = e.message; }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (error) return { error };
  const sum = summarize(tree, { items: Object.fromEntries(items.map((i) => [i.id, i])) });
  return { sum };
}
for (const s of SCENARIOS) {
  const r = await runScenario(s);
  if (r.error) { add("FAIL", `Run: ${s.title}`, r.error); continue; }
  const ok = r.sum.total === s.expect.total && r.sum.fit === s.expect.fit;
  add(ok ? "PASS" : "FAIL", `Run: ${s.title}`, ok ? headline(r.sum) : `${headline(r.sum)}, but docs/DEMO.md and scenarios.mjs say ${s.expect.fit} of ${s.expect.total}`);
  if (s.fix) {
    const f = await runScenario(s, { fixed: true });
    const closed = !f.error && f.sum.needHuman === 0;
    add(closed ? "PASS" : "FAIL", `Run after the fix: ${s.title}`, f.error ?? (closed ? headline(f.sum) : `${headline(f.sum)}: the fix should close everything`));
  }
}

// ---------- report ----------
const width = Math.max(...rows.map((r) => r.name.length));
console.log(`\n${PRODUCT.name} demo preflight\n`);
for (const r of rows) console.log(`  ${r.level.padEnd(4)}  ${r.name.padEnd(width)}${r.detail ? `  ${r.detail}` : ""}`);
const fails = rows.filter((r) => r.level === "FAIL").length, warns = rows.filter((r) => r.level === "WARN").length;
console.log(`\n${fails ? `NOT READY: ${fails} problem${fails === 1 ? "" : "s"} to fix before you present.` : `READY.${warns ? ` ${warns} warning${warns === 1 ? "" : "s"}, none of them blocking.` : ""}`}\n`);
process.exit(fails ? 1 : 0);
