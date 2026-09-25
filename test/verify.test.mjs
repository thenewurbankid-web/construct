// #632 -- `check.types` and `check.build`: type-check and build as read-only plan steps whose result is CLASSIFIED (a pass, or what kind of
// failure and where), never a raw log. Pure classification, the bounded runners on real fixtures (a passing and a failing tsc and build,
// a timeout that kills the process group, an output cap), the CLI, the flows in the registry and the `q-verify` question of a shaped plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRequirement } from '../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../packages/core/placement.mjs';
import { PLAN_FLOWS, planToCommand, validatePlan } from '../packages/core/plan.mjs';
import { flowBlock, flowScopeKind } from '../packages/core/block-flows.mjs';
import { choicesFromWiring } from '../packages/core/decision-trace-adapters.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { classifyBuildOutput, classifyTypeErrors, readBuildErrors, typeErrorKind, verifyOffer, verifyTouches, buildScriptOf, VERIFY_LIMITS } from '../packages/core/verify.mjs';
import { runTypesCheck, runBuildCheck, renderCheckText, checkExitCode } from '../packages/engine/verifyRunner.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });
const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const TS = path.join(REPO, 'node_modules', 'typescript');
const HAVE_TS = fs.existsSync(path.join(TS, 'lib', 'tsc.js'));
const NEEDS_TS = { skip: HAVE_TS ? false : 'typescript is not installed here' };

/** A project with the repo's TypeScript linked in, a tsconfig over `features`, and the given files. */
function tsProject(files, { incremental = false, scripts = { build: 'node build.js' }, build = "console.log('built');\n" } = {}) {
  const dir = makeTempDir('construct-verify-');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  if (HAVE_TS) fs.symlinkSync(TS, path.join(dir, 'node_modules', 'typescript'));
  put(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, ...(incremental ? { incremental: true } : {}) }, include: ['features'] }));
  put(dir, 'package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }));
  put(dir, 'architecture.yml', 'features:\n  root: features\n');
  if (build !== null) put(dir, 'build.js', build);
  for (const [f, text] of Object.entries(files)) put(dir, f, text);
  return dir;
}
const BROKEN = {
  'features/shop/a.ts': "import { nope } from './missing';\nexport const a: number = 'x';\nexport const b = unknownName + 1;\nexport const c = nope;\n",
  'features/shop/b.ts': 'export const ok: number = 1;\n',
  'features/cart/c.ts': "export const d: string = 42;\n",
};
const GOOD = { 'features/shop/b.ts': 'export const ok: number = 1;\n' };

// ------------------------------------------------------------------------------------------------------ pure classification

test('typeErrorKind: the three kinds a person can act on, by TypeScript code; anything else is other', () => {
  assert.deepEqual(['TS2307', 'TS2305', 'TS2724'].map(typeErrorKind), Array(3).fill('missing-import'));
  assert.deepEqual(['TS2304', 'TS2552', 'TS2339'].map(typeErrorKind), Array(3).fill('unknown-name'));
  assert.deepEqual(['TS2322', 'TS2345', 'TS2741'].map(typeErrorKind), Array(3).fill('type-mismatch'));
  assert.deepEqual(['TS7016', 'TS1005', 'nonsense'].map(typeErrorKind), Array(3).fill('other'));
});

test('classifyTypeErrors: no error is a pass; errors are grouped by file, only the first N are listed, the counts are complete and the statement is plain', () => {
  assert.deepEqual(classifyTypeErrors([]).status, 'pass');
  assert.equal(classifyTypeErrors([]).statement, 'No type errors: the project type-checks.');
  const errors = [
    { file: 'a.ts', line: 1, code: 'TS2307', message: "Cannot find module './x'." },
    { file: 'b.ts', line: 2, code: 'TS2322', message: 'Type A is not assignable to type B.' },
    { file: 'a.ts', line: 3, code: 'TS2304', message: "Cannot find name 'y'." },
    { file: 'c.ts', line: 4, code: 'TS2304', message: "Cannot find name 'z'." },
  ];
  const all = classifyTypeErrors(errors);
  assert.equal(all.status, 'type-errors');
  assert.deepEqual(all.counts, { errors: 4, files: 3, shown: 4, omitted: 0, byKind: { 'missing-import': 1, 'type-mismatch': 1, 'unknown-name': 2 } });
  assert.deepEqual(all.files.map((f) => [f.file, f.count, f.errors.map((e) => `${e.line} ${e.code} ${e.kind}`)]), [['a.ts', 2, ['1 TS2307 missing-import', '3 TS2304 unknown-name']], ['b.ts', 1, ['2 TS2322 type-mismatch']], ['c.ts', 1, ['4 TS2304 unknown-name']]]);
  assert.match(all.statement, /^4 type errors in 3 files: 1 missing import, 2 unknown names, 1 type mismatch \(/, 'always in the same order of kinds, whatever order tsc printed');
  const capped = classifyTypeErrors(errors, { limit: 2 });
  assert.deepEqual([capped.counts.shown, capped.counts.omitted, capped.counts.errors, capped.files.map((f) => f.file), capped.files[0].count], [2, 2, 4, ['a.ts', 'b.ts'], 2], 'the first two in tsc order, the file count still says how many are in a.ts');
  assert.match(capped.statement, /The first 2 are listed\.$/);
  assert.equal(classifyTypeErrors([{ file: 'a.ts', line: 1, code: 'TS2322', message: 'x'.repeat(500) }]).files[0].errors[0].message.length, VERIFY_LIMITS.message, 'a message is capped');
  assert.equal(VERIFY_LIMITS.errors, 10, 'ten by default');
});

test('readBuildErrors: tsc lines, Next.js blocks and Vite/esbuild errors become { file, line, message }, the rest of the log is left out', () => {
  assert.deepEqual(readBuildErrors("noise\nsrc/a.ts(3,5): error TS2304: Cannot find name 'x'.\nmore noise"), [{ file: 'src/a.ts', line: 3, message: "TS2304: Cannot find name 'x'." }]);
  assert.deepEqual(readBuildErrors("src/a.ts:7:9 - error TS2322: Type 'string' is not assignable to type 'number'."), [{ file: 'src/a.ts', line: 7, message: "TS2322: Type 'string' is not assignable to type 'number'." }]);
  const next = "Failed to compile.\n\n./features/shop/Page.tsx:12:5\nType error: Property 'x' does not exist on type 'Props'.\n\n  10 | const a = 1;\n> 12 |   x;\n";
  assert.deepEqual(readBuildErrors(next), [{ file: 'features/shop/Page.tsx', line: 12, message: "Type error: Property 'x' does not exist on type 'Props'." }]);
  const vite = 'vite v5 building for production...\n✘ [ERROR] Could not resolve "./missing"\n\n    src/main.tsx:2:7:\n      2 │ import "./missing";\n';
  assert.deepEqual(readBuildErrors(vite), [{ file: 'src/main.tsx', line: 2, message: 'Could not resolve "./missing"' }]);
  assert.deepEqual(readBuildErrors('Module not found: Error: Can\'t resolve \'zod\' in \'/app\''), [{ file: null, line: null, message: "Module not found: Error: Can't resolve 'zod' in '/app'" }]);
  assert.equal(readBuildErrors(Array.from({ length: 30 }, (_, i) => `a.ts(${i + 1},1): error TS2304: x`).join('\n')).length, VERIFY_LIMITS.errors, 'the first N only');
  assert.deepEqual(readBuildErrors('\u001b[31msrc/a.ts(1,1): error TS2304: red\u001b[0m'), [{ file: 'src/a.ts', line: 1, message: 'TS2304: red' }], 'colour codes are stripped');
});

test('classifyBuildOutput: pass, timeout, compile-error with its errors, and failed with the end of the output kept', () => {
  assert.deepEqual([classifyBuildOutput({ exitCode: 0, output: 'anything' }).status, classifyBuildOutput({ exitCode: 0, output: '' }).errors], ['pass', []]);
  const timeout = classifyBuildOutput({ exitCode: null, output: 'x', timedOut: true, timeoutMs: 5000 });
  assert.deepEqual([timeout.status, timeout.statement], ['timeout', 'The build did not finish within 5 seconds and was stopped.']);
  const compile = classifyBuildOutput({ exitCode: 1, output: "src/a.ts(3,5): error TS2304: Cannot find name 'x'." });
  assert.deepEqual([compile.status, compile.errors.length, compile.statement], ['compile-error', 1, 'The build failed to compile: 1 error listed.']);
  const hinted = classifyBuildOutput({ exitCode: 1, output: 'Build failed with 1 error:\nsomething odd' });
  assert.deepEqual([hinted.status, hinted.errors, /Build failed/.test(hinted.excerpt)], ['compile-error', [], true], 'a compile message with no location keeps its own words');
  const failed = classifyBuildOutput({ exitCode: 3, output: `${'line\n'.repeat(50)}the disk is full\n` });
  assert.equal(failed.status, 'failed');
  assert.match(failed.statement, /exited with code 3/);
  assert.match(failed.excerpt, /the disk is full$/);
  assert.ok(failed.excerpt.split('\n').length <= VERIFY_LIMITS.excerptLines, 'the end of the output, a fixed number of lines');
});

// ------------------------------------------------------------------------------------------------------ the type-check runner

test('check.types on a broken project: classified, grouped by file, with the kind of each error; nothing is written', NEEDS_TS, async () => {
  const dir = tsProject(BROKEN);
  const before = fs.readdirSync(dir, { recursive: true }).sort();
  const r = await runTypesCheck(dir);
  assert.deepEqual([r.ok, r.check, r.status, r.feature], [true, 'types', 'type-errors', null]);
  assert.deepEqual(r.counts, { errors: 4, files: 2, shown: 4, omitted: 0, byKind: { 'missing-import': 1, 'type-mismatch': 2, 'unknown-name': 1 } }, JSON.stringify(r.files));
  assert.deepEqual(r.files.map((f) => [f.file, f.count]), [['features/cart/c.ts', 1], ['features/shop/a.ts', 3]]);
  const a = r.files.find((f) => f.file === 'features/shop/a.ts');
  assert.deepEqual(a.errors.map((e) => [e.line, e.code, e.kind]), [[1, 'TS2307', 'missing-import'], [2, 'TS2322', 'type-mismatch'], [3, 'TS2304', 'unknown-name']]);
  assert.match(r.statement, /^4 type errors in 2 files: 1 missing import, 1 unknown name, 2 type mismatches \(/);
  assert.equal(JSON.stringify(r).includes(dir), false, 'project-relative paths only');
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before, 'read-only: nothing was written in the project');
  assert.equal(checkExitCode(r), 1);
  const text = renderCheckText(r);
  assert.match(text, /^Type-check: TYPE-ERRORS\. 4 type errors in 2 files/);
  assert.match(text, /features\/shop\/a\.ts \(3\)\n {4}line 1 {2}TS2307 {2}\[missing-import\] {2}Cannot find module '\.\/missing'/);
});

test('check.types: a clean project passes; --feature narrows the report to that feature\'s files; a limit lists the first N and counts the rest', NEEDS_TS, async () => {
  assert.deepEqual(await runTypesCheck(tsProject(GOOD)).then((r) => [r.status, r.statement, checkExitCode(r)]), ['pass', 'No type errors: the project type-checks.', 0]);
  const dir = tsProject(BROKEN);
  const cart = await runTypesCheck(dir, { feature: 'cart' });
  assert.deepEqual([cart.status, cart.counts.errors, cart.files.map((f) => f.file), cart.feature], ['type-errors', 1, ['features/cart/c.ts'], 'cart']);
  assert.match(cart.statement, /\(in the cart feature\)\.$/);
  const clean = await runTypesCheck(dir, { feature: 'shop' });
  assert.equal(clean.counts.errors, 3);
  const capped = await runTypesCheck(dir, { limit: 2 });
  assert.deepEqual([capped.counts.errors, capped.counts.shown, capped.counts.omitted], [4, 2, 2]);
  const noSuch = await runTypesCheck(dir, { feature: 'nope' });
  assert.deepEqual([noSuch.ok, noSuch.error.code, checkExitCode(noSuch)], [false, 'NO_FEATURE', 2]);
  assert.equal((await runTypesCheck(dir, { feature: '../x' })).error.code, 'NO_FEATURE');
  assert.equal((await runTypesCheck(tsProject(GOOD), { feature: 'shop' })).statement, 'No type errors in the shop feature.');
});

test('check.types cannot run: no TypeScript, no tsconfig and a timeout are named statuses, not a pass and not a crash', NEEDS_TS, async () => {
  const bare = makeTempDir('construct-verify-bare-');
  put(bare, 'tsconfig.json', '{}');
  const missing = await runTypesCheck(bare);
  assert.deepEqual([missing.ok, missing.status, checkExitCode(missing)], [true, 'tool-missing', 2]);
  assert.match(missing.statement, /TypeScript is not installed in this project/);

  const noConfig = tsProject(GOOD);
  fs.rmSync(path.join(noConfig, 'tsconfig.json'));
  assert.deepEqual(await runTypesCheck(noConfig).then((r) => [r.status, checkExitCode(r)]), ['no-config', 2]);

  const slow = await runTypesCheck(tsProject(BROKEN), { timeoutMs: 1 });
  assert.deepEqual([slow.status, checkExitCode(slow)], ['timeout', 1]);
  assert.match(slow.statement, /did not finish within 1ms/);
});

test('check.types leaves no build-info file behind (an incremental tsconfig makes tsc write one), and keeps one that was already there', NEEDS_TS, async () => {
  const dir = tsProject(GOOD, { incremental: true });
  const r = await runTypesCheck(dir);
  assert.equal(r.status, 'pass');
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.tsbuildinfo')), [], 'the file tsc wrote is removed');
  put(dir, 'kept.tsbuildinfo', '{}');
  await runTypesCheck(dir);
  assert.equal(fs.existsSync(path.join(dir, 'kept.tsbuildinfo')), true, 'one that was there is not ours to remove');
});

// ------------------------------------------------------------------------------------------------------ the build runner

test('check.build: a build that passes, and one that fails to compile (a classified error with file and line, not the log)', async () => {
  const good = await runBuildCheck(tsProject(GOOD));
  assert.deepEqual([good.ok, good.check, good.status, good.exitCode, good.script, checkExitCode(good)], [true, 'build', 'pass', 0, 'node build.js', 0]);
  const dir = tsProject(GOOD, { build: "console.log('starting');\nconsole.error(\"src/a.ts(3,5): error TS2304: Cannot find name 'x'.\");\nprocess.exit(1);\n" });
  const bad = await runBuildCheck(dir);
  assert.deepEqual([bad.status, bad.exitCode, checkExitCode(bad)], ['compile-error', 1, 1]);
  assert.deepEqual(bad.errors, [{ file: 'src/a.ts', line: 3, message: "TS2304: Cannot find name 'x'." }]);
  assert.equal(JSON.stringify(bad).includes('starting'), false, 'the log is not the result');
  assert.match(renderCheckText(bad), /^Build: COMPILE-ERROR\. The build failed to compile: 1 error listed\./);
  const other = await runBuildCheck(tsProject(GOOD, { build: "console.error('the disk is full');\nprocess.exit(7);\n" }));
  assert.deepEqual([other.status, other.exitCode, /the disk is full/.test(other.excerpt)], ['failed', 7, true]);
  assert.deepEqual([other.failure.kind, /the disk is full/.test(other.failure.message)], ['other', true], 'the shape the test runners give a failure they cannot classify (classifyFailure)');
});

test('check.build: a missing build script and a project with no package.json are named statuses that could not run', async () => {
  const none = tsProject(GOOD, { scripts: { test: 'x' } });
  const r = await runBuildCheck(none);
  assert.deepEqual([r.status, r.script, checkExitCode(r), r.durationMs], ['missing-script', null, 2, 0]);
  assert.match(r.statement, /no "build" script/);
  fs.rmSync(path.join(none, 'package.json'));
  assert.match((await runBuildCheck(none)).statement, /no package\.json/);
  assert.equal(buildScriptOf(none), null);
});

test('check.build: a build that never finishes is stopped at the timeout, its whole process group with it (no orphan)', async () => {
  const grand = "const { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nrequire('node:fs').writeFileSync('grandchild.pid', String(child.pid));\nsetInterval(() => {}, 1000);\n";
  const dir = tsProject(GOOD, { build: grand });
  const started = Date.now();
  const r = await runBuildCheck(dir, { timeoutMs: 1500 });
  assert.deepEqual([r.status, checkExitCode(r)], ['timeout', 1]);
  assert.ok(Date.now() - started < 10_000, 'it did not wait for the build');
  assert.match(r.statement, /did not finish within 2 seconds|did not finish within 1 seconds/);
  const pid = Number(fs.readFileSync(path.join(dir, 'grandchild.pid'), 'utf8'));
  let alive = true;
  for (let i = 0; i < 30 && alive; i += 1) {
    try { process.kill(pid, 0); await new Promise((res) => setTimeout(res, 100)); } catch { alive = false; }
  }
  assert.equal(alive, false, 'the grandchild the build started is gone too');
});

test('check.build: the output is capped (the head and the tail are kept, the middle is cut) and the error at the end is still found', async () => {
  const noisy = "const big = 'x'.repeat(1000);\nfor (let i = 0; i < 4000; i += 1) console.log(big);\nconsole.error(\"src/z.ts(9,1): error TS2304: Cannot find name 'late'.\");\nprocess.exit(1);\n";
  const r = await runBuildCheck(tsProject(GOOD, { build: noisy }), { outputCap: 20_000 });
  assert.equal(r.outputTruncated, true);
  assert.deepEqual([r.status, r.errors[0]?.file, r.errors[0]?.line], ['compile-error', 'src/z.ts', 9]);
  assert.match(renderCheckText(r), /its output was cut/);
  const small = await runBuildCheck(tsProject(GOOD), { outputCap: 20_000 });
  assert.equal(small.outputTruncated, false);
  assert.ok(JSON.stringify(r).length < 5000, 'the result is small whatever the build printed');
});

test('check.build: an injected command replaces npm (a test seam) and its failure to start is classified, not thrown', async () => {
  const r = await runBuildCheck(makeTempDir('construct-verify-cmd-'), { command: { file: process.execPath, args: ['-e', "console.error('src/q.ts(1,1): error TS2304: x'); process.exit(2)"] } });
  assert.deepEqual([r.status, r.errors.length], ['compile-error', 1]);
  const missing = await runBuildCheck(makeTempDir('construct-verify-cmd-'), { command: { file: '/no/such/binary', args: [] } });
  assert.deepEqual([missing.ok, ['failed', 'compile-error'].includes(missing.status)], [true, true]);
});

// ------------------------------------------------------------------------------------------------------ the CLI

test('the CLI: `construct test types` and `construct test build`, text and json, with the exit code of the classification', NEEDS_TS, () => {
  const dir = tsProject(BROKEN, { build: "console.error('src/a.ts(3,5): error TS2304: Cannot find name x.');\nprocess.exit(1);\n" });
  const text = run(['test', 'types'], dir);
  assert.equal(text.status, 1);
  assert.match(text.stdout, /^Type-check: TYPE-ERRORS\. 4 type errors in 2 files/);
  const json = JSON.parse(run(['test', 'types', '--format', 'json', '--feature', 'cart'], dir).stdout);
  assert.deepEqual([json.ok, json.status, json.counts.errors, json.files[0].errors[0].kind], [true, 'type-errors', 1, 'type-mismatch']);
  const ok = run(['test', 'types', '--feature', 'shop'], tsProject(GOOD));
  assert.deepEqual([ok.status, /No type errors/.test(ok.stdout)], [0, true]);
  assert.equal(run(['test', 'types', '--feature', 'nope'], dir).status, 2);
  const build = run(['test', 'build', '--format', 'json'], dir);
  assert.equal(build.status, 1);
  assert.deepEqual([JSON.parse(build.stdout).status, JSON.parse(build.stdout).errors[0].file], ['compile-error', 'src/a.ts']);
  assert.equal(run(['test', 'build'], tsProject(GOOD, { scripts: {} })).status, 2, 'no build script: could not run');
  assert.equal(run(['test', 'build', '--feature', 'shop'], dir).status, 2, 'the build is of the whole project');
  assert.equal(run(['test', 'types', 'stray'], dir).status, 2, 'a stray word is a usage error');
});

// ------------------------------------------------------------------------------------------------------ the flows and the question

test('the flows: registered read-only with an empty scope, mapped to `construct test types|build`, validated', () => {
  assert.deepEqual([PLAN_FLOWS['check.types'].cli, PLAN_FLOWS['check.types'].writes, PLAN_FLOWS['check.types'].executors], [['test', 'types'], false, ['deterministic']]);
  assert.deepEqual([PLAN_FLOWS['check.build'].cli, PLAN_FLOWS['check.build'].writes, PLAN_FLOWS['check.build'].executors], [['test', 'build'], false, ['deterministic']]);
  assert.deepEqual([flowScopeKind('check.types'), flowScopeKind('check.build')], ['empty', 'empty']);
  assert.deepEqual(flowBlock('check.types').declaredScope({}, { root: '/x' }), { features: [], files: [] });
  assert.deepEqual(verifyTouches(), { features: [], files: [] });
  assert.deepEqual(planToCommand({ flow: 'check.types', args: {} }).argv, ['test', 'types']);
  assert.deepEqual(planToCommand({ flow: 'check.types', args: { feature: 'products' } }).argv, ['test', 'types', '--feature', 'products']);
  assert.deepEqual(planToCommand({ flow: 'check.build', args: { dir: 'app' } }).argv, ['test', 'build', '--dir', 'app']);
  const codes = (flow, args) => validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow, args, executor: 'deterministic' }] }).errors.map((e) => `${e.code} ${e.path}`);
  assert.deepEqual([codes('check.types', {}), codes('check.types', { feature: 'products' }), codes('check.build', {})], [[], [], []]);
  assert.deepEqual(codes('check.types', { feature: '../x' }), ['STEP_ARG_TYPE steps[0].args.feature']);
  assert.deepEqual(codes('check.types', { name: 'x' }), ['STEP_ARG_UNKNOWN steps[0].args.name']);
  assert.deepEqual(codes('check.build', { feature: 'x' }), ['STEP_ARG_UNKNOWN steps[0].args.feature']);
  const local = validatePlan({ version: 1, ticket: { source: 'text', title: 't' }, steps: [{ id: 's1', title: 't', flow: 'check.build', args: {}, executor: 'local-model' }] });
  assert.deepEqual(local.errors.map((e) => e.code), ['STEP_EXECUTOR_NOT_ALLOWED'], 'no model runs a build');
});

test('verifyOffer: types | types-build | none, `types` first (the rules-only default), build offered disabled when there is no build script, a disabled answer falls back', () => {
  const dir = tsProject(GOOD);
  const asked = verifyOffer(dir);
  assert.deepEqual([asked.question.id, asked.question.default, asked.question.chosen, asked.question.options.map((o) => [o.id, o.enabled])], ['q-verify', 'types', null, [['types', true], ['types-build', true], ['none', true]]]);
  assert.deepEqual([asked.types, asked.build], [true, false]);
  assert.ok(asked.question.question.length <= 160 && asked.question.options.every((o) => o.label.length <= 60 && o.why.length <= 120), 'the chooser summary limits hold');
  assert.deepEqual([verifyOffer(dir, 'types-build').types, verifyOffer(dir, 'types-build').build], [true, true]);
  assert.deepEqual([verifyOffer(dir, { option: 'none', by: 'person' }).types, verifyOffer(dir, 'none').question.chosen], [false, 'none']);
  const noBuild = tsProject(GOOD, { scripts: {} });
  const off = verifyOffer(noBuild, 'types-build');
  assert.deepEqual([off.question.options[1].enabled, off.question.options[1].why, off.question.chosen, off.build, off.types], [false, 'package.json has no "build" script to run.', null, false, true], 'a disabled option is never used: the default applies');
  assert.deepEqual([verifyOffer(dir, 'nonsense').types, verifyOffer(dir, 'nonsense').question.chosen], [true, null]);
  assert.deepEqual([verifyOffer(makeTempDir('construct-verify-empty-')).question.options[1].enabled], [false], 'no package.json');
});

const shapedPlan = (dir, options = {}) => {
  const placed = placeCard(parseRequirement('A user wants to see a list of products').card, { framework: 'react-spa', answers: { 'q-shape': 'list' } });
  return planFromBlocks(placed.blocks, { feature: 'products', root: dir, decisions: placed.decisions, ...options, answers: { 'q-source': 'endpoint', ...options.answers } });
};

test('a shaped plan gets check.types after sync and the route, before the proof, which stays last; the answer changes it and is recorded', () => {
  const dir = tsProject(GOOD);
  const planned = shapedPlan(dir);
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(validatePlan(planned.plan), { valid: true, errors: [] });
  const flows = planned.plan.steps.map((s) => s.flow);
  assert.deepEqual(flows.slice(-5), ['sync', 'create.route', 'check.types', 'create.proof', 'test.proof']);
  const step = planned.plan.steps.find((s) => s.flow === 'check.types');
  assert.deepEqual([step.args, step.executor, step.touches], [{}, 'deterministic', { features: [], files: [] }]);
  const upTo = planned.plan.steps.filter((s) => s.flow === 'sync' || s.flow === 'create.route').map((s) => s.id);
  assert.ok(upTo.every((id) => step.dependsOn.includes(id)), 'it waits for the wiring');
  assert.deepEqual(planned.verify, { types: step.id, build: null });
  assert.equal(planned.plan.steps.at(-1).flow, 'test.proof', 'the proof stays last');
  assert.deepEqual(planned.offers.at(-1).options.map((o) => o.id), ['types', 'types-build', 'none']);
  assert.deepEqual(planned.decisions.filter((d) => d.question === 'q-verify'), [], 'unanswered: nobody chose');

  const both = shapedPlan(dir, { answers: { 'q-verify': { option: 'types-build', by: 'person' } } });
  assert.deepEqual(both.plan.steps.filter((s) => s.flow.startsWith('check.')).map((s) => [s.flow, s.dependsOn?.length]), [['check.types', 9], ['check.build', 1]]);
  assert.deepEqual(both.plan.steps.find((s) => s.flow === 'check.build').dependsOn, [both.verify.types]);
  assert.deepEqual(both.decisions.at(-1), { question: 'q-verify', option: 'types-build', by: 'person' });
  const choice = choicesFromWiring(both).find((c) => c.chooser.id === 'requirement.plan.verify');
  assert.deepEqual([choice.chosen, choice.by, choice.summary.chosen, choice.summary.options.map((o) => o.id)], ['types-build', 'person', null, ['types', 'types-build', 'none']], 'a decision trace, with the question as it was offered');

  const none = shapedPlan(dir, { answers: { 'q-verify': { option: 'none', by: 'decision-model', provider: 'rules' } } });
  assert.deepEqual([none.plan.steps.some((s) => s.flow.startsWith('check.')), none.verify, none.decisions.at(-1)], [false, { types: null, build: null }, { question: 'q-verify', option: 'none', by: 'decision-model', provider: 'rules' }]);
  assert.equal(shapedPlan(dir, { verify: false }).offers.some((o) => o.id === 'q-verify'), false, 'verify: false leaves the question and the steps out');
  assert.deepEqual([shapedPlan(dir, { wire: false }).verify, shapedPlan(dir, { wire: false }).plan.steps.some((s) => s.flow.startsWith('check.'))], [null, false], 'wire: false leaves the plan as it was before');
  const plain = planFromBlocks(placeCard(parseRequirement('A user wants to see a list of products').card, { framework: 'react-spa' }).blocks, { feature: 'products', root: dir });
  assert.deepEqual([plain.verify, plain.plan.steps.some((s) => s.flow.startsWith('check.'))], [null, false], 'a plan with no shaped screen has nothing to verify');
  assert.deepEqual(JSON.stringify(shapedPlan(dir).plan), JSON.stringify(shapedPlan(dir).plan), 'deterministic');
});

test('the rules-only provider suggests `types` for q-verify, and a build script that is missing is never suggested', async () => {
  const q = shapedPlan(tsProject(GOOD)).offers.find((o) => o.id === 'q-verify');
  assert.equal((await suggest({ id: q.id, question: q.question, options: q.options })).option, 'types');
  const noBuild = shapedPlan(tsProject(GOOD, { scripts: {} })).offers.find((o) => o.id === 'q-verify');
  assert.equal((await suggest({ id: noBuild.id, question: noBuild.question, options: noBuild.options })).option, 'types');
});
