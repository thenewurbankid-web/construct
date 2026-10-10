// The ONE place where the eval knows what a case looks like on disk and how Trace reads its inputs.
//
// The API contract is an OpenAPI file in the case folder (openapi.json / .yaml / .yml), read with the SAME loader the
// pipeline uses (src/contract.mjs: readSpec), so the eval can never disagree with Trace about what a contract says.
// The stored cases (eval/cases/*/feature.json) still keep the contract as `apis` (example request/response bodies),
// which is a neutral, diff-friendly snapshot format: readContract() accepts that fallback, and writeContract() turns
// `apis` into an openapi file (src/apis-to-openapi.mjs) where the pipeline will read it. Everything else in the eval
// works on the neutral `spec` object those two functions produce and consume.
//
// A case directory holds case.json and either
//   - a snapshot of the inputs (feature.json, page.jsx, optional story.md), or
//   - a `generator` block in case.json ({ name, seed, params }): the inputs and the ground truth are rebuilt
//     from the seed on every load, so nothing but the seed needs committing.
import fs from "node:fs";
import path from "node:path";
import { readJson, hashOf } from "./util.mjs";
import { generateCase } from "./generate.mjs";
import { applyFilled } from "./labeling/fold.mjs";
import { readSpec, CONTRACT_FILES } from "../src/contract.mjs";
import { apisToOpenApi } from "../src/apis-to-openapi.mjs";

// --- the contract format --------------------------------------------------------------------------------------
export { CONTRACT_FILES };
export const contractSource = () => "src/contract.mjs (openapi), feature.json apis as the stored snapshot format";

const readFeature = (dir) => { try { return readJson(path.join(dir, "feature.json")); } catch { return {}; } };

// The neutral spec of a folder: feature.json's fields, `apis`, and `list` (an envelope's array key) when there is one.
export function readContract(dir) {
  if (!CONTRACT_FILES.some((f) => fs.existsSync(path.join(dir, f)))) return readFeature(dir); // the stored snapshot: `apis` in feature.json
  const { contract: _c, ...spec } = readSpec(dir);
  return spec;
}

// Writes a spec where the PIPELINE reads it: an openapi file (or, with format "apis", the stored snapshot format).
export function writeContract(dir, spec, { format = "openapi" } = {}) {
  // key order is kept as authored: it is part of the input (it decides the order of tie options)
  for (const f of CONTRACT_FILES) fs.rmSync(path.join(dir, f), { force: true });
  if (format === "openapi") {
    const { apis, ...rest } = spec;
    fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify(rest, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "openapi.json"), JSON.stringify(apisToOpenApi(apis, { title: spec.feature ?? "feature" }), null, 2) + "\n");
  } else fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify(spec, null, 2) + "\n");
}
// ---------------------------------------------------------------------------------------------------------------

export function loadCase(dir) {
  const meta = readJson(path.join(dir, "case.json"));
  let spec, pageSource, story = null, truth = meta.truth ?? null, generated = null;
  if (meta.generator) {
    generated = generateCase(meta.generator);
    ({ spec, pageSource, story, truth } = generated);
  } else {
    spec = readContract(dir);
    pageSource = fs.readFileSync(path.join(dir, spec.page ?? "page.jsx"), "utf8");
    const s = path.join(dir, "story.md");
    story = fs.existsSync(s) ? fs.readFileSync(s, "utf8") : null;
  }
  const loaded = { id: meta.id, category: meta.category, meta, spec, pageSource, story, truth, dir };
  if (!meta.generator) applyFilled(loaded); // independent labels from a filled worksheet, when there is one
  loaded.inputHash = hashOf({ spec, pageSource, story, truth: loaded.truth });
  return loaded;
}

// Writes the inputs where the pipeline expects them. `spec` may be replaced (shuffled orders in the determinism check).
export function writeInputs(loaded, dir, spec = loaded.spec) {
  fs.mkdirSync(dir, { recursive: true });
  writeContract(dir, spec);
  fs.writeFileSync(path.join(dir, spec.page ?? "page.jsx"), loaded.pageSource);
  if (loaded.story) fs.writeFileSync(path.join(dir, "story.md"), loaded.story);
  return dir;
}

export function listCaseDirs(casesDir) {
  return fs.readdirSync(casesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(casesDir, e.name, "case.json")))
    .map((e) => path.join(casesDir, e.name))
    .sort();
}
