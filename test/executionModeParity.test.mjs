// #541 -- the parity CONTRACT for the switchable execution mode: the Cockpit's `engine` mode (the core function
// called in-process) and its `cli` mode (the real `construct` binary as a subprocess) must produce
// byte-identical `validate --format json` output for the same project. If they ever disagree, this fails --
// nothing here is normalized: the whole JSON document is compared as a string.
//
// Fixtures are COPIED into a temp dir first and validated from there: a fixture that has no architecture.yml of
// its own would otherwise resolve upward to THIS repo's root config (both modes do that identically, but it
// would validate the repo, not the fixture), and a user's project is never inside another Construct project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { runValidate, resolveCliBin, parseValidateOutput, ExecutionError, CLI_BIN_ENV } from '../ui/server/src/coreExecutor.mjs';
import { loadConfig } from '../packages/core/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const DIST = path.join(here, '..', 'packages', 'cli', 'dist', 'construct.mjs');

const project = (rel) => {
  const dir = makeTempDir('construct-parity-');
  fs.cpSync(path.join(FIXTURES, rel), dir, { recursive: true });
  return dir;
};

// [fixture, expected status, why it is in the set]
const CASES = [
  ['architecture-valid-react-spa', 'passed', 'clean: no error-severity violations (a few warnings)'],
  ['frozen-presentation/project-bad', 'failed', 'many findings across rules, some errors'],
  ['architecture-invalid', 'failed', 'error-severity violations (missing feature slices)'],
  ['architecture-valid', 'passed', 'no errors, a different rule mix'],
  ['soc-god-file', 'failed', 'separation-of-concerns errors'],
  ['readability-naming', 'failed', 'readability findings'],
];

for (const [fixture, status, why] of CASES) {
  test(`parity: ${fixture} (${why}) -- engine and cli output are byte-identical`, async () => {
    const dir = project(fixture);
    const engine = await runValidate(dir, { mode: 'engine' });
    const cli = await runValidate(dir, { mode: 'cli' });
    assert.equal(engine.mode, 'engine');
    assert.equal(cli.mode, 'cli');
    assert.equal(engine.status, status);
    // guard against a vacuous pass: both sides really carry findings
    assert.ok(engine.violations.length > 0, 'the fixture must produce findings');
    // the contract: the whole document, as a string, no normalization
    assert.equal(cli.report, engine.report);
    // (compared through JSON: in-process violation objects carry `docsUrl: undefined` keys that JSON drops -- invisible on the wire)
    assert.deepEqual(cli.violations, JSON.parse(engine.report).violations);
    assert.equal(cli.ok, engine.ok);
    // and it is the CLI's own stdout, not something the executor rebuilt
    const direct = spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', dir], { encoding: 'utf8' });
    assert.equal(direct.stdout, `${engine.report}\n`);
    assert.equal(direct.status, engine.ok ? 0 : 1);
  });
}

test('parity holds for the BUILT cli bundle too (skipped unless `npm run build:cli` has produced it)', { skip: !fs.existsSync(DIST) && 'packages/cli/dist is not built' }, async () => {
  const dir = project('architecture-valid-react-spa');
  const engine = await runValidate(dir, { mode: 'engine' });
  const built = await runValidate(dir, { mode: 'cli', env: { ...process.env, [CLI_BIN_ENV]: DIST } });
  assert.equal(built.report, engine.report);
});

test('the default mode is engine; project.execution.mode: cli is read from architecture.yml; an unknown value is a clear error', () => {
  assert.equal(loadConfig(project('architecture-valid-react-spa')).project.execution.mode, 'engine');
  const dir = project('architecture-valid-react-spa');
  const file = path.join(dir, 'architecture.yml');
  fs.writeFileSync(file, 'project:\n  framework: react-spa\n  execution:\n    mode: cli\n');
  assert.equal(loadConfig(dir).project.execution.mode, 'cli');
  fs.writeFileSync(file, 'project:\n  execution:\n    mode: bogus\n');
  assert.throws(() => loadConfig(dir), /Unknown project\.execution\.mode 'bogus' in architecture\.yml — expected one of: engine, cli/);
  assert.equal(loadConfig(makeTempDir('construct-parity-empty-')).project.execution.mode, 'engine');
});

test('a CLI that fails is an error, never a silent empty result', async () => {
  const dir = project('architecture-valid-react-spa');
  const bad = path.join(makeTempDir('construct-parity-bin-'), 'bad.mjs');
  const run = (body) => {
    fs.writeFileSync(bad, body);
    return runValidate(dir, { mode: 'cli', bin: bad, timeoutMs: 3000 });
  };
  await assert.rejects(run('console.error("boom"); process.exit(3);'), (e) => e instanceof ExecutionError && e.code === 'CLI_FAILED' && /boom/.test(e.message));
  await assert.rejects(run('console.log("not json at all");'), (e) => e.code === 'CLI_BAD_OUTPUT');
  await assert.rejects(run('console.log(JSON.stringify({ hello: 1 }));'), (e) => e.code === 'CLI_BAD_OUTPUT');
  await assert.rejects(run('console.log(JSON.stringify({ status: "passed", violations: [] })); process.exit(1);'), (e) => e.code === 'CLI_BAD_OUTPUT');
  await assert.rejects(run('setInterval(() => {}, 1000);'), (e) => e.code === 'CLI_TIMEOUT');
  // a binary that does not exist: node itself exits non-zero with no report, and the Cockpit says so
  await assert.rejects(runValidate(dir, { mode: 'cli', bin: path.join(dir, 'nope.mjs') }), (e) => e.code === 'CLI_BAD_OUTPUT' && /Cannot find module/.test(e.message));
});

test('the real CLI\'s own errors surface: a project with an unknown execution.mode fails validate with its message', async () => {
  const dir = project('architecture-valid-react-spa');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: react-spa\n  execution:\n    mode: bogus\n');
  await assert.rejects(runValidate(dir, { mode: 'cli' }), (e) => e.code === 'CLI_FAILED' && /Unknown project\.execution\.mode 'bogus'/.test(e.message));
});

test('the subprocess gets --dir, cwd and CONSTRUCT_* variables, and not the server\'s other secrets', async () => {
  const dir = project('architecture-valid-react-spa');
  const spy = path.join(makeTempDir('construct-parity-bin-'), 'spy.mjs');
  fs.writeFileSync(spy, `console.log(JSON.stringify({ status: 'passed', violations: [], argv: process.argv.slice(2), cwd: process.cwd(), ws: process.env.CONSTRUCT_WORKSPACE_ROOT, secret: process.env.GITHUB_TOKEN ?? null }));`);
  const r = await runValidate(dir, { mode: 'cli', bin: spy, env: { ...process.env, CONSTRUCT_WORKSPACE_ROOT: '/ws', GITHUB_TOKEN: 'shh' } });
  const seen = JSON.parse(r.report);
  assert.deepEqual(seen.argv, ['validate', '--format', 'json', '--dir', dir]);
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(dir));
  assert.equal(seen.ws, '/ws');
  assert.equal(seen.secret, null);
});

test('resolveCliBin: the env var wins, a missing target is CLI_NOT_FOUND, the default is this repo\'s CLI', () => {
  assert.equal(resolveCliBin({ [CLI_BIN_ENV]: CLI }), CLI);
  assert.throws(() => resolveCliBin({ [CLI_BIN_ENV]: '/definitely/not/here.mjs' }), (e) => e.code === 'CLI_NOT_FOUND');
  assert.ok(fs.existsSync(resolveCliBin({})));
});

test('parseValidateOutput: exit 1 with a "failed" report is a result, not an error', () => {
  const doc = parseValidateOutput({ code: 1, signal: null, stdout: JSON.stringify({ status: 'failed', violations: [{ rule: 'X' }] }), stderr: '' });
  assert.equal(doc.status, 'failed');
});
