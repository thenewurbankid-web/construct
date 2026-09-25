// #647 -- the training kit (train-kit/, its own folder, NOT a package): the loop end to end on the fixture (export, train.sh, import, replay),
// the watch loop (one pass), the guards (memory, a bad or partial bundle), the kit's own python test, and the fixture cannot drift.
// Skipped, with a reason, when python3 is not on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeTrainKitTraces, buildFixtureBundle, FIXTURE_DIR } from '../test-utils/trainKitFixture.mjs';
import { DATASET_FILES } from '../packages/core/decision-dataset.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(here, '..', 'train-kit');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const skip = hasPython ? false : 'python3 is not installed on this machine';
const CREATED = '2026-09-25T12:00:00.000Z';
const kitEnv = { ...process.env, TRAIN_MIN_FREE_GB: '0', TRAIN_CREATED_AT: CREATED, PYTHONDONTWRITEBYTECODE: '1' };
const train = (args, env = {}) => spawnSync('bash', [path.join(KIT, 'train.sh'), ...args], { encoding: 'utf8', env: { ...kitEnv, ...env } });

test('the committed dataset fixture is exactly what the real store and exporter produce (no drift)', async () => {
  const files = await buildFixtureBundle();
  for (const name of DATASET_FILES) assert.equal(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'), files[name], `${name} drifted: run node test-utils/trainKitFixture.mjs --write`);
  const golden = JSON.parse(fs.readFileSync(path.join(KIT, 'fixtures', 'golden', 'manifest.json'), 'utf8'));
  assert.equal(golden.datasetHash, JSON.parse(files['manifest.json']).datasetHash, 'the golden model was trained on this dataset');
});

test('the kit is self-contained: no Construct package, no network, no third-party import', () => {
  const py = fs.readFileSync(path.join(KIT, 'train_features.py'), 'utf8');
  const imports = [...py.matchAll(/^(?:import|from) ([a-zA-Z_][\w.]*)/gm)].map((m) => m[1].split('.')[0]);
  const stdlib = new Set(['argparse', 'hashlib', 'json', 'math', 'os', 'random', 're', 'resource', 'signal', 'sys', 'time']);
  for (const name of new Set(imports)) assert.ok(stdlib.has(name), `train_features.py imports ${name}, which is not the standard library`);
  for (const file of fs.readdirSync(KIT).filter((f) => /\.(py|sh|json|md|plist)$/.test(f))) {
    const text = fs.readFileSync(path.join(KIT, file), 'utf8');
    assert.doesNotMatch(text, /@line\/|require\(|node_modules/, `${file} depends on Construct`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(KIT, 'train.sh'), 'utf8'), /\b(curl|wget|nc|ssh|scp|rsync)\b\s/, 'the loop opens no connection');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  assert.equal(rootPkg.files.some((f) => f.includes('train-kit')), false, 'train-kit is not part of a published package');
});

test('the launchd template is a valid plist: RunAtLoad, KeepAlive, Nice, log paths, no secrets', { skip }, () => {
  const parsed = spawnSync('python3', ['-c', 'import plistlib,sys,json; print(json.dumps(plistlib.load(open(sys.argv[1], "rb"))))', path.join(KIT, 'com.line.train.plist')], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const plist = JSON.parse(parsed.stdout);
  assert.deepEqual([plist.Label, plist.RunAtLoad, plist.KeepAlive, plist.Nice], ['com.line.train', true, true, 19]);
  assert.ok(plist.ProgramArguments.includes('--watch'));
  assert.match(plist.StandardOutPath, /train\.out\.log$/);
  assert.match(plist.StandardErrorPath, /train\.err\.log$/);
  const text = fs.readFileSync(path.join(KIT, 'com.line.train.plist'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(text, /token|secret|password|api[_-]?key|ghp_|sk-/i);
});

test("the kit's own test passes (python3 -m unittest): determinism against the golden model", { skip }, () => {
  const r = spawnSync('python3', ['-m', 'unittest'], { cwd: KIT, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /OK/);
});

test('THE LOOP: export from a project, train.sh once, import the result, replay, and the model comes back DISABLED', { skip }, async () => {
  const root = makeTempDir('og647-loop-project-');
  const stateDir = makeTempDir('og647-loop-state-');
  await writeTrainKitTraces(root, stateDir);
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', root], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir } });
  const work = makeTempDir('og647-loop-work-');
  const dataset = path.join(work, 'dataset');
  const model = path.join(work, 'model');

  assert.equal(cli('traces', 'export', '--out', dataset, '--yes').status, 0);
  const t = train([dataset, model]);
  assert.equal(t.status, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /trained features-lr on 96 train records \(2 routes\)/);
  assert.deepEqual(fs.readdirSync(model).sort(), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'features.json', 'manifest.json']);
  const report = JSON.parse(fs.readFileSync(path.join(model, 'eval-report.json'), 'utf8'));
  assert.ok(report.peakMemoryMB > 0, 'peak memory is recorded');
  assert.equal(report.test.overall.verdict, 'beats');

  const imported = cli('model', 'import', model, '--yes', '--json');
  assert.equal(imported.status, 0, imported.stderr);
  const doc = JSON.parse(imported.stdout);
  assert.equal(doc.registered, true);
  assert.equal(doc.entry.enabled, false);
  assert.equal(doc.replay.overall.verdict, 'beats');
  assert.equal(doc.replay.overall.hits, report.test.overall.hits, 'what the kit measured on the held-out records is what Construct replays');
  assert.equal(doc.replay.overall.baseline.hits, report.test.overall.rulesHits);
  assert.equal(doc.entry.replay.heldOut.found, doc.entry.replay.heldOut.expected);

  const again = train([dataset, model]);
  assert.equal(again.status, 2, 'a model folder that already holds a model is never overwritten');
});

test('train.sh: a memory guard refuses to start (exit 75, nothing written); a bad dataset is exit 2 with no traceback', { skip }, async () => {
  const work = makeTempDir('og647-guard-');
  const out = path.join(work, 'model');
  const low = train([FIXTURE_DIR, out], { TRAIN_MIN_FREE_GB: '100000' });
  assert.equal(low.status, 75, low.stdout + low.stderr);
  assert.match(low.stdout, /memory guard: \d+ MiB free, \d+ MiB required/);
  assert.equal(fs.existsSync(out), false);
  const bad = train([work, path.join(work, 'm2')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /refused: /);
  assert.doesNotMatch(bad.stderr, /Traceback/);
  assert.equal(fs.existsSync(path.join(work, 'm2')), false, 'nothing is left behind, not even a temporary folder');
  assert.deepEqual(fs.readdirSync(work), [], 'the work folder is untouched');
});

test('train.sh --watch --once: trains a NEW dataset hash into model-<hash12>/, keeps a heartbeat, skips a trained one, a partial copy and a changed dataset', { skip }, () => {
  const work = makeTempDir('og647-watch-');
  const inbox = path.join(work, 'inbox');
  const outbox = path.join(work, 'outbox');
  fs.mkdirSync(inbox);
  fs.cpSync(FIXTURE_DIR, path.join(inbox, 'from-dev'), { recursive: true });
  fs.mkdirSync(path.join(inbox, 'half-copied'));
  fs.copyFileSync(path.join(FIXTURE_DIR, 'manifest.json'), path.join(inbox, 'half-copied', 'manifest.json'));
  const first = train(['--watch', inbox, outbox, '--once']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const golden = JSON.parse(fs.readFileSync(path.join(KIT, 'fixtures', 'golden', 'manifest.json'), 'utf8'));
  const target = path.join(outbox, `model-${golden.datasetHash.slice(0, 12)}`);
  assert.ok(fs.existsSync(path.join(target, 'features.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')).datasetHash, golden.datasetHash);
  assert.deepEqual(fs.readdirSync(outbox).filter((n) => n.startsWith('model-')), [path.basename(target)], 'the half-copied bundle was not trained');
  assert.deepEqual(fs.readdirSync(outbox).filter((n) => n.includes('.tmp.')), [], 'no temporary folder is left behind');
  const heartbeat = JSON.parse(fs.readFileSync(path.join(outbox, 'heartbeat.json'), 'utf8'));
  assert.equal(heartbeat.state, 'idle');
  assert.equal(heartbeat.lastTrained, golden.datasetHash);
  assert.match(heartbeat.time, /^\d{4}-\d{2}-\d{2}T/);

  const second = train(['--watch', inbox, outbox, '--once']);
  assert.equal(second.status, 0);
  assert.doesNotMatch(second.stdout, /training from/, 'a dataset hash it already trained is not trained again');

  // a copy whose dataset.jsonl was changed after the manifest was written is not a valid bundle: skipped, not trained
  fs.cpSync(FIXTURE_DIR, path.join(inbox, 'tampered'), { recursive: true });
  fs.appendFileSync(path.join(inbox, 'tampered', 'dataset.jsonl'), '\n');
  fs.rmSync(target, { recursive: true });
  const third = train(['--watch', inbox, outbox, '--once']);
  assert.equal(third.status, 0);
  assert.equal(fs.readdirSync(outbox).filter((n) => n.startsWith('model-')).length, 1, 'the valid one was trained again (its model was removed), the tampered one was not');
});

test('train.sh --watch: below the memory guard the loop waits, says so in the heartbeat, trains nothing and does not mark the dataset failed', { skip }, () => {
  const work = makeTempDir('og647-watch-low-');
  const inbox = path.join(work, 'inbox');
  const outbox = path.join(work, 'outbox');
  fs.mkdirSync(inbox);
  fs.cpSync(FIXTURE_DIR, path.join(inbox, 'from-dev'), { recursive: true });
  const r = train(['--watch', inbox, outbox, '--once'], { TRAIN_MIN_FREE_GB: '100000' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /memory guard/);
  assert.equal(fs.readdirSync(outbox).some((n) => n.startsWith('model-') || n.startsWith('.failed-')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outbox, 'heartbeat.json'), 'utf8')).state, 'idle');
});
