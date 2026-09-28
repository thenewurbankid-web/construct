import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCase } from "./adapter.mjs";
import { getVariant, registerVariant, baselineAnalyze } from "./variants.mjs";
import { fingerprint, checkDeterminism, drifted, shuffleSpec } from "./determinism.mjs";
import { here } from "./util.mjs";

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-det-"));
const example = () => loadCase(here("cases", "example-roster"));

test("the baseline is deterministic on a case, run twice and with endpoints reordered", async () => {
  const l = example(), v = getVariant("baseline"), w = scratch();
  const base = await fingerprint(l, v, l.spec, path.join(w, "base"));
  const det = await checkDeterminism(l, v, base, w);
  assert.equal(drifted(det), false);
});

test("an injected nondeterminism is caught", async () => {
  let n = 0;
  registerVariant({ name: "test-flaky", describe: "test only", analyze: baselineAnalyze, generate: async () => ({ "x.js": `run ${n++}` }) });
  const l = example(), v = getVariant("test-flaky"), w = scratch();
  const base = await fingerprint(l, v, l.spec, path.join(w, "base"));
  const det = await checkDeterminism(l, v, base, w);
  assert.equal(drifted(det), true);
  assert.equal(det.repeat.same, false);
  assert.deepEqual(det.repeat.filesChanged, ["x.js"]);
});

test("an order-dependent variant is caught by the endpoint-order check", async () => {
  // picks whichever GET is listed first: the very dependence findEndpoints() has today
  registerVariant({ name: "test-order", describe: "test only", analyze: baselineAnalyze, generate: async ({ spec }) => ({ "first.js": spec.apis[0].path }) });
  const l = loadCase(here("cases", "decoy-endpoint-01")), v = getVariant("test-order"), w = scratch();
  const base = await fingerprint(l, v, l.spec, path.join(w, "base"));
  const det = await checkDeterminism(l, v, base, w);
  assert.equal(det.apisOrder.same, false);
});

test("shuffles are seeded and really reorder", () => {
  const l = example();
  const a = shuffleSpec(l.spec, "apisOrder", 3), b = shuffleSpec(l.spec, "apisOrder", 3);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.apis.map((x) => x.method + x.path), l.spec.apis.map((x) => x.method + x.path));
  const k = shuffleSpec(l.spec, "keyOrder", 3);
  assert.deepEqual(JSON.parse(JSON.stringify(k.apis[0].response[0], Object.keys(k.apis[0].response[0]).sort())), JSON.parse(JSON.stringify(l.spec.apis[0].response[0], Object.keys(l.spec.apis[0].response[0]).sort())));
});
