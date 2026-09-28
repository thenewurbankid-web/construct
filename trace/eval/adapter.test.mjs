import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCase, readContract, writeContract, CONTRACT_FILES } from "./adapter.mjs";
import { apisToOpenApi } from "../src/apis-to-openapi.mjs";
import { readOpenApi } from "../src/openapi.mjs";
import { loadContract } from "../src/contract.mjs";
import { getVariant } from "./variants.mjs";
import { evaluateCase } from "./evaluate.mjs";
import { here } from "./util.mjs";

const fixture = here("fixtures", "openapi-tiny");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-adapter-"));

test("an openapi file in the folder is read first, and feature.json needs no apis", () => {
  const spec = readContract(fixture);
  assert.equal(spec.feature, "things");
  assert.deepEqual(spec.apis.map((a) => `${a.method} ${a.path}`), ["GET /api/things", "POST /api/things", "PUT /api/things/:id", "DELETE /api/things/:id"]);
  assert.equal(spec.apis[0].response.length, 3);
  assert.deepEqual(spec.apis[1].response, { id: 4, name: "Mug", price: 900, stock: 5 }, "a $ref schema with property examples becomes an example body");
  assert.deepEqual(spec.apis[1].request, { name: "Mug", price: 900, stock: 5 });
  assert.equal(spec.apis[3].response, undefined);
});

test("loadCase works on an openapi folder and scores through the same code path", async () => {
  const l = loadCase(fixture);
  assert.equal(l.spec.apis.length, 4);
  const r = await evaluateCase(l, getVariant("baseline"), {});
  assert.equal(r.counts.unlabelled, 0);
  assert.deepEqual(r.orphans, []);
  assert.equal(r.counts.wrong_accepts, 0);
  assert.equal(r.counts.match_hits, r.counts.match_parts);
});

test("the apis format still loads, and both formats give the same spec", () => {
  const d = tmp();
  const spec = readContract(fixture);
  writeContract(d, spec, { format: "apis" });
  const viaApis = readContract(d);
  assert.deepEqual(viaApis.apis, spec.apis);
  assert.ok(!CONTRACT_FILES.some((f) => fs.existsSync(path.join(d, f))));
});

test("writing openapi (what the pipeline will read after the Swagger merge) round-trips", () => {
  const d = tmp();
  const spec = readContract(fixture);
  fs.writeFileSync(path.join(d, "page.jsx"), "x");
  writeContract(d, spec, { format: "openapi" });
  assert.ok(fs.existsSync(path.join(d, "openapi.json")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "feature.json"), "utf8")).apis, undefined);
  assert.deepEqual(readContract(d).apis, spec.apis);
  // and an existing example converts both ways
  const roster = JSON.parse(fs.readFileSync(here("cases", "example-roster", "feature.json"), "utf8"));
  assert.deepEqual(readOpenApi(JSON.stringify(apisToOpenApi(roster.apis, { title: "roster" }))).apis, roster.apis);
});

test("the eval reads a contract with Trace's own loader: YAML works, and both give the same answer as loadContract", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "feature.json"), JSON.stringify({ feature: "things", route: "/things", page: "page.jsx" }));
  fs.writeFileSync(path.join(d, "openapi.yaml"), "openapi: 3.0.3\ninfo: { title: t, version: '1' }\npaths:\n  /api/things:\n    get:\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              example: [{ id: 1, name: A }]\n");
  const spec = readContract(d);
  assert.deepEqual(spec.apis, loadContract(d).apis);
  assert.deepEqual(spec.apis[0].response, [{ id: 1, name: "A" }]);
  assert.equal("contract" in spec, false, "the loader's bookkeeping does not leak into the neutral spec");
});
