// #647 -- the real binary: `construct traces export` (preview, then --yes) and `construct model list|import|remove|enable|disable`.
// Typed failures, exit codes (2 usage, 1 refused, 0 done), one-line messages instead of stack traces, JSON documents, and nothing
// written to the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { writeTrainKitTraces } from '../test-utils/trainKitFixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const GOLDEN = path.join(here, '..', 'train-kit', 'fixtures', 'golden');

async function setup() {
  const root = makeTempDir('og647-cli-project-');
  const stateDir = makeTempDir('og647-cli-state-');
  await writeTrainKitTraces(root, stateDir);
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args, '--dir', root], { encoding: 'utf8', env: { ...process.env, CONSTRUCT_STATE_DIR: stateDir, ...extra } });
  return { root, stateDir, run };
}

test('traces export: preview by default (exit 0, writes nothing), --yes writes the bundle, --json is one document', async () => {
  const { root, stateDir, run } = await setup();
  const out = path.join(makeTempDir('og647-cli-out-'), 'bundle');
  const preview = run(['traces', 'export', '--out', out]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /^PREVIEW: nothing is written/);
  assert.match(preview.stdout, /Records: 120 \(train \d+, validation \d+, test \d+\)/);
  assert.match(preview.stdout, /requirement\.card\.noun\s+90/);
  assert.match(preview.stdout, /No path and no secret is in it/);
  assert.equal(preview.stdout.includes(root), false);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'exports')), false);

  const asJson = run(['traces', 'export', '--out', out, '--json']);
  const doc = JSON.parse(asJson.stdout);
  assert.deepEqual([doc.ok, doc.written, doc.preview.records], [true, false, 120]);

  const done = run(['traces', 'export', '--out', out, '--yes']);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^Wrote a dataset bundle to /);
  assert.deepEqual(fs.readdirSync(out).sort(), ['README.md', 'dataset.jsonl', 'manifest.json', 'schema.json']);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.constructVersion, JSON.parse(fs.readFileSync(path.join(here, '..', 'packages', 'cli', 'package.json'), 'utf8')).version);
  assert.deepEqual(fs.readdirSync(root), [], 'the project was not touched');
});

test('traces export: typed failures are one line and an exit code, never a stack trace', async () => {
  const { root, run } = await setup();
  const out = path.join(makeTempDir('og647-cli-out2-'), 'b');
  const cases = [
    [['traces', 'export'], 2, /OUT_REQUIRED/],
    [['traces', 'export', '--out', out, '--since', 'yesterday'], 2, /SINCE_INVALID/],
    [['traces', 'export', '--out', path.join(root, 'inside')], 1, /OUT_INSIDE_PROJECT/],
    [['traces', 'export', '--out', out, '--chooser', 'nope.nothing'], 1, /DATASET_EMPTY/],
  ];
  for (const [args, code, pattern] of cases) {
    const r = run(args);
    assert.equal(r.status, code, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, pattern);
    assert.match(r.stderr, /^\nConstruct error: /);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  const json = run(['traces', 'export', '--out', out, '--chooser', 'nope.nothing', '--json']);
  assert.equal(json.status, 1);
  assert.deepEqual(Object.keys(JSON.parse(json.stdout)), ['ok', 'error']);
  assert.equal(JSON.parse(json.stdout).error.code, 'DATASET_EMPTY');
});

test('traces: off contributes nothing, through the CLI too', async () => {
  const { root, run } = await setup();
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\ntraces: off\n');
  const r = run(['traces', 'export', '--out', path.join(makeTempDir('og647-cli-off-'), 'b'), '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DATASET_EMPTY.*traces: off/);
});

test('model import: verifies and replays; without --yes nothing is stored; --yes registers it DISABLED; list, enable, disable, remove', async () => {
  const { root, stateDir, run } = await setup();
  const out = path.join(makeTempDir('og647-cli-bundle-'), 'bundle');
  assert.equal(run(['traces', 'export', '--out', out, '--yes'], { }).status, 0);
  // the golden model was trained on the fixture dataset; a real export of the same records has the same dataset hash
  const preview = run(['model', 'import', GOLDEN]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Verified model features-lr@1-55d26b82 \(features\)/);
  assert.match(preview.stdout, /verdict: beats/);
  assert.match(preview.stdout, /PREVIEW: nothing is stored/);
  assert.equal(fs.existsSync(path.join(stateDir, 'models')), false);

  const yes = run(['model', 'import', GOLDEN, '--yes', '--json']);
  assert.equal(yes.status, 0, yes.stderr);
  const doc = JSON.parse(yes.stdout);
  assert.deepEqual([doc.ok, doc.registered, doc.loadable, doc.entry.enabled, doc.replay.overall.verdict], [true, true, true, false, 'beats']);
  assert.deepEqual(fs.readdirSync(root), [], 'architecture.yml was not created or edited');

  assert.match(run(['model', 'list']).stdout, /features-lr@1-55d26b82  features  disabled/);
  assert.equal(JSON.parse(run(['model', 'list', '--json']).stdout).models[0].enabled, false);
  assert.match(run(['model', 'enable', 'features-lr']).stdout, /is now ENABLED in the registry/);
  assert.match(run(['model', 'list']).stdout, /ENABLED/);
  assert.match(run(['model', 'disable', 'features-lr']).stdout, /is now disabled/);
  assert.match(run(['model', 'remove', 'features-lr']).stdout, /Removed features-lr@1-55d26b82/);
  assert.match(run(['model', 'list']).stdout, /No models are registered/);
});

test('model: a refused bundle is exit 1 with a typed one-line message; usage errors are exit 2; never a stack trace', async () => {
  const { run } = await setup();
  const bad = path.join(makeTempDir('og647-cli-bad-'), 'model');
  fs.mkdirSync(bad);
  for (const n of fs.readdirSync(GOLDEN)) fs.copyFileSync(path.join(GOLDEN, n), path.join(bad, n));
  fs.writeFileSync(path.join(bad, 'train.py'), 'print(1)');
  const refused = run(['model', 'import', bad, '--yes']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /MODEL_FILE_NOT_ALLOWED/);
  assert.doesNotMatch(refused.stderr, /\n\s+at /);
  const json = run(['model', 'import', bad, '--json']);
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stdout).error.code, 'MODEL_FILE_NOT_ALLOWED');
  const unknown = run(['model', 'import', GOLDEN]);
  assert.equal(unknown.status, 1, 'the golden model was trained on a dataset this project never exported here');
  assert.match(unknown.stderr, /MODEL_DATASET_UNKNOWN/);
  for (const [args, pattern] of [[['model'], /Say what to do/], [['model', 'frobnicate'], /Unknown model command/], [['model', 'import'], /needs the model folder/], [['model', 'remove'], /needs a model name/], [['model', 'import', GOLDEN, '--min-traces', 'x'], /whole number/]]) {
    const r = run(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, pattern);
  }
  assert.equal(run(['model', 'remove', 'nothing']).status, 1);
  assert.equal(run(['model', 'enable', 'nothing']).status, 1);
});
