// Server-level tests for LIN-90 §5's adapter routes: real server, real HTTP, never the contract file, and a
// storage shape (operationId -> field) that carries no run-state-only id (docs/ADAPTER-PERSISTENCE.md's
// 2026-09-30 design constraint).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = path.join(root, "examples");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-adapter-routes-"));
const events = (text) => text.split("\n").filter((l) => l.startsWith("data: ")).flatMap((l) => { try { return [JSON.parse(l.slice(6))]; } catch { return []; } });

function startServer(examplesDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--no-open", "--port", String(4800 + Math.floor(Math.random() * 400)), "--examples", examplesDir, "--out", tmp()], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d) => { const m = String(d).match(/http:\/\/localhost:(\d+)/); if (m) resolve({ child, base: `http://127.0.0.1:${m[1]}` }); });
    child.on("error", reject);
    setTimeout(() => reject(new Error("the server did not start")), 8000).unref();
  });
}
const post = (base, body) => fetch(`${base}/api/adapter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (base, example, operation, field) => fetch(`${base}/api/adapter?example=${example}&operation=${encodeURIComponent(operation)}&field=${field}`);

test("server: GET /api/adapter on an example with none is { adapter: null }; POST saves and it round-trips", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const empty = await (await get(base, "orders", "GET /api/orders", "status_code")).json();
    assert.equal(empty.adapter, null);

    const res = await post(base, {
      example: "orders", operationId: "GET /api/orders", field: "status_code",
      transform: "map", params: { table: { 1: "open" } }, fromType: "number", toType: "string", value: 1,
    });
    assert.equal(res.status, 200);
    const got = await res.json();
    assert.equal(got.ok, true);
    assert.equal(got.adapter.transform, "map");
    assert.equal(got.adapter.questionId, undefined); // no run-state-only id in the persisted mapping

    const after = await (await get(base, "orders", "GET /api/orders", "status_code")).json();
    assert.equal(after.adapter.transform, "map");
    assert.equal(fs.existsSync(path.join(dir, "orders", "adapters.json")), true);
  } finally {
    child.kill();
  }
});

test("server: POST /api/adapter refuses an unknown example (404), missing fields (400), and a mapping outside the closed set (400)", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    assert.equal((await post(base, { example: "nope", operationId: "GET /api/orders", field: "a", transform: "passthrough" })).status, 404);
    assert.equal((await post(base, { example: "orders", operationId: "GET /api/orders" })).status, 400);
    // "substring" isn't in the closed set for number -> string (only stringify/map are)
    const res = await post(base, { example: "orders", operationId: "GET /api/orders", field: "a", transform: "substring", fromType: "number", toType: "string" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /isn't an allowed mapping/);
  } finally {
    child.kill();
  }
});

test("server: POST /api/adapter refuses a mapping that fails its own preview against the given value", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const res = await post(base, {
      example: "orders", operationId: "GET /api/orders", field: "status_code",
      transform: "map", params: { table: { 1: "open" } }, fromType: "number", toType: "string", value: 9, // 9 isn't in the table
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /isn't valid/);
    const after = await (await get(base, "orders", "GET /api/orders", "status_code")).json();
    assert.equal(after.adapter, null);
  } finally {
    child.kill();
  }
});

test("server: saving an adapter never touches the contract file", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const contractPath = fs.readdirSync(path.join(dir, "orders")).find((f) => f.startsWith("openapi"));
  const before = fs.readFileSync(path.join(dir, "orders", contractPath), "utf8");
  const { child, base } = await startServer(dir);
  try {
    await post(base, { example: "orders", operationId: "GET /api/orders", field: "a", transform: "passthrough", fromType: "string", toType: "string" });
    const after = fs.readFileSync(path.join(dir, "orders", contractPath), "utf8");
    assert.equal(after, before);
  } finally {
    child.kill();
  }
});

test("server: a questionId in the request is accepted but never persisted into the saved mapping", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    await post(base, { example: "orders", operationId: "GET /api/orders", field: "a", transform: "passthrough", fromType: "string", toType: "string", questionId: "value.status#0" });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "orders", "adapters.json"), "utf8"));
    assert.deepEqual(Object.keys(raw["GET /api/orders"].a).sort(), ["params", "savedAt", "transform"]);
  } finally {
    child.kill();
  }
});

// ---------- LIN-190: "Save adapter & attach" saves the mapping AND resolves the run's open question ----------
test("server: POST /api/adapter with run+questionId resolves a live run's open Tie in one request", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "invoices"), path.join(dir, "invoices"), { recursive: true });
  fs.rmSync(path.join(dir, "invoices", "answers.json"), { force: true }); // force a fresh, unanswered run
  const { child, base } = await startServer(dir);
  try {
    const runRes = await fetch(`${base}/api/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices", useSaved: false }) });
    const { run } = await runRes.json();
    assert.ok(run, "a run id came back");

    // Wait for the pipeline to land on its first open question (list.requestedBy: requester vs. assignee tie).
    const q = await new Promise((resolve, reject) => {
      const r = http.get({ host: "127.0.0.1", port: new URL(base).port, path: `/api/events?run=${run}`, headers: { host: `127.0.0.1:${new URL(base).port}` } }, (res) => {
        let buf = "";
        const timer = setTimeout(() => { r.destroy(); reject(new Error("no question arrived: " + buf.slice(-300))); }, 20000);
        res.on("data", (c) => { buf += c; const question = events(buf).find((e) => e.type === "question"); if (question) { clearTimeout(timer); r.destroy(); resolve(question.data); } });
      });
      r.on("error", () => {});
    });
    assert.equal(q.id, "list.requestedBy");

    // The dialog's "Save adapter & attach": a valid passthrough mapping, plus the run and the open question's id.
    const res = await post(base, {
      example: "invoices", operationId: "GET /api/invoices", field: "vendor", transform: "passthrough",
      fromType: "string", toType: "string", value: "Northwind Freight", run, questionId: q.id,
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.resolved, true, "the run had a question waiting, so it was resolved in the same request");

    // The mapping is saved (already covered by the round-trip test above) AND the pipeline moved past the tie.
    const answered = await new Promise((resolve, reject) => {
      const r = http.get({ host: "127.0.0.1", port: new URL(base).port, path: `/api/events?run=${run}`, headers: { host: `127.0.0.1:${new URL(base).port}` } }, (res) => {
        let buf = "";
        const timer = setTimeout(() => { r.destroy(); reject(new Error("no 'answered' event: " + buf.slice(-500))); }, 20000);
        res.on("data", (c) => { buf += c; const a = events(buf).find((e) => e.type === "answered" && e.data.id === "list.requestedBy"); if (a) { clearTimeout(timer); r.destroy(); resolve(a.data); } });
      });
      r.on("error", () => {});
    });
    assert.match(answered.answer, /via a saved adapter/);
  } finally {
    child.kill();
  }
});

test("server: POST /api/adapter with run+questionId but no question currently waiting reports resolved: false", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const res = await post(base, {
      example: "orders", operationId: "GET /api/orders", field: "status_code", transform: "stringify",
      fromType: "number", toType: "string", value: 1, run: "no-such-run", questionId: "value.status#0",
    });
    const data = await res.json();
    assert.equal(data.ok, true, "saving the mapping still succeeds");
    assert.equal(data.resolved, false);
  } finally {
    child.kill();
  }
});

// LIN-117 §7: the persistent "⇄ adapter" chip reads every saved adapter for the example at once (not a lookup
// per field), so it knows which endpoints to show a chip under without guessing.
test("server: GET /api/adapter with only ?example lists every saved mapping for that example; empty when none", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "orders"), path.join(dir, "orders"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const empty = await (await fetch(`${base}/api/adapter?example=orders`)).json();
    assert.deepEqual(empty.adapters, {});

    await post(base, { example: "orders", operationId: "GET /api/orders", field: "status_code", transform: "map", params: { table: { 1: "open" } }, fromType: "number", toType: "string", value: 1 });
    const after = await (await fetch(`${base}/api/adapter?example=orders`)).json();
    assert.equal(after.adapters["GET /api/orders"].status_code.transform, "map");
  } finally {
    child.kill();
  }
});
