// Route-level tests for the import wizard (T13.7), in the style of build-routes.test.mjs (a fake response, no real
// HTTP server needed for most of these; server.test.mjs separately exercises the guard/CSRF behaviour on a real
// server once the routes are registered there).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importWizardRoute } from "./import-wizard-routes.mjs";

const fakeRes = () => { const r = { code: null, headers: null, body: "", writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b; } }; return r; };
const call = async (method, p, { examplesDir = "/nope", known = () => true, readBody = async () => ({}) } = {}) => {
  const res = fakeRes();
  const handled = await importWizardRoute({ method }, res, new URL("http://localhost" + p), { examplesDir, known, readBody });
  return { handled, res, json: () => JSON.parse(res.body) };
};

// A tiny, self-contained example (not one of the shipped ones): an enveloped response with TWO array
// properties, so the endpoint-choice override (T13.5/T13.6) has something real to disambiguate.
function scratchExample() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-wizard-"));
  const name = "widgets";
  const edir = path.join(dir, name);
  fs.mkdirSync(edir);
  fs.writeFileSync(path.join(edir, "feature.json"), JSON.stringify({ feature: name, route: `/${name}`, page: "page.jsx", about: "scratch fixture for the wizard route test" }));
  fs.writeFileSync(path.join(edir, "page.jsx"), "export default function P() { return <div>hi</div>; }\n");
  fs.writeFileSync(path.join(edir, "openapi.json"), JSON.stringify({
    openapi: "3.0.0", info: { title: "t", version: "1" },
    paths: { "/api/things": { get: { responses: { 200: { description: "ok", content: { "application/json": {
      schema: { type: "object", properties: { items: { type: "array", items: { type: "object" } }, tags: { type: "array", items: { type: "string" } } } },
      example: { items: [{ id: 1 }], tags: ["a"] },
    } } } } } } },
  }));
  return { examplesDir: dir, name, dir: edir };
}

const PAGE = `export default function P() {\n  return (\n    <div>\n      <span>$5.6M</span>\n    </div>\n  );\n}\n`;

test("static files: /import-wizard, /ui/import-wizard.mjs and /ui/subframe-fixture.mjs serve the real files", async () => {
  const page = await call("GET", "/import-wizard");
  assert.equal(page.handled, true);
  assert.equal(page.res.code, 200);
  assert.match(page.res.body.toString(), /Import wizard/);

  const mod = await call("GET", "/ui/import-wizard.mjs");
  assert.equal(mod.res.code, 200);
  assert.equal(mod.res.headers["content-type"], "text/javascript");
  assert.match(mod.res.body.toString(), /installImportWizard/);

  const fixture = await call("GET", "/ui/subframe-fixture.mjs");
  assert.equal(fixture.res.code, 200);
  assert.match(fixture.res.body.toString(), /MOCK_SUBFRAME_PROJECT/);
});

test("an unrelated path is not handled (falls through to the rest of the server)", async () => {
  assert.equal((await call("GET", "/api/other")).handled, false);
  assert.equal((await call("GET", "/nothing")).handled, false);
});

test("GET /api/wizard/subframe/status never claims a live connection when no token is set", async () => {
  delete process.env.SUBFRAME_MCP_ACCESS_TOKEN;
  const { res, json } = await call("GET", "/api/wizard/subframe/status");
  assert.equal(res.code, 200);
  assert.equal(json().connected, false);
  assert.match(json().reason, /OAuth 2\.1/);
});

test("POST /api/wizard/markers/suggest runs T18's real suggestMarkers() and returns its suggestions", async () => {
  const { res, json } = await call("POST", "/api/wizard/markers/suggest", { readBody: async () => ({ source: PAGE }) });
  assert.equal(res.code, 200);
  assert.ok(json().suggestions.length > 0);
  assert.ok(json().suggestions.some((s) => s.kind === "dyn"));
});

test("POST /api/wizard/markers/suggest with no source is a 400, not a crash", async () => {
  const { res, json } = await call("POST", "/api/wizard/markers/suggest", { readBody: async () => ({}) });
  assert.equal(res.code, 400);
  assert.match(json().error, /source/);
});

test("POST /api/wizard/markers/apply writes the accepted marker and applying twice changes nothing more", async () => {
  const s1 = await call("POST", "/api/wizard/markers/suggest", { readBody: async () => ({ source: PAGE }) });
  const dynId = s1.json().suggestions.find((s) => s.kind === "dyn").id;
  const a1 = await call("POST", "/api/wizard/markers/apply", { readBody: async () => ({ source: PAGE, acceptedIds: [dynId] }) });
  assert.equal(a1.res.code, 200);
  assert.match(a1.json().source, /data-dyn=/);
  const a2 = await call("POST", "/api/wizard/markers/apply", { readBody: async () => ({ source: a1.json().source, acceptedIds: [dynId] }) });
  assert.equal(a2.json().source, a1.json().source, "applying an already-applied id is a no-op");
});

test("POST /api/wizard/markers/apply on unparsable JSX is a 400 with a real reason, not a 500", async () => {
  const { res, json } = await call("POST", "/api/wizard/markers/apply", { readBody: async () => ({ source: "not { valid jsx <<<", acceptedIds: [] }) });
  assert.equal(res.code, 400);
  assert.ok(json().error.length > 0);
});

test("POST /api/wizard/apply: unknown example is a 404", async () => {
  const { res } = await call("POST", "/api/wizard/apply", { known: () => false, readBody: async () => ({ example: "nope" }) });
  assert.equal(res.code, 404);
});

test("POST /api/wizard/apply: setting listKey writes feature.json's existing `list` override, and loadContract picks it up (T13.6 hand-off)", async () => {
  const ex = scratchExample();
  const known = (n) => n === ex.name;
  const before = JSON.parse(fs.readFileSync(path.join(ex.dir, "feature.json"), "utf8"));
  assert.equal("list" in before, false);

  const r1 = await call("POST", "/api/wizard/apply", { examplesDir: ex.examplesDir, known, readBody: async () => ({ example: ex.name, listKey: "tags" }) });
  assert.equal(r1.res.code, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ex.dir, "feature.json"), "utf8")).list, "tags");
  assert.equal(r1.json().listKey, "tags", "the contract now reads back the forced key");

  const r2 = await call("POST", "/api/wizard/apply", { examplesDir: ex.examplesDir, known, readBody: async () => ({ example: ex.name, listKey: "items" }) });
  assert.equal(JSON.parse(fs.readFileSync(path.join(ex.dir, "feature.json"), "utf8")).list, "items");
  assert.equal(r2.json().listKey, "items");

  const r3 = await call("POST", "/api/wizard/apply", { examplesDir: ex.examplesDir, known, readBody: async () => ({ example: ex.name, listKey: null }) });
  assert.equal("list" in JSON.parse(fs.readFileSync(path.join(ex.dir, "feature.json"), "utf8")), false, "a null listKey clears the override");
});

test("POST /api/wizard/apply: pageSource is validated (parsePage) before it is written, and otherwise replaces the page file atomically", async () => {
  const ex = scratchExample();
  const known = (n) => n === ex.name;
  const bad = await call("POST", "/api/wizard/apply", { examplesDir: ex.examplesDir, known, readBody: async () => ({ example: ex.name, pageSource: "function( {{{" }) });
  assert.equal(bad.res.code, 400);
  assert.equal(fs.readFileSync(path.join(ex.dir, "page.jsx"), "utf8"), "export default function P() { return <div>hi</div>; }\n", "a bad page is never written");

  const ok = await call("POST", "/api/wizard/apply", { examplesDir: ex.examplesDir, known, readBody: async () => ({ example: ex.name, pageSource: PAGE }) });
  assert.equal(ok.res.code, 200);
  assert.equal(fs.readFileSync(path.join(ex.dir, "page.jsx"), "utf8"), PAGE);
  assert.deepEqual(fs.readdirSync(ex.dir).filter((f) => f.startsWith(".")), [], "no leftover temp file");
});
