// #583 (part of #574) -- `construct generate tests --unit <feature>`: one locked every-path unit test per
// machine, walked with @xstate/graph under node's test runner. The static model, the rendered file,
// the lock, the CLI, and the generated test RUNNING for real (passing on the machine it was generated
// from, failing when that machine is broken).
//
// The generated file is TypeScript that imports a .tsx machine; a target project runs it through
// `tsx --test`. This repo has no tsx, so the harness below transpiles both files with the
// TypeScript compiler (a root dependency) into .mjs and runs `node --test` on the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateUnitTests, planUnitTests, pathModel, unsupportedReason, missingUnitTestDependencies, UNIT_TEST_DEPENDENCIES } from '../packages/engine/testUnitGenerator.mjs';
import { GENERATED_MARKER } from '../packages/engine/testGenerator.mjs';
import { extractMachines } from '../packages/engine/workflowExtractor.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const BIN = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];

function project({ features = {}, lock = true, pkg } = {}) {
  const dir = makeTempDir('construct-unitgen-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + (lock ? LOCK_YML : ''));
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [name, { workflows = {} }] of Object.entries(features)) {
    for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', name, l), { recursive: true });
    fs.writeFileSync(path.join(dir, 'features', name, 'types.ts'), 'export type Id = string;\n');
    fs.writeFileSync(path.join(dir, 'features', name, 'index.ts'), "export type * from './types';\n");
    for (const [f, src] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, 'features', name, 'workflows', f), src);
  }
  return dir;
}

/** A machine with everything the model has to settle: guards, a targetless action, invoke, after, always, a nested final + onDone. */
const CHECKOUT = `import { setup, fromPromise } from 'xstate';

export const CheckoutWorkflow = setup({
  types: {} as {
    context: { amount: number };
    events: { type: 'START' } | { type: 'SUBMIT' } | { type: 'SAVE' } | { type: 'NEXT' } | { type: 'OK' } | { type: 'RETRY' } | { type: 'TOUCH' };
  },
  actions: { noop: () => {} },
  guards: { isBig: ({ context }) => context.amount > 100 },
  actors: { load: fromPromise(async () => 1) },
}).createMachine({
  id: 'checkout',
  initial: 'idle',
  context: { amount: 0 },
  states: {
    idle: { on: { START: 'loading', TOUCH: { actions: 'noop' } } },
    loading: { invoke: { src: 'load', onDone: 'review', onError: 'failed' }, after: { 5000: 'failed' } },
    review: { on: { SUBMIT: [{ target: 'audit', guard: 'isBig' }, { target: 'checking' }], SAVE: 'review' } },
    checking: { always: [{ target: 'audit', guard: 'isBig' }, { target: 'wrap' }] },
    wrap: { initial: 'a', states: { a: { on: { NEXT: 'b' } }, b: { type: 'final' } }, onDone: 'done' },
    audit: { on: { OK: 'done' } },
    failed: { on: { RETRY: 'loading' } },
    done: { type: 'final' },
  },
});
`;
const SIMPLE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done', CANCEL: 'idle' } },
    done: { type: 'final' },
  },
});
`;
const machineOf = (src) => extractMachines(src).machines[0];

/** Transpile the generated test and the feature's workflow files to .mjs and run `node --test` on it. */
function runGenerated(dir, feature, name) {
  const out = makeTempDir('construct-unitrun-');
  fs.mkdirSync(path.join(out, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(out, 'tests', 'generated'), { recursive: true });
  const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const wfDir = path.join(dir, 'features', feature, 'workflows');
  for (const f of fs.readdirSync(wfDir)) {
    const js = ts.transpileModule(fs.readFileSync(path.join(wfDir, f), 'utf8'), { ...opts, fileName: f }).outputText;
    fs.writeFileSync(path.join(out, 'workflows', f.replace(/\.tsx?$/, '.mjs')), js);
  }
  const src = fs.readFileSync(path.join(dir, 'features', feature, 'tests', 'generated', name), 'utf8');
  const js = ts.transpileModule(src, { ...opts, fileName: name }).outputText.replace(/from "\.\.\/\.\.\/workflows\/([^"]+)"/, 'from "../../workflows/$1.mjs"');
  const file = path.join(out, 'tests', 'generated', name.replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(file, js);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(out, 'node_modules'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // otherwise node's runner sees a nested `--test` and skips the file
  const r = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout + r.stderr };
}

// ---- static model ---------------------------------------------------------------------------------

test('pathModel: user-event table with settled landings, guarded groups as choices, fixture-free reachability', () => {
  const m = pathModel(machineOf(CHECKOUT));
  assert.deepEqual(m.initial, ['idle']);
  assert.deepEqual(m.states, ['idle', 'loading', 'review', 'checking', 'wrap.a', 'wrap.b', 'audit', 'failed', 'done']);
  // idle -> loading by START; loading -> review/failed by invoke + after (unguarded, so guaranteed); audit/wrap only behind a guard
  assert.deepEqual(m.reachable, ['idle', 'loading', 'failed', 'review']);
  const row = (from, event) => m.transitions.find((t) => t.from === from && t.event === event);
  assert.deepEqual(row('idle', 'START').to, ['loading']);
  assert.deepEqual(row('idle', 'TOUCH').to, ['idle'], 'a targetless transition with actions is a self-loop');
  assert.deepEqual(row('review', 'SUBMIT').to, ['audit', 'wrap.a'], 'guarded branch, then the fallback settles through the always state into the nested initial child');
  assert.deepEqual(row('review', 'SAVE').to, ['review']);
  assert.deepEqual(row('wrap.a', 'NEXT').to, ['done'], 'a final child settles through the parent onDone');
  assert.deepEqual(row('audit', 'OK').to, ['done']);
  assert.deepEqual(row('failed', 'RETRY').to, ['loading']);
  assert.equal(m.transitions.length, 7);
});

test('pathModel: a child handler shadows the parent handler for the same event; all-guarded group may stay put', () => {
  const src = `import { setup } from 'xstate';
export const M = setup({}).createMachine({
  id: 'm', initial: 'outer',
  states: {
    outer: { initial: 'a', on: { GO: 'end', MAYBE: { target: 'end', guard: 'ok' } }, states: { a: { on: { GO: 'b' } }, b: {} } },
    end: { type: 'final' },
  },
});
`;
  const m = pathModel(machineOf(src));
  const row = (from, event) => m.transitions.find((t) => t.from === from && t.event === event);
  assert.deepEqual(row('outer.a', 'GO').to, ['outer.b']);
  assert.deepEqual(row('outer.b', 'GO').to, ['end']);
  assert.deepEqual(row('outer.a', 'MAYBE').to, ['end', 'outer.a']);
  assert.deepEqual(m.reachable, ['outer.a', 'outer.b', 'end']);
});

test('unsupportedReason: unexported, default-exported, parallel and history machines are named, a plain one is fine', () => {
  assert.equal(unsupportedReason(machineOf(SIMPLE), SIMPLE), null);
  const unexported = SIMPLE.replace('export const Simple', 'const Simple');
  assert.match(unsupportedReason(machineOf(unexported), unexported), /export the machine \(export const Simple\)/);
  const reexported = `${unexported}export { Simple };\n`;
  assert.equal(unsupportedReason(machineOf(reexported), reexported), null);
  const anonymous = SIMPLE.replace('export const Simple = ', 'export default ');
  assert.match(unsupportedReason(machineOf(anonymous), anonymous), /exported const/);
  const parallel = SIMPLE.replace("done: { type: 'final' }", "done: { type: 'parallel', states: { x: {}, y: {} } }");
  assert.match(unsupportedReason(machineOf(parallel), parallel), /parallel state "done"/);
});

// ---- rendering and writing -------------------------------------------------------------------------

test('planUnitTests: one locked file per machine, byte-identical across runs, skips with reasons', () => {
  const dir = project({ features: { checkout: { workflows: { 'CheckoutWorkflow.tsx': CHECKOUT, 'Draft.ts': SIMPLE.replace('export const Simple', 'const Simple') } } } });
  const plan = planUnitTests(dir, 'checkout');
  assert.deepEqual(plan.files.map((f) => f.name), ['checkout--every-path.test.ts']);
  assert.equal(plan.files[0].relPath, 'features/checkout/tests/generated/checkout--every-path.test.ts');
  assert.deepEqual(plan.skipped.map((s) => [s.file, s.machine]), [['workflows/Draft.ts', 'simple']]);
  const text = plan.files[0].content;
  assert.ok(text.startsWith(`${GENERATED_MARKER}\n`));
  assert.match(text, /^\/\/ machine-hash: sha256:[0-9a-f]{64}$/m);
  assert.match(text, /^\/\/ run: npx tsx --test features\/checkout\/tests\/generated\/checkout--every-path\.test\.ts$/m);
  assert.match(text, /import \{ CheckoutWorkflow \} from "\.\.\/\.\.\/workflows\/CheckoutWorkflow";/);
  assert.match(text, /from '@xstate\/graph'/);
  assert.match(text, /from 'node:test'/);
  assert.match(text, /\{ from: "review", event: "SUBMIT", to: \["audit", "wrap\.a"\] \}/);
  assert.equal(planUnitTests(dir, 'checkout').files[0].content, text, 'deterministic');
});

test('generateUnitTests: writes, reports unchanged, refuses without the lock, never overwrites a foreign file, prunes only orphans it made', () => {
  const dir = project({ features: { jobs: { workflows: { 'Jobs.tsx': SIMPLE } } } });
  const r1 = generateUnitTests(dir, 'jobs');
  assert.deepEqual(r1.written, ['features/jobs/tests/generated/simple--every-path.test.ts']);
  assert.deepEqual(r1.unchanged, []);
  const r2 = generateUnitTests(dir, 'jobs');
  assert.deepEqual(r2.written, []);
  assert.deepEqual(r2.unchanged, ['features/jobs/tests/generated/simple--every-path.test.ts']);
  // dry run writes nothing
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Jobs.tsx'), SIMPLE.replace("id: 'simple'", "id: 'other'"));
  const dry = generateUnitTests(dir, 'jobs', { dryRun: true });
  assert.deepEqual(dry.written, ['features/jobs/tests/generated/other--every-path.test.ts']);
  assert.deepEqual(dry.orphans, ['features/jobs/tests/generated/simple--every-path.test.ts']);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'jobs', 'tests', 'generated', 'other--every-path.test.ts')), false);
  // prune removes the orphan (marker-bearing) but not a foreign file
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'tests', 'generated', 'mine--every-path.test.ts'), '// hand-written\n');
  const pruned = generateUnitTests(dir, 'jobs', { prune: true });
  assert.deepEqual(pruned.pruned, ['features/jobs/tests/generated/simple--every-path.test.ts']);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'jobs', 'tests', 'generated', 'mine--every-path.test.ts')), true);
  // a foreign file at a target path is refused before anything is written
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'tests', 'generated', 'other--every-path.test.ts'), '// hand-written\n');
  assert.throws(() => generateUnitTests(dir, 'jobs'), (e) => e instanceof ConstructError && /not a generated file/.test(e.message));
  // no lock declared: refused with the yaml to add
  const unlocked = project({ features: { jobs: { workflows: { 'Jobs.tsx': SIMPLE } } }, lock: false });
  assert.throws(() => generateUnitTests(unlocked, 'jobs'), (e) => e instanceof ConstructError && /frozen:/.test(e.message));
  assert.equal(fs.existsSync(path.join(unlocked, 'features', 'jobs', 'tests', 'generated')), false);
});

test('missingUnitTestDependencies: reads the target package.json', () => {
  assert.deepEqual(missingUnitTestDependencies(project()), UNIT_TEST_DEPENDENCIES);
  assert.deepEqual(missingUnitTestDependencies(project({ pkg: { dependencies: { xstate: '^5' }, devDependencies: { '@xstate/graph': '^3' } } })), ['tsx']);
  assert.deepEqual(missingUnitTestDependencies(project({ pkg: { devDependencies: { xstate: '^5', '@xstate/graph': '^3', tsx: '^4' } } })), []);
});

test('CLI: generate tests --unit <feature> (flag before or after the feature), install hint, usage error', () => {
  const dir = project({ features: { jobs: { workflows: { 'Jobs.tsx': SIMPLE } } } });
  const run = (...a) => spawnSync(process.execPath, [BIN, 'generate', 'tests', ...a, '--dir', dir], { encoding: 'utf8' });
  const a = run('--unit', 'jobs');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /Wrote features\/jobs\/tests\/generated\/simple--every-path\.test\.ts/);
  assert.match(a.stdout, /1 every-path test\(s\) for feature "jobs" \(1 written, 0 unchanged; 3 transition\(s\) checked\)/);
  assert.match(a.stdout, /npm install -D @xstate\/graph xstate tsx/);
  assert.match(a.stdout, /Run: npx tsx --test features\/jobs\/tests\/generated\/simple--every-path\.test\.ts/);
  const b = run('jobs', '--unit', '--dry-run');
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /Unchanged features\/jobs\/tests\/generated\/simple--every-path\.test\.ts/);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { xstate: '^5', '@xstate/graph': '^3', tsx: '^4' } }));
  assert.doesNotMatch(run('--unit', 'jobs').stdout, /npm install/);
  const bad = spawnSync(process.execPath, [BIN, 'generate', 'tests', '--unit', '--dir', dir], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Usage: construct generate tests \[--unit\] <feature>/);
});

// ---- the generated test, run for real -------------------------------------------------------------

test('generated every-path test passes on the machine it came from and fails when that machine is broken', () => {
  const dir = project({ features: { checkout: { workflows: { 'CheckoutWorkflow.tsx': CHECKOUT } } } });
  const name = 'checkout--every-path.test.ts';
  generateUnitTests(dir, 'checkout');
  const machineFile = path.join(dir, 'features', 'checkout', 'workflows', 'CheckoutWorkflow.tsx');

  const ok = runGenerated(dir, 'checkout', name);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /^# pass 2$/m);
  assert.match(ok.out, /^# fail 0$/m);

  // a transition removed: RETRY is gone from `failed`
  fs.writeFileSync(machineFile, CHECKOUT.replace("failed: { on: { RETRY: 'loading' } }", 'failed: {}'));
  const removed = runGenerated(dir, 'checkout', name);
  assert.notEqual(removed.status, 0);
  assert.match(removed.out, /failed --RETRY--> is gone \(it landed on loading\)/);

  // a transition retargeted: OK now goes back to idle instead of done
  fs.writeFileSync(machineFile, CHECKOUT.replace("audit: { on: { OK: 'done' } }", "audit: { on: { OK: 'idle' } }").replace("context: { amount: 0 }", 'context: { amount: 500 }'));
  const retargeted = runGenerated(dir, 'checkout', name);
  assert.notEqual(retargeted.status, 0);
  assert.match(retargeted.out, /audit --OK--> lands on idle, expected done/);

  // a state made unreachable: START now goes straight to done, so loading/review/failed are never reached
  fs.writeFileSync(machineFile, CHECKOUT.replace("idle: { on: { START: 'loading'", "idle: { on: { START: 'done'"));
  const unreachable = runGenerated(dir, 'checkout', name);
  assert.notEqual(unreachable.status, 0);
  assert.match(unreachable.out, /the flow can no longer reach loading/);
});
