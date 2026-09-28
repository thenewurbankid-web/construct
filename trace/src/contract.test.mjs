// The contract in the feature folder: loading it, uploading it, running without one (allowed, and honest),
// and the migration of the shipped examples (their generated output must be byte-identical to before).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.mjs";
import { loadContract, saveContract, readSpec, CONTRACT_FILES, NO_CONTRACT } from "./contract.mjs";
import { resetExample } from "./reset.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = path.join(root, "examples");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-contract-"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const walk = (d, base = d, out = {}) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out[path.relative(base, p)] = sha(p);
  }
  return out;
};
// A copy of an example folder, so a run can never touch the real one (answers.json, ...).
const copyExample = (name, as = name) => {
  const dst = path.join(tmp(), as);
  fs.cpSync(path.join(examples, name), dst, { recursive: true });
  return dst;
};
const run = (dir, out = tmp()) => runPipeline({ dir, outRoot: out, auto: true }).then((r) => ({ ...r, out }));
const read = (out, feature, rel) => fs.readFileSync(path.join(out, "features", feature, rel), "utf8");

// ---------- migration: identical output ----------
// pre-migration-output.json holds the sha256 of every file that `node src/cli.mjs examples --all --auto` wrote
// BEFORE the examples were migrated to openapi.json (feature.json `apis` -> the contract file). It was regenerated once,
// on purpose, when two hint sentences stopped pointing at "apis in feature.json" (they now point at the OpenAPI file):
// only the hint text of deals and orders (REPORT.md, status.json) changed, no other byte. The REPORT.html entries were refreshed
// once when R0 merged the light/dark theme (REPORT.html got the theme CSS); they equal the output of the code before the migration.
test("migration: every example generates byte-identical files to before", async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(root, "src", "fixtures", "pre-migration-output.json"), "utf8"));
  const names = fs.readdirSync(examples).filter((d) => fs.existsSync(path.join(examples, d, "feature.json")) && d !== "products-no-contract");
  const out = tmp();
  for (const name of names) await runPipeline({ dir: copyExample(name), outRoot: out, auto: true });
  const now = walk(out);
  const changed = Object.keys(golden).filter((f) => now[f] !== golden[f]);
  assert.deepEqual(changed, [], "these generated files differ from before the migration");
  assert.deepEqual(Object.keys(now).filter((f) => !(f in golden)), [], "new files appeared");
  assert.equal(names.length, 11);
});

// The ViewModel is a no-op the first time it can be (no viewmodel.json yet): a run creates it, and a second
// run on the same example, no page or contract change in between, writes the identical bytes back (the
// write-if-changed guard — same pattern as answers.json — so a file watcher never self-retriggers).
test("ViewModel: a run creates viewmodel.json, and a second run leaves it byte-identical", async () => {
  const dir = copyExample("products");
  await run(dir);
  const file = path.join(dir, "viewmodel.json");
  assert.ok(fs.existsSync(file), "viewmodel.json appears after the first run");
  const first = fs.readFileSync(file, "utf8");
  await run(dir);
  const second = fs.readFileSync(file, "utf8");
  assert.equal(second, first, "no watch-loop retrigger: the file is rewritten with identical bytes");
});

test("migration: no example lists `apis` in feature.json; every example but the no-contract one has exactly one openapi file", () => {
  for (const name of fs.readdirSync(examples).filter((d) => fs.existsSync(path.join(examples, d, "feature.json")))) {
    const spec = JSON.parse(fs.readFileSync(path.join(examples, name, "feature.json"), "utf8"));
    assert.ok(!("apis" in spec), `${name}: feature.json still has apis`);
    const files = CONTRACT_FILES.filter((f) => fs.existsSync(path.join(examples, name, f)));
    assert.equal(files.length, name === "products-no-contract" ? 0 : 1, `${name}: ${files}`);
  }
  // the envelope list key comes from the contract now, not from feature.json
  assert.equal(readSpec(path.join(examples, "portfolio-redesigned")).list, "categories");
});

// ---------- loading ----------
test("loadContract: none, unusable, and fine", () => {
  const dir = copyExample("products-no-contract");
  const none = loadContract(dir);
  assert.deepEqual([none.present, none.usable, none.state, none.apis], [false, false, "none", []]);
  assert.ok(none.notice.startsWith(NO_CONTRACT));

  fs.writeFileSync(path.join(dir, "openapi.json"), "{ nope");
  const bad = loadContract(dir);
  assert.deepEqual([bad.present, bad.usable, bad.state], [true, false, "invalid"]);
  assert.match(bad.notice, /openapi\.json could not be read/);

  fs.writeFileSync(path.join(dir, "openapi.json"), fs.readFileSync(path.join(examples, "products", "openapi.json")));
  const ok = loadContract(dir);
  assert.deepEqual([ok.usable, ok.file, ok.apis.length, ok.notice], [true, "openapi.json", 4, null]);
});

test("an old feature.json with `apis` is not read, and the notice says how to convert it", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify({ feature: "x", route: "/x", page: "page.jsx", apis: [{ method: "GET", path: "/api/x", response: [] }] }));
  const c = loadContract(dir);
  assert.equal(c.usable, false);
  assert.match(c.notice, /apis-to-openapi/);
});

// ---------- upload ----------
test("upload saves exactly one openapi file: json replaces yaml and back", () => {
  const dir = copyExample("products-no-contract");
  const json = fs.readFileSync(path.join(examples, "products", "openapi.json"), "utf8");
  const yaml = `openapi: 3.0.0
info: { title: t, version: "1" }
paths:
  /api/products:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              example: [{ id: 1, name: Lamp }]
`;
  const files = () => CONTRACT_FILES.filter((f) => fs.existsSync(path.join(dir, f)));
  assert.equal(saveContract(dir, yaml), "openapi.yaml");
  assert.deepEqual(files(), ["openapi.yaml"]);
  assert.equal(saveContract(dir, json), "openapi.json"); // the yaml is removed
  assert.deepEqual(files(), ["openapi.json"]);
  fs.writeFileSync(path.join(dir, "openapi.yml"), yaml); // a stray second file
  assert.equal(saveContract(dir, json), "openapi.json");
  assert.deepEqual(files(), ["openapi.json"]);
});

test("upload of a bad file throws and changes nothing", () => {
  const dir = copyExample("products");
  const before = fs.readFileSync(path.join(dir, "openapi.json"), "utf8");
  for (const bad of ["", "hello", "{ nope", JSON.stringify({ swagger: "1.2", paths: {} }), JSON.stringify({ openapi: "3.0.0", info: {}, paths: {} }), JSON.stringify({ openapi: "3.0.0", info: {}, paths: { "/a/{x}/b/{y}": { get: {} } } })])
    assert.throws(() => saveContract(dir, bad));
  assert.equal(fs.readFileSync(path.join(dir, "openapi.json"), "utf8"), before);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes("openapi")), ["openapi.json"]);
});

test("upload after a run without a contract gives the same files as the same example always had", async () => {
  const dir = copyExample("products"); // feature "products"
  fs.rmSync(path.join(dir, "openapi.json"));
  const before = await run(dir);
  assert.ok(before.open.some((o) => o.id === "contract"));
  saveContract(dir, fs.readFileSync(path.join(examples, "products", "openapi.json"), "utf8"));
  const after = await run(dir);
  const golden = JSON.parse(fs.readFileSync(path.join(root, "src", "fixtures", "pre-migration-output.json"), "utf8"));
  const now = walk(after.out);
  for (const f of Object.keys(golden).filter((f) => f.startsWith("features/products/"))) assert.equal(now[f], golden[f], f);
  assert.equal(after.open.length, 0); // the products example closes completely
});

test("reset removes a contract that was uploaded later, and restores one that shipped with the example", () => {
  const dir = copyExample("products-no-contract");
  saveContract(dir, fs.readFileSync(path.join(examples, "products", "openapi.json"), "utf8"));
  resetExample(dir);
  assert.equal(loadContract(dir).present, false);
  const dir2 = copyExample("products");
  fs.writeFileSync(path.join(dir2, "openapi.json"), "{}");
  resetExample(dir2);
  assert.equal(loadContract(dir2).usable, true);
});

// ---------- a run without a contract ----------
test("a run without a contract is allowed, says so once, and is honest everywhere", async () => {
  const dir = copyExample("products-no-contract");
  const events = [];
  const out = tmp();
  const r = await runPipeline({ dir, outRoot: out, auto: false, emit: (type, data) => events.push({ type, data }) }); // even a "Start" run: nothing to ask
  const files = Object.keys(walk(path.join(out, "features", "products-no-contract")));
  assert.ok(files.length >= 12, files.join(","));

  // the notice comes first
  assert.equal(events[0].type, "contract");
  assert.equal(events[0].data.hasContract, false);
  assert.ok(events[0].data.notice.startsWith(NO_CONTRACT));
  for (const f of ["REPORT.md", "REPORT.html", "status.json"]) assert.ok(read(out, "products-no-contract", f).includes(NO_CONTRACT), f);
  const summary = events.find((e) => e.type === "summary").data.blocks;
  assert.equal(summary[0].key, "contract");
  assert.ok(summary[0].text.includes(NO_CONTRACT));
  assert.equal(events.some((e) => e.type === "question"), false, "nothing is asked without a contract");

  // no noise anywhere: not in the reports, the open items, the events, or as garbage in the generated code
  const code = files.filter((f) => /\.jsx?$/.test(f)).map((f) => read(out, "products-no-contract", f)).join("\n");
  const prose = ["REPORT.md", "REPORT.html", "status.json"].map((f) => read(out, "products-no-contract", f)).join("\n") + JSON.stringify({ items: r.open, events: events.filter((e) => e.type !== "changes") }); // (a code diff legitimately has `undefined` in JS)
  assert.doesNotMatch(prose, /undefined/);
  for (const text of [prose, code]) {
    assert.doesNotMatch(text, /undefined undefined/);
    assert.doesNotMatch(text, /item\.undefined/);
    assert.doesNotMatch(text, /to "apis" in feature\.json/);
    assert.doesNotMatch(text, /Could not line up/);
    assert.doesNotMatch(text, /add a field to the GET response with these values per row/);
  }

  // every open item that needs the API says the contract is missing
  const contractItem = r.open.find((o) => o.id === "contract");
  assert.equal(r.open[0], contractItem);
  const dependents = r.open.filter((o) => o.viaContract);
  assert.ok(dependents.length >= 10);
  for (const o of dependents) assert.match(`${o.why} ${o.hint}`, /contract/i, o.part);
  assert.equal(r.open.length, 1 + dependents.length);

  // team actions: the one "upload the contract" item goes to Backend, and the parts that only wait for it are not repeated
  const teams = events.find((e) => e.type === "actions").data.teams;
  const backend = teams.find((t) => t.key === "backend");
  assert.equal(backend.items[0].id, "contract");
  assert.match(backend.email.body, /No API contract for this feature: upload a Swagger\/OpenAPI file/);
  assert.equal(teams.flatMap((t) => t.items).filter((i) => i.id !== "contract" && dependents.some((d) => d.id === i.id)).length, 0);

  // the tree marks everything that needs the API as missing (not "waiting for an answer")
  const leaves = events.filter((e) => e.type === "tree").at(-1).data.tree.groups.flatMap((g) => g.leaves);
  const need = leaves.filter((l) => /^(list|value|form)\./.test(l.id) && l.id !== "list.sort" || ["action.row.delete", "action.page.save"].includes(l.id));
  assert.ok(need.length >= 10);
  for (const l of need) assert.ok(l.cells.slice(1).filter(Boolean).every((c) => c.state === "missing"), `${l.id}: ${l.cells.map((c) => c?.state)}`); // (the first cell is the design part itself)

  // the code is stubs: a service that fails on purpose, an empty mock, TODO values
  assert.match(read(out, "products-no-contract", "service/products-no-contract.service.js"), /Promise\.reject/);
  assert.match(read(out, "products-no-contract", "mocks/products-no-contract.mock.js"), /const seed = \[\];/);
});

test("the same run in the CLI and with an unusable contract file is honest too", async () => {
  const dir = copyExample("products-no-contract");
  fs.writeFileSync(path.join(dir, "openapi.yaml"), "just: [broken");
  const { open, out } = await run(dir);
  assert.match(open[0].why, /openapi\.yaml could not be read/);
  assert.ok(!JSON.stringify(open).includes("undefined"));
  assert.match(read(out, "products-no-contract", "REPORT.md"), /No usable API contract for this feature/);
});

// ---------- a contract without examples ----------
test("a contract with no example for the list: the code shape is generated, nothing is matched, the gap is named", async () => {
  const dir = copyExample("products-no-contract");
  const doc = {
    openapi: "3.0.0", info: { title: "p", version: "1" },
    paths: {
      "/api/products": {
        get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, price: { type: "number" } } } } } } } } },
        post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, stock: { type: "number" } } } } } }, responses: { 201: { description: "ok" } } },
      },
    },
  };
  saveContract(dir, JSON.stringify(doc));
  const events = [];
  const { open, out } = await runPipeline({ dir, outRoot: tmp(), auto: true, emit: (type, data) => events.push({ type, data }) }).then((r) => ({ open: r.open, out: r.base }));
  const item = open.find((o) => o.id === "contract.examples");
  assert.match(item.why, /The contract has no example for the response of GET \/api\/products/);
  assert.ok(open.filter((o) => o.viaContract).length >= 7);
  for (const o of open.filter((o) => o.viaContract)) assert.match(o.why, /no example/);
  assert.ok(!JSON.stringify(open).includes("undefined"));
  assert.match(fs.readFileSync(path.join(out, "REPORT.md"), "utf8"), /Contract gaps \(openapi\.json\)/);
  // the service and the form types still come from the schema: the shape, without fake values
  assert.match(fs.readFileSync(path.join(out, "service", "products-no-contract.service.js"), "utf8"), /listProductsNoContract = \(\) =>\s*request\("GET", `\/api\/products`\)/);
  assert.match(fs.readFileSync(path.join(out, "domain", "products-no-contract.domain.js"), "utf8"), /price: Number\(values\.price\)/);
  assert.match(fs.readFileSync(path.join(out, "mocks", "products-no-contract.mock.js"), "utf8"), /const seed = \[\];/);
  // the form inputs are typed from the schema, so they are not reported as "not in the API"
  assert.equal(open.some((o) => o.id.startsWith("form.")), false);
  assert.equal(events.find((e) => e.type === "contract").data.hasContract, true);
});

// ---------- the server ----------
// the upload as the page sends it: JSON { name, text } with content-type application/json (the guard refuses anything else)
const upload = (base, name, text) => fetch(`${base}/api/openapi?example=${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "openapi.json", text }) });
function startServer(examplesDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--no-open", "--port", String(4300 + Math.floor(Math.random() * 500)), "--examples", examplesDir, "--out", tmp()], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d) => { const m = String(d).match(/http:\/\/localhost:(\d+)/); if (m) resolve({ child, base: `http://127.0.0.1:${m[1]}` }); });
    child.on("error", reject);
    setTimeout(() => reject(new Error("the server did not start")), 8000).unref();
  });
}

test("server: /api/examples and /api/contract report the contract; POST /api/openapi validates and saves one file", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "products-no-contract"), path.join(dir, "products-no-contract"), { recursive: true });
  fs.cpSync(path.join(examples, "products"), path.join(dir, "products"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const list = await (await fetch(`${base}/api/examples`)).json();
    const by = Object.fromEntries(list.map((e) => [e.name, e]));
    assert.deepEqual([by.products.hasContract, by.products.contractFile, by.products.endpoints.length], [true, "openapi.json", 4]);
    assert.deepEqual([by["products-no-contract"].hasContract, by["products-no-contract"].contractFile, by["products-no-contract"].gaps], [false, null, []]);

    const none = await (await fetch(`${base}/api/contract?example=products-no-contract`)).json();
    assert.equal(none.hasContract, false);
    assert.ok(none.notice.startsWith(NO_CONTRACT));

    const post = (name, text) => upload(base, name, text);
    let res = await post("products-no-contract", "this is not a contract");
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /can't be used/);
    assert.equal((await post("nope", "{}")).status, 404);
    assert.equal((await post("products-no-contract", "x".repeat(3 * 1024 * 1024))).status, 413);
    assert.equal(CONTRACT_FILES.filter((f) => fs.existsSync(path.join(dir, "products-no-contract", f))).length, 0);

    res = await post("products-no-contract", fs.readFileSync(path.join(examples, "products", "openapi.json"), "utf8"));
    assert.equal(res.status, 200);
    const got = await res.json();
    assert.deepEqual([got.hasContract, got.file, got.endpoints.length, got.gaps], [true, "openapi.json", 4, []]);
    assert.deepEqual(got.endpoints[0], { method: "GET", path: "/api/products", label: "GET /api/products", request: "none", response: "example" });
    const after = await (await fetch(`${base}/api/contract?example=products-no-contract`)).json();
    assert.deepEqual([after.hasContract, after.file, after.apis.length], [true, "openapi.json", 4]);

    // a YAML upload replaces the JSON: still exactly one file
    res = await post("products-no-contract", "openapi: 3.0.0\ninfo: { title: t, version: '1' }\npaths:\n  /api/products:\n    get:\n      responses:\n        '200':\n          description: ok\n");
    assert.equal(res.status, 200);
    const yamlDone = await res.json();
    assert.equal(yamlDone.file, "openapi.yaml");
    assert.deepEqual(yamlDone.gaps.map((g) => g.kind), []); // no body declared at all: nothing to be missing
    assert.deepEqual(fs.readdirSync(path.join(dir, "products-no-contract")).filter((f) => f.startsWith("openapi")), ["openapi.yaml"]);
  } finally {
    child.kill();
  }
});

test("server: watch mode re-runs when the openapi file changes", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "products-no-contract"), path.join(dir, "products-no-contract"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    // follow /api/live: the server announces the re-run the watcher starts
    const live = await fetch(`${base}/api/live`);
    const reader = live.body.getReader();
    const started = (async () => {
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        text += new TextDecoder().decode(value);
        const m = text.match(/data: (\{.*\})/);
        if (m) return JSON.parse(m[1]);
      }
    })();
    const { run } = await (await fetch(`${base}/api/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "products-no-contract", auto: true, watch: true }) })).json();
    assert.ok(run);
    await new Promise((r) => setTimeout(r, 2500)); // the first run finishes and the watcher settles
    await upload(base, "products-no-contract", fs.readFileSync(path.join(examples, "products", "openapi.json"), "utf8"));
    const ev = await Promise.race([started, new Promise((r) => setTimeout(() => r("timeout"), 6000))]);
    assert.notEqual(ev, "timeout", "the watcher did not notice the new openapi file");
    assert.equal(ev.type, "run");
    assert.equal(ev.example, "products-no-contract");
    reader.cancel();
  } finally {
    child.kill();
  }
});

// ---------- reading an upload ----------
test("an upload keeps multi-byte characters intact and is refused when it is not the JSON the page sends", async () => {
  const dir = tmp();
  fs.cpSync(path.join(examples, "products-no-contract"), path.join(dir, "products-no-contract"), { recursive: true });
  const { child, base } = await startServer(dir);
  try {
    const yaml = "openapi: 3.0.0\ninfo: { title: café — 日本語 🎉, version: '1' }\npaths:\n  /api/products:\n    get:\n      responses:\n        '200':\n          description: ok\n";
    const res = await upload(base, "products-no-contract", yaml);
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(path.join(dir, "products-no-contract", "openapi.yaml"), "utf8"), yaml);
    const url = `${base}/api/openapi?example=products-no-contract`;
    assert.equal((await fetch(url, { method: "POST", body: yaml })).status, 415, "a raw body (no content type) is refused by the guard");
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: yaml })).status, 415);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: "{}" })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).status, 400, "no text");
  } finally {
    child.kill();
  }
});

// ---------- T12.1: interactive AI sample generation for a field with no example ----------
test("server: POST /api/contract/sample proposes a value for a field with no example, and never persists anything", async () => {
  const dir = tmp();
  const name = "gapfield";
  const edir = path.join(dir, name);
  fs.mkdirSync(edir, { recursive: true });
  fs.writeFileSync(path.join(edir, "feature.json"), JSON.stringify({ feature: name, route: "/x", page: "page.jsx" }));
  fs.writeFileSync(path.join(edir, "page.jsx"), "export default function P() { return <div />; }\n");
  const doc = {
    openapi: "3.0.0", info: { title: "t", version: "1" },
    paths: { "/api/summary": { get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { total: { type: "integer", example: 5 }, region: { type: "string" } } } } } } } } } },
  };
  fs.writeFileSync(path.join(edir, "openapi.json"), JSON.stringify(doc));
  assert.deepEqual(loadContract(edir).gaps.map((g) => [g.kind, g.where, g.path]), [["field-no-example", "response", "region"]], "the fixture really has the gap this test exercises");
  // a fake local model that never gives a usable {"value": ...} reply, so the route's own checking is what this test proves
  const fakeModel = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ message: { content: '{"nope": true}' } })); });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
  fs.writeFileSync(path.join(edir, "ai.json"), JSON.stringify({ tasks: { "generate-sample": { provider: "ollama", model: "m", baseUrl: fakeModel.url } } }));
  const before = fs.readFileSync(path.join(edir, "openapi.json"), "utf8");
  const { child, base } = await startServer(dir);
  try {
    const req = (b) => fetch(`${base}/api/contract/sample`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const res = await req({ example: name, method: "GET", path: "/api/summary", where: "response", field: "region" });
    assert.equal(res.status, 502, "the fake model's reply has no usable value, so the route declines rather than making one up");
    assert.match((await res.json()).error, /didn't give a usable sample/);
    assert.equal((await req({ example: "nope", method: "GET", path: "/api/summary", where: "response", field: "region" })).status, 404, "unknown example");
    assert.equal((await req({ example: name, method: "GET", path: "/api/nope", where: "response", field: "region" })).status, 404, "unknown endpoint");
    assert.equal((await req({ example: name, method: "GET", path: "/api/summary", where: "sideways", field: "region" })).status, 400, "bad 'where'");
    // nothing this route can do ever touches the contract file or writes a new one
    assert.equal(fs.readFileSync(path.join(edir, "openapi.json"), "utf8"), before);
    assert.deepEqual(fs.readdirSync(edir).sort(), ["ai.json", "feature.json", "openapi.json", "page.jsx"]);
  } finally {
    child.kill();
    fakeModel.close();
  }
});

test("the orders 'fix' flow: copying fixed.openapi.json over openapi.json closes everything", async () => {
  const dir = copyExample("orders");
  const before = await run(dir);
  assert.ok(before.open.length > 0);
  fs.copyFileSync(path.join(dir, "fixed.openapi.json"), path.join(dir, "openapi.json"));
  assert.equal((await run(dir)).open.length, 0);
});

// ---------- paths with several parameters (R1.1): imported and listed, never generated ----------
test("example-level: a contract with nested-path endpoints added imports them as endpoints (no gap), saves, and generates the same files as without them", async () => {
  const nested = JSON.parse(fs.readFileSync(path.join(root, "src", "fixtures", "nested-paths.openapi.json"), "utf8"));
  const plainDir = copyExample("products"), nestedDir = copyExample("products");
  const doc = JSON.parse(fs.readFileSync(path.join(nestedDir, "openapi.json"), "utf8"));
  const extra = { "/api/products/{id}/reviews": nested.paths["/api/customers/{id}/orders"], "/api/products/{id}/reviews/{reviewId}": nested.paths["/api/customers/{id}/orders/{orderId}"] };
  // the nested endpoints come FIRST in the file: the plain ones must still be the ones that are picked
  const merged = { ...doc, paths: { ...extra, ...doc.paths } };
  const text = JSON.stringify(merged, null, 2);
  fs.rmSync(path.join(nestedDir, "openapi.json"));
  assert.equal(saveContract(nestedDir, text), "openapi.json", "a contract with nested endpoints is accepted");

  const c = loadContract(nestedDir);
  assert.equal(c.usable, true);
  assert.deepEqual(c.gaps.filter((g) => g.kind === "unsupported"), [], "reported as endpoints, not as gaps");
  const wired = c.endpoints.filter((e) => e.wired === false).map((e) => e.label);
  assert.deepEqual(wired, ["GET /api/products/:id/reviews", "POST /api/products/:id/reviews", "GET /api/products/:id/reviews/:reviewId", "PUT /api/products/:id/reviews/:reviewId", "DELETE /api/products/:id/reviews/:reviewId"]);
  assert.equal(c.endpoints.length, loadContract(plainDir).endpoints.length + 5);
  assert.equal(loadContract(plainDir).endpoints.some((e) => "wired" in e), false, "an ordinary contract's endpoint list has no new field");

  const [a, b] = [await run(plainDir), await run(nestedDir)];
  const code = (r) => Object.fromEntries(Object.entries(walk(path.join(r.out, "features"))).filter(([f]) => !/(^|\/)(REPORT\.|status\.json)/.test(f)));
  assert.deepEqual(code(b), code(a), "the generated code and tests are byte-identical: nothing is generated for an endpoint the generator cannot call");
  assert.ok(Object.keys(code(a)).length > 5);
});
