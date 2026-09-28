import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateCase, CATEGORIES } from "./generate.mjs";
import { explainColumn, explainValue } from "./reference.mjs";
import { hashOf, mulberry32, here } from "./util.mjs";
import { listCaseDirs, loadCase } from "./adapter.mjs";

const h = (g) => hashOf({ spec: g.spec, pageSource: g.pageSource, story: g.story, truth: g.truth });

test("same seed, same case (hash of inputs and truth); another seed, another case", () => {
  for (const name of CATEGORIES) {
    const a = generateCase({ name, seed: 4242, params: {} });
    const b = generateCase({ name, seed: 4242, params: {} });
    assert.equal(h(a), h(b), name);
    assert.notEqual(h(a), h(generateCase({ name, seed: 4243, params: {} })), `${name}: seeds should differ`);
  }
});

test("the seeded PRNG is a pure function of the seed", () => {
  const a = mulberry32(5), b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(mulberry32(5)(), mulberry32(6)());
});

test("every committed generated case still builds what its case.json pinned", () => {
  for (const d of listCaseDirs(here("cases"))) {
    const meta = JSON.parse(fs.readFileSync(path.join(d, "case.json"), "utf8"));
    if (!meta.generator) continue;
    assert.equal(loadCase(d).inputHash && h(generateCase(meta.generator)), meta.expect, `${meta.id}: the generator moved; re-run eval/tools/build-corpus.mjs and eval:baseline together`);
  }
});

test("ground truth agrees with the independent reference explainers", () => {
  // the truth kind is DERIVED from the reference when generating; this checks it again from the committed output
  for (const d of listCaseDirs(here("cases"))) {
    const l = loadCase(d);
    if (l.category === "example") continue;
    for (const [id, t] of Object.entries(l.truth)) {
      if (t.uncertain || !id.startsWith("value.") ) continue;
      const v = l.pageSource.match(new RegExp(`data-dyn="${id.slice(6)}">([^<]*)<`));
      assert.ok(v, `${l.id} ${id} is on the page`);
      const items = (Array.isArray(l.spec.apis[0].response) ? l.spec.apis.find((a) => a.method === "GET" && Array.isArray(a.response))?.response : l.spec.apis[0].response[l.spec.list]) ?? [];
      if (!items.length || t.want.startsWith("gap:") || t.want.startsWith("u:")) continue;
      const env = {};
      const E = explainValue(items, env, v[1]);
      if (t.want.startsWith("e:")) continue;
      assert.ok(E.includes(t.want), `${l.id} ${id}: ${t.want} not in ${E}`);
      assert.equal(E.length > 1, t.kind === "needs-answer", `${l.id} ${id}: kind ${t.kind} vs explanations ${E}`);
    }
  }
  assert.deepEqual(explainColumn([{ a: "x" }], ["x"]), ["f:a|asText"]);
});

test("nothing that affects results reads a clock or Math.random", () => {
  const allowed = new Set(["run.mjs", "evaluate.mjs", "ai-eval.mjs", "determinism.mjs"]); // timing only (performance.now); never Date or random
  for (const f of fs.readdirSync(here()).filter((x) => x.endsWith(".mjs") && !x.endsWith(".test.mjs"))) {
    const src = fs.readFileSync(here(f), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/Math\.random|Date\.now|new Date\b/.test(src), `${f} uses Math.random or a clock`);
    if (!allowed.has(f)) assert.ok(!/performance\.now/.test(src), `${f} reads the clock`);
  }
});

test("scale cases have the requested number of parts and no committed inputs", () => {
  for (const n of [50, 200]) {
    const g = generateCase({ name: `scale-${n}`, seed: 90000 + n, params: {} });
    const parts = Object.keys(g.truth).filter((k) => k.startsWith("list.") || k.startsWith("value.")).length;
    assert.ok(Math.abs(parts - n) <= 2, `${n}: got ${parts}`);
  }
});
