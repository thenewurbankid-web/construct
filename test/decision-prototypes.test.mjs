// #645 -- the local embedding classifier: a nearest-prototype scorer over a plain `prototypes.json`, behind the decision seam.
// The embedding (`embed.v1`), the model validator, the scorer and its abstentions; JS and the Python kit agree on the fixture; a
// prototypes bundle is verified as plain data, replayed on the held-out records against the rules baseline, registered DISABLED,
// loadable only when enabled (and only from the verified, hash-checked registry copy), and scored offline by `traces replay --model`.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeTrainKitTraces, FIXTURE_NOW } from '../test-utils/trainKitFixture.mjs';
import { exportDataset } from '../packages/core/decision-dataset.mjs';
import { verifyModelBundle } from '../packages/core/decision-model-bundle.mjs';
import { embedText, subjectOf, validatePrototypesModel, compilePrototypesModel, scorePrototypes, createPrototypesProvider, DEFAULT_EMBEDDER, PROTOTYPES_MODEL_LIMITS } from '../packages/core/decision-prototypes.mjs';
import { importModel, listModels, setModelEnabled, readModelRegistry, loadRegisteredModelProvider, registeredModelProvider, unseenByModel, renderImport, renderModelList } from '../packages/core/decision-model-registry.mjs';
import { readTraces } from '../packages/core/decision-trace-store.mjs';
import { splitOf } from '../packages/core/decision-dataset.mjs';
import { openDecision, clearDecisionCache } from '../packages/core/decision-project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, '..', 'train-kit', 'fixtures', 'golden-prototypes');
const DATASET = path.join(here, '..', 'train-kit', 'fixtures', 'dataset');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const read = (f) => fs.readFileSync(f);
const golden = JSON.parse(read(path.join(GOLDEN, 'prototypes.json'), 'utf8'));
const goldenReport = JSON.parse(read(path.join(GOLDEN, 'eval-report.json'), 'utf8'));
const goldenManifest = JSON.parse(read(path.join(GOLDEN, 'manifest.json'), 'utf8'));
const compiled = compilePrototypesModel(golden);

const noun = (word, over = {}) => ({ id: 'o1', question: `What does "${word}" mean here?`, options: ['entity', 'state', 'ui-part', 'external', 'ignore'].map((o) => ({ id: o, label: o, enabled: true, why: '' })), chosen: null, ...over });
const shape = (word) => ({ id: 'q-shape', question: `How should the "${word}" screen be built?`, options: ['list', 'scaffold'].map((o) => ({ id: o, label: o, enabled: true, why: '' })), chosen: null });

async function project() {
  const root = makeTempDir('og645-project-');
  const stateDir = makeTempDir('og645-state-');
  await writeTrainKitTraces(root, stateDir);
  const out = path.join(makeTempDir('og645-out-'), 'bundle');
  const exported = exportDataset(root, { out, write: true, stateDir, now: FIXTURE_NOW, constructVersion: 'test' });
  assert.equal(exported.ok, true);
  assert.equal(exported.manifest.datasetHash, goldenManifest.datasetHash, 'the fixture dataset hashes the same when exported by a project');
  return { root, stateDir, opts: (extra = {}) => ({ stateDir, now: '2026-09-25T13:00:00.000Z', ...extra }) };
}
function copyGolden() {
  const dir = path.join(makeTempDir('og645-bundle-'), 'model');
  fs.mkdirSync(dir);
  for (const n of fs.readdirSync(GOLDEN)) fs.copyFileSync(path.join(GOLDEN, n), path.join(dir, n));
  return dir;
}
function reseal(dir) {
  const m = JSON.parse(read(path.join(dir, 'manifest.json'), 'utf8'));
  for (const n of Object.keys(m.files)) if (fs.existsSync(path.join(dir, n))) m.files[n] = { sha256: sha(read(path.join(dir, n))), bytes: read(path.join(dir, n)).length };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  const names = fs.readdirSync(dir).filter((n) => n !== 'checksums.txt').sort();
  fs.writeFileSync(path.join(dir, 'checksums.txt'), names.map((n) => `${sha(read(path.join(dir, n)))}  ${n}`).join('\n') + '\n');
}
const editJson = (dir, name, fn) => { const f = path.join(dir, name); const j = JSON.parse(read(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j, null, 1)); };
const verify = (dir) => verifyModelBundle(dir, { findExport: (h) => (h === goldenManifest.datasetHash ? { testIds: [] } : null) });
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ---------------------------------------------------------------------------------------------------------------- embed.v1

test('embed.v1: a unit vector of the requested size, deterministic, case and punctuation blind, null for nothing', () => {
  const v = embedText('Invoices');
  assert.equal(v.length, DEFAULT_EMBEDDER.dim);
  assert.ok(Math.abs(cos(v, v) - 1) < 1e-12);
  assert.deepEqual([...embedText('invoices')], [...v]);
  assert.deepEqual([...embedText('  INVOICES!! ')], [...v]);
  assert.equal(embedText(''), null);
  assert.equal(embedText('!!! ???'), null);
  assert.equal(embedText('éè'), null, 'non-ASCII counts as a separator');
  assert.equal(embedText('order line', { dim: 64, ngrams: [3] }).length, 64);
});

test('embed.v1 is pinned: the same buckets as the Python kit (train-kit/test_build_prototypes.py pins this very table)', () => {
  const plus = [22, 39, 60, 70, 84, 93, 105, 128, 132, 138, 158, 162, 170, 177, 181, 214, 227, 242, 244, 248, 252];
  const minus = [31, 33, 56, 78, 112, 160, 202, 217, 245];
  const v = embedText('order lines');
  assert.deepEqual([...v.keys()].filter((i) => v[i] !== 0), [...plus, ...minus].sort((a, b) => a - b));
  for (const i of plus) assert.ok(Math.abs(v[i] - 30 ** -0.5) < 1e-15);
  for (const i of minus) assert.ok(Math.abs(v[i] + 30 ** -0.5) < 1e-15);
});

test('embed.v1: words that share a stem or an ending are closer than unrelated ones; an unseen word still has a place', () => {
  const e = (w) => embedText(w);
  assert.ok(cos(e('invoices'), e('invoice')) > 0.6);
  assert.ok(cos(e('invoices'), e('invoice')) > cos(e('invoices'), e('button')) + 0.4);
  assert.ok(cos(e('orders'), e('customers')) > cos(e('orders'), e('modal')), 'a shared plural ending pulls plurals together');
  assert.ok(embedText('zzyzx'), 'a word nobody ever saw is embedded all the same');
});

test('subjectOf: the first quoted phrase, normalised; nothing when nothing is quoted', () => {
  assert.equal(subjectOf({ question: 'What does "Order Lines" mean here?' }), 'order lines');
  assert.equal(subjectOf({ question: 'How should the "coupons" screen be built? ("x")' }), 'coupons');
  assert.equal(subjectOf({ question: 'Which layer?' }), null);
  assert.equal(subjectOf({ question: 'A "!!!" b' }), null);
  assert.equal(subjectOf(null), null);
});

// ---------------------------------------------------------------------------------------------------------------- validation

test('validatePrototypesModel: the golden model is valid; every kind of poisoned or oversized file is refused with words', () => {
  const ok = validatePrototypesModel(golden);
  assert.deepEqual([ok.ok, ok.routes, ok.prototypes], [true, 2, goldenReport.routes.prototypes]);
  const route = Object.keys(golden.routes)[0];
  const clone = () => JSON.parse(JSON.stringify(golden));
  const cases = [
    ['not an object', [], /must be a JSON object/],
    ['another schema', { ...clone(), schema: 'x' }, /schema must be/],
    ['another embedder kind', { ...clone(), embedder: { ...golden.embedder, kind: 'onnx' } }, /this version computes no other embedder/],
    ['another embedder version', { ...clone(), embedder: { ...golden.embedder, version: 'embed.v9' } }, /no other embedder/],
    ['a huge dimension', { ...clone(), embedder: { ...golden.embedder, dim: 1e9 } }, /embedder\.dim/],
    ['a fractional dimension', { ...clone(), embedder: { ...golden.embedder, dim: 12.5 } }, /embedder\.dim/],
    ['unsorted n-grams', { ...clone(), embedder: { ...golden.embedder, ngrams: [4, 2] } }, /ngrams/],
    ['too many n-grams', { ...clone(), embedder: { ...golden.embedder, ngrams: [1, 2, 3, 4, 5] } }, /ngrams/],
    ['minScore out of range', { ...clone(), minScore: 2 }, /minScore/],
    ['minMargin missing', (() => { const m = clone(); delete m.minMargin; return m; })(), /minMargin/],
    ['routes not an object', { ...clone(), routes: [] }, /routes must be an object/],
    ['a class that is not an option id', (() => { const m = clone(); m.routes[route].classes.push('has space'); return m; })(), /classes must be/],
    ['prototypes for a class the route does not have', (() => { const m = clone(); m.routes[route].prototypes.mystery = ['a']; return m; })(), /must be a class of the route/],
    ['an uppercase prototype', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = ['Invoices']; return m; })(), /lowercase words/],
    ['a prototype with a path in it', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = ['../../etc']; return m; })(), /lowercase words/],
    ['a prototype that is not a string', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = [7]; return m; })(), /lowercase words/],
    ['an over-long prototype', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = ['a'.repeat(41)]; return m; })(), /at most 40/],
    ['an empty class list', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = []; return m; })(), /1-100 lowercase/],
    ['too many prototypes in a class', (() => { const m = clone(); m.routes[route].prototypes[m.routes[route].classes[0]] = Array.from({ length: PROTOTYPES_MODEL_LIMITS.perClass + 1 }, (_, i) => `w${i}`); return m; })(), /1-100 lowercase/],
    ['too many prototypes in all', (() => { const m = clone(); for (let r = 0; r < 60; r += 1) m.routes[`q${r}|a`] = { classes: ['a'], prototypes: { a: Array.from({ length: 100 }, (_, i) => `w${i}`) } }; return m; })(), /at most 5000 prototypes/],
    ['a prototype-polluting route', JSON.parse('{"schema":"construct.prototypes-model.v1","embedder":{"kind":"char-ngram-hash","version":"embed.v1","dim":64,"ngrams":[3]},"minScore":0.1,"minMargin":0,"routes":{"__proto__":{"classes":["a"],"prototypes":{"a":["x"]}}}}'), /not a route|classes\[\]/],
    ['choosers that are not ids', (() => { const m = clone(); m.routes[route].choosers = ['../x']; return m; })(), /choosers/],
  ];
  for (const [name, model, pattern] of cases) {
    const r = validatePrototypesModel(model);
    assert.equal(r.ok, false, `${name} was accepted`);
    assert.match(r.errors.join(' | '), pattern, name);
  }
  assert.equal(({}).polluted, undefined, 'nothing polluted Object.prototype');
});

// ---------------------------------------------------------------------------------------------------------------- the scorer

test('the scorer on the golden fixture: nearest prototype wins, inflected words follow their stem, all abstentions', () => {
  const exact = scorePrototypes(compiled, noun('customers'));
  assert.equal(exact.option, 'entity');
  assert.ok(Math.abs(exact.score - 1) < 1e-9, 'a word that is a prototype is at similarity 1');
  assert.equal(exact.nearest, 'customers');
  assert.match(exact.reason, /^closest example "customers" \(100% similar\): entity$/);
  assert.equal(scorePrototypes(compiled, noun('button')).option, 'ui-part');
  assert.equal(scorePrototypes(compiled, noun('buttons')).option, 'ui-part', 'the plural of a known word');
  assert.equal(scorePrototypes(compiled, noun('carts')).option, 'state', 'and so is this one');
  assert.ok(scorePrototypes(compiled, noun('buttons')).score < 1 && scorePrototypes(compiled, noun('buttons')).score > 0.5);
  const s = scorePrototypes(compiled, noun('customers'));
  assert.ok(typeof s.runnerUp === 'string' && s.runnerUp !== s.option);
  assert.equal(scorePrototypes(compiled, shape('customers')).option, 'list');
  assert.equal(scorePrototypes(compiled, shape('landing')).option, 'scaffold');
  const noEntity = noun('customers', { options: noun('x').options.map((o) => ({ ...o, enabled: o.id !== 'entity' })) });
  assert.notEqual(scorePrototypes(compiled, noEntity)?.option, 'entity', 'a disabled option is never suggested');
  assert.equal(scorePrototypes(compiled, { id: 'z', question: 'Something never asked "invoices"?', options: noun('x').options }), null, 'an unknown question abstains');
  assert.equal(scorePrototypes(compiled, { id: 'z', question: 'What does it mean here?', options: noun('x').options }), null, 'a question that quotes nothing abstains');
  assert.equal(scorePrototypes(compiled, { id: 'z', question: '__proto__', options: [{ id: 'a', enabled: true }] }), null);
  assert.equal(scorePrototypes(compiled, noun('!!!')), null);
  assert.deepEqual(scorePrototypes(compiled, noun('cart')), scorePrototypes(compiled, noun('cart')), 'deterministic');
  assert.equal(scorePrototypes(compilePrototypesModel({ ...golden, minScore: 1 }), noun('widgets')), null, 'under minScore it abstains');
  assert.equal(scorePrototypes(compilePrototypesModel({ ...golden, minMargin: 1 }), noun('widgets')), null, 'two options too close to call is "I do not know"');
  assert.equal(scorePrototypes(compilePrototypesModel({ ...golden, minMargin: 1 }), { ...noun('widgets'), options: noun('x').options.map((o) => ({ ...o, enabled: o.id === 'entity' })) }).option, 'entity', 'a single enabled option has no runner-up to be close to');
});

test('a tiny hand-written model (a curated seed alone) validates and scores', () => {
  const model = { ...golden, routes: { [Object.keys(golden.routes).find((k) => k.startsWith('what'))]: { classes: ['entity', 'state'], prototypes: { entity: ['a'], state: ['cart'] } } } };
  assert.equal(validatePrototypesModel(model).ok, true);
  assert.ok(scorePrototypes(compilePrototypesModel(model), noun('cart')));
});

test('createPrototypesProvider follows the provider contract: name, version, suggest; the answer is a suggestion and nothing else', () => {
  const p = createPrototypesProvider(golden, { name: 'layer-proto', version: '1' });
  assert.deepEqual(Object.keys(p).sort(), ['name', 'suggest', 'version']);
  const a = p.suggest(noun('invoices'));
  assert.deepEqual(Object.keys(a).sort(), ['option', 'reason', 'runnerUp', 'score']);
  assert.equal(a.option, 'entity');
  assert.equal(p.suggest({ id: 'x', question: 'no quote', options: [] }), null);
  const started = process.hrtime.bigint();
  for (let i = 0; i < 200; i += 1) p.suggest(noun(`word${i}`));
  const perCallMs = Number(process.hrtime.bigint() - started) / 1e6 / 200;
  assert.ok(perCallMs < 5, `a suggestion takes ${perCallMs.toFixed(3)} ms on this machine`);
});

test('JS and the Python kit agree: the kit\'s build reproduces the golden prototypes, and the JS scorer reproduces the hits the kit measured', () => {
  const lines = fs.readFileSync(path.join(DATASET, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const split of ['validation', 'test']) {
    const byChooser = {};
    for (const { split: s, trace } of lines) {
      if (s !== split) continue;
      const c = (byChooser[trace.chooser.id] ??= { persons: 0, hits: 0, answered: 0, traces: 0 });
      const pick = scorePrototypes(compiled, trace.summary);
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
  assert.ok(goldenReport.test.overall.hits > goldenReport.test.overall.rulesHits, 'on the fixture it beats the rules baseline');
});

// ---------------------------------------------------------------------------------------------------------------- the bundle

test('the golden prototypes bundle verifies as plain data and is loadable; the manifest says which embedding it needs', () => {
  const v = verify(GOLDEN);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual([v.kind, v.loadable, v.manifest.name, v.modelFile, v.manifest.embedVersion, v.notes], ['prototypes', true, 'layer-proto', 'prototypes.json', 'embed.v1', []]);
  assert.deepEqual(Object.keys(v.files).sort(), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'manifest.json', 'prototypes.json']);
});

test('REFUSED, typed and without a stack trace: a tampered prototypes.json, a poisoned one, another embedder, a script in its place', () => {
  const cases = [];
  const add = (name, code, prepare) => cases.push({ name, code, prepare });
  add('a tampered prototypes.json', 'MODEL_CHECKSUM_MISMATCH', (d) => fs.appendFileSync(path.join(d, 'prototypes.json'), ' '));
  add('prototypes.json that is not JSON', 'MODEL_PROTOTYPES_INVALID', (d) => { fs.writeFileSync(path.join(d, 'prototypes.json'), '{nope'); reseal(d); });
  add('prototypes.json with another embedder', 'MODEL_PROTOTYPES_INVALID', (d) => { editJson(d, 'prototypes.json', (j) => { j.embedder.kind = 'onnx'; }); reseal(d); });
  add('prototypes.json with a word that is a path', 'MODEL_PROTOTYPES_INVALID', (d) => { editJson(d, 'prototypes.json', (j) => { const r = Object.values(j.routes)[0]; r.prototypes[r.classes[0]] = ['../../etc/passwd']; }); reseal(d); });
  add('prototypes.json that starts like a script', 'MODEL_EXECUTABLE', (d) => { fs.writeFileSync(path.join(d, 'prototypes.json'), '#!/usr/bin/env node\n{}'); reseal(d); });
  add('prototypes.json that is a pickle', 'MODEL_EXECUTABLE', (d) => { fs.writeFileSync(path.join(d, 'prototypes.json'), Buffer.from([0x80, 0x04, 0x95, 0x00])); reseal(d); });
  add('a manifest for another embedding', 'MODEL_MANIFEST_INVALID', (d) => { editJson(d, 'manifest.json', (m) => { m.embedVersion = 'embed.v9'; }); reseal(d); });
  add('a manifest that says prototypes but ships no file', 'MODEL_MISSING_FILE', (d) => { fs.rmSync(path.join(d, 'prototypes.json')); reseal(d); });
  add('an extra embedding module', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'embed.mjs'), 'process.exit(1)'));
  add('an extra vocabulary table', 'MODEL_FILE_NOT_ALLOWED', (d) => fs.writeFileSync(path.join(d, 'vocab.pkl'), Buffer.from([0x80, 0x04])));
  add('an oversize prototypes.json', 'MODEL_TOO_LARGE', (d) => fs.truncateSync(path.join(d, 'prototypes.json'), 8 * 1024 * 1024 + 1));
  for (const c of cases) {
    const dir = copyGolden();
    c.prepare(dir);
    const r = verify(dir);
    assert.equal(r.ok, false, `${c.name} was accepted`);
    assert.equal(r.code, c.code, `${c.name}: ${r.code} ${r.message}`);
    assert.doesNotMatch(r.message, /\bat \S+ \(|node:internal|\.mjs:\d+/, `${c.name}: no stack trace`);
    assert.equal(r.message.includes(dir), false, `${c.name}: the message holds no path`);
  }
});

test('import (without --yes) replays the held-out records against the rules baseline and stores nothing; --yes registers it DISABLED', async () => {
  const { root, stateDir, opts } = await project();
  const preview = await importModel(root, GOLDEN, opts());
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.deepEqual([preview.kind, preview.loadable, preview.registered, preview.replayNote], ['prototypes', true, false, null]);
  const o = preview.replay.overall;
  assert.equal(preview.entry.replay.heldOut.found, 13);
  assert.equal(o.verdict, 'beats');
  assert.equal(o.promotable, false, 'fewer than 30 person-made traces: beats, but not promotable');
  assert.equal(o.hits, goldenReport.test.overall.hits, 'the replay equals what the kit measured on the same records');
  assert.equal(o.baseline.hits, goldenReport.test.overall.rulesHits, 'and the baseline is the rules provider');
  assert.equal(fs.existsSync(path.join(stateDir, 'models')), false);
  const text = renderImport(preview);
  assert.match(text, /Verified model layer-proto@1-55d26b82 \(prototypes\)/);
  assert.match(text, /verdict: beats/);
  assert.doesNotMatch(text, /Not replayed/);

  const yml = 'version: 1\nrules: {}\n';
  fs.writeFileSync(path.join(root, 'architecture.yml'), yml);
  const done = await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(done.registered, true);
  assert.equal(fs.readFileSync(path.join(root, 'architecture.yml'), 'utf8'), yml, 'decision: is never edited by import');
  const [entry] = listModels(root, { stateDir }).models;
  assert.deepEqual([entry.name, entry.kind, entry.enabled, entry.loadable], ['layer-proto', 'prototypes', false, true]);
  assert.match(renderModelList([entry]), /layer-proto@1-55d26b82  prototypes  disabled/);
  assert.equal(loadRegisteredModelProvider('layer-proto', { root, stateDir }).code, 'MODEL_DISABLED', 'disabled by default: not loadable for a project');
  assert.equal(loadRegisteredModelProvider('layer-proto', { root, stateDir, requireEnabled: false }).ok, true, 'but scorable offline');
  assert.equal(setModelEnabled(root, 'layer-proto', true, { stateDir }).entry.enabled, true, 'a prototypes model CAN be enabled now');
});

test('a prototypes model that LOSES is stored and reported as losing, never promoted', async () => {
  const { root, stateDir, opts } = await project();
  const dir = copyGolden();
  editJson(dir, 'prototypes.json', (j) => {
    // every word is "ignore" or "state": the nearest example is the wrong one for the noun question
    const key = Object.keys(j.routes).find((k) => k.startsWith('what does'));
    j.routes = { [key]: { classes: ['ignore'], prototypes: { ignore: ['a', 'b', 'c'] } } };
    j.minScore = 0;
  });
  reseal(dir);
  const r = await importModel(root, dir, opts({ yes: true }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.replay.overall.verdict, 'loses');
  assert.equal(r.replay.overall.promotable, false);
  assert.equal(listModels(root, { stateDir }).models[0].enabled, false);
});

test('an ENABLED prototypes model answers behind the seam through the plugin file the docs show; disabled or tampered, the rules answer', async () => {
  const { root, stateDir, opts } = await project();
  await importModel(root, GOLDEN, opts({ yes: true }));
  const registryModule = pathToFileURL(path.join(here, '..', 'packages', 'core', 'decision-model-registry.mjs')).href;
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'decision-model.mjs'), [
    `import { registeredModelProvider } from ${JSON.stringify(registryModule)};`,
    "export default registeredModelProvider('layer-proto', { root: new URL('..', import.meta.url) });",
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\ndecision:\n  provider: layer-proto\n  plugin: tools/decision-model.mjs\n');
  const previous = process.env.CONSTRUCT_STATE_DIR;
  process.env.CONSTRUCT_STATE_DIR = stateDir;
  const caps = { available: true, reason: '' };
  const summary = noun('buttons');
  try {
    clearDecisionCache();
    const off = await (await openDecision(root, { capabilities: caps })).suggest(summary);
    assert.deepEqual([off.provider, off.fellBackFrom], ['rules', 'layer-proto'], 'a disabled model does not answer: the rules provider does');
    setModelEnabled(root, 'layer-proto', true, { stateDir });
    clearDecisionCache();
    const on = await openDecision(root, { capabilities: caps });
    assert.equal(on.provider.name, 'layer-proto');
    const s = await on.suggest(summary);
    assert.deepEqual([s.option, s.provider, s.version], ['ui-part', 'layer-proto', '1-55d26b82']);
    assert.equal(typeof s.score, 'number');
    assert.match(s.reason, /^closest example "/);
    const stored = path.join(readModelRegistry(root, { stateDir }).dir, 'layer-proto', 'prototypes.json');
    fs.appendFileSync(stored, ' ');
    assert.equal(loadRegisteredModelProvider('layer-proto', { root, stateDir }).code, 'MODEL_TAMPERED');
    clearDecisionCache();
    const tampered = await (await openDecision(root, { capabilities: caps })).suggest(summary);
    assert.deepEqual([tampered.provider, tampered.fellBackFrom], ['rules', 'layer-proto']);
    setModelEnabled(root, 'layer-proto', false, { stateDir });
    assert.throws(() => registeredModelProvider('layer-proto', { root, stateDir }).suggest(summary), /disabled/);
  } finally {
    if (previous === undefined) delete process.env.CONSTRUCT_STATE_DIR;
    else process.env.CONSTRUCT_STATE_DIR = previous;
    clearDecisionCache();
  }
});

test('unseenByModel: the held-out records of the export plus everything recorded after it, never the ones the model was built from', async () => {
  const { root, stateDir, opts } = await project();
  await importModel(root, GOLDEN, opts({ yes: true }));
  const decisions = readTraces(root, { stateDir }).decisions;
  const r = unseenByModel(root, 'layer-proto', decisions, { stateDir });
  assert.deepEqual([r.ok, r.heldOut, r.later, r.decisions.length], [true, 13, 0, 13]);
  assert.ok(r.decisions.every((d) => splitOf(d.id) === 'test'));
  const later = { ...decisions[0], id: 'later-one', at: '2026-10-01T00:00:00.000Z' };
  assert.equal(unseenByModel(root, 'layer-proto', [...decisions, later], { stateDir }).later, 1);
  assert.equal(unseenByModel(root, 'nope', decisions, { stateDir }).code, 'MODEL_NOT_FOUND');
  assert.equal(unseenByModel(root, 'layer-proto', decisions, { stateDir: makeTempDir('og645-none-') }).code, 'MODEL_NOT_FOUND');
});

// ---------------------------------------------------------------------------------------------------------------- the real binary

test('construct traces replay --model: scores a registered model offline (enabled or not) on the records it has not seen; --all on everything; typed failures', async () => {
  const { root, stateDir, opts } = await project();
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, '--dir', root], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  const none = run(['traces', 'replay', '--model', 'layer-proto']);
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stderr, /No model named "layer-proto" is registered/);
  await importModel(root, GOLDEN, opts({ yes: true }));
  assert.equal(listModels(root, { stateDir }).models[0].enabled, false);

  const r = run(['traces', 'replay', '--model', 'layer-proto', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.ok, true);
  assert.equal(doc.provider, 'layer-proto');
  assert.equal(doc.overall.persons, 13, 'only the held-out records');
  assert.equal(doc.overall.verdict, 'beats');
  assert.equal(doc.overall.hits, goldenReport.test.overall.hits);
  assert.equal(listModels(root, { stateDir }).models[0].enabled, false, 'scoring a model never enables it');

  const text = run(['traces', 'replay', '--model', 'layer-proto']);
  assert.match(text.stdout, /Scored on the 13 decisions layer-proto has not seen \(13 held-out records of its export, 0 recorded since\)/);
  assert.match(text.stdout, /verdict: beats/);

  const all = JSON.parse(run(['traces', 'replay', '--model', 'layer-proto', '--all', '--json']).stdout);
  assert.equal(all.overall.persons, 120);
  assert.ok(all.overall.agreement > all.overall.baseline.agreement);

  const both = run(['traces', 'replay', '--model', 'layer-proto', '--provider', 'rules']);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /takes no other provider/);
  assert.doesNotMatch(both.stderr, /\n\s+at /);
});
