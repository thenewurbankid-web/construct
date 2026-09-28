// The real server (src/server.mjs) on an ephemeral loopback port, in a child process, with a fake model server on
// loopback as its only "provider". No live model and no network beyond 127.0.0.1. These are the security regressions:
// bad input must not kill the process, a cross-site request must not reach a route, and a request must never be able
// to choose where the model call (and an API key) goes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TASKS } from "./ai/config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_KEY = "sk-FAKE-KEY-for-tests";
const HOSTILE = 'item["constr"+"uctor"]["constr"+"uctor"]("return typeof pro"+"cess")()';

// a loopback HTTP server that records every request it gets
function recorder(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { seen.push({ url: req.url, headers: req.headers, body: b }); handler(req, res, b); });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}
// fake Ollama: streams a short email for the mail chat, and answers everything else with an unusable choice
const fakeOllama = () => recorder((req, res, body) => {
  const j = JSON.parse(body || "{}");
  if (j.stream) {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { content: "Subject: Hi\n\nHello team" }, done: false }) + "\n");
    return res.end(JSON.stringify({ done: true, prompt_eval_count: 3, eval_count: 4 }) + "\n");
  }
  const draft = /Write ONE JavaScript expression/.test(body);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: { content: draft ? JSON.stringify({ expression: HOSTILE }) : '{"choice":1,"fact":0}' } }));
});

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

let ollama, sink, port, child, dir, log = "";
const base = () => `http://127.0.0.1:${port}`;

// low-level request so tests can set Host / Origin / content-type freely
function req(method, p, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) }));
    });
    r.on("error", reject);
    r.end(body);
  });
}
const postJson = (p, obj, extra = {}) => req("POST", p, { headers: { "content-type": "application/json", origin: base(), ...(extra.headers ?? {}) }, body: JSON.stringify(obj), ...extra.opts });
const alive = async () => child.exitCode === null && (await req("GET", "/api/health")).status === 200;
// a stream may be cut mid-line while it is still being read: unfinished lines are skipped
const events = (text) => text.split("\n").filter((l) => l.startsWith("data: ")).flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });

before(async () => {
  ollama = await fakeOllama();
  sink = await recorder((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-server-"));
  const examples = path.join(dir, "examples");
  for (const name of ["categories", "portfolio-figma-1", "invoices"]) {
    fs.mkdirSync(path.join(examples, name), { recursive: true });
    for (const f of ["feature.json", "openapi.json", "page.jsx", "story.md"]) if (fs.existsSync(path.join(root, "examples", name, f))) fs.copyFileSync(path.join(root, "examples", name, f), path.join(examples, name, f));
  }
  // the server's own config for the example: every task goes to the fake local model
  const tasks = Object.fromEntries(TASKS.map((t) => [t, { provider: "ollama", model: "server-model", baseUrl: ollama.url }]));
  fs.writeFileSync(path.join(examples, "categories", "ai.json"), JSON.stringify({ tasks }));
  fs.writeFileSync(path.join(examples, "invoices", "ai.json"), JSON.stringify({ tasks }));
  // a mail task configured for Anthropic but with a base URL that is not api.anthropic.com
  fs.writeFileSync(path.join(examples, "portfolio-figma-1", "ai.json"), JSON.stringify({ tasks: { ...tasks, mail: { provider: "anthropic", model: "claude-x", baseUrl: sink.url } } }));
  port = await freePort();
  child = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--port", String(port), "--strict-port", "--no-open", "--examples", examples, "--out", path.join(dir, "out")], {
    env: { ...process.env, ANTHROPIC_API_KEY: FAKE_KEY, OPENAI_API_KEY: FAKE_KEY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) { try { if ((await req("GET", "/api/health")).status === 200) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("the server did not start:\n" + log);
});
after(() => { child?.kill(); ollama?.close(); sink?.close(); });

test("bad JSON is a 400 and the process survives", async () => {
  for (const route of ["/api/mail-chat", "/api/run", "/api/reset", "/api/watch", "/api/answer"]) {
    const r = await req("POST", route, { headers: { "content-type": "application/json", origin: base() }, body: "{not json" });
    assert.equal(r.status, 400, route);
    assert.match(r.json().error, /valid JSON/);
  }
  const r = await req("POST", "/api/run", { headers: { "content-type": "application/json", origin: base() }, body: "[1,2]" });
  assert.equal(r.status, 400);
  assert.ok(await alive(), "server must still answer");
});

test("an oversized body is a 413, an aborted upload is survived, and a normal request still works", async () => {
  const big = await req("POST", "/api/run", { headers: { "content-type": "application/json", origin: base() }, body: JSON.stringify({ x: "a".repeat(3 * 1024 * 1024) }) });
  assert.equal(big.status, 413);
  await new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write(`POST /api/run HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base()}\r\ncontent-type: application/json\r\ncontent-length: 5000\r\n\r\n{"exa`);
      setTimeout(() => { s.destroy(); resolve(); }, 50);
    });
  });
  assert.ok(await alive());
  assert.equal((await postJson("/api/run", { example: "nope" })).status, 404);
});

test("a cross-site text/plain POST (no preflight in a browser) is rejected on every state-changing route", async () => {
  const before = ollama.seen.length;
  for (const route of ["/api/mail-chat", "/api/run", "/api/reset", "/api/watch", "/api/answer"]) {
    const r = await req("POST", route, { headers: { "content-type": "text/plain", origin: "https://evil.example" }, body: JSON.stringify({ example: "categories", instruction: "x" }) });
    assert.ok([403, 415].includes(r.status), `${route}: ${r.status}`);
    const noOrigin = await req("POST", route, { headers: { "content-type": "text/plain" }, body: "{}" }); // a form post: no JSON type
    assert.equal(noOrigin.status, 415, route);
    const noType = await req("POST", route, { headers: { origin: base() }, body: "{}" });
    assert.equal(noType.status, 415, route);
  }
  // a JSON post from another origin: refused too (Origin must be exactly this server)
  const cross = await postJson("/api/mail-chat", { example: "categories", instruction: "shorter" }, { headers: { origin: "http://evil.example" } });
  assert.equal(cross.status, 403);
  const nullOrigin = await postJson("/api/mail-chat", { example: "categories", instruction: "shorter" }, { headers: { origin: "null" } });
  assert.equal(nullOrigin.status, 403);
  const otherPort = await postJson("/api/mail-chat", { example: "categories", instruction: "shorter" }, { headers: { origin: `http://127.0.0.1:${port + 1}` } });
  assert.equal(otherPort.status, 403);
  assert.equal(ollama.seen.length, before, "no model call was made");
  assert.ok(await alive());
});

test("a wrong Host header (DNS rebinding) is refused, even on read-only routes", async () => {
  for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1", `localhost:${port + 1}`, `127.0.0.1.evil.example:${port}`]) {
    assert.equal((await req("GET", "/api/examples", { host })).status, 403, host);
    assert.equal((await req("GET", "/", { host })).status, 403, host);
  }
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) assert.equal((await req("GET", "/api/examples", { host })).status, 200, host);
  assert.equal((await postJson("/api/run", { example: "nope" }, { opts: { host: `evil.example:${port}` } })).status, 403);
});

test("a same-origin JSON request still works: the mail chat streams from the server's own model", async () => {
  const r = await postJson("/api/mail-chat", { example: "categories", subject: "S", body: "Hi\nBye", instruction: "make it shorter", ai: { tasks: { mail: { model: "picked-model" } } } });
  assert.equal(r.status, 200);
  const ev = events(r.text);
  assert.equal(ev[0].type, "start");
  assert.equal(ev[0].model, "ollama:picked-model"); // the client may choose the model name
  assert.equal(ev.at(-1).type, "done");
  assert.match(ev.at(-1).body, /Hello team/);
});

test("the client cannot choose provider, base URL or where an API key goes", async () => {
  ollama.seen.length = 0;
  sink.seen.length = 0;
  const evil = { tasks: { mail: { provider: "anthropic", baseUrl: sink.url, model: "claude-anything", headers: { "x-api-key": "stolen" } }, choose: { provider: "openai", baseUrl: sink.url } } };
  const r = await postJson("/api/mail-chat", { example: "categories", subject: "S", body: "Hi", instruction: "make it shorter", ai: evil });
  const ev = events(r.text);
  assert.equal(ev[0].model, "ollama:claude-anything", "provider stays the server's; only the model name is taken");
  assert.equal(sink.seen.length, 0, "the attacker's sink received nothing");
  assert.equal(ollama.seen.length, 1);
  assert.equal(ollama.seen[0].headers["x-api-key"], undefined);
  assert.ok(!JSON.stringify(ollama.seen).includes(FAKE_KEY), "the key never went anywhere");
});

test("a paid provider only accepts models the server's config names", async () => {
  // portfolio-figma-1 is configured for anthropic (claude-x); a client model outside that list is ignored
  sink.seen.length = 0;
  const r = await postJson("/api/mail-chat", { example: "portfolio-figma-1", subject: "S", body: "Hi", instruction: "shorter", ai: { tasks: { mail: { model: "claude-opus-expensive" } } } });
  assert.equal(events(r.text)[0].model, "anthropic:claude-x");
});

test("a configured Anthropic task never sends the key to a host that is not api.anthropic.com", async () => {
  sink.seen.length = 0;
  const r = await postJson("/api/mail-chat", { example: "portfolio-figma-1", subject: "S", body: "Hi", instruction: "make it shorter" });
  const ev = events(r.text);
  assert.equal(ev.at(-1).type, "error");
  assert.match(ev.at(-1).message, /refusing to send ANTHROPIC_API_KEY to 127\.0\.0\.1:\d+/);
  assert.equal(sink.seen.length, 0);
  assert.ok(await alive());
});

test("/api/run ignores provider/baseUrl in ai.tasks, and the model's hostile expression is rejected, not executed", async () => {
  sink.seen.length = 0;
  // portfolio-figma-1 with a saved answer that builds a placeholder from fields: the fake model answers with the escape string
  const ex = path.join(dir, "examples", "portfolio-figma-1");
  fs.writeFileSync(path.join(ex, "answers.json"), JSON.stringify({ "list.savingsPct": { custom: true, from: "fields", inputs: ["display_name"], fn: "savingsPct" } }));
  const evil = { tasks: Object.fromEntries(["choose", "pick-fields", "draft-body", "explain"].map((t) => [t, { provider: "anthropic", baseUrl: sink.url, model: "m" }])) };
  const { run } = (await postJson("/api/run", { example: "portfolio-figma-1", auto: true, useSaved: true, ai: { enabled: true, tasks: evil } })).json();
  const all = await new Promise((resolve, reject) => {
    const r = http.get({ host: "127.0.0.1", port, path: `/api/events?run=${run}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let buf = "";
      const timer = setTimeout(() => { r.destroy(); reject(new Error("no end: " + buf.slice(-300))); }, 60000);
      res.on("data", (c) => { buf += c; const e = events(buf); if (e.some((x) => x.type === "done" || x.type === "error")) { clearTimeout(timer); r.destroy(); resolve(e); } });
    });
    r.on("error", () => {});
  });
  const drafts = all.filter((e) => e.type === "ai-log" && e.data.task === "draft-body");
  assert.ok(drafts.length >= 1, "the draft-body task ran: " + JSON.stringify(all.map((e) => e.type)));
  assert.ok(drafts.every((e) => /expression not allowed/.test(e.data.verdict?.text ?? "")), JSON.stringify(drafts.map((e) => e.data.verdict)));
  assert.equal(sink.seen.length, 0, "the attacker's sink received nothing");
  assert.ok(!JSON.stringify(ollama.seen).includes(FAKE_KEY), "the key never went anywhere");
  assert.ok(await alive());
});

// ---------- every route the merged server exposes (R0): the guard, the model boundary and the inspector's Stub route ----------
// The lists below are the routes as of the R0 merge. The "no route is missing" test reads the sources that register routes and fails when
// one is added without a line here, so a new route cannot ship without being asserted to sit behind the guard.
const POST_ROUTES = [
  "/api/mail-chat", "/api/run", "/api/reset", "/api/watch", "/api/answer", "/api/openapi?example=categories",
  "/api/suggest", "/api/part-chat", "/api/part-preview", "/api/part-similar", "/api/part-apply", "/api/part-undo", "/api/part-redo",
  "/api/demo/apply-fix", "/api/demo/release", "/api/wizard/markers/suggest", "/api/wizard/markers/apply", "/api/wizard/apply", "/api/contract/sample",
  "/api/pagemap/decide", "/api/pagemap/undo", "/api/pagemap/redo", "/api/pagemap/apply", "/api/pagemap/use", // the Page map (src/pagemap-routes.mjs)
];
const GET_ROUTES = [
  "/", "/studio", "/about", "/ui/about.mjs", "/ui/build-badge.mjs", "/ui/contract-panel.mjs", "/doc/README.md", "/doc/SECURITY.md", "/theme.css", "/tree/svg.mjs", "/ai/mail-chat.mjs",
  "/api/health", "/api/build", "/api/about", "/api/examples", "/api/ai-config?example=categories", "/api/contract?example=categories", "/api/preview?example=categories",
  "/api/parts?example=invoices", "/api/part?example=invoices&id=list.requestedBy", "/api/demo/status", "/api/live", "/api/events?run=none", "/report/categories",
  "/demo/demo.mjs", "/demo/hero3d/hero.bundle.mjs", "/demo/canvas/trace.mjs", "/inspector/inspector.mjs", "/inspector/inspector.css", "/inspector/issues.mjs",
  "/import-wizard", "/ui/import-wizard.mjs", "/ui/subframe-fixture.mjs", "/api/wizard/subframe/status",
  "/pagemap", "/pagemap/pagemap.mjs", "/pagemap/pagemap.css", "/api/pagemap?example=categories", "/api/pagemap/pages",
];
const STREAMS = new Set(["/api/live"]); // never end on their own

test("no route is missing from the lists above: every path the server sources register is covered", () => {
  const src = ["src/server.mjs", "src/contract-routes.mjs", "src/import-wizard-routes.mjs", "src/demo-server.mjs", "src/inspector/routes.mjs", "src/build-routes.mjs", "src/pagemap-routes.mjs"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const found = new Set([...src.matchAll(/["'`](\/(?:api|inspector|demo|ui|doc|report|about|studio|theme\.css|tree|ai|import-wizard|pagemap)[\w/.\-]*)/g)].map((m) => m[1].replace(/\/$/, "")));
  const covered = new Set([...POST_ROUTES, ...GET_ROUTES].map((r) => r.split("?")[0]));
  // an /api route must be listed exactly; a static file is covered by a listed file of the same folder and type (the folder is an allow-list)
  const folder = (p) => p.replace(/\/[^/]*(\.\w+)$/, (_m, ext) => `/*${ext}`);
  const missing = [...found].filter((p) => (p.startsWith("/api/") ? !covered.has(p) : ![...covered].some((c) => c === p || (folder(c) === folder(p) && folder(p).includes("/*")))));
  assert.deepEqual(missing, [], "add these routes to POST_ROUTES / GET_ROUTES");
});

test("every state-changing route refuses a foreign Origin, a foreign Host and a text/plain or type-less body, and never reaches a model", async () => {
  const modelCalls = ollama.seen.length, sinkCalls = sink.seen.length;
  const body = JSON.stringify({ example: "invoices", id: "list.requestedBy", question: "why is this open?", instruction: "x", changes: [], ai: { tasks: { choose: { provider: "anthropic", baseUrl: sink.url } } } });
  for (const route of POST_ROUTES) {
    const foreignOrigin = await req("POST", route, { headers: { "content-type": "application/json", origin: "http://evil.example" }, body });
    assert.equal(foreignOrigin.status, 403, `${route}: foreign Origin`);
    const nullOrigin = await req("POST", route, { headers: { "content-type": "application/json", origin: "null" }, body });
    assert.equal(nullOrigin.status, 403, `${route}: null Origin`);
    const foreignHost = await req("POST", route, { headers: { "content-type": "application/json", origin: base() }, body, host: `evil.example:${port}` });
    assert.equal(foreignHost.status, 403, `${route}: foreign Host`);
    const plain = await req("POST", route, { headers: { "content-type": "text/plain", origin: base() }, body });
    assert.equal(plain.status, 415, `${route}: text/plain`);
    const form = await req("POST", route, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
    assert.equal(form.status, 415, `${route}: a plain form post`);
    const untyped = await req("POST", route, { headers: { origin: base() }, body });
    assert.equal(untyped.status, 415, `${route}: no content type`);
  }
  assert.equal(ollama.seen.length, modelCalls, "no model call was made by any refused request");
  assert.equal(sink.seen.length, sinkCalls);
  assert.ok(await alive());
});

test("every route that reads a body answers bad JSON with 400 (never a crash), and an unknown example with 404", async () => {
  const reads = POST_ROUTES.filter((r) => !r.startsWith("/api/demo/release")); // release reads no body
  for (const route of reads) {
    const bad = await req("POST", route, { headers: { "content-type": "application/json", origin: base() }, body: "{not json" });
    assert.ok([400, 404].includes(bad.status), `${route}: bad JSON gave ${bad.status}`); // 404: /api/openapi looks the example up before it reads the file
    if (bad.status === 400) assert.match(bad.json().error, /JSON|request/i, route);
  }
  for (const route of ["/api/openapi?example=nope", "/api/part-preview", "/api/part-apply", "/api/suggest", "/api/part-chat", "/api/part-undo", "/api/demo/apply-fix", "/api/wizard/apply", "/api/pagemap/decide", "/api/pagemap/undo", "/api/pagemap/redo", "/api/pagemap/apply", "/api/pagemap/use"]) {
    assert.equal((await postJson(route, { example: "nope", id: "x", changes: [{ id: "x", choice: {} }], question: "why?" })).status, 404, route);
  }
  const big = await postJson("/api/part-apply", { example: "invoices", changes: [], pad: "a".repeat(3 * 1024 * 1024) });
  assert.equal(big.status, 413, "the inspector's body is bounded by the same reader");
  assert.ok(await alive());
});

test("every read-only route refuses a foreign Host (DNS rebinding), the streams included, and answers a same-origin read", async () => {
  for (const route of GET_ROUTES) {
    const r = await req("GET", route, { host: `evil.example:${port}` });
    assert.equal(r.status, 403, `${route}: foreign Host`);
  }
  for (const route of GET_ROUTES.filter((r) => !STREAMS.has(r.split("?")[0]))) {
    const r = await req("GET", route);
    assert.ok(r.status < 500, `${route}: ${r.status}`);
  }
  assert.ok(await alive());
});

test("a missing report is a 404, not an empty 200 (and the server does not log a headers-already-sent error)", async () => {
  const r = await req("GET", "/report/categories"); // nothing has been run in this server's --out folder
  assert.equal(r.status, 404);
  assert.equal(r.text, "not found");
  const demo = await req("GET", "/demo/nope.mjs");
  assert.equal(demo.status, 404);
  assert.ok(!/ERR_HTTP_HEADERS_SENT/.test(log), "no ERR_HTTP_HEADERS_SENT in the server's log");
  assert.ok(await alive());
});

test("Suggest and the inspector chat never send a request anywhere the server's own config did not name", async () => {
  ollama.seen.length = 0;
  sink.seen.length = 0;
  const evil = { tasks: Object.fromEntries(TASKS.map((t) => [t, { provider: "anthropic", baseUrl: sink.url, model: "m", headers: { "x-api-key": "stolen" } }])) };
  const s = await postJson("/api/suggest", { example: "invoices", id: "list.requestedBy", ai: evil });
  assert.equal(s.status, 200);
  const chat = await postJson("/api/part-chat", { example: "invoices", id: "list.requestedBy", question: "why is this open?", ai: evil });
  assert.equal(chat.status, 200);
  const ev = events(chat.text);
  assert.equal(ev[0].type, "start");
  assert.match(ev[0].model, /^ollama:/, "the provider stays the server's; a client can not pick it");
  assert.ok(["done", "error"].includes(ev.at(-1).type));
  // a non-object ai.tasks is ignored, not a crash
  assert.equal((await postJson("/api/suggest", { example: "invoices", id: "list.requestedBy", ai: { tasks: "x" } })).status, 200);
  assert.equal((await postJson("/api/part-chat", { example: "invoices", id: "list.requestedBy", question: "why is this open?", ai: { tasks: [1] } })).status, 200);
  assert.ok(ollama.seen.length >= 1, "the calls went to the server's own model, so this test really exercised the path");
  assert.equal(sink.seen.length, 0, "the attacker's sink received nothing");
  assert.ok(!JSON.stringify(ollama.seen).includes(FAKE_KEY) && !JSON.stringify(ollama.seen).includes("stolen"));
  assert.ok(await alive());
});

test("the hostile-expression suite passes through the inspector's Stub route: refused in preview and apply, nothing written or run", async () => {
  const dirInv = path.join(dir, "examples", "invoices");
  const HOSTILE_SET = [
    HOSTILE,
    'item["constr"+"uctor"]["constr"+"uctor"]("return process")()',
    "process.exit(1)",
    "globalThis.process.env",
    "this.constructor.constructor('return process')()",
    "(function(){return process})()",
    "require('fs').readFileSync('/etc/passwd')",
    "`${process.env.HOME}`",
    "item.__proto__.constructor",
    "import('fs')",
    "item.requester; while(true){}",
  ];
  for (const expression of HOSTILE_SET) {
    for (const route of ["/api/part-preview", "/api/part-apply"]) {
      const r = await postJson(route, { example: "invoices", changes: [{ id: "list.requestedBy", choice: { option: "stub:fields", inputs: ["requester"], fn: "who", expression, keepUnverified: true } }] });
      assert.equal(r.status, 422, `${route}: ${expression}`);
      assert.match(r.json().error, /can't be used|expression not allowed|not one of|Only a Stub/, `${route}: ${expression}`);
    }
  }
  assert.ok(!fs.existsSync(path.join(dirInv, "answers.json")) && !fs.existsSync(path.join(dirInv, "answers.history.jsonl")), "nothing was written");
  assert.ok(await alive(), "the server is still up (process.exit was never run)");
  // the same route still accepts a plain, verified expression
  const ok = await postJson("/api/part-preview", { example: "invoices", changes: [{ id: "list.requestedBy", choice: { option: "stub:fields", inputs: ["requester"], fn: "who", expression: "item.requester" } }] });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
});
