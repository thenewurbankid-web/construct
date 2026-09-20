// #348 -- locked per-scenario Playwright specs: naming, attributes, goldens, determinism, the frozen
// lock, path safety and injection. (The generated spec RUNNING under Playwright is in
// testGeneratorPlaywright.test.mjs, opt-in.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests, planFeatureTests, GENERATED_MARKER, lit, comment } from '../src/engine/testGenerator.mjs';
import { kebab, slotTestId, assignTestIds } from '../src/engine/testAttributes.mjs';
import { normalizeNonLayer, isNonLayerPath } from '../src/nonLayer.mjs';
import { write } from '../src/fs.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../src/soc-enforcer.mjs';
import { summarizeUnit } from '../src/engine/unitSummary.mjs';
import { parseToAst } from '../src/parser.mjs';
import { ConstructError } from '../src/diagnostics.mjs';
import { transformPristineSource } from '../src/engine/pageTransformer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const BIN = path.join(REPO, 'bin', 'construct.mjs');
const GOLDEN = path.join(here, 'golden', 'testgen');
const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];

function golden(name, actual) {
  const file = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, actual); }
  assert.equal(actual, fs.readFileSync(file, 'utf8'), `golden mismatch: ${name} (UPDATE_GOLDEN=1 to regenerate after an intentional change)`);
}

/** A project with the lock declared. features: { name: { workflows: { 'X.ts': src } } }; routes: { '/path': 'feature' }. */
function project({ features = {}, lock = true, routes = {} } = {}) {
  const dir = makeTempDir('construct-testgen-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + (lock ? LOCK_YML : ''));
  for (const [name, { workflows = {} }] of Object.entries(features)) {
    for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', name, l), { recursive: true });
    fs.writeFileSync(path.join(dir, 'features', name, 'types.ts'), 'export type Id = string;\n');
    fs.writeFileSync(path.join(dir, 'features', name, 'index.ts'), "export type * from './types';\n");
    for (const [f, src] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, 'features', name, 'workflows', f), src);
  }
  for (const [route, feature] of Object.entries(routes)) {
    const cdir = path.join(dir, 'features', feature, 'controllers');
    fs.writeFileSync(path.join(cdir, 'MainController.tsx'), 'export function MainController() {\n  return <div />;\n}\n');
    const pdir = path.join(dir, 'app', ...route.split('/').filter(Boolean));
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'page.tsx'), `import { MainController } from '../../features/${feature}/controllers/MainController';\n\nexport default function Page() {\n  return <MainController />;\n}\n`);
  }
  return dir;
}

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
const machineSrc = (exportName, id) => SIMPLE.replace('Simple', exportName).replace("id: 'simple'", `id: '${id}'`);
const TWO = `import { setup } from 'xstate';
export const Cart = setup({}).createMachine({
  id: 'cart',
  initial: 'open',
  states: { open: { on: { SUBMIT: 'sent' } }, sent: { type: 'final' } },
});
export const Review = setup({}).createMachine({
  id: 'review',
  initial: 'drafting',
  states: { drafting: { on: { SUBMIT: 'reviewing', SAVE: 'drafting' } }, reviewing: { on: { APPROVE: 'approved' } }, approved: { type: 'final' } },
});
`;

// ---- the convention ---------------------------------------------------------------------------

test('data-testid derivation: kebab-case from the event name', () => {
  assert.equal(kebab('SUBMIT'), 'submit');
  assert.equal(kebab('PAYMENT_FAILED'), 'payment-failed');
  assert.equal(kebab('paymentFailed'), 'payment-failed');
  assert.equal(kebab('REQUEST_REFUND'), 'request-refund');
  assert.equal(kebab('HTTPRequest'), 'http-request');
  assert.equal(kebab('  a..b  '), 'a-b');
  assert.equal(slotTestId('onRequestRefund'), 'request-refund');
  assert.equal(slotTestId('onSubmit'), 'submit');
  assert.equal(slotTestId('value'), null);
});

test('two machines sharing an event name are scoped on both; unique events stay unscoped', () => {
  const { keys, testIds } = assignTestIds([
    { id: 'cart', transitions: [{ kind: 'on', event: 'SUBMIT' }, { kind: 'on', event: 'PAY' }] },
    { id: 'review', transitions: [{ kind: 'on', event: 'SUBMIT' }] },
  ]);
  assert.deepEqual(keys, ['cart', 'review']);
  assert.equal(testIds[0].get('SUBMIT'), 'cart-submit');
  assert.equal(testIds[1].get('SUBMIT'), 'review-submit');
  assert.equal(testIds[0].get('PAY'), 'pay');
  // the same id in two machines gets a unique key
  assert.deepEqual(assignTestIds([{ id: 'm', transitions: [] }, { id: 'm', transitions: [] }]).keys, ['m', 'm-2']);
});

// ---- non-layer paths (the enforcers skip them; nothing else is exempted) ----------------------

test('nonLayer: shape validation', () => {
  assert.deepEqual(normalizeNonLayer(undefined), []);
  assert.deepEqual(normalizeNonLayer(['features/*/tests/**']), ['features/*/tests/**']);
  assert.throws(() => normalizeNonLayer('features/x'), ConstructError);
  assert.throws(() => normalizeNonLayer(['/abs/**']), /absolute/);
  assert.throws(() => normalizeNonLayer(['../x/**']), /\.\./);
  assert.throws(() => normalizeNonLayer(['']), ConstructError);
  assert.equal(isNonLayerPath('/p', 'features/a/tests/x.spec.ts', ['features/*/tests/**']), true);
  assert.equal(isNonLayerPath('/p', 'features/a/domain/x.ts', ['features/*/tests/**']), false);
});

test('a declared tests/ folder is skipped by the enforcers; an undeclared one is still flagged (no exemption for anyone else)', () => {
  const body = "import { Thing } from '../../other/domain/Thing';\nimport { useX } from '../hooks/useX';\nexport const t = 1;\nexport const u = 2;\nexport const v = 3;\n";
  for (const [lock, expectFlag] of [[true, false], [false, true]]) {
    const dir = project({ features: { a: {}, other: {} }, lock });
    fs.mkdirSync(path.join(dir, 'features', 'a', 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'features', 'a', 'tests', 'flow.spec.ts'), body);
    const all = [...validateArchitecture(dir).violations, ...validateSeparationOfConcerns(dir).violations].filter((v) => v.file.includes('/tests/'));
    assert.equal(all.length > 0, expectFlag, JSON.stringify(all.map((v) => `${v.rule} ${v.file}`)));
  }
  // and the real code beside it is still checked
  const dir = project({ features: { a: {} } });
  fs.mkdirSync(path.join(dir, 'features', 'a', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'a', 'domain', 'Bad.ts'), "import React from 'react';\nexport function bad() { return fetch('/x'); }\n");
  assert.ok(validateArchitecture(dir).violations.some((v) => v.file.endsWith('domain/Bad.ts')));
});

// ---- goldens ----------------------------------------------------------------------------------

test('golden: example/ login feature (real route /login, guarded steps become fixme)', () => {
  const dir = makeTempDir('construct-testgen-example-');
  fs.cpSync(path.join(REPO, 'example'), dir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  fs.appendFileSync(path.join(dir, 'architecture.yml'), `\n${LOCK_YML}`);
  const r = generateFeatureTests(dir, 'login');
  assert.deepEqual(r.written.map((f) => path.basename(f)), [
    'login--ends-success-via-submit-otherwise-then-submit-if-is-valid.spec.ts',
    'login--happy-path.spec.ts',
  ]);
  for (const f of r.written) golden(`example-login/${path.basename(f)}`, fs.readFileSync(path.join(dir, f), 'utf8'));
  assert.equal(r.route, '/login');
});

test('golden: refund request, nine scenarios with distinct stable names, no route -> TODO', () => {
  const dir = project({ features: { refunds: { workflows: { 'RefundRequest.ts': fs.readFileSync(path.join(REPO, 'fixtures', 'workflow-graphs', 'refund-request.ts'), 'utf8') } } } });
  const r = generateFeatureTests(dir, 'refunds');
  const names = r.written.map((f) => path.basename(f));
  assert.equal(names.length, 9);
  assert.equal(new Set(names).size, 9);
  assert.ok(names.every((n) => !/path-\d|--path/.test(n)), 'no positional "Path N" names (#307)');
  assert.ok(names.includes('refund-request--happy-path.spec.ts'));
  for (const f of r.written) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /TODO\(construct\): no route reaches this feature/);
    assert.match(text, /const START_URL: string \| null = null;/);
  }
  golden('refund/refund-request--happy-path.spec.ts', fs.readFileSync(path.join(dir, r.written.find((f) => f.includes('happy'))), 'utf8'));
  golden('refund/names.txt', `${names.join('\n')}\n`);
});

test('golden: two machines sharing SUBMIT in one feature are scoped on both', () => {
  const dir = project({ features: { shop: { workflows: { 'Flows.ts': TWO } } }, routes: { '/shop': 'shop' } });
  const r = generateFeatureTests(dir, 'shop');
  const by = Object.fromEntries(r.written.map((f) => [path.basename(f), fs.readFileSync(path.join(dir, f), 'utf8')]));
  const cart = by['cart--happy-path.spec.ts'];
  assert.match(cart, /trigger\(page, "cart-submit", "SUBMIT"\)/);
  const reviewHappy = by['review--happy-path.spec.ts'];
  assert.match(reviewHappy, /trigger\(page, "review-submit", "SUBMIT"\)/);
  assert.match(reviewHappy, /trigger\(page, "approve", "APPROVE"\)/, 'APPROVE is unique so stays unscoped');
  golden('shop/cart--happy-path.spec.ts', cart);
  golden('shop/review--happy-path.spec.ts', by['review--happy-path.spec.ts']);
});

test('a runnable scenario (no guards) has no fixme and asserts state per beat', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } }, routes: { '/jobs': 'jobs' } });
  const r = generateFeatureTests(dir, 'jobs');
  const happy = fs.readFileSync(path.join(dir, r.written.find((f) => f.includes('happy'))), 'utf8');
  assert.doesNotMatch(happy, /test\.fixme/);
  assert.match(happy, /START_URL: string \| null = "\/jobs"/);
  assert.match(happy, /trigger\(page, "start-job", "START_JOB"\)[\s\S]*expectFlowState\(page, MACHINE, "working"\)[\s\S]*trigger\(page, "finish-job", "finishJob"\)[\s\S]*expectFlowState\(page, MACHINE, "done"\)/);
  assert.equal(happy.startsWith(`${GENERATED_MARKER}\n`), true);
});

// ---- determinism ------------------------------------------------------------------------------

test('byte-identical output for the same source, and no timestamp', () => {
  const mk = () => project({ features: { refunds: { workflows: { 'R.ts': fs.readFileSync(path.join(REPO, 'fixtures', 'workflow-graphs', 'refund-request.ts'), 'utf8') } } } });
  const a = mk(); const b = mk();
  const ra = generateFeatureTests(a, 'refunds'); const rb = generateFeatureTests(b, 'refunds');
  assert.deepEqual(ra.written, rb.written);
  for (const f of ra.written) {
    const ta = fs.readFileSync(path.join(a, f), 'utf8');
    assert.equal(ta, fs.readFileSync(path.join(b, f), 'utf8'));
    assert.doesNotMatch(ta, /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
    assert.doesNotMatch(ta, /Date\.now|new Date/);
  }
  // a second run over the same tree changes nothing
  const again = generateFeatureTests(a, 'refunds');
  assert.equal(again.written.length, 0);
  assert.equal(again.unchanged.length, 9);
});

test('lineage: every file records the machine hash and the scenario hash', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  const { files } = planFeatureTests(dir, 'jobs');
  for (const f of files) {
    assert.match(f.content, /^\/\/ machine-hash: sha256:[0-9a-f]{64}$/m);
    assert.match(f.content, /^\/\/ scenario-hash: sha256:[0-9a-f]{64}$/m);
  }
  const edited = SIMPLE.replace("CANCEL: 'idle'", "CANCEL: 'done'");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), edited);
  const after = planFeatureTests(dir, 'jobs').files;
  assert.notEqual(after[0].content.match(/machine-hash: (\S+)/)[1], files[0].content.match(/machine-hash: (\S+)/)[1]);
});

// ---- the lock ---------------------------------------------------------------------------------

test('frozen lock: any write into tests/generated/ other than the generator is refused', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  generateFeatureTests(dir, 'jobs'); // the generator itself may write there
  const target = path.join(dir, 'features', 'jobs', 'tests', 'generated', 'jobs--hand-edit.spec.ts');
  assert.throws(() => write(target, 'x'), /frozen glob/);
  const existing = path.join(dir, 'features', 'jobs', 'tests', 'generated', 'simple--happy-path.spec.ts');
  const before = fs.readFileSync(existing, 'utf8');
  assert.throws(() => write(existing, 'tampered'), /Refusing to write to/);
  assert.equal(fs.readFileSync(existing, 'utf8'), before);
  // one level up (clones and authored tests) is NOT locked
  assert.doesNotThrow(() => write(path.join(dir, 'features', 'jobs', 'tests', 'my-clone.spec.ts'), '// mine\n'));
});

test('the generator refuses to run when the lock is not declared, and prints the YAML to add', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } }, lock: false });
  assert.throws(() => generateFeatureTests(dir, 'jobs'), (e) => e instanceof ConstructError && /frozen:\n  - features\/\*\/tests\/generated\/\*\*\nnonLayer:/.test(e.message));
  assert.equal(fs.existsSync(path.join(dir, 'features', 'jobs', 'tests')), false, 'nothing written');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), `${BASE_YML}frozen:\n  - features/*/tests/generated/**\n`);
  assert.throws(() => generateFeatureTests(dir, 'jobs'), /missing: nonLayer/);
});

// ---- path safety ------------------------------------------------------------------------------

test('feature names that are paths are refused before anything is read or written', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  for (const bad of ['..', '../jobs', 'jobs/../jobs', '/etc', 'a/b', '.hidden', '', 'jobs\n', 'jo"bs']) {
    assert.throws(() => generateFeatureTests(dir, bad), ConstructError, JSON.stringify(bad));
  }
});

test('refuses to overwrite a file that is not a generated file; clones one level up are never touched', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  const gen = path.join(dir, 'features', 'jobs', 'tests', 'generated');
  fs.mkdirSync(gen, { recursive: true });
  const authored = path.join(gen, 'simple--happy-path.spec.ts');
  fs.writeFileSync(authored, "// my own test\ntest('x', () => {});\n");
  assert.throws(() => generateFeatureTests(dir, 'jobs'), /not a generated file/);
  assert.equal(fs.readFileSync(authored, 'utf8'), "// my own test\ntest('x', () => {});\n");
  assert.equal(fs.readdirSync(gen).length, 1, 'all-or-nothing: nothing else written');
  fs.rmSync(authored);
  generateFeatureTests(dir, 'jobs');
  const clone = path.join(dir, 'features', 'jobs', 'tests', 'simple--happy-path.spec.ts');
  fs.writeFileSync(clone, '// QA clone\n');
  generateFeatureTests(dir, 'jobs', { prune: true });
  assert.equal(fs.readFileSync(clone, 'utf8'), '// QA clone\n');
});

test('refuses a symlinked tests/ or generated/ directory (no symlink escape)', () => {
  const outside = makeTempDir('construct-testgen-outside-');
  for (const link of ['tests', 'generated']) {
    const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
    const t = path.join(dir, 'features', 'jobs', 'tests');
    if (link === 'tests') fs.symlinkSync(outside, t);
    else { fs.mkdirSync(t); fs.symlinkSync(outside, path.join(t, 'generated')); }
    assert.throws(() => generateFeatureTests(dir, 'jobs'), /symlink/);
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written outside the project');
  }
  // a symlinked target FILE is refused too
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  const gen = path.join(dir, 'features', 'jobs', 'tests', 'generated');
  fs.mkdirSync(gen, { recursive: true });
  fs.symlinkSync(path.join(outside, 'victim'), path.join(gen, 'simple--happy-path.spec.ts'));
  assert.throws(() => generateFeatureTests(dir, 'jobs'), /not a regular file/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('--prune removes only generated orphans; without it they are reported', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  generateFeatureTests(dir, 'jobs');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), SIMPLE.replace("finishJob: 'done', ", ''));
  const r = generateFeatureTests(dir, 'jobs');
  assert.ok(r.orphans.length >= 1);
  const gen = path.join(dir, 'features', 'jobs', 'tests', 'generated');
  fs.writeFileSync(path.join(gen, 'zzz--hand-made.spec.ts'), '// hand made\n');
  const p = generateFeatureTests(dir, 'jobs', { prune: true });
  assert.deepEqual(p.pruned.sort(), r.orphans.sort());
  assert.ok(fs.existsSync(path.join(gen, 'zzz--hand-made.spec.ts')), 'a non-generated file is never pruned');
});

// ---- injection --------------------------------------------------------------------------------

test('hostile machine, state and event names cannot inject code or escape the directory', () => {
  const evil = `import { setup } from 'xstate';
export const Evil = setup({}).createMachine({
  id: '../../pwn"); process.exit(1); //\\u2028 */ \`\${1}\`',
  initial: 'a"b',
  states: {
    'a"b': { on: { 'EV"ENT\\n});throw 1;//': 'c' } },
    c: { on: { "x'; y": 'd\\u2028e' } },
    'd\\u2028e': { type: 'final' },
  },
});
`;
  const dir = project({ features: { evil: { workflows: { 'Evil.ts': evil } } } });
  const r = generateFeatureTests(dir, 'evil');
  assert.ok(r.written.length >= 1);
  const gen = path.join(dir, 'features', 'evil', 'tests', 'generated');
  for (const f of fs.readdirSync(gen)) {
    assert.match(f, /^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*\.spec\.ts$/, 'file name is a safe slug');
    const text = fs.readFileSync(path.join(gen, f), 'utf8');
    const ast = parseToAst(text); // must parse as TypeScript
    // exactly the statements the template emits: 1 import, 2 consts, harness, 3 helpers, 1 test
    assert.deepEqual(ast.body.map((n) => n.type), ['ImportDeclaration', 'VariableDeclaration', 'VariableDeclaration', 'VariableDeclaration', 'FunctionDeclaration', 'FunctionDeclaration', 'FunctionDeclaration', 'ExpressionStatement']);
    assert.ok(!text.split('\n').some((l) => /^\s*(process\.exit|throw 1)/.test(l)), 'nothing hostile reached statement position');
    assert.doesNotMatch(text, /[\u2028\u2029]/);
  }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'features', 'evil')).sort(), [...LAYERS, 'index.ts', 'tests', 'types.ts'].sort());
});

test('escaping helpers', () => {
  assert.equal(lit('a"b\n\u2028'), '"a\\"b\\n\\u2028"');
  assert.doesNotMatch(comment('x\ny\u2028z\u0085'), /[\n\u2028\u0085]/);
});

// ---- summarizeUnit still sees the tests -------------------------------------------------------

test('summarizeUnit counts a feature\'s generated tests even though tests/ is outside the layer graph', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } } });
  const r = generateFeatureTests(dir, 'jobs');
  const s = summarizeUnit(dir, 'feature:jobs', { kind: 'feature', detail: 'standard' });
  assert.equal(s.sections.tests.count, r.written.length);
  assert.ok(s.sections.tests.files.every((f) => f.includes('/tests/generated/')));
  assert.ok(!s.health.findings.some((f) => f.code === 'no-tests'));
});

// ---- CLI ----------------------------------------------------------------------------------------

test('CLI: construct generate tests <feature> (and --dry-run, and a usage error)', () => {
  const dir = project({ features: { jobs: { workflows: { 'Simple.ts': SIMPLE } } }, routes: { '/jobs': 'jobs' } });
  const run = (...a) => spawnSync(process.execPath, [BIN, 'generate', 'tests', ...a, '--dir', dir], { encoding: 'utf8' });
  const dry = run('jobs', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run, nothing written/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'jobs', 'tests')), false);
  const real = run('jobs');
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Wrote features\/jobs\/tests\/generated\/simple--happy-path\.spec\.ts/);
  assert.match(real.stdout, /start URL \/jobs/);
  const bad = spawnSync(process.execPath, [BIN, 'generate', 'tests', '--dir', dir], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Usage: construct generate tests/);
});

// ---- generator emission -----------------------------------------------------------------------

test('page ingestion emits data-testid on the first element per on<Event> slot, never duplicating or overwriting', () => {
  const src = `export function X() {\n  return (\n    <main>\n      <button onClick={() => {}}>a</button>\n      <button onClick={() => {}}>b</button>\n      <button data-testid="mine" onSubmit={() => {}}>c</button>\n      <input onChange={() => {}} />\n    </main>\n  );\n}\n`;
  const { pageSource, testIds } = transformPristineSource(src, { feature: 'f', name: 'X' });
  assert.deepEqual(testIds, ['click', 'change']);
  assert.equal((pageSource.match(/data-testid="click"/g) || []).length, 1);
  assert.match(pageSource, /data-testid="mine"/);
  assert.doesNotThrow(() => parseToAst(pageSource));
});

test('page ingestion in a feature with a workflow: scoped testid and data-flow-state from a flowState prop', () => {
  const src = `export function X() {\n  return (\n    <main>\n      <button onSubmit={() => {}}>a</button>\n    </main>\n  );\n}\n`;
  const flow = { machineKey: 'review', eventIds: new Map([['submit', 'review-submit']]) };
  const { pageSource, propsSource, slots } = transformPristineSource(src, { feature: 'f', name: 'X', flow });
  assert.match(pageSource, /<main data-flow="review" data-flow-state=\{flowState\}>/);
  assert.match(pageSource, /data-testid="review-submit"/);
  assert.match(propsSource, /flowState\?: string;/);
  assert.ok(slots.some((s) => s.name === 'flowState'));
  assert.doesNotThrow(() => parseToAst(pageSource));
});

test('ingestPage in a feature with workflows emits the scoped testid + flowState; the controller forwards a matching hook member and leaves an unmatched optional slot unwired', async () => {
  const { ingestPage } = await import('../src/engine/pageTransformer.mjs');
  const { generateController } = await import('../src/engine/controllerBinder.mjs');
  const dir = project({ features: { shop: { workflows: { 'Flows.ts': TWO } } } });
  const from = path.join(dir, 'Export.tsx');
  fs.writeFileSync(from, 'export function E() {\n  return (\n    <main>\n      <button onSubmit={() => {}}>go</button>\n    </main>\n  );\n}\n');
  const r = ingestPage(dir, 'Shop', 'shop', from);
  assert.deepEqual(r.testIds, ['cart-submit']);
  const page = fs.readFileSync(r.pageFile, 'utf8');
  assert.match(page, /<main data-flow="cart" data-flow-state=\{flowState\}>/);
  const hook = path.join(dir, 'features', 'shop', 'hooks', 'useShop.tsx');
  fs.writeFileSync(hook, 'export function useShop() {\n  const onSubmit = () => {};\n  return { onSubmit };\n}\n');
  const c = generateController(dir, 'Shop', 'shop');
  assert.ok(!fs.readFileSync(c.file, 'utf8').includes('flowState'), 'unmatched optional slot is not stubbed');
  assert.ok(!c.bindings.some((b) => b.slot === 'flowState'));
  fs.writeFileSync(hook, 'export function useShop() {\n  const onSubmit = () => {};\n  const flowState = "open";\n  return { onSubmit, flowState };\n}\n');
  const c2 = generateController(dir, 'Shop', 'shop');
  assert.match(fs.readFileSync(c2.file, 'utf8'), /flowState=\{flowState\}/);
});
