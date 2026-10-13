// #945 -- the Line LSP calls wired into Line's surfaces, each under its lsp.* switch: the profile (defaults, project
// file, env, per-call override, shadow log), the nextSteps Trace-step block, fixes after a splice, the closed choice at
// a tsc failure (import paths ranked by exports), the deterministic gatherer (research read_file, coder scope), the
// Smith check after a fill, and path-first fill end to end. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { lspMode, lspProfile, shadowLog, LSP_DEFAULTS, LSP_SHADOW_LOG, LSP_PROFILE_FILE } from '../packages/engine/line/lsp/profile.mjs';
import { traceStep, nextOpenStub } from '../packages/engine/line/lsp/traceStep.mjs';
import { fixSpliced, fixesStep } from '../packages/engine/line/lsp/spliceFixes.mjs';
import { smithCheck, smithCheckStep } from '../packages/engine/line/lsp/smithCheck.mjs';
import { failurePoint, completionsForFailure, completionsStep, rankImportPaths } from '../packages/engine/line/coder/completions.mjs';
import { gatherSymbols, gatherStep } from '../packages/engine/line/coder/symbols.mjs';
import { READ_TOOLS } from '../packages/engine/line/research/subagent.mjs';
import { scopeOf } from '../packages/engine/line/coder/reads.mjs';
import { fill, failureText } from '../packages/engine/line/path/fill.mjs';
import { smithReady } from '../packages/engine/lsp/smith.mjs';
import { clearHostCache } from '../packages/engine/lsp/host.mjs';

delete process.env.LINE_LSP;
const TSCONFIG = JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['es2020'] }, include: ['**/*.ts'] });
const STUB = (name, sig, id) => `export function ${name}${sig} {\n  throw new Error('TODO(path-stub ${id})');\n}\n`;
const BASE = {
  'architecture.yml': 'version: 1\npreset: line\n',
  'tsconfig.json': TSCONFIG,
  'features/book/domains/formatPages.ts': 'export function formatPages(pages: number): string {\n  return pages + " pages";\n}\n',
  'features/book/domains/formatAuthor.ts': STUB('formatAuthor', '(author: string): string', 'book.formatAuthor'),
  'features/picks/services/addPick.ts': 'export function addPick(ids: string[], id: string): string[] {\n  return ids.includes(id) ? ids : [...ids, id];\n}\n',
  'features/picks/index.ts': "export { addPick } from './services/addPick';\n",
};
function project(files = {}, { line = true } = {}) {
  const root = makeTempDir('construct-lsp-wiring-');
  for (const [rel, t] of Object.entries({ ...BASE, ...files })) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); }
  if (line) fs.mkdirSync(path.join(root, 'line'), { recursive: true });
  clearHostCache();
  return root;
}
const shadowRows = (root) => { try { return fs.readFileSync(path.join(root, LSP_SHADOW_LOG), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('profile: nextSteps and fixes default on, the rest shadow; override > env > project file > default; shadow rows only with line/', () => {
  assert.deepEqual(LSP_DEFAULTS, { nextSteps: 'on', completions: 'shadow', gatherer: 'shadow', smithCheck: 'shadow', fixes: 'on' });
  const root = project();
  assert.deepEqual(lspProfile(root, null, {}).map((p) => [p.flag, p.mode]), [['lsp.nextSteps', 'on'], ['lsp.completions', 'shadow'], ['lsp.gatherer', 'shadow'], ['lsp.smithCheck', 'shadow'], ['lsp.fixes', 'on']]);
  fs.writeFileSync(path.join(root, LSP_PROFILE_FILE), JSON.stringify({ v: 1, calls: { 'lsp.fixes': 'off', gatherer: 'on' } }));
  assert.equal(lspMode(root, 'fixes', null, {}), 'off');
  assert.equal(lspMode(root, 'gatherer', null, {}), 'on');
  assert.equal(lspMode(root, 'fixes', null, { LINE_LSP: 'fixes=shadow' }), 'shadow', 'env over the project file');
  assert.equal(lspMode(root, 'fixes', { 'lsp.fixes': true }, { LINE_LSP: 'fixes=shadow' }), 'on', 'a call\'s own override wins');
  assert.equal(lspMode(root, 'fixes', { fixes: 'nonsense' }, {}), 'off', 'an unknown mode is ignored');
  assert.throws(() => lspMode(root, 'nope'), /no call nope/);
  shadowLog(root, 'completions', { x: 1 });
  assert.deepEqual(shadowRows(root).map((r) => [r.flag, r.x]), [['lsp.completions', 1]]);
  const bare = project({}, { line: false });
  shadowLog(bare, 'completions', { x: 1 });
  assert.equal(fs.existsSync(path.join(bare, 'line')), false, 'a project without line/ gets no log');
});

test('nextSteps block: the first legal step in Line order, from facts on disk', () => {
  const root = project();
  const step = (need, from = 'book') => traceStep(root, { need, from }).step;
  assert.deepEqual(step('book/domains/formatAuthor'), { step: 'complete_stub', target: 'book/domains/formatAuthor', reason_id: 'STUB_OPEN', why: 'OPEN,UNUSED_INPUT' });
  assert.equal(step('book/domains/formatPages').step, 'reuse');
  assert.equal(step('picks/services/addPick').step, 'add_to_scope');
  assert.equal(step('book/domains/newOne').step, 'create');
  assert.deepEqual(step('book/hooks/useX'), { step: 'create_module', target: 'module:book/hooks', reason_id: 'NO_MODULE' });
  const r = traceStep(root, { need: 'book/domains/formatPages', from: 'book' });
  assert.deepEqual(r.schema.properties.option.enum, ['reuse book/domains/formatPages']);
  assert.equal(traceStep(root, { need: 'nope', from: 'book' }).ok, false);
});

test('nextOpenStub: on passes over a stub finished on disk (reuse); shadow keeps the order and logs; off is the order', () => {
  const root = project();
  const open = [
    { id: 'book.domain.formatPages', file: 'features/book/domains/formatPages.ts', fn: 'formatPages' },
    { id: 'book.domain.formatAuthor', file: 'features/book/domains/formatAuthor.ts', fn: 'formatAuthor' },
  ];
  const on = nextOpenStub(root, open);
  assert.deepEqual([on.mode, on.id, on.skipped, on.step.step], ['on', 'book.domain.formatAuthor', ['book.domain.formatPages'], 'complete_stub']);
  const sh = nextOpenStub(root, open, { lsp: { nextSteps: 'shadow' } });
  assert.deepEqual([sh.id, sh.step], ['book.domain.formatPages', null]);
  assert.deepEqual(shadowRows(root).map((x) => [x.flag, x.used, x.would]), [['lsp.nextSteps', 'book.domain.formatPages', 'book.domain.formatAuthor']]);
  assert.equal(nextOpenStub(root, open, { lsp: { nextSteps: 'off' } }).id, 'book.domain.formatPages');
  assert.equal(nextOpenStub(project({ 'architecture.yml': 'nope: [' }), open).id, 'book.domain.formatPages', 'no Line facts: the order stands');
});

test('fixes after a splice: on adds the missing import; shadow logs and keeps the text; a fix never changes the locked signature', () => {
  const root = project();
  const spliced = 'export function useIt(n: number): string {\n  return formatPages(n);\n}\n';
  fs.mkdirSync(path.join(root, 'features/book/services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/book/services/useIt.ts'), spliced);
  const on = fixesStep(root, 'features/book/services/useIt.ts', spliced, { fn: 'useIt' });
  assert.equal(on.mode, 'on');
  assert.match(on.source, /^import \{ formatPages \} from '\.\.\/domains\/formatPages';/);
  assert.deepEqual(on.applied.map((a) => a.fix), ['fixMissingImport']);
  const sh = fixesStep(root, 'features/book/services/useIt.ts', spliced, { fn: 'useIt', lsp: { fixes: 'shadow' } });
  assert.equal(sh.source, spliced);
  assert.deepEqual(shadowRows(root).map((x) => [x.flag, x.would[0].fix]), [['lsp.fixes', 'fixMissingImport']]);
  assert.equal(fixesStep(root, 'features/book/services/useIt.ts', spliced, { lsp: { fixes: 'off' } }).source, spliced);
  const lost = fixSpliced(root, 'features/book/services/useIt.ts', spliced, { fn: 'notThere' });
  assert.equal(lost.source, spliced);
  assert.match(lost.dropped, /locked signature/);
  assert.deepEqual(fixSpliced(project({}, { line: false }), 'features/book/domains/formatPages.ts', BASE['features/book/domains/formatPages.ts']).applied, [], 'nothing to fix: nothing applied');
});

test('completions at a tsc failure: the point, the enum, import paths ranked by the names the module exports', () => {
  const root = project({ 'features/book/domains/pagesText.ts': 'export const pagesLabel = "pages";\n' });
  const bad = "import { formatPages } from './formatPage';\nexport function x(n: number): string { return formatPages(n); }\n";
  fs.mkdirSync(path.join(root, 'features/book/services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/book/services/x.ts'), bad);
  const p = failurePoint(bad, { line: 1, col: 29, code: 'TS2307' });
  assert.deepEqual([p.kind, p.wrong, p.names], ['path', './formatPage', ['formatPages']]);
  const c = completionsForFailure(root, 'features/book/services/x.ts', bad, { line: 1, col: 29, code: 2307 });
  assert.equal(c.ok, true);
  assert.equal(c.items[0], '../domains/formatPages', 'the module that exports formatPages comes first');
  assert.deepEqual(c.schema.properties.name.enum, c.items);
  assert.deepEqual(rankImportPaths(root, 'features/book/services/x.ts', ['../domains/pagesText', '../domains/formatPages'], ['formatPages']), ['../domains/formatPages', '../domains/pagesText']);
  const unknown = "export function y(n: number): string { return formatPages(n); }\n";
  const u = completionsForFailure(root, 'features/book/services/x.ts', unknown, { line: 1, col: 47, code: 'TS2304' });
  assert.equal(u.kind, 'import-source');
  assert.equal(u.items[0], '../domains/formatPages');
  assert.equal(completionsForFailure(root, 'features/book/services/x.ts', bad, { line: 1, col: 1, code: 'TS2322' }).ok, false, 'not a failure point');
  const sh = completionsStep(root, 'features/book/services/x.ts', bad, { line: 1, col: 29, code: 'TS2307' });
  assert.deepEqual([sh.mode, sh.offer], ['shadow', null], 'shadow by default: computed, not offered');
  assert.equal(shadowRows(root).at(-1).items[0], '../domains/formatPages');
  const on = completionsStep(root, 'features/book/services/x.ts', bad, { line: 1, col: 29, code: 'TS2307' }, { lsp: { completions: 'on' } });
  assert.equal(on.offer.items[0], '../domains/formatPages');
  assert.match(failureText({ layer: 'tsc', sentence: 'x', completions: on.offer }), /Pick the import path for \.\/formatPage from: \.\.\/domains\/formatPages/);
});

test('gatherer: exports as file:line and exact type; research read_file returns them under on, the text under shadow', async () => {
  const root = project();
  const g = gatherSymbols(root, ['features/book/domains/formatPages.ts', 'features/picks/services/addPick.ts', 'architecture.yml']);
  assert.deepEqual(g.lines, ['features/book/domains/formatPages.ts:1 function formatPages(pages: number): string', 'features/picks/services/addPick.ts:1 function addPick(ids: string[], id: string): string[]']);
  assert.equal(gatherStep(root, 'features/book/domains/formatPages.ts', 'x').symbols, null, 'shadow: not used');
  assert.equal(shadowRows(root).at(-1).flag, 'lsp.gatherer');
  const shadowRead = await READ_TOOLS.read_file.run(root, { path: 'features/book/domains/formatPages.ts' });
  assert.match(shadowRead.text, /return pages/);
  fs.writeFileSync(path.join(root, LSP_PROFILE_FILE), JSON.stringify({ v: 1, calls: { 'lsp.gatherer': 'on' } }));
  const onRead = await READ_TOOLS.read_file.run(root, { path: 'features/book/domains/formatPages.ts' });
  assert.deepEqual([onRead.text, onRead.symbols], [undefined, 'features/book/domains/formatPages.ts:1 function formatPages(pages: number): string']);
  assert.match((await READ_TOOLS.read_file.run(root, { path: 'architecture.yml' })).text, /preset: line/, 'not TypeScript: the text');
  const scope = scopeOf(root, { file: 'features/book/domains/formatAuthor.ts' });
  const own = scope.entries.find((e) => e.file === 'features/book/domains/formatPages.ts');
  assert.deepEqual(own.types, ['function formatPages(pages: number): string']);
  assert.match(scope.sentence, /Exports: function formatPages\(pages: number\): string\./);
});

test('Smith check after a fill: exact match against the plan; on fails a mismatch, shadow only logs, no plan is skipped', { skip: smithReady() ? false : 'atomic-codemod is not linked' }, async () => {
  const root = project();
  const src = 'export function twice(n: number): number {\n  return n * 2;\n}\n';
  assert.equal((await smithCheck('features/book/domains/twice.ts', src, 'twice', ['It returns n * 2.'])).pass, true);
  const miss = await smithCheck('features/book/domains/twice.ts', src, 'twice', ['It returns n * 3.']);
  assert.deepEqual([miss.pass, miss.missing.map((m) => m.sentence), miss.extra.map((m) => m.sentence)], [false, ['it returns n * 3'], ['it returns n * 2']]);
  assert.match((await smithCheck('f.ts', src, 'twice', [])).skipped, /no Smith test plan/);
  assert.match((await smithCheck('f.ts', src, 'twice', ['x'], { ready: () => false })).skipped, /not linked/);
  const unit = { id: 'book.domain.twice', file: 'features/book/domains/twice.ts', fn: 'twice', smith: ['It returns n * 3.'] };
  const sh = await smithCheckStep(root, unit, src);
  assert.deepEqual([sh.mode, sh.failure], ['shadow', null]);
  assert.equal(shadowRows(root).at(-1).pass, false);
  const on = await smithCheckStep(root, unit, src, { lsp: { smithCheck: 'on' } });
  assert.equal(on.failure.layer, 'smith');
  assert.match(on.failure.sentence, /The plan says "it returns n \* 3"/);
});

test('path-first fill: fixes add the missing import before tsc, the fill passes, the next stub is the nextSteps block\'s', async () => {
  const root = project({
    'features/book/domains/pagesLine.ts': STUB('pagesLine', '(n: number): string', 'book.domain.pagesLine'),
    'features/book/domains/authorLine.ts': STUB('authorLine', '(a: string): string', 'book.domain.authorLine'),
    'features/book/domains/doneLine.ts': 'export function doneLine(a: string): string {\n  return a;\n}\n',
  });
  const unit = (id, name, ex) => ({ id, kind: 'stub', layer: 'domain', file: `features/book/domains/${name}.ts`, fn: name, export: name, point: 'p1', examples: [ex] });
  const p = { units: [
    unit('book.domain.pagesLine', 'pagesLine', { id: 'e1', input: 3, expect: '3 pages' }),
    unit('book.domain.doneLine', 'doneLine', { id: 'e1', input: 'x', expect: 'x' }),
    unit('book.domain.authorLine', 'authorLine', { id: 'e1', input: 'Ann', expect: 'by Ann' }),
  ], edges: [], points: { p1: {} } };
  fs.mkdirSync(path.join(root, 'line/path'), { recursive: true });
  fs.writeFileSync(path.join(root, 'line/path/path.json'), JSON.stringify(p));
  const r = await fill({ root, stubId: 'book.domain.pagesLine', body: 'return formatPages(n);' });
  assert.equal(r.pass, true, r.sentence);
  assert.deepEqual(r.fixes.map((f) => f.fix), ['fixMissingImport']);
  assert.match(fs.readFileSync(path.join(root, 'features/book/domains/pagesLine.ts'), 'utf8'), /^import \{ formatPages \} from '\.\/formatPages';/);
  assert.equal(r.next, 'book.domain.authorLine', 'doneLine is finished on disk (reuse), so it is passed over');
  assert.deepEqual(r.nextStep, { step: 'complete_stub', target: 'book/domains/authorLine', reason_id: 'STUB_OPEN', why: 'OPEN,UNUSED_INPUT' });
  const off = await fill({ root, stubId: 'book.domain.authorLine', body: 'return byLine(a);', lsp: { fixes: 'off', completions: 'on' } });
  assert.equal(off.pass, false);
  assert.equal(off.failure.layer, 'tsc');
  assert.equal(off.fixes, undefined);
  assert.ok(off.failure.completions, 'completions on: the failure carries the closed choice');
  assert.equal(off.failure.completions.code, 'TS2304');
});
