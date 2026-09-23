// #593 (R2) -- `construct research spec <file> --generate`: turns an ACCEPTED machine-spec.v1 into a
// real workflow (with its typed state union and named guard stubs) and one defineService(...) stub
// per function. Covers: the descriptor-building/rendering pure functions directly, the CLI end to
// end against the worked example (into a temp project that passes the real `construct validate`),
// never-overwrite/idempotency, and the usage errors (--generate on a failing spec writes nothing;
// no feature name is exit 2).
//
// A real `tsc` check of the generated project is deliberately NOT run here (unlike
// test/typed-contracts-tsc.test.mjs's fixed example files): the worked example's own function types
// reference a `Session` type the spec never declares or imports (see docs/machine-spec.md's "Known
// gaps"), so a real project-wide tsc pass would fail on that pre-existing gap, not on anything this
// generator gets wrong -- and running one for real would also need `npm install` in a fresh temp
// project, which this repo's machine limits (docs/DELEGATION.md) rule out per test. Instead this
// asserts the exact stub text (import specifier, precondition/postcondition/req comments, the
// re-printed input/output types, the throw) and separately proves the generated project passes the
// real, no-LLM `construct validate`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildWorkflowDescriptor, functionStubSource, generateFromSpec } from '../packages/core/research/specToCode.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
const EXAMPLE_PATH = path.join(REPO_ROOT, 'packages', 'core', 'research', 'examples', 'machine-spec.v1.example.json');
const UNREACHABLE_PATH = path.join(REPO_ROOT, 'fixtures', 'machine-spec', 'unreachable-state.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const example = () => readJson(EXAMPLE_PATH);

function tmpProject() {
  const dir = makeTempDir('construct-spec-generate-');
  fs.writeFileSync(
    path.join(dir, 'architecture.yml'),
    'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\n  language: typescript\nfeatures:\n  root: features\nrules: {}\nexceptions: []\n',
  );
  return dir;
}

const run = (args, cwd) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd });

// ---------------------------------------------------------------------------
// buildWorkflowDescriptor: pure mapping from spec to workflowGenerator's descriptor shape
// ---------------------------------------------------------------------------

test('buildWorkflowDescriptor: initial state, final states, and guarded-before-unguarded ordering', () => {
  const descriptor = buildWorkflowDescriptor(example());
  assert.equal(descriptor.initial, 'idle');
  assert.deepEqual(descriptor.states.signedIn, { type: 'final' });
  assert.deepEqual(descriptor.states.lockedOut, { type: 'final' });
  assert.deepEqual(descriptor.states.idle, { on: { SUBMIT: 'checking' } });
  // checking has two INVALID transitions (t3 guarded, t4 unguarded) -- guarded first, array form.
  assert.deepEqual(descriptor.states.checking.on.INVALID, [
    { target: 'lockedOut', guard: 'attemptsExhausted' },
    { target: 'failed' },
  ]);
  assert.equal(descriptor.states.checking.on.VALID, 'signedIn');
});

test('buildWorkflowDescriptor: a guard\'s TODO note is its transition\'s own req sentence text', () => {
  const descriptor = buildWorkflowDescriptor(example());
  assert.equal(
    descriptor.guards.attemptsExhausted,
    'After three failed attempts in a row, the visitor is locked out and must reset their password.',
  );
});

test('buildWorkflowDescriptor: a single unguarded transition for a (from, event) stays the bare-string shorthand', () => {
  const descriptor = buildWorkflowDescriptor(example());
  assert.equal(typeof descriptor.states.failed.on.RETRY, 'string');
  assert.equal(descriptor.states.failed.on.RETRY, 'idle');
});

// ---------------------------------------------------------------------------
// functionStubSource: pure stub rendering
// ---------------------------------------------------------------------------

test('functionStubSource: precondition/postcondition/req comments, the typed-contracts import, and a throwing body', () => {
  const spec = example();
  const fn = spec.functions.find((f) => f.name === 'verifyCredentials');
  const source = functionStubSource(spec, fn, '/some/project/features/auth/services');
  assert.match(source, /import \{ defineService \} from ['"].*typed-contracts\/index\.ts['"];/);
  assert.match(source, /\/\/ Precondition: email and password are both non-empty strings\./);
  assert.match(source, /\/\/ Postcondition: Resolves \{ ok: true, session \} when the pair matches an account/);
  assert.match(source, /\/\/ req: s1 \(.*\), s3 \(.*\), s4 \(.*\)/);
  assert.match(source, /export const verifyCredentials = defineService\("verifyCredentials", \(props: \{/);
  assert.match(source, /email: string;/);
  assert.match(source, /password: string;/);
  assert.match(source, /Promise<\{/);
  assert.match(source, /session: Session;/);
  assert.match(source, /throw new Error\("Not implemented: verifyCredentials/);
});

test('functionStubSource: a "void" output type prints as plain void, not an object', () => {
  const spec = example();
  const fn = spec.functions.find((f) => f.name === 'openDashboard');
  const source = functionStubSource(spec, fn, '/some/project/features/auth/services');
  assert.match(source, /\): void => \{/);
});

// Note: `parseTypeString` (workflowGenerator.mjs, reused here) parses via `ts.createSourceFile`,
// which recovers from malformed input rather than refusing to produce a node -- so
// `functionStubSource`'s own type-string error path (wrapping that parse failure with which
// function/field it came from) mirrors an existing, effectively unreachable-in-practice guard the
// context-field code already had; not given its own test here for the same reason
// workflowGenerator.test.mjs never exercised it either.

// ---------------------------------------------------------------------------
// generateFromSpec: filesystem-backed, end to end via validateArchitecture
// ---------------------------------------------------------------------------

test('generateFromSpec: the worked example writes a full feature scaffold, the workflow, its state union, and three function stubs', () => {
  const dir = tmpProject();
  const result = generateFromSpec(dir, example(), {});
  assert.equal(result.feature, 'auth');
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.functions.sort(), ['openDashboard', 'recordFailedAttempt', 'verifyCredentials']);
  assert.deepEqual(result.written.sort(), [
    'features/auth/index.ts',
    'features/auth/services/openDashboard.ts',
    'features/auth/services/recordFailedAttempt.ts',
    'features/auth/services/verifyCredentials.ts',
    'features/auth/types.ts',
    'features/auth/workflows/SignInWithRetryWorkflow.tsx',
    'features/auth/workflows/SignInWithRetryWorkflowState.ts',
  ].sort());
  for (const f of result.written) assert.equal(fs.existsSync(path.join(dir, f)), true, f);
  assert.equal(result.workflow.file, 'features/auth/workflows/SignInWithRetryWorkflow.tsx');
  assert.deepEqual(result.workflow.events, ['SUBMIT', 'VALID', 'INVALID', 'RETRY']);
});

test('generateFromSpec: the generated project passes the real construct validate cleanly', () => {
  const dir = tmpProject();
  generateFromSpec(dir, example(), {});
  const { violations } = validateArchitecture(dir, {});
  assert.deepEqual(violations.filter((v) => v.severity === 'error'), []);
});

test('generateFromSpec: a second call with the same spec writes nothing new (never overwrites)', () => {
  const dir = tmpProject();
  const first = generateFromSpec(dir, example(), {});
  const bytesBefore = Object.fromEntries(first.written.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const second = generateFromSpec(dir, example(), {});
  assert.deepEqual(second.written, []);
  // The one-time feature scaffold (types.ts/index.ts, via createFeature) isn't re-checked or
  // re-reported on a later call -- once the feature directory exists at all, it's out of scope for
  // this command's own per-run skipped/written accounting. Everything THIS command itself owns
  // (the workflow, its state union, the function stubs) is reported skipped, unchanged.
  const ownFiles = first.written.filter((f) => !['features/auth/types.ts', 'features/auth/index.ts'].includes(f));
  assert.deepEqual(second.skipped.sort(), ownFiles.sort());
  for (const [f, content] of Object.entries(bytesBefore)) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), content, f);
});

test('generateFromSpec: a hand-written file already at a target path is left untouched and reported skipped', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'auth', 'services'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'auth', 'services', 'verifyCredentials.ts'), '// hand-written, never touch me\n');
  const result = generateFromSpec(dir, example(), {});
  assert.ok(result.skipped.includes('features/auth/services/verifyCredentials.ts'));
  assert.ok(!result.written.includes('features/auth/services/verifyCredentials.ts'));
  assert.equal(fs.readFileSync(path.join(dir, 'features', 'auth', 'services', 'verifyCredentials.ts'), 'utf8'), '// hand-written, never touch me\n');
});

test('generateFromSpec: --feature is the fallback when the spec has no "feature" field', () => {
  const dir = tmpProject();
  const spec = example();
  delete spec.feature;
  const result = generateFromSpec(dir, spec, { feature: 'loginFlow' });
  assert.equal(result.feature, 'loginFlow');
  assert.equal(fs.existsSync(path.join(dir, 'features', 'loginFlow', 'workflows')), true);
});

test('generateFromSpec: neither spec.feature nor --feature is a usage error (exit 2), nothing written', () => {
  const dir = tmpProject();
  const spec = example();
  delete spec.feature;
  assert.throws(() => generateFromSpec(dir, spec, {}), (err) => {
    assert.equal(err.exitCode, EXIT_CODES.USAGE_ERROR);
    assert.match(err.message, /No feature given/);
    return true;
  });
  assert.equal(fs.existsSync(path.join(dir, 'features')), false);
});

// ---------------------------------------------------------------------------
// end-to-end via the real CLI binary
// ---------------------------------------------------------------------------

test('construct research spec --generate: CLI writes the feature end to end and construct validate passes', () => {
  const dir = tmpProject();
  const res = run(['research', 'spec', EXAMPLE_PATH, '--generate'], dir);
  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  assert.match(res.stdout, /Wrote features\/auth\/workflows\/SignInWithRetryWorkflow\.tsx/);
  assert.match(res.stdout, /Wrote features\/auth\/services\/verifyCredentials\.ts/);
  assert.match(res.stdout, /Generated feature "auth": 7 file\(s\) written, 0 skipped\./);

  const validateRes = run(['validate'], dir);
  assert.equal(validateRes.status, EXIT_CODES.OK, validateRes.stdout);
});

test('construct research spec --generate --format json: prints the generation result as JSON only', () => {
  const dir = tmpProject();
  const res = run(['research', 'spec', EXAMPLE_PATH, '--generate', '--format', 'json'], dir);
  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.status, 'generated');
  assert.equal(parsed.feature, 'auth');
  assert.equal(parsed.functions.length, 3);
});

test('construct research spec --generate on a FAILING spec: prints R1\'s report, exits 1, writes nothing', () => {
  const dir = tmpProject();
  const res = run(['research', 'spec', UNREACHABLE_PATH, '--generate'], dir);
  assert.equal(res.status, EXIT_CODES.VIOLATIONS);
  assert.match(res.stdout, /SPEC-007/);
  assert.doesNotMatch(res.stdout, /Wrote /);
  assert.equal(fs.existsSync(path.join(dir, 'features')), false);
});

test('construct research spec --generate: no feature name anywhere is a usage error (exit 2)', () => {
  const dir = tmpProject();
  const spec = example();
  delete spec.feature;
  const specPath = path.join(dir, 'no-feature.json');
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const res = run(['research', 'spec', specPath, '--generate'], dir);
  assert.equal(res.status, EXIT_CODES.USAGE_ERROR);
  assert.match(res.stderr, /No feature given/);
  assert.equal(fs.existsSync(path.join(dir, 'features')), false);
});

test('construct research spec (no --generate): behavior is completely unchanged, still read-only', () => {
  const dir = tmpProject();
  const res = run(['research', 'spec', EXAMPLE_PATH], dir);
  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  assert.match(res.stdout, /passed/);
  assert.equal(fs.existsSync(path.join(dir, 'features')), false);
});

test('usage text and repl help list --generate for research spec', () => {
  const helpRes = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' });
  assert.match(helpRes.stdout, /research spec <file> \[--generate/);
});
