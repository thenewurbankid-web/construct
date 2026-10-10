#!/usr/bin/env node
// Writes the committed synthetic cases: eval/cases/<category>-<n>/case.json (a generator block: name, seed, params)
// and eval/scale/scale-<parts>/case.json. Only the seed is committed; inputs and ground truth are rebuilt on load.
// `expect` pins a hash of what the seed builds, so a generator change that moves a committed case is noticed.
import fs from "node:fs";
import path from "node:path";
import { generateCase } from "../generate.mjs";
import { ROOT, writeJson, hashOf } from "../util.mjs";

const CASES = {
  clean: [{}, {}, { envelope: true }, { cols: 4 }, { cols: 2 }],
  "coincidence-shared": [{ value: false, story: false }, { value: true, story: false }, { value: false, story: true }, { value: true, story: true }, {}, {}],
  "coincidence-spurious": [{ parts: 1 }, { parts: 1 }, { parts: 2 }, { parts: 2 }, { parts: 3 }, { parts: 3 }],
  "ties-sort": [{ story: false }, { story: true }, { story: false }, { story: true }],
  "ties-agg": [{ mode: "single" }, { mode: "single" }, { mode: "constant" }, { mode: "constant" }, {}],
  coupled: [{ k: 2 }, { k: 2, totals: true }, { k: 3 }, { k: 3, totals: true }, { k: 2, totals: false }],
  "missing-field": [{ parts: 1, resolution: "todo" }, { parts: 2, resolution: "custom" }, { parts: 3 }, { parts: 2, resolution: "?" }, { parts: 1, resolution: "custom" }],
  "missing-endpoint": [{ mode: "no-delete" }, { mode: "no-delete" }, { mode: "no-write" }, { mode: "no-list" }, { mode: "unknown-verb" }, { mode: "unknown-verb" }],
  noisy: [{ noise: ["ws"] }, { noise: ["case"] }, { noise: ["hash", "ws"] }, { noise: ["locale", "case"] }, { noise: ["spaced"] }, {}],
  "decoy-fields": [{}, {}, {}, { hidden: true }, { hidden: true }],
  "decoy-endpoint": [{ decoyFirst: true }, { decoyFirst: true }, { decoyFirst: false }, { decoyFirst: false }],
  "multi-agg": [{ tie: false }, { tie: true }, { tie: false, values: 10 }, { tie: true, values: 10 }, {}],
};
const SCALE = [50, 200, 1000, 2000];
const BASE_SEED = { clean: 1000, "coincidence-shared": 2000, "coincidence-spurious": 3000, "ties-sort": 4000, "ties-agg": 5000, coupled: 6000, "missing-field": 7000, "missing-endpoint": 8000, noisy: 9000, "decoy-fields": 10000, "decoy-endpoint": 11000, "multi-agg": 12000 };

const write = (dir, id, generator) => {
  const g = generateCase(generator);
  fs.rmSync(dir, { recursive: true, force: true });
  writeJson(path.join(dir, "case.json"), {
    id, category: generator.name.startsWith("scale-") ? "scale" : generator.name, generator,
    expect: hashOf({ spec: g.spec, pageSource: g.pageSource, story: g.story, truth: g.truth }),
  });
};

let n = 0;
for (const [name, list] of Object.entries(CASES)) {
  list.forEach((params, i) => {
    const id = `${name}-${String(i + 1).padStart(2, "0")}`;
    write(path.join(ROOT, "eval", "cases", id), id, { name, seed: BASE_SEED[name] + i * 17 + 1, params });
    n++;
  });
}
for (const parts of SCALE) write(path.join(ROOT, "eval", "scale", `scale-${parts}`), `scale-${parts}`, { name: `scale-${parts}`, seed: 90000 + parts, params: {} });
console.log(`${n} synthetic cases, ${SCALE.length} scale cases`);
