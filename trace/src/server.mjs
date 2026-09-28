#!/usr/bin/env node
// Local web UI: load the examples, press Start, and watch the whole process on screen —
// extract → match → ask → plan → emit — while the tree grows. Questions are answered on the page.
//
//   npm start            (or: node src/server.mjs [--port 4177] [--strict-port] [--no-open] [--examples <dir>] [--out <dir>])
//
// Runs the same pipeline as the CLI and writes the generated code to demo-app/src/features/<feature>.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.mjs";
import { watchExample } from "./watch.mjs";
import { resetExample } from "./reset.mjs";
import { loadContract, CONTRACT_FILES } from "./contract.mjs";
import { contractRoute, contractFields } from "./contract-routes.mjs";
import { importWizardRoute } from "./import-wizard-routes.mjs";
import { renderPreview } from "./page-preview.mjs";
import { THEME_CSS } from "./tree/svg.mjs";
import { loadAiConfig, taskConfig, TASKS } from "./ai/config.mjs";
import { streamChat } from "./ai/provider.mjs";
import { createBuildContext, handleBuildRoute } from "./build-routes.mjs";
import { answerIfContractsLocked, deployDirOf } from "./deploy/contracts-lock.mjs";
import { demoRoute } from "./demo-server.mjs";
import { createInspectorRoutes } from "./inspector/routes.mjs";
import { createPagemapRoutes } from "./pagemap-routes.mjs";
import { checkRequest, readJsonBody, sendError, HttpError } from "./http-guard.mjs";
import { SYSTEM as MAIL_SYSTEM, modeOf, mailMessages, parseReply, tidy, checkDraft } from "./ai/mail-chat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const examplesDir = path.resolve(opt("--examples", path.join(root, "examples")));
const outRoot = path.resolve(opt("--out", path.join(root, "demo-app", "src")));
const basePort = Number(opt("--port", 4177));
const inspectorRoute = createInspectorRoutes({ examplesDir, outRoot }); // the Part inspector (src/inspector/routes.mjs)
const pagemapRoute = createPagemapRoutes({ examplesDir }); // the Page map (src/pagemap-routes.mjs)
const buildCtx = createBuildContext({ root, getPort: () => server.address()?.port ?? null });

const listExamples = () =>
  fs.readdirSync(examplesDir).filter((d) => fs.existsSync(path.join(examplesDir, d, "feature.json"))).sort().map((name) => {
    const spec = JSON.parse(fs.readFileSync(path.join(examplesDir, name, "feature.json"), "utf8"));
    return {
      name,
      feature: spec.feature,
      route: spec.route,
      about: spec.about ?? "",
      endpoints: loadContract(path.join(examplesDir, name)).apis.map((a) => `${a.method} ${a.path}`),
      ...contractFields(path.join(examplesDir, name)), // hasContract, contractFile, contractNotice, gaps
      hasAnswers: fs.existsSync(path.join(examplesDir, name, "answers.json")),
    };
  });

// ---------- runs ----------
const runs = new Map();
const live = new Set(); // clients of /api/live: told when a watcher starts a new run
const watchers = new Map(); // example -> { stop, active, dirty }
const broadcast = (o) => { for (const res of live) res.write(`data: ${JSON.stringify(o)}\n\n`); };

// auto: never ask — use saved answers and leave the rest open (this is also what watch mode runs).
function startRun(example, { useSaved = false, askAll = false, auto = false, ai = null } = {}) {
  const run = { id: randomUUID(), example, finished: false, events: [], clients: new Set(), waiting: null };
  runs.set(run.id, run);
  const w = watchers.get(example);
  if (w) { w.active++; w.seen.fp = readState(example).fp; }
  const push = (type, data) => {
    const ev = { type, data };
    run.events.push(ev);
    for (const res of run.clients) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  runPipeline({
    dir: path.join(examplesDir, example),
    outRoot,
    useSaved: useSaved || auto,
    askAll: askAll && !auto,
    auto,
    ai: isObj(ai) && (ai.enabled || ai.explain) ? { enabled: !!ai.enabled, explain: !!ai.explain, overrides: { tasks: ai.tasks ?? {} } } : null,
    pace: auto ? 150 : 450,
    emit: push,
    prompt: auto ? null : () => new Promise((resolve) => { run.waiting = resolve; }),
  })
    .then(({ files, base, open }) => push("done", { base: path.relative(root, base), files: Object.keys(files).length + 3, open: open.length }))
    .catch((err) => push("error", { message: err.message }))
    .finally(() => {
      run.finished = true;
      if (!w) return;
      w.active--;
      w.seen.ans = readState(example).ans;
      if (w.dirty && !w.active) { w.dirty = false; if (w.changed()) rerun(example); }
    });
  return run.id;
}

// What a run reads: feature.json, the openapi file + the page (fp), and the saved answers (ans). A run writes answers.json
// itself, so the watcher compares content instead of reacting to every write.
function readState(example) {
  const dir = path.join(examplesDir, example);
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch { return ""; } };
  let page = "page.jsx";
  try { page = JSON.parse(read("feature.json")).page ?? page; } catch {}
  return { fp: read("feature.json") + "\0" + read(page) + "\0" + CONTRACT_FILES.map(read).join("\0"), ans: read("answers.json") };
}

function rerun(example) {
  broadcast({ type: "run", example, run: startRun(example, { auto: true }), reason: "a file changed" });
}

function setWatch(example, on) {
  if (!on) { watchers.get(example)?.stop(); watchers.delete(example); return; }
  if (watchers.has(example)) return;
  const w = { active: 0, dirty: false, seen: readState(example) };
  const changed = () => { const c = readState(example); return c.fp !== w.seen.fp || c.ans !== w.seen.ans; };
  w.changed = changed;
  w.stop = watchExample(path.join(examplesDir, example), () => {
    if (!changed()) return;
    if (w.active) w.dirty = true;
    else rerun(example);
  });
  watchers.set(example, w);
}

// ---------- http ----------
// Every request passes http-guard.mjs first (Host, Origin, content-type). Bodies are read only through readBody, which
// answers bad JSON with 400 and an oversized body with 413; nothing thrown in a handler can end the process.
const readBody = (req, opts) => readJsonBody(req, opts);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const file = (res, p, type) => {
  let data;
  try { data = fs.readFileSync(p); } catch { return void res.writeHead(404, { "content-type": "text/plain" }).end("not found"); } // read first: a missing file is a 404, never an empty 200
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
};

async function handle(req, res) {
  const denied = checkRequest(req, server.address()?.port);
  if (denied) return json(res, denied.status, { error: denied.error });
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return json(res, 400, { error: "bad request URL" }); }
  const p = url.pathname;
  if (answerIfContractsLocked(req.method, p, res, deployDirOf(root))) return; // a deploy is switching builds: contract writes wait (503 + Retry-After); after the guard above, never instead of it
  if (handleBuildRoute(p, res, buildCtx)) return; // /api/health, /api/build, /api/about, /about, /ui/*.mjs, /doc/*
  // "/" is the demo shell (Trace, src/demo-server.mjs); the full studio stays here at /studio. Both come after checkRequest.
  if (await demoRoute(req, res, url, { examplesDir, readBody, json, file, runs })) return;
  if (await inspectorRoute(req, res, url, { readBody, json, file })) return; // /inspector/*.mjs|css, /api/parts, /api/part*, /api/suggest
  if (await pagemapRoute(req, res, url, { readBody, json, file })) return; // /pagemap, /pagemap/*, /api/pagemap*
  if (p === "/studio") return file(res, path.join(here, "ui", "index.html"), "text/html; charset=utf-8");
  if (p === "/ai/mail-chat.mjs") return file(res, path.join(here, "ai", "mail-chat.mjs"), "text/javascript");
  if (p === "/theme.css") { res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" }); return res.end(THEME_CSS); }
  if (p === "/tree/svg.mjs") return file(res, path.join(here, "tree", "svg.mjs"), "text/javascript");
  if (p === "/ui/endpoint-select.mjs") return file(res, path.join(here, "ui", "endpoint-select.mjs"), "text/javascript"); // T12.2: endpoint selection with Product confirm (studio's Contract card)
  if (p === "/api/examples") return json(res, 200, listExamples());

  if (p === "/api/ai-config") {
    const name = url.searchParams.get("example");
    const cfg = loadAiConfig({ dir: listExamples().some((e) => e.name === name) ? path.join(examplesDir, name) : undefined });
    return json(res, 200, { tasks: TASKS, config: cfg });
  }

  // The email composer's chat: streams thinking and text as server-sent events. Closing the connection (Stop) aborts
  // the model call. The reply is only a proposal: it is parsed and fact-checked here, and the page decides what to do.
  if (p === "/api/mail-chat" && req.method === "POST") {
    const { example, subject = "", body = "", instruction = "", earlier = [], temperature = 0, ai = {} } = await readBody(req);
    if (!listExamples().some((e) => e.name === example)) return json(res, 404, { error: "unknown example" });
    if (![subject, body, instruction].every((v) => typeof v === "string") || !Array.isArray(earlier) || !earlier.every((v) => typeof v === "string") || typeof temperature !== "number") return json(res, 400, { error: "subject, body and instruction must be strings, earlier a list of strings" });
    if (!instruction.trim()) return json(res, 400, { error: "say what to change" });
    // the client may only pick a model name per task; provider, base URL and keys come from the server's own config
    const c = taskConfig(loadAiConfig({ dir: path.join(examplesDir, example), overrides: { tasks: isObj(ai) && isObj(ai.tasks) ? ai.tasks : {} } }), "mail");
    const model = `${c.provider}:${c.model}`, mode = modeOf(instruction);
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = (type, data = {}) => res.writableEnded || res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    const t0 = Date.now();
    let text = "", usage = null, firstText = null;
    send("start", { model, mode });
    try {
      for await (const e of streamChat({ ...c, system: MAIL_SYSTEM[mode], messages: mailMessages({ subject, body, instruction, earlier }), temperature, signal: ac.signal })) {
        if (e.type === "usage") usage = e;
        else { if (e.type === "text") { text += e.delta; firstText ??= Date.now() - t0; } send(e.type, { delta: e.delta }); }
      }
      const r = parseReply(text, mode);
      if (r.body) r.body = tidy(r.body);
      const check = r.body ? checkDraft({ from: `${subject}\n${body}\n${instruction}\n${earlier.join("\n")}`, draft: `${r.subject ?? subject}\n${r.body}`, baseLines: body.split("\n").length }) : null;
      send("done", { model, mode, ...r, note: mode === "ask" ? r.note : r.body ? `Rewrote it: ${body.split("\n").length} → ${r.body.split("\n").length} lines.` : "The model did not reply with an email.", check, ms: Date.now() - t0, firstTextMs: firstText, tokens: usage ? { in: usage.in, out: usage.out } : null });
    } catch (err) {
      if (!ac.signal.aborted) send("error", { message: /fetch failed|ECONNREFUSED/.test(err.message) ? `${model} is not reachable. Is ${c.provider} running?` : err.message });
    }
    return res.end();
  }
  // /api/contract, /api/openapi (upload) and the panel script: after checkRequest above; the body comes only through readBody
  if (await contractRoute(req, res, url, { examplesDir, known: (n) => listExamples().some((e) => e.name === n), readBody })) return;

  // The import wizard (T13): /import-wizard, /ui/import-wizard.mjs, /ui/subframe-fixture.mjs, /api/wizard/*
  if (await importWizardRoute(req, res, url, { examplesDir, known: (n) => listExamples().some((e) => e.name === n), readBody })) return;

  if (p === "/api/preview") {
    const name = url.searchParams.get("example");
    if (!listExamples().some((e) => e.name === name)) return json(res, 404, { error: "unknown example" });
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(examplesDir, name, "feature.json"), "utf8"));
      const html = renderPreview(fs.readFileSync(path.join(examplesDir, name, spec.page), "utf8"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (p === "/api/run" && req.method === "POST") {
    const { example, useSaved, askAll, auto, watch, ai } = await readBody(req);
    if (!listExamples().some((e) => e.name === example)) return json(res, 404, { error: "unknown example" });
    setWatch(example, !!watch);
    return json(res, 200, { run: startRun(example, { useSaved: !!useSaved, askAll: !!askAll, auto: !!auto, ai }) });
  }

  if (p === "/api/reset" && req.method === "POST") {
    const { example, all } = await readBody(req);
    const names = all ? listExamples().map((e) => e.name) : [example];
    if (names.some((n) => !listExamples().some((e) => e.name === n))) return json(res, 404, { error: "unknown example" });
    const busy = names.filter((n) => [...runs.values()].some((r) => r.example === n && !r.finished));
    if (busy.length) return json(res, 409, { error: `still running: ${busy.join(", ")}. Wait for it to finish (or answer its question) first.` });
    const results = {};
    for (const n of names) { setWatch(n, false); results[n] = resetExample(path.join(examplesDir, n)); }
    return json(res, 200, { results });
  }

  if (p === "/api/watch" && req.method === "POST") {
    const { example, on } = await readBody(req);
    if (!listExamples().some((e) => e.name === example)) return json(res, 404, { error: "unknown example" });
    setWatch(example, !!on);
    return json(res, 200, { ok: true });
  }

  if (p === "/api/live") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n"); // flush the headers so the client's stream opens now
    live.add(res);
    req.on("close", () => live.delete(res));
    return;
  }

  if (p === "/api/events") {
    const run = runs.get(url.searchParams.get("run"));
    if (!run) return json(res, 404, { error: "unknown run" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    run.clients.add(res);
    req.on("close", () => run.clients.delete(res));
    return;
  }

  if (p === "/api/answer" && req.method === "POST") {
    const { run: id, answer } = await readBody(req);
    const run = runs.get(id);
    if (!run?.waiting) return json(res, 409, { error: "no question is waiting" });
    const resolve = run.waiting;
    run.waiting = null;
    resolve(answer);
    return json(res, 200, { ok: true });
  }

  // The static tree the last run wrote next to the generated code.
  const report = p.match(/^\/report\/([\w-]+)$/);
  if (report) {
    const ex = listExamples().find((e) => e.name === report[1]);
    if (ex) return file(res, path.join(outRoot, "features", ex.feature, "REPORT.html"), "text/html; charset=utf-8");
  }
  res.writeHead(404).end("not found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err instanceof HttpError) return sendError(res, err.status, err.message);
    console.error(`request failed: ${req.method} ${req.url}: ${err?.stack ?? err}`);
    sendError(res, 500, "internal error");
  });
});

function listen(port, tries = 10) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
    else throw err;
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(`Trace UI: ${url}`);
    if (process.platform === "darwin" && !args.includes("--no-open")) execFile("open", [url]);
  });
}
listen(basePort, args.includes("--strict-port") ? 0 : 10); // --strict-port: a deploy must own its port, never slide to the next one
