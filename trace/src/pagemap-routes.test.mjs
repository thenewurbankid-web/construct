// The Page map's routes on the real server (child process, ephemeral loopback port, tmp examples): the pages and assets, the
// JSON API, path safety, the two-step write, and that a request can only ever name a known example or one of the fixed real pages.
// No model, no network beyond 127.0.0.1. The guard itself (Host, Origin, content type) is asserted for every route in server.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let port, child, dir, log = "";
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const req = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  let answered = false; // a 413 is sent while the client is still writing: a reset after the answer is not a failure
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let t = "";
    res.on("data", (c) => (t += c));
    res.on("end", () => { answered = true; resolve({ status: res.statusCode, type: res.headers["content-type"], text: t, json: () => JSON.parse(t) }); });
  });
  r.on("error", (e) => { if (!answered) reject(e); });
  r.end(body);
});
const post = (p, obj) => req("POST", p, { headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(obj) });
const tree = (d, base = d, out = {}) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) tree(p, base, out); else out[path.relative(base, p)] = fs.statSync(p).size; } return out; };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-pmroutes-"));
  for (const name of ["orders", "portfolio-figma-1", "portfolio-figma-2", "portfolio-redesigned"]) {
    fs.mkdirSync(path.join(dir, "examples", name), { recursive: true });
    for (const f of ["feature.json", "openapi.json", "page.jsx"]) fs.copyFileSync(path.join(root, "examples", name, f), path.join(dir, "examples", name, f));
  }
  fs.mkdirSync(path.join(dir, "subframe-app", "src", "pages"), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, "subframe-app", "src", "pages")).filter((x) => /\.tsx$/.test(x))) fs.copyFileSync(path.join(root, "subframe-app", "src", "pages", f), path.join(dir, "subframe-app", "src", "pages", f));
  fs.writeFileSync(path.join(dir, "secret.txt"), "top secret");
  port = await freePort();
  child = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--port", String(port), "--strict-port", "--no-open", "--examples", path.join(dir, "examples"), "--out", path.join(dir, "out")], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) { try { if ((await req("GET", "/api/health")).status === 200) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("the server did not start:\n" + log);
});
after(() => child?.kill());

test("the page and its two files are served; nothing else under /pagemap is", async () => {
  const html = await req("GET", "/pagemap");
  assert.equal(html.status, 200);
  assert.match(html.type, /text\/html/);
  assert.match(html.text, /Page map/);
  assert.match(html.text, /\/pagemap\/pagemap\.mjs/);
  assert.equal((await req("GET", "/pagemap/pagemap.mjs")).status, 200);
  assert.match((await req("GET", "/pagemap/pagemap.css")).type, /text\/css/);
  for (const p of ["/pagemap/nope.mjs", "/pagemap/..%2Fserver.mjs", "/pagemap/%2e%2e/server.mjs", "/pagemap/constructor", "/pagemap/__proto__", "/api/pagemapx", "/api/pagemap/other"]) assert.equal((await req("GET", p)).status, 404, p);
});

test("GET /api/pagemap: an example and a real page open; anything else is a 404 and never reads another path", async () => {
  const r = await req("GET", "/api/pagemap?example=orders");
  assert.equal(r.status, 200);
  const j = r.json();
  assert.equal(j.page.name, "page.jsx");
  assert.ok(j.nodes.length > 50 && j.coverage.accountedFor === 100 && j.wireframe.includes("data-pm-id"));
  assert.equal(JSON.stringify(j).includes(dir), false, "no absolute path leaks to the browser");
  const real = (await req("GET", "/api/pagemap?file=PortfolioHealthFigmaRebuild.tsx")).json();
  assert.equal(real.page.mode, "file");
  assert.equal(real.page.canUse, false);
  for (const q of ["example=../orders", "example=orders/../../secret.txt", "example=..", "example=nope", "example=", "file=../../secret.txt", "file=%2e%2e%2fsecret.txt", "file=Other.tsx", "file=PortfolioHealthFigmaRebuild.tsx%00.txt", "", "example=orders&file=nope.tsx"]) {
    const x = await req("GET", `/api/pagemap?${q}`);
    assert.equal(x.status, 404, q);
    assert.ok(!x.text.includes("top secret"), q);
  }
  const pages = (await req("GET", "/api/pagemap/pages")).json();
  assert.deepEqual(pages.examples, ["orders", "portfolio-figma-1", "portfolio-figma-2", "portfolio-redesigned"]);
  assert.deepEqual(pages.files.map((f) => f.file), ["PortfolioHealthFigmaRebuild.tsx", "PortfolioHealthFigmaRebuild2.tsx", "RedesignedPortfolioHealth.tsx"]);
});

test("valid input is never a 500: all three real Subframe pages and every example open (200), take a bulk decision and apply", async () => {
  const files = fs.readdirSync(path.join(root, "subframe-app", "src", "pages")).filter((f) => /\.tsx$/.test(f)).sort();
  assert.equal(files.length, 3);
  for (const f of files) {
    const r = await req("GET", `/api/pagemap?file=${f}`);
    assert.equal(r.status, 200, `${f}: ${r.text.slice(0, 120)}`);
    const j = r.json();
    assert.deepEqual(j.warnings, [], f);
    assert.ok(j.nodes.length > 400 && j.violations.length > 20, f);
  }
  for (const ex of ["orders", "portfolio-figma-1", "portfolio-figma-2", "portfolio-redesigned"]) assert.equal((await req("GET", `/api/pagemap?example=${ex}`)).status, 200, ex);
  for (const f of files) {
    assert.equal((await post("/api/pagemap/decide", { file: f, bulk: "accept-strong" })).status, 200, f);
    assert.equal((await post("/api/pagemap/apply", { file: f })).status, 200, f);
  }
  assert.ok(!/request failed|internal error/.test(log), log);
});

test("POST bodies: bad JSON 400, oversized 413, unknown example 404, invalid change 422; the server survives all of them", async () => {
  for (const p of ["decide", "undo", "redo", "apply", "use"]) {
    const bad = await req("POST", `/api/pagemap/${p}`, { headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` }, body: "{not json" });
    assert.equal(bad.status, 400, p);
    assert.equal((await post(`/api/pagemap/${p}`, { example: "nope" })).status, 404, p);
    assert.equal((await post(`/api/pagemap/${p}`, { file: "../../secret.txt" })).status, 404, p);
    assert.equal((await post(`/api/pagemap/${p}`, {})).status, 404, `${p}: no page named`);
  }
  assert.equal((await post("/api/pagemap/decide", { example: "orders", pad: "a".repeat(3 * 1024 * 1024) })).status, 413);
  const d = await post("/api/pagemap/decide", { example: "orders", changes: [{ id: "nabcdef01", act: "accept" }] });
  assert.equal(d.status, 422);
  assert.equal((await post("/api/pagemap/decide", { example: "orders", changes: [] })).status, 400);
  assert.equal((await req("GET", "/api/health")).status, 200);
});

test("decide, undo, redo, apply and use: the design source changes only in the explicit second step, and only these files appear", async () => {
  const before = tree(dir);
  const map = (await req("GET", "/api/pagemap?example=orders")).json();
  const target = map.nodes.find((n) => n.kind === "text" && n.text === "orders · total value");
  // mark an unsuggested text
  const dec = await post("/api/pagemap/decide", { example: "orders", changes: [{ id: target.id, act: "change", cls: "dynamic", name: "summaryLine" }] });
  assert.equal(dec.status, 200);
  const m1 = dec.json();
  assert.equal(m1.decisions[target.id].by, "user");
  assert.equal(m1.effective[target.id].cls, "dynamic");
  assert.ok(m1.history.undo && !m1.history.redo);
  assert.equal(tree(dir)["examples/orders/pagemap.json"] > 0, true);
  // undo, redo
  assert.equal((await post("/api/pagemap/undo", { example: "orders" })).json().summary.decided, 0);
  assert.equal((await post("/api/pagemap/redo", { example: "orders" })).json().summary.decided, 1);
  assert.equal((await post("/api/pagemap/undo", { example: "orders" })).status, 200);
  assert.equal((await post("/api/pagemap/undo", { example: "orders" })).status, 422, "nothing left to undo");
  await post("/api/pagemap/decide", { example: "orders", changes: [{ id: target.id, act: "change", cls: "dynamic", name: "summaryLine" }] });
  // apply writes the copy next to the page, not the page
  const orig = fs.readFileSync(path.join(dir, "examples", "orders", "page.jsx"), "utf8");
  const ap = await post("/api/pagemap/apply", { example: "orders" });
  assert.equal(ap.status, 200);
  assert.equal(ap.json().written, "page.marked.jsx");
  assert.equal(fs.readFileSync(path.join(dir, "examples", "orders", "page.jsx"), "utf8"), orig);
  assert.match(fs.readFileSync(path.join(dir, "examples", "orders", "page.marked.jsx"), "utf8"), /data-dyn="summaryLine"/);
  // use needs confirm
  assert.equal((await post("/api/pagemap/use", { example: "orders" })).status, 400);
  assert.equal(fs.readFileSync(path.join(dir, "examples", "orders", "page.jsx"), "utf8"), orig, "still the original after an unconfirmed use");
  // a real page is never replaced
  const refused = await post("/api/pagemap/use", { file: "PortfolioHealthFigmaRebuild.tsx", confirm: true });
  assert.equal(refused.status, 400);
  assert.match(refused.json().error, /never replaced/);
  const used = await post("/api/pagemap/use", { example: "orders", confirm: true });
  assert.equal(used.status, 200);
  assert.match(fs.readFileSync(path.join(dir, "examples", "orders", "page.jsx"), "utf8"), /data-dyn="summaryLine"/);
  const after = tree(dir);
  const added = Object.keys(after).filter((f) => !(f in before)).sort();
  assert.deepEqual(added, ["examples/orders/page.before-pagemap.jsx", "examples/orders/page.marked.jsx", "examples/orders/pagemap.history.jsonl"], "the only new files: the copy, the backup and the history");
  assert.equal(fs.readFileSync(path.join(dir, "secret.txt"), "utf8"), "top secret");
  assert.ok(!/ERR_HTTP_HEADERS_SENT|request failed/.test(log), log);
});

test("a real page: decisions live in the example's folder under fixed names; the Subframe app is never written", async () => {
  const before = tree(path.join(dir, "subframe-app"));
  const map = (await req("GET", "/api/pagemap?file=PortfolioHealthFigmaRebuild.tsx")).json();
  assert.ok(map.summary.strong + map.summary.decided > 5);
  const bulk = await post("/api/pagemap/decide", { file: "PortfolioHealthFigmaRebuild.tsx", bulk: "accept-strong" });
  assert.equal(bulk.status, 200);
  const ap = await post("/api/pagemap/apply", { file: "PortfolioHealthFigmaRebuild.tsx" });
  assert.equal(ap.status, 200);
  assert.equal(ap.json().written, "PortfolioHealthFigmaRebuild.marked.tsx");
  assert.ok(fs.existsSync(path.join(dir, "examples", "portfolio-figma-1", "PortfolioHealthFigmaRebuild.marked.tsx")));
  assert.deepEqual(tree(path.join(dir, "subframe-app")), before, "nothing was written into the Subframe app");
  assert.ok(fs.existsSync(path.join(dir, "examples", "portfolio-figma-1", "pagemap.PortfolioHealthFigmaRebuild.json")));
});

test("use: two concurrent requests and a dangling-symlink backup name never give a 500; the first original survives; a corrupt sidecar is a 200 with a warning", async () => {
  const d = path.join(dir, "examples", "portfolio-figma-2");
  fs.copyFileSync(path.join(root, "examples", "orders", "page.jsx"), path.join(d, "page.jsx")); // a small page to replace
  const orig = fs.readFileSync(path.join(d, "page.jsx"), "utf8");
  fs.symlinkSync(path.join(dir, "nowhere.jsx"), path.join(d, "page.before-pagemap.2.jsx")); // a dangling name in the way
  const map = (await req("GET", "/api/pagemap?example=portfolio-figma-2")).json();
  const t = map.nodes.find((n) => n.kind === "text" && n.text === "Order");
  assert.equal((await post("/api/pagemap/decide", { example: "portfolio-figma-2", changes: [{ id: t.id, act: "add", cls: "dynamic", name: "orderHeader" }] })).status, 200);
  assert.equal((await post("/api/pagemap/apply", { example: "portfolio-figma-2" })).status, 200);
  const both = await Promise.all([post("/api/pagemap/use", { example: "portfolio-figma-2", confirm: true }), post("/api/pagemap/use", { example: "portfolio-figma-2", confirm: true })]);
  for (const r of both) assert.ok([200, 409].includes(r.status), `no 500: ${r.status} ${r.text.slice(0, 100)}`);
  assert.ok(both.some((r) => r.status === 200));
  assert.equal(fs.readFileSync(path.join(d, "page.before-pagemap.jsx"), "utf8"), orig, "the first original is untouched");
  assert.ok(!fs.existsSync(path.join(dir, "nowhere.jsx")), "nothing was written through the dangling symlink");
  // corrupt sidecar: still a page
  fs.writeFileSync(path.join(d, "pagemap.json"), JSON.stringify({ decisions: { n00000001: null, n00000002: [], nfeedbeef0: { act: "explode" } } }));
  const r = await req("GET", "/api/pagemap?example=portfolio-figma-2");
  assert.equal(r.status, 200);
  assert.ok(r.json().warnings.length >= 1);
  assert.equal((await post("/api/pagemap/decide", { example: "portfolio-figma-2", changes: [{ id: r.json().nodes[3].id, act: "accept" }] })).status, 200);
  assert.ok(!/request failed|internal error/.test(log), log);
});
