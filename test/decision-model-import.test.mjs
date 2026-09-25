// #647 -- `construct model import`: a model trained on ANOTHER machine comes back as a folder and is verified as PLAIN DATA. Good bundle,
// tampered file, extra script, symlink, path traversal, wrong dataset hash, oversize, executable magic, schema mismatch; the JSON
// structured-feature scorer on the golden fixture (and its agreement with what the Python kit measured); the held-out replay against the
// rules baseline; the registry (disabled on import, list, enable, remove) and the plugin file that loads an ENABLED model.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeTrainKitTraces, FIXTURE_NOW } from '../test-utils/trainKitFixture.mjs';
import { exportDataset, findExport } from '../packages/core/decision-dataset.mjs';
import { verifyModelBundle, MODEL_ALLOWED_FILES, MODEL_SIZE_CAPS } from '../packages/core/decision-model-bundle.mjs';
import { extractFeatures, routeOf, scoreSummary, validateFeaturesModel, createFeaturesProvider } from '../packages/core/decision-features.mjs';
import { importModel, listModels, removeModel, setModelEnabled, readModelRegistry, loadRegisteredModelProvider, registeredModelProvider, renderImport, renderModelList } from '../packages/core/decision-model-registry.mjs';
import { readTraces } from '../packages/core/decision-trace-store.mjs';
import { splitOf } from '../packages/core/decision-dataset.mjs';
import { openDecision, clearDecisionCache } from '../packages/core/decision-project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, '..', 'train-kit', 'fixtures', 'golden');
const DATASET = path.join(here, '..', 'train-kit', 'fixtures', 'dataset');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const read = (f) => fs.readFileSync(f);
const golden = JSON.parse(read(path.join(GOLDEN, 'features.json'), 'utf8'));
const goldenReport = JSON.parse(read(path.join(GOLDEN, 'eval-report.json'), 'utf8'));
const goldenManifest = JSON.parse(read(path.join(GOLDEN, 'manifest.json'), 'utf8'));

/** A project whose trace store holds the fixture traces and whose export ledger knows the fixture dataset (its hash is the golden model's). */
async function project() {
  const root = makeTempDir('og647-imp-project-');
  const stateDir = makeTempDir('og647-imp-state-');
  await writeTrainKitTraces(root, stateDir);
  const out = path.join(makeTempDir('og647-imp-out-'), 'bundle');
  const exported = exportDataset(root, { out, write: true, stateDir, now: FIXTURE_NOW, constructVersion: 'test' });
  assert.equal(exported.ok, true);
  assert.equal(exported.manifest.datasetHash, goldenManifest.datasetHash, 'the fixture dataset hashes the same when exported by a project');
  return { root, stateDir, opts: (extra = {}) => ({ stateDir, now: '2026-09-25T13:00:00.000Z', ...extra }) };
}

/** A writable copy of the golden model bundle. */
function copyGolden() {
  const dir = path.join(makeTempDir('og647-imp-bundle-'), 'model');
  fs.mkdirSync(dir);
  for (const n of fs.readdirSync(GOLDEN)) fs.copyFileSync(path.join(GOLDEN, n), path.join(dir, n));
  return dir;
}
/** Rewrite checksums.txt over the files that are there (so a change is caught by the check it is meant to hit, not by the checksum). */
function reseal(dir, { manifest = false } = {}) {
  if (manifest) {
    const m = JSON.parse(read(path.join(dir, 'manifest.json'), 'utf8'));
    for (const n of Object.keys(m.files)) if (fs.existsSync(path.join(dir, n))) m.files[n] = { sha256: sha(read(path.join(dir, n))), bytes: read(path.join(dir, n)).length };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  }
  const names = fs.readdirSync(dir).filter((n) => n !== 'checksums.txt' && fs.lstatSync(path.join(dir, n)).isFile()).sort();
  fs.writeFileSync(path.join(dir, 'checksums.txt'), names.map((n) => `${sha(read(path.join(dir, n)))}  ${n}`).join('\n') + '\n');
}
const editJson = (dir, name, fn) => { const f = path.join(dir, name); const j = JSON.parse(read(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j, null, 1)); };
const refuse = (dir, findExportFn = (h) => (h === goldenManifest.datasetHash ? { testIds: [] } : null)) => verifyModelBundle(dir, { findExport: findExportFn });

// ---------------------------------------------------------------------------------------------------------------- verification

test('the golden bundle verifies: plain data, checksums and manifest agree, schema ours, dataset exported here', () => {
  const v = refuse(GOLDEN);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual([v.kind, v.loadable, v.manifest.name, v.modelFile], ['features', true, 'features-lr', 'features.json']);
  assert.deepEqual(Object.keys(v.files).sort(), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'features.json', 'manifest.json']);
  assert.ok(v.model.routes);
});

test('REFUSED, typed and without a stack trace: a tampered file, an extra script, a symlink, a folder, traversal, an unknown dataset, oversize, an executable, a wrong schema', () => {
  const cases = [];
  const add = (name, code, prepare) => cases.push({ name, code, prepare });

  add('a tampered features.json', 'MODEL_CHECKSUM_MISMATCH', (d) => fs.appendFileSync(path.join(d, 'features.json'), ' '));
  add('a tampered MODEL_CARD.md', 'MODEL_CHECKSUM_MISMATCH', (d) => fs.appendFileSync(path.join(d, 'MODEL_CARD.md'), 'safe to enable'));
  add('an extra train.py', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'train.py'), 'import os\nos.system("id")\n'));
  add('an extra shell script', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 }));
  add('a pickle', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'model.pkl'), Buffer.from([0x80, 0x04, 0x95])));
  add('an extra module', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'postinstall.mjs'), 'process.exit(1)'));
  add('a hidden file', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, '.env'), 'X=1'));
  add('a symlink named like an allowed file', 'MODEL_SYMLINK', (d) => { const target = path.join(makeTempDir('og647-elsewhere-'), 'features.json'); fs.copyFileSync(path.join(d, 'features.json'), target); fs.rmSync(path.join(d, 'features.json')); fs.symlinkSync(target, path.join(d, 'features.json')); });
  add('a symlink to /etc/passwd', 'MODEL_SYMLINK', (d) => { fs.rmSync(path.join(d, 'MODEL_CARD.md')); fs.symlinkSync('/etc/passwd', path.join(d, 'MODEL_CARD.md')); });
  add('a sub-folder', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.mkdirSync(path.join(d, 'nested')));
  add('a checksums.txt that names a path', 'MODEL_PATH_TRAVERSAL', (d) => fs.appendFileSync(path.join(d, 'checksums.txt'), `${'a'.repeat(64)}  ../../etc/passwd\n`));
  add('a manifest that lists a path', 'MODEL_PATH_TRAVERSAL', (d) => { editJson(d, 'manifest.json', (m) => { m.files['../evil.json'] = { sha256: 'a'.repeat(64), bytes: 1 }; }); reseal(d); });
  add('a manifest that lists an absolute path', 'MODEL_PATH_TRAVERSAL', (d) => { editJson(d, 'manifest.json', (m) => { m.files['/etc/passwd'] = { sha256: 'a'.repeat(64), bytes: 1 }; }); reseal(d); });
  add('a dataset hash this project never exported', 'MODEL_DATASET_UNKNOWN', (d) => { editJson(d, 'manifest.json', (m) => { m.datasetHash = 'b'.repeat(64); }); reseal(d); });
  add('an oversize features.json', 'MODEL_TOO_LARGE', (d) => fs.truncateSync(path.join(d, 'features.json'), MODEL_SIZE_CAPS['features.json'] + 1));
  add('an oversize model.onnx (sparse, never read)', 'MODEL_TOO_LARGE', (d) => { fs.writeFileSync(path.join(d, 'model.onnx'), ''); fs.truncateSync(path.join(d, 'model.onnx'), MODEL_SIZE_CAPS['model.onnx'] + 1); });
  add('a features.json that starts like a script', 'MODEL_EXECUTABLE', (d) => { fs.writeFileSync(path.join(d, 'features.json'), '#!/usr/bin/env node\n{}'); reseal(d, { manifest: true }); });
  add('a model.onnx that is an ELF executable', 'MODEL_EXECUTABLE', (d) => { fs.writeFileSync(path.join(d, 'model.onnx'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])); reseal(d); });
  add('a model.onnx that is a zip (torch container)', 'MODEL_EXECUTABLE', (d) => { fs.writeFileSync(path.join(d, 'model.onnx'), Buffer.from([0x50, 0x4b, 3, 4, 0, 0])); reseal(d); });
  add('binary data in a text file', 'MODEL_NOT_TEXT', (d) => { fs.writeFileSync(path.join(d, 'MODEL_CARD.md'), Buffer.from([0x68, 0x69, 0x00, 0x01])); reseal(d, { manifest: true }); });
  add('a manifest that disagrees with a file', 'MODEL_MANIFEST_MISMATCH', (d) => { editJson(d, 'manifest.json', (m) => { m.files['features.json'].sha256 = 'c'.repeat(64); }); reseal(d); });
  add('a file the manifest does not list', 'MODEL_MANIFEST_MISMATCH', (d) => { editJson(d, 'manifest.json', (m) => { delete m.files['MODEL_CARD.md']; }); reseal(d); });
  add('another trace version', 'MODEL_SCHEMA_MISMATCH', (d) => { editJson(d, 'manifest.json', (m) => { m.traceVersion = 'decision-trace.v2'; }); reseal(d); });
  add('another bundle schema', 'MODEL_SCHEMA_MISMATCH', (d) => { editJson(d, 'manifest.json', (m) => { m.schema = 'construct.model-bundle.v9'; }); reseal(d); });
  add('another dataset schema', 'MODEL_SCHEMA_MISMATCH', (d) => { editJson(d, 'manifest.json', (m) => { m.datasetSchema = 'x'; }); reseal(d); });
  add('a model named like a built-in provider', 'MODEL_MANIFEST_INVALID', (d) => { editJson(d, 'manifest.json', (m) => { m.name = 'rules'; }); reseal(d); });
  add('a model version that is a path', 'MODEL_MANIFEST_INVALID', (d) => { editJson(d, 'manifest.json', (m) => { m.version = '../x'; }); reseal(d); });
  add('an unknown model kind', 'MODEL_MANIFEST_INVALID', (d) => { editJson(d, 'manifest.json', (m) => { m.kind = 'pickle'; }); reseal(d); });
  add('a manifest that is not JSON', 'MODEL_MANIFEST_INVALID', (d) => { fs.writeFileSync(path.join(d, 'manifest.json'), '{nope'); reseal(d); });
  add('a missing MODEL_CARD.md', 'MODEL_MISSING_FILE', (d) => { fs.rmSync(path.join(d, 'MODEL_CARD.md')); reseal(d); });
  add('a missing checksums.txt', 'MODEL_MISSING_FILE', (d) => fs.rmSync(path.join(d, 'checksums.txt')));
  add('a missing model file for the declared kind', 'MODEL_MISSING_FILE', (d) => { editJson(d, 'manifest.json', (m) => { m.kind = 'onnx'; }); reseal(d); });
  add('a checksums line that is not sha256sum format', 'MODEL_CHECKSUM_INVALID', (d) => fs.appendFileSync(path.join(d, 'checksums.txt'), 'garbage\n'));
  add('a file missing from checksums.txt', 'MODEL_CHECKSUM_MISSING', (d) => { const f = path.join(d, 'checksums.txt'); fs.writeFileSync(f, read(f, 'utf8').toString().split('\n').filter((l) => !l.includes('MODEL_CARD.md')).join('\n')); });
  add('features.json with a non-number weight', 'MODEL_FEATURES_INVALID', (d) => { editJson(d, 'features.json', (j) => { const r = Object.values(j.routes)[0]; r.weights[Object.keys(r.weights)[0]][0] = 'boom'; }); reseal(d, { manifest: true }); });
  add('features.json with a huge weight', 'MODEL_FEATURES_INVALID', (d) => { editJson(d, 'features.json', (j) => { const r = Object.values(j.routes)[0]; r.bias[0] = 1e9; }); reseal(d, { manifest: true }); });
  add('features.json with a prototype-polluting feature', 'MODEL_FEATURES_INVALID', (d) => { fs.writeFileSync(path.join(d, 'features.json'), '{"schema":"construct.features-model.v1","featureVersion":"features.v1","minScore":0.4,"routes":{"q|a,b":{"classes":["a","b"],"bias":[0,0],"weights":{"__proto__":[1,1]}}}}'); reseal(d, { manifest: true }); });
  add('features.json of another feature version', 'MODEL_FEATURES_INVALID', (d) => { editJson(d, 'features.json', (j) => { j.featureVersion = 'features.v9'; }); reseal(d, { manifest: true }); });
  add('an eval report for another dataset', 'MODEL_REPORT_INVALID', (d) => { editJson(d, 'eval-report.json', (j) => { j.datasetHash = 'd'.repeat(64); }); reseal(d, { manifest: true }); });
  add('an eval report that is not JSON', 'MODEL_REPORT_INVALID', (d) => { fs.writeFileSync(path.join(d, 'eval-report.json'), 'nope'); reseal(d, { manifest: true }); });

  for (const c of cases) {
    const dir = copyGolden();
    c.prepare(dir);
    const r = refuse(dir);
    assert.equal(r.ok, false, `${c.name} was accepted`);
    assert.equal(r.code, c.code, `${c.name}: ${r.code} ${r.message}`);
    assert.equal(typeof r.message, 'string');
    assert.doesNotMatch(r.message, /\bat \S+ \(|node:internal|\.mjs:\d+/, `${c.name}: no stack trace`);
    assert.equal(r.message.includes(dir), false, `${c.name}: the message holds no path`);
  }
  assert.ok(cases.length >= 35);
});

test('a folder that does not exist, a file, a symlinked folder are refused', () => {
  assert.equal(refuse(path.join(makeTempDir('og647-none-'), 'nope')).code, 'MODEL_DIR_NOT_FOUND');
  const file = path.join(makeTempDir('og647-file-'), 'f');
  fs.writeFileSync(file, 'x');
  assert.equal(refuse(file).code, 'MODEL_DIR_NOT_FOUND');
  const link = path.join(makeTempDir('og647-link-'), 'l');
  fs.symlinkSync(GOLDEN, link);
  assert.equal(refuse(link).code, 'MODEL_SYMLINK');
});

test('verification NEVER executes anything in the folder: a planted script and module leave no trace', () => {
  const dir = copyGolden();
  const marker = path.join(makeTempDir('og647-marker-'), 'ran');
  fs.writeFileSync(path.join(dir, 'evil.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x');`);
  fs.writeFileSync(path.join(dir, 'evil.py'), `open(${JSON.stringify(marker)}, 'w').write('x')`);
  assert.equal(refuse(dir).ok, false);
  assert.equal(fs.existsSync(marker), false);
});

test('the allowlist is exactly the seven plain-data names', () => {
  assert.deepEqual([...MODEL_ALLOWED_FILES].sort(), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'features.json', 'manifest.json', 'model.onnx', 'prototypes.json']);
});

// ---------------------------------------------------------------------------------------------------------------- the JSON scorer

const noun = (word, over = {}) => ({ id: 'o1', question: `What does "${word}" mean here?`, options: ['entity', 'state', 'ui-part', 'external', 'ignore'].map((o) => ({ id: o, label: o, enabled: true, why: '' })), chosen: null, ...over });

test('the scorer on the golden fixture: known words, disabled options, unknown questions, minScore, determinism', () => {
  assert.equal(validateFeaturesModel(golden).ok, true);
  const p = scoreSummary(golden, noun('invoices'));
  assert.equal(p.option, 'entity');
  assert.ok(p.score > 0.6 && p.score <= 1);
  assert.match(p.reason, /^trained classifier: \d+% entity$/);
  assert.equal(scoreSummary(golden, noun('button')).option, 'ui-part');
  assert.equal(scoreSummary(golden, noun('zebras')).option, 'entity', 'a plural it never saw is still data');
  assert.equal(scoreSummary(golden, noun('invoices', { options: noun('x').options.map((o) => ({ ...o, enabled: o.id !== 'entity' })) })).option !== 'entity', true, 'a disabled option is never suggested');
  assert.equal(scoreSummary(golden, { id: 'z', question: 'Something never asked?', options: noun('x').options }), null, 'an unknown question abstains');
  assert.equal(scoreSummary(golden, { id: 'z', question: '__proto__', options: [{ id: 'a', enabled: true }] }), null);
  assert.equal(scoreSummary({ ...golden, minScore: 1 }, noun('invoices')), null, 'under minScore it abstains');
  assert.deepEqual(scoreSummary(golden, noun('cart')), scoreSummary(golden, noun('cart')), 'deterministic');
  const shape = (word) => ({ id: 'q-shape', question: `How should the "${word}" screen be built?`, options: ['list', 'scaffold'].map((o) => ({ id: o, label: o, enabled: true, why: '' })), chosen: null });
  assert.equal(scoreSummary(golden, shape('coupons')).option, 'list');
  assert.equal(scoreSummary(golden, shape('landing')).option, 'scaffold');
  assert.equal(routeOf(noun('a')), routeOf(noun('bbb')));
  assert.deepEqual(extractFeatures({ question: 'What does "invoices" mean here?', options: [{ id: 'entity', enabled: true }, { id: 'ignore', enabled: true }] }), ['enabled:entity', 'enabled:ignore', 'len:8', 'n:2', 'plural', 'suf1:s', 'suf2:es', 'suf3:ces', 'tok:does', 'tok:here', 'tok:mean', 'tok:what', 'word:invoices']);
});

test('JS and the Python kit agree: replaying the fixture through the JS scorer reproduces the hits the kit measured, per chooser and split', () => {
  const lines = fs.readFileSync(path.join(DATASET, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const split of ['validation', 'test']) {
    const byChooser = {};
    for (const { split: s, trace } of lines) {
      if (s !== split) continue;
      const c = (byChooser[trace.chooser.id] ??= { persons: 0, hits: 0, answered: 0, traces: 0 });
      const pick = scoreSummary(golden, trace.summary);
      c.traces += 1;
      if (pick) c.answered += 1;
      if (trace.by === 'person') { c.persons += 1; if (pick?.option === trace.chosen) c.hits += 1; }
    }
    for (const [id, m] of Object.entries(byChooser)) {
      const want = goldenReport[split].byChooser[id];
      assert.deepEqual([m.persons, m.hits], [want.persons, want.hits], `${split} ${id}`);
      assert.equal(Math.round((m.answered / m.traces) * 1e6) / 1e6, want.coverage);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------- import, replay, registry

test('import (without --yes) verifies and REPLAYS the held-out test records against the rules baseline, and stores nothing', async () => {
  const { root, stateDir, opts } = await project();
  const ymlBefore = fs.readdirSync(root);
  const r = await importModel(root, GOLDEN, opts());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.registered, false);
  assert.equal(r.loadable, true);
  const o = r.replay.overall;
  const test13 = 13;
  assert.equal(r.entry.replay.heldOut.expected, test13);
  assert.equal(r.entry.replay.heldOut.found, test13);
  assert.equal(o.persons, test13);
  assert.equal(o.verdict, 'beats');
  assert.equal(o.promotable, false, 'fewer than 30 person-made traces: beats, but not promotable');
  assert.ok(o.agreement > o.baseline.agreement);
  assert.equal(o.hits, goldenReport.test.overall.hits, 'the replay equals what the kit measured on the same records');
  assert.equal(o.baseline.hits, goldenReport.test.overall.rulesHits, 'and the baseline is the rules provider');
  assert.deepEqual(Object.keys(r.replay.byChooser), ['requirement.card.noun', 'requirement.placement.shape']);
  assert.equal(readModelRegistry(root, { stateDir }).models.length, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'models')), false, 'nothing was stored');
  assert.deepEqual(fs.readdirSync(root), ymlBefore);
  const text = renderImport(r);
  assert.match(text, /Verified model features-lr@1-55d26b82 \(features\): plain data only/);
  assert.match(text, /Replay of the held-out test records \(13 of 13 found/);
  assert.match(text, /verdict: beats/);
  assert.match(text, /PREVIEW: nothing is stored/);
});

test('--yes registers the model DISABLED in the state directory; architecture.yml is never touched; list, enable, disable, remove', async () => {
  const { root, stateDir, opts } = await project();
  const yml = 'version: 1\nrules: {}\n';
  fs.writeFileSync(path.join(root, 'architecture.yml'), yml);
  const r = await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(r.registered, true);
  assert.equal(r.replaced, null);
  assert.equal(fs.readFileSync(path.join(root, 'architecture.yml'), 'utf8'), yml, 'decision: is never edited by import');
  assert.deepEqual(fs.readdirSync(root), ['architecture.yml'], 'nothing else appeared in the project');
  const { models } = listModels(root, { stateDir });
  assert.equal(models.length, 1);
  assert.deepEqual([models[0].name, models[0].version, models[0].kind, models[0].enabled, models[0].loadable], ['features-lr', '1-55d26b82', 'features', false, true]);
  assert.equal(models[0].replay.verdict, 'beats');
  const stored = path.join(stateDir, 'models');
  assert.ok(fs.existsSync(stored));
  const dir = path.join(readModelRegistry(root, { stateDir }).dir, 'features-lr');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'features.json', 'manifest.json']);
  assert.match(renderModelList(models), /features-lr@1-55d26b82  features  disabled/);
  assert.match(renderImport(r), /DISABLED/);

  assert.equal(setModelEnabled(root, 'features-lr', true, { stateDir }).entry.enabled, true);
  assert.equal(listModels(root, { stateDir }).models[0].enabled, true);
  assert.equal(setModelEnabled(root, 'features-lr', false, { stateDir }).entry.enabled, false);
  assert.equal(setModelEnabled(root, 'nope', true, { stateDir }).code, 'MODEL_NOT_FOUND');

  const again = await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(again.replaced, 'features-lr@1-55d26b82', 'importing the same name replaces it');
  setModelEnabled(root, 'features-lr', true, { stateDir });
  await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(listModels(root, { stateDir }).models[0].enabled, false, 'a re-import comes back DISABLED');

  assert.deepEqual(removeModel(root, 'features-lr', { stateDir }), { ok: true, removed: 'features-lr@1-55d26b82' });
  assert.equal(listModels(root, { stateDir }).models.length, 0);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(removeModel(root, 'features-lr', { stateDir }).code, 'MODEL_NOT_FOUND');
  assert.match(renderModelList([]), /No models are registered/);
});

test('a refused bundle stores nothing and the failure is typed', async () => {
  const { root, stateDir, opts } = await project();
  const dir = copyGolden();
  fs.writeFileSync(path.join(dir, 'run.sh'), 'echo hi');
  const r = await importModel(root, dir, opts({ yes: true }));
  assert.deepEqual([r.ok, r.code], [false, 'MODEL_FILE_NOT_ALLOWED']);
  assert.equal(fs.existsSync(path.join(stateDir, 'models')), false);
  const other = await project();
  const foreign = await importModel(other.root, GOLDEN, { ...other.opts({ yes: true }), stateDir: makeTempDir('og647-empty-ledger-') });
  assert.equal(foreign.code, 'MODEL_DATASET_UNKNOWN', 'a project that never exported that dataset refuses a model trained on it');
});

test('a model that LOSES is stored and reported as losing, never promoted', async () => {
  const { root, stateDir, opts } = await project();
  const dir = copyGolden();
  editJson(dir, 'features.json', (j) => {
    // always the option nobody chooses ("ignore") on the noun question; abstains on every other question
    const [key, route] = Object.entries(j.routes).find(([k]) => k.startsWith('what does'));
    j.routes = { [key]: { classes: [...route.classes, 'ignore'], bias: [0, 0, 0, 5], weights: {} } };
    j.minScore = 0;
  });
  reseal(dir, { manifest: true });
  const r = await importModel(root, dir, opts({ yes: true }));
  assert.equal(r.ok, true);
  assert.equal(r.replay.overall.verdict, 'loses');
  assert.equal(r.replay.overall.promotable, false);
  assert.match(renderImport(r), /does not beat the baseline \(loses\)/);
  assert.equal(listModels(root, { stateDir }).models[0].replay.verdict, 'loses');
  assert.equal(listModels(root, { stateDir }).models[0].enabled, false);
});

test('an .onnx model is verified and stored, NOT loaded: no replay, the report says so, and it cannot be enabled', async () => {
  const { root, stateDir, opts } = await project();
  const dir = copyGolden();
  fs.writeFileSync(path.join(dir, 'model.onnx'), Buffer.from([0x08, 0x07, 0x12, 0x04, 0x74, 0x65, 0x73, 0x74]));
  editJson(dir, 'manifest.json', (m) => { m.kind = 'onnx'; m.files['model.onnx'] = { sha256: sha(read(path.join(dir, 'model.onnx'))), bytes: 8 }; });
  reseal(dir);
  const r = await importModel(root, dir, opts({ yes: true }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.kind, r.loadable, r.replay, r.registered], ['onnx', false, null, true]);
  assert.match(r.replayNote, /NO ONNX loader/);
  assert.match(renderImport(r), /Not replayed: model\.onnx is verified .* has NO ONNX loader/);
  assert.equal(setModelEnabled(root, 'features-lr', true, { stateDir }).code, 'MODEL_NOT_LOADABLE');
  assert.equal(loadRegisteredModelProvider('features-lr', { root, stateDir }).code, 'MODEL_DISABLED');
  assert.match(renderModelList(listModels(root, { stateDir }).models), /no loader in this version/);
});

test('an ENABLED model loads through the project plugin file the docs show; a disabled or tampered one falls back to the rules provider', async () => {
  const { root, stateDir, opts } = await project();
  await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(loadRegisteredModelProvider('features-lr', { root, stateDir }).code, 'MODEL_DISABLED');
  const registryModule = pathToFileURL(path.join(here, '..', 'packages', 'core', 'decision-model-registry.mjs')).href;
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'decision-model.mjs'), [
    `import { registeredModelProvider } from ${JSON.stringify(registryModule)};`,
    "export default registeredModelProvider('features-lr', { root: new URL('..', import.meta.url) });",
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\ndecision:\n  provider: features-lr\n  plugin: tools/decision-model.mjs\n');
  const previous = process.env.CONSTRUCT_STATE_DIR;
  process.env.CONSTRUCT_STATE_DIR = stateDir;
  const caps = { available: true, reason: '' };
  const summary = noun('invoices');
  try {
    clearDecisionCache();
    const off = await openDecision(root, { capabilities: caps });
    const rulesAnswer = await off.suggest(summary);
    assert.deepEqual([rulesAnswer.provider, rulesAnswer.fellBackFrom], ['rules', 'features-lr'], 'a disabled model does not answer: the rules provider does');
    assert.match(off.notes.join('\n'), /disabled/);
    setModelEnabled(root, 'features-lr', true, { stateDir });
    clearDecisionCache();
    const on = await openDecision(root, { capabilities: caps });
    assert.equal(on.provider.name, 'features-lr');
    const s = await on.suggest(summary);
    assert.deepEqual([s.option, s.provider, s.version], ['entity', 'features-lr', '1-55d26b82']);
    assert.equal(typeof s.score, 'number');
    // tamper with the stored file: it is refused, the rules answer
    const stored = path.join(readModelRegistry(root, { stateDir }).dir, 'features-lr', 'features.json');
    fs.appendFileSync(stored, ' ');
    assert.equal(loadRegisteredModelProvider('features-lr', { root, stateDir }).code, 'MODEL_TAMPERED');
    clearDecisionCache();
    const tampered = await (await openDecision(root, { capabilities: caps })).suggest(summary);
    assert.deepEqual([tampered.provider, tampered.fellBackFrom], ['rules', 'features-lr']);
    // the same provider object follows the registry without a restart: disabling it takes effect at once
    setModelEnabled(root, 'features-lr', false, { stateDir });
    assert.throws(() => registeredModelProvider('features-lr', { root, stateDir }).suggest(summary), /disabled/);
  } finally {
    if (previous === undefined) delete process.env.CONSTRUCT_STATE_DIR;
    else process.env.CONSTRUCT_STATE_DIR = previous;
    clearDecisionCache();
  }
});

test('createFeaturesProvider follows the provider contract, and the held-out ids are the split the export recorded', async () => {
  const p = createFeaturesProvider(golden, { name: 'features-lr', version: '1' });
  assert.deepEqual(Object.keys(p).sort(), ['name', 'suggest', 'version']);
  assert.equal(p.suggest(noun('invoices')).option, 'entity');
  const { root, stateDir } = await project();
  const entry = findExport(root, goldenManifest.datasetHash, { stateDir });
  const decisions = readTraces(root, { stateDir }).decisions;
  assert.deepEqual(new Set(entry.testIds), new Set(decisions.filter((d) => splitOf(d.id) === 'test').map((d) => d.id)));
});
