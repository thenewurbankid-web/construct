// #924: the fallow block (packages/core/fallow.mjs). Fixtures under test/fixtures/fallow/ are real
// `fallow dead-code|health --format json` output (fallow 3.33.1) captured on a `construct init` scaffold
// plus a generated core slice and an orders list screen, with three seeded problems added to the core
// domain (an import cycle Score <-> Rank, an unresolved import, one deliberately complex function).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertValidViolation } from '../packages/core/diagnostics.mjs';
import {
  mapDeadCode, mapHealth, runFallow, fallowSetting, fallowStage, resolveFallowBin, FALLOW_RULES, FALLOW_BIN_ENV, FALLOW_VERSION,
} from '../packages/core/fallow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'fallow');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');
const deadCode = () => JSON.parse(fs.readFileSync(path.join(FIX, 'dead-code.json'), 'utf8'));
const health = () => JSON.parse(fs.readFileSync(path.join(FIX, 'health.json'), 'utf8'));
const countByRule = (vs) => vs.reduce((m, v) => ({ ...m, [v.rule]: (m[v.rule] ?? 0) + 1 }), {});

/** A throwaway project: package.json (so fallow is on by default) and an optional architecture.yml. */
function project({ pkg = true, yml } = {}) {
  const dir = makeTempDir('construct-fallow-');
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","private":true}\n');
  if (yml !== undefined) fs.writeFileSync(path.join(dir, 'architecture.yml'), yml);
  return dir;
}

/** An execFile stand-in answering each fallow sub-command from `answers[sub]` = {stdout, err}. */
const fakeExec = (answers) => (cmd, args, opts, cb) => {
  const sub = args.find((a) => a === 'dead-code' || a === 'health');
  const a = answers[sub] ?? {};
  setImmediate(() => cb(a.err ?? null, a.stdout ?? '', a.stderr ?? ''));
};

test('the pinned version matches package.json devDependencies (exact, no range)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies.fallow, FALLOW_VERSION);
});

test('mapDeadCode: the recorded scaffold run maps to FALLOW-* warnings with fallow\'s fingerprints kept', () => {
  const vs = mapDeadCode(deadCode());
  assert.deepEqual(countByRule(vs), {
    'FALLOW-UNUSED-EXPORT': 2,
    'FALLOW-UNUSED-FILE': 19,
    'FALLOW-UNUSED-DEPENDENCY': 1,
    'FALLOW-UNRESOLVED-IMPORT': 1,
    'FALLOW-CYCLE': 1,
  });
  for (const v of vs) {
    assertValidViolation(v);
    assert.equal(v.severity, 'warning');
    assert.equal(v.source, 'fallow');
    assert.match(v.fingerprint, /^dc1:[a-z-]+:[0-9a-f]+$/);
    assert.ok(v.rule in FALLOW_RULES);
  }
  const cycle = vs.find((v) => v.rule === 'FALLOW-CYCLE');
  assert.equal(cycle.module, 'architecture');
  assert.equal(cycle.fingerprint, 'dc1:circular-dependency:e2ee685e3dddaba5');
  assert.match(cycle.message, /Rank\.ts -> features\/core\/domain\/Score\.ts -> features\/core\/domain\/Rank\.ts/);
  const exp = vs.find((v) => v.rule === 'FALLOW-UNUSED-EXPORT' && /unusedHelper/.test(v.message));
  assert.equal(exp.file, 'features/core/domain/Score.ts');
  assert.equal(exp.line, 35);
  const unresolved = vs.find((v) => v.rule === 'FALLOW-UNRESOLVED-IMPORT');
  assert.deepEqual([unresolved.file, unresolved.line], ['features/core/domain/Score.ts', 2]);
  assert.match(vs.find((v) => v.rule === 'FALLOW-UNUSED-DEPENDENCY').message, /"@xstate\/graph" in devDependencies/);
});

test('mapHealth: one function over every threshold is three findings, each with an identity fingerprint', () => {
  const vs = mapHealth(health());
  assert.deepEqual(vs.map((v) => v.rule), ['FALLOW-COMPLEXITY-CYCLOMATIC', 'FALLOW-COMPLEXITY-COGNITIVE', 'FALLOW-CRAP']);
  for (const v of vs) {
    assertValidViolation(v);
    assert.equal(v.severity, 'warning');
    assert.equal(v.file, 'features/core/domain/Score.ts');
    assert.equal(v.line, 6);
  }
  assert.equal(vs[0].fingerprint, 'health:complexity-cyclomatic:features/core/domain/Score.ts:scoreOrder');
  assert.match(vs[0].message, /cyclomatic complexity 27 \(critical\)/);
  assert.match(vs[1].message, /cognitive complexity 39/);
  assert.match(vs[2].message, /CRAP score 756/);
  assert.match(vs[0].suggestedFix, /Refactor `scoreOrder`/);
});

test('schema drift: unknown fields are ignored, missing or wrong-typed ones never throw', () => {
  for (const doc of [null, undefined, 42, 'x', [], {}]) {
    assert.deepEqual(mapDeadCode(doc), []);
    assert.deepEqual(mapHealth(doc), []);
  }
  // unknown fields everywhere, a new top-level category, and the boundary/policy detectors (always dropped)
  const drifted = { ...deadCode(), brand_new_category: [{ path: 'a.ts' }], boundary_violations: [{ path: 'a.ts', line: 1 }], policy_violations: [{ path: 'a.ts' }] };
  drifted.unused_exports = drifted.unused_exports.map((f) => ({ ...f, some_future_field: { nested: true } }));
  assert.deepEqual(countByRule(mapDeadCode(drifted)), countByRule(mapDeadCode(deadCode())));
  // findings missing every field, and arrays that are not arrays
  const sparse = mapDeadCode({
    unused_exports: [{}], unused_files: [{}, null, 7], unused_dependencies: [{}], unused_component_props: [{}],
    unresolved_imports: [{}], circular_dependencies: [{}], duplicate_exports: [{}], unused_types: 'nope',
  });
  assert.equal(sparse.length, 7);
  for (const v of sparse) {
    assertValidViolation(v);
    assert.ok(v.file && v.line >= 1);
    assert.equal(v.fingerprint, null);
  }
  assert.equal(sparse.find((v) => v.rule === 'FALLOW-UNUSED-DEPENDENCY').file, 'package.json');
  const h = mapHealth({ findings: [{}, { exceeded: 'something-new' }, { exceeded: 'both', path: 'x.ts' }] });
  assert.deepEqual(h.map((v) => v.rule), ['FALLOW-COMPLEXITY-CYCLOMATIC', 'FALLOW-COMPLEXITY-COGNITIVE']);
  assert.equal(h[0].fingerprint, 'health:complexity-cyclomatic:x.ts:(anonymous)');
});

test('the remaining categories map too: unused prop, duplicate export, unused type export', () => {
  const vs = mapDeadCode({
    unused_component_props: [{ path: 'C.tsx', component_name: 'Card', prop_name: 'tone', line: 3, finding_id: 'dc1:unused-component-prop:1' }],
    duplicate_exports: [{ export_name: 'Order', locations: [{ path: 'a.ts', line: 2, col: 1 }, { path: 'b.ts', line: 5, col: 1 }], finding_id: 'dc1:duplicate-export:2' }],
    unused_types: [{ path: 't.ts', export_name: 'T', is_type_only: true, line: 4, finding_id: 'dc1:unused-type:3' }],
  });
  assert.deepEqual(vs.map((v) => [v.rule, v.file, v.line, v.fingerprint]), [
    ['FALLOW-UNUSED-EXPORT', 't.ts', 4, 'dc1:unused-type:3'],
    ['FALLOW-UNUSED-PROP', 'C.tsx', 3, 'dc1:unused-component-prop:1'],
    ['FALLOW-DUPLICATE', 'a.ts', 2, 'dc1:duplicate-export:2'],
  ]);
  assert.match(vs[2].message, /2 modules: a\.ts, b\.ts/);
});

test('missing binary: unavailable with one clear message, never a throw', async () => {
  const dir = project();
  const none = await runFallow(dir, { bin: null });
  assert.equal(none.status, 'unavailable');
  assert.deepEqual(none.violations, []);
  assert.match(none.message, /^fallow not installed: FALLOW-\* checks skipped \(npm i -D fallow@3\.33\.1\)$/);
  // a CONSTRUCT_FALLOW_BIN that does not exist resolves to nothing
  assert.equal(resolveFallowBin(dir, { env: { [FALLOW_BIN_ENV]: path.join(dir, 'nope') } }), null);
  // a binary that vanishes between resolve and spawn (ENOENT) is the same result
  const enoent = Object.assign(new Error('spawn fallow ENOENT'), { code: 'ENOENT' });
  const gone = await runFallow(dir, { bin: { command: 'fallow', args: [] }, execFileImpl: fakeExec({ 'dead-code': { err: enoent }, health: { err: enoent } }) });
  assert.equal(gone.status, 'unavailable');
  // the validate stage turns it into exactly one info line and no findings
  const stage = await fallowStage(dir, { bin: null });
  assert.deepEqual(stage.violations, []);
  assert.equal(stage.notice, `ℹ️ ${none.message}`);
});

test('runFallow: exit 1 from fallow\'s own gate still maps the report; non-JSON and timeouts are failed, not thrown', async () => {
  const dir = project();
  const bin = { command: 'fallow', args: [] };
  const gate = Object.assign(new Error('exit 1'), { code: 1 });
  const ok = await runFallow(dir, { bin, execFileImpl: fakeExec({ 'dead-code': { err: gate, stdout: JSON.stringify(deadCode()) }, health: { err: gate, stdout: JSON.stringify(health()) } }) });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.version, '3.33.1');
  assert.equal(ok.violations.length, 27);
  const bad = await runFallow(dir, { bin, execFileImpl: fakeExec({ 'dead-code': { stdout: 'panic: boom', err: gate }, health: { stdout: JSON.stringify(health()) } }) });
  assert.equal(bad.status, 'failed');
  assert.match(bad.message, /fallow dead-code printed no JSON report: panic: boom/);
  assert.equal(bad.violations.length, 3, 'the analysis that did finish still reports');
  const killed = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
  const slow = await runFallow(dir, { bin, timeoutMs: 5, execFileImpl: fakeExec({ 'dead-code': { err: killed }, health: { err: killed } }) });
  assert.equal(slow.status, 'failed');
  assert.match(slow.message, /timed out after 5 ms/);
});

test('runFallow passes no --type-aware, no boundaries/similar-code, --no-cache, and telemetry off', async () => {
  const dir = project();
  const seen = [];
  const exec = (cmd, args, opts, cb) => { seen.push({ args, env: opts.env, timeout: opts.timeout }); setImmediate(() => cb(null, '{}', '')); };
  await runFallow(dir, { bin: { command: 'fallow', args: [] }, execFileImpl: exec, env: {} });
  assert.deepEqual(seen.map((s) => s.args[0]).sort(), ['dead-code', 'health']);
  for (const s of seen) {
    assert.deepEqual(s.args.slice(1), ['--root', dir, '--format', 'json', '--quiet', '--no-cache']);
    assert.equal(s.env.FALLOW_TELEMETRY_DISABLED, '1');
    assert.equal(s.env.DO_NOT_TRACK, '1');
    assert.equal(s.timeout, 120000);
  }
});

test('fallowSetting: on by default with a package.json; --no-fallow, architecture.yml and no package.json turn it off', () => {
  assert.deepEqual(fallowSetting(project()), { enabled: true });
  assert.equal(fallowSetting(project(), ['--no-fallow']).enabled, false);
  assert.equal(fallowSetting(project({ yml: 'fallow: false\n' })).enabled, false);
  assert.equal(fallowSetting(project({ yml: 'fallow:\n  enabled: false\n' })).enabled, false);
  assert.equal(fallowSetting(project({ yml: 'fallow: true\n' })).enabled, true);
  assert.equal(fallowSetting(project({ yml: ': not yaml [' })).enabled, true, 'a broken architecture.yml is loadConfig\'s to report');
  assert.deepEqual(fallowSetting(project({ pkg: false })), { enabled: false, reason: 'no package.json' });
});

/** A fake fallow binary (a node script) that prints the recorded fixture for each sub-command. */
function fakeBin() {
  const dir = makeTempDir('construct-fallow-bin-');
  const bin = path.join(dir, 'fallow');
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconst fs = require('fs');\nconst sub = process.argv[2];\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(FIX)} + '/' + sub + '.json', 'utf8'));\nprocess.exit(1);\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

const runValidate = (dir, extra = [], env = {}) => spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', dir, ...extra], { encoding: 'utf8', env: { ...process.env, ...env } });

test('construct validate: FALLOW-* findings are added by default as warnings and never change the exit code', { skip: process.platform === 'win32' && 'fake binary is a shebang script' }, () => {
  const dir = project({ yml: 'version: 1\n' });
  const bin = fakeBin();
  const on = runValidate(dir, [], { [FALLOW_BIN_ENV]: bin });
  const off = runValidate(dir, ['--no-fallow'], { [FALLOW_BIN_ENV]: bin });
  const onDoc = JSON.parse(on.stdout);
  const offDoc = JSON.parse(off.stdout);
  const fallowFindings = onDoc.violations.filter((v) => v.rule.startsWith('FALLOW-'));
  assert.equal(fallowFindings.length, 27);
  assert.ok(fallowFindings.every((v) => v.severity === 'warning'));
  assert.equal(offDoc.violations.filter((v) => v.rule.startsWith('FALLOW-')).length, 0);
  assert.deepEqual(onDoc.violations.filter((v) => !v.rule.startsWith('FALLOW-')), offDoc.violations, 'the enforcers\' findings are unchanged');
  assert.equal(onDoc.status, offDoc.status);
  assert.equal(on.status, off.status);
  assert.equal(on.stderr, '');
  // architecture.yml's switch does the same as --no-fallow
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nfallow: false\n');
  assert.equal(JSON.parse(runValidate(dir, [], { [FALLOW_BIN_ENV]: bin }).stdout).violations.filter((v) => v.rule.startsWith('FALLOW-')).length, 0);
});

test('construct validate: a missing fallow is one info line on stderr; the JSON report is untouched', () => {
  const dir = project({ yml: 'version: 1\n' });
  const missing = runValidate(dir, [], { [FALLOW_BIN_ENV]: path.join(dir, 'no-such-fallow') });
  const off = runValidate(dir, ['--no-fallow']);
  assert.equal(missing.stdout, off.stdout);
  assert.equal(missing.status, off.status);
  assert.deepEqual(missing.stderr.trim().split('\n'), ['ℹ️ fallow not installed: FALLOW-* checks skipped (npm i -D fallow@3.33.1)']);
});

test('construct fallow [path] --json: the block alone; exit 2 when fallow is missing', { skip: process.platform === 'win32' && 'fake binary is a shebang script' }, () => {
  const dir = project();
  const r = spawnSync(process.execPath, [CLI, 'fallow', dir, '--json'], { encoding: 'utf8', env: { ...process.env, [FALLOW_BIN_ENV]: fakeBin() } });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.status, 'ok');
  assert.equal(doc.version, '3.33.1');
  assert.equal(doc.violations.length, 27);
  const gone = spawnSync(process.execPath, [CLI, 'fallow', dir], { encoding: 'utf8', env: { ...process.env, [FALLOW_BIN_ENV]: path.join(dir, 'nope') } });
  assert.equal(gone.status, 2);
  assert.match(gone.stderr, /fallow not installed/);
});

test('real fallow (when installed): runs on a tiny project and reports its unused export', { skip: !resolveFallowBin(makeTempDir('construct-fallow-probe-'), { env: {} }) && 'fallow is not installed' }, async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","private":true,"main":"index.js"}\n');
  fs.writeFileSync(path.join(dir, 'index.js'), "import { used } from './lib.js';\nconsole.log(used());\n");
  fs.writeFileSync(path.join(dir, 'lib.js'), 'export function used() { return 1; }\nexport function unused() { return 2; }\n');
  const r = await runFallow(dir, { env: {} });
  assert.equal(r.status, 'ok', r.message);
  assert.equal(r.version, FALLOW_VERSION);
  const exp = r.violations.find((v) => v.rule === 'FALLOW-UNUSED-EXPORT');
  assert.ok(exp, JSON.stringify(r.violations));
  assert.equal(exp.file, 'lib.js');
  assert.match(exp.message, /"unused"/);
  assert.ok(!fs.existsSync(path.join(dir, '.fallow')), 'read-only: no cache folder written');
});
