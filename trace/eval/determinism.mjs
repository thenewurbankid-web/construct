// Determinism: the same inputs must give the same outputs, and outputs must not depend on the order things were
// listed in. A run is fingerprinted (hash of every generated file, of the question list, of the per-part
// predictions); fingerprints are compared across
//   repeat     the same inputs run twice
//   apisOrder  the endpoints listed in a different order
//   keyOrder   JSON object keys in a different order (reported; see below)
// Key order is treated separately because Trace copies the example data into mocks/*.mock.js and the domain
// tests as written, so those two files legitimately follow the input. Any OTHER file, or the question set,
// changing with key order is order-sensitivity, and it is counted.
import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "../src/pipeline.mjs";
import { extract } from "../src/extract.mjs";
import { describeParts } from "./truth.mjs";
import { rngTools, seedFrom, hashOf, sortKeys } from "./util.mjs";
import { writeInputs } from "./adapter.mjs";

const ECHO = [/^mocks\//, /\.domain\.test\.js$/];
export const isEcho = (rel) => ECHO.some((r) => r.test(rel));

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}

const shuffleKeys = (v, r) =>
  Array.isArray(v) ? v.map((x) => shuffleKeys(x, r))
  : v && typeof v === "object" ? Object.fromEntries(r.shuffle(Object.keys(v)).map((k) => [k, shuffleKeys(v[k], r)]))
  : v;

// Reorders inputs that should not matter. Row order inside a list is NOT touched: it is meaningful.
export function shuffleSpec(spec, mode, seed) {
  const r = rngTools(seed);
  if (mode === "apisOrder") {
    // a permutation that really differs from the original (a 50% no-op on two endpoints would hide order dependence)
    const same = (a) => a.every((x, i) => x === spec.apis[i]);
    let apis = r.shuffle(spec.apis);
    for (let i = 0; i < 5 && spec.apis.length > 1 && same(apis); i++) apis = r.shuffle(spec.apis);
    if (spec.apis.length > 1 && same(apis)) apis = [...spec.apis].reverse();
    return { ...spec, apis };
  }
  if (mode === "keyOrder") return { ...spec, apis: spec.apis.map((a) => shuffleKeys(a, r)) };
  throw new Error(`unknown shuffle ${mode}`);
}

// Order-insensitive views, to tell "the same thing listed differently" from "a different thing".
const questionOrdered = (qs) => qs.filter((q) => !q.sub).map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => o.label) }));
const questionSet = (qs) => questionOrdered(qs).map((q) => ({ ...q, options: [...q.options].sort() })).sort((a, b) => (a.id + a.text < b.id + b.text ? -1 : 1));
const predOrdered = (parts) => parts.map(({ id, outcome, accepted, default: d, options, candidates }) => ({ id, outcome, accepted, default: d, options, candidates }));
const predSet = (parts) => parts.map(({ id, outcome, accepted, options, candidates }) => ({ id, outcome, accepted, options: [...options].sort(), candidates: [...candidates].sort() })).sort((a, b) => (a.id < b.id ? -1 : 1));

// One fingerprinted run of a case with the given spec. `variant.generate` (if any) replaces the default pipeline.
export async function fingerprint(loaded, variant, spec, workDir) {
  const dir = path.join(workDir, "in");
  const out = path.join(workDir, "out");
  fs.rmSync(workDir, { recursive: true, force: true });
  writeInputs(loaded, dir, spec);
  const extracted = extract(loaded.pageSource);
  const { matched, questions } = variant.analyze(extracted, spec);
  const parts = describeParts(matched, questions, { endpoint: !!loaded.truth?.["endpoint.list"] });
  let files = {}, pipelineMs = null;
  const tp = performance.now(); // timing only: never part of a hash
  if (variant.generate) files = await variant.generate({ dir, out, loaded, spec });
  else {
    await runPipeline({ dir, outRoot: out, auto: true });
    const base = path.join(out, "features", spec.feature);
    pipelineMs = performance.now() - tp;
    for (const rel of walk(base).sort()) files[rel] = hashOf(fs.readFileSync(path.join(base, rel), "utf8"));
  }
  return {
    pipelineMs,
    files,
    filesHash: hashOf(files),
    questionsHash: hashOf(questionOrdered(questions)),
    questionSetHash: hashOf(questionSet(questions)),
    predHash: hashOf(predOrdered(parts)),
    predSetHash: hashOf(predSet(parts)),
  };
}

const changedFiles = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((k) => a[k] !== b[k]);

// Compares fingerprints. `strict` runs (repeat, apisOrder) must be identical in every hash; keyOrder is analysed.
export function compareRuns(base, other, kind) {
  const changed = changedFiles(base.files, other.files);
  if (kind === "keyOrder") {
    return {
      echoFilesChanged: changed.filter(isEcho),
      logicFilesChanged: changed.filter((f) => !isEcho(f)),
      questionsOrderedSame: base.questionsHash === other.questionsHash,
      questionsSetSame: base.questionSetHash === other.questionSetHash,
      predictionsOrderedSame: base.predHash === other.predHash,
      predictionsSetSame: base.predSetHash === other.predSetHash,
    };
  }
  return {
    filesChanged: changed,
    filesSame: changed.length === 0,
    questionsSame: base.questionsHash === other.questionsHash,
    predictionsSame: base.predHash === other.predHash,
    same: changed.length === 0 && base.questionsHash === other.questionsHash && base.predHash === other.predHash,
  };
}

// Full check for one case: repeat, apis order, key order. `base` is the fingerprint of the first, ordinary run.
export async function checkDeterminism(loaded, variant, base, workRoot) {
  const seed = seedFrom("determinism", loaded.id);
  const rep = await fingerprint(loaded, variant, loaded.spec, path.join(workRoot, "repeat"));
  const apis = await fingerprint(loaded, variant, shuffleSpec(loaded.spec, "apisOrder", seed), path.join(workRoot, "apis"));
  const keys = await fingerprint(loaded, variant, shuffleSpec(loaded.spec, "keyOrder", seed), path.join(workRoot, "keys"));
  return {
    repeat: compareRuns(base, rep, "repeat"),
    apisOrder: compareRuns(base, apis, "apisOrder"),
    keyOrder: compareRuns(base, keys, "keyOrder"),
  };
}

// A case drifts when a strict comparison is not identical. (Key order is judged separately, see the header.)
export const drifted = (det) => !det.repeat.same || !det.apisOrder.same;
export const keyOrderSensitive = (det) => det.keyOrder.logicFilesChanged.length > 0 || !det.keyOrder.questionsSetSame || !det.keyOrder.predictionsSetSame;
export const stableFingerprint = (fp) => sortKeys({ files: fp.filesHash, questions: fp.questionsHash, predictions: fp.predHash });
