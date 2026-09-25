// #673 (R5, part of #576) -- `construct research spec <file> --coverage`: sentence -> functions -> generated
// files, and functions -> sentences.
//
// Pinned here: the worked example's report (text and JSON, byte for byte; golden files under
// fixtures/machine-spec-coverage/, regenerate by re-running the CLI when the wording is meant to change);
// a fixture with a gap (a sentence nothing claims, a function whose only link is to a sentence that does not
// exist, a sentence out of scope); the exit codes (non-zero only for an uncovered sentence that is not out of
// scope); that the file paths are the ones `--generate` really writes; and the fixed shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coverageOfMachineSpec, renderCoverage, uncoveredSentences, COVERAGE_SCHEMA } from '../packages/core/research/coverage.mjs';
import { generateFromSpec } from '../packages/core/research/specToCode.mjs';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_REL = 'packages/core/research/examples/machine-spec.v1.example.json';
const GAP_REL = 'fixtures/machine-spec-coverage/gap.spec.json';
const GOLDEN = path.join(REPO_ROOT, 'fixtures', 'machine-spec-coverage');
const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
const run = (args, cwd = REPO_ROOT) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd });
const golden = (name) => fs.readFileSync(path.join(GOLDEN, name), 'utf8');

test('the worked example is covered exactly as pinned (text and json), exit 0, through the CLI', () => {
  const text = run(['research', 'spec', EXAMPLE_REL, '--coverage']);
  assert.equal(text.status, EXIT_CODES.OK, text.stderr);
  assert.ok(text.stdout.startsWith(golden('example.txt')), 'text coverage differs from fixtures/machine-spec-coverage/example.txt');
  assert.match(text.stdout, /\[tool: produced the read-only report above\] \[llm: 0 calls\]/);

  const json = run(['research', 'spec', EXAMPLE_REL, '--coverage', '--format', 'json']);
  assert.equal(json.status, EXIT_CODES.OK, json.stderr);
  assert.equal(json.stdout, golden('example.json'), 'json coverage differs from fixtures/machine-spec-coverage/example.json (pure JSON: no attribution line)');
});

test('worked example: each sentence names its functions and files, the out-of-scope one names none', () => {
  const cov = coverageOfMachineSpec(REPO_ROOT, readJson(EXAMPLE_REL));
  const byId = Object.fromEntries(cov.sentences.map((s) => [s.id, s]));
  assert.deepEqual(byId.s3.functions, ['verifyCredentials', 'openDashboard']);
  assert.deepEqual(byId.s3.machine, { states: ['signedIn'], events: ['VALID'], transitions: ['t2'] });
  assert.ok(byId.s3.files.includes('features/auth/services/openDashboard.ts'));
  assert.ok(byId.s3.files.includes('features/auth/workflows/SignInWithRetryWorkflow.tsx'));
  assert.equal(byId.s5.status, 'covered');
  assert.deepEqual(byId.s5.functions, ['recordFailedAttempt']);
  assert.equal(byId.s6.status, 'out-of-scope');
  assert.match(byId.s6.reason, /Lighthouse/);
  assert.deepEqual([byId.s6.functions, byId.s6.files], [[], []]);
  // reverse: every function cites at least one sentence of the requirement
  assert.deepEqual(cov.functions.map((f) => [f.name, f.status, f.req]), [
    ['verifyCredentials', 'cites', ['s1', 's3', 's4']],
    ['recordFailedAttempt', 'cites', ['s5']],
    ['openDashboard', 'cites', ['s3']],
  ]);
  assert.deepEqual(cov.counts, { sentences: 6, covered: 5, outOfScope: 1, uncovered: 0, functions: 3, orphanFunctions: 0, files: 6 });
});

test('the shape is fixed, the ids are the spec\'s own, and the library agrees with the CLI', () => {
  const spec = readJson(EXAMPLE_REL);
  const cov = coverageOfMachineSpec(REPO_ROOT, spec);
  assert.equal(cov.schema, COVERAGE_SCHEMA);
  assert.deepEqual(Object.keys(cov), ['schema', 'name', 'feature', 'sentences', 'functions', 'files', 'counts']);
  assert.deepEqual(cov.sentences.map((s) => s.id), spec.requirement.map((r) => r.id));
  assert.deepEqual(cov.functions.map((f) => f.name), spec.functions.map((f) => f.name));
  for (const s of cov.sentences) {
    assert.deepEqual(Object.keys(s), ['id', 'text', 'status', 'reason', 'functions', 'machine', 'files']);
    assert.deepEqual(Object.keys(s.machine), ['states', 'events', 'transitions']);
  }
  for (const f of cov.functions) assert.deepEqual(Object.keys(f), ['name', 'file', 'status', 'req', 'unknownReq']);
  for (const f of cov.files) assert.deepEqual(Object.keys(f), ['path', 'kind', 'sentences']);
  assert.equal(`${renderCoverage(cov, { format: 'json' })}\n`, golden('example.json'));
});

test('the files it names are the files --generate really writes', () => {
  const spec = readJson(EXAMPLE_REL);
  const dir = makeTempDir('construct-spec-coverage-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\n  language: typescript\nfeatures:\n  root: features\nrules: {}\nexceptions: []\n');
  const planned = coverageOfMachineSpec(dir, spec).files.map((f) => f.path).sort();
  const written = generateFromSpec(dir, spec).written.filter((f) => !['features/auth/types.ts', 'features/auth/index.ts'].includes(f)).sort();
  assert.deepEqual(planned, written);
});

test('a gap: an uncovered sentence and a function citing no sentence are reported, the sentence out of scope is not a gap', () => {
  const cov = coverageOfMachineSpec(REPO_ROOT, readJson(GAP_REL));
  assert.deepEqual(cov.sentences.map((s) => [s.id, s.status]), [['s1', 'covered'], ['s2', 'uncovered'], ['s3', 'out-of-scope']]);
  assert.deepEqual(uncoveredSentences(cov), ['s2']);
  assert.deepEqual(cov.functions.find((f) => f.name === 'notifyTeam'), { name: 'notifyTeam', file: 'features/contact/services/notifyTeam.ts', status: 'orphan', req: [], unknownReq: ['s9'] });
  assert.deepEqual(cov.files.find((f) => f.path.endsWith('notifyTeam.ts')).sentences, []);
  assert.deepEqual(cov.counts, { sentences: 3, covered: 1, outOfScope: 1, uncovered: 1, functions: 2, orphanFunctions: 1, files: 5 });
});

test('CLI: the gap fixture prints its report (text pinned, json pinned) and exits 1 for the uncovered sentence', () => {
  const text = run(['research', 'spec', GAP_REL, '--coverage']);
  assert.equal(text.status, EXIT_CODES.VIOLATIONS);
  assert.ok(text.stdout.startsWith(golden('gap.txt')), 'text coverage differs from fixtures/machine-spec-coverage/gap.txt');
  assert.match(text.stdout, /s2: The visitor gets a confirmation email\.\n {2}NOT covered/);
  assert.match(text.stdout, /notifyTeam: cites no sentence of the requirement \(unknown link s9\)/);
  const json = run(['research', 'spec', GAP_REL, '--coverage', '--format', 'json']);
  assert.equal(json.status, EXIT_CODES.VIOLATIONS);
  assert.equal(json.stdout, golden('gap.json'));
});

test('CLI: a function citing no sentence alone does not fail the run; only an uncovered sentence does', () => {
  const spec = readJson(GAP_REL);
  spec.outOfScope.push({ req: 's2', reason: 'Email is another team\'s service.' });
  const dir = makeTempDir('construct-spec-coverage-orphan-');
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
  const res = run(['research', 'spec', 'spec.json', '--coverage', '--format', 'json'], dir);
  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  const cov = JSON.parse(res.stdout);
  assert.equal(cov.counts.uncovered, 0);
  assert.equal(cov.counts.orphanFunctions, 1);
});

test('CLI: any other violation prints the validation report and no coverage; flag conflicts and a missing feature are usage errors', () => {
  const bad = run(['research', 'spec', 'fixtures/machine-spec/unreachable-state.json', '--coverage']);
  assert.equal(bad.status, EXIT_CODES.VIOLATIONS);
  assert.match(bad.stdout, /❌ SPEC-007/);
  assert.doesNotMatch(bad.stdout, /Coverage of/);
  const badJson = run(['research', 'spec', 'fixtures/machine-spec/unreachable-state.json', '--coverage', '--format', 'json']);
  assert.equal(JSON.parse(badJson.stdout).status, 'failed');

  // (run from a scratch directory: a build without the exclusivity check would honour --generate and write into cwd)
  const scratch = makeTempDir('construct-spec-coverage-conflict-');
  for (const other of ['--generate', '--read-back']) {
    const both = run(['research', 'spec', path.join(REPO_ROOT, EXAMPLE_REL), '--coverage', other], scratch);
    assert.equal(both.status, EXIT_CODES.USAGE_ERROR, other);
    assert.match(both.stderr, /--coverage/);
  }

  const spec = readJson(EXAMPLE_REL);
  delete spec.feature;
  const dir = makeTempDir('construct-spec-coverage-nofeature-');
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
  const none = run(['research', 'spec', 'spec.json', '--coverage'], dir);
  assert.equal(none.status, EXIT_CODES.USAGE_ERROR);
  assert.match(none.stderr, /No feature given/);
  const given = run(['research', 'spec', 'spec.json', '--coverage', '--feature', 'login', '--format', 'json'], dir);
  assert.equal(given.status, EXIT_CODES.OK, given.stderr);
  assert.equal(JSON.parse(given.stdout).feature, 'login');
});
