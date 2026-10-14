// #949 -- the Trace beam (packages/engine/line/path/beam/): candidate paths per spec point, pruned structure -> types
// (LSP) -> behaviour (examples run in a vm) -> cost (Knuth over the AND-OR graph), then take | compare | NEEDS_YOU;
// re-plan after a stub fails 3 fills; a greedy Steiner merge across points; determinism. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { shortestPlan, resolveCompare, replan, steinerMerge } from '../packages/engine/line/path/beam/shortestPlan.mjs';
import { buildGraph, knuthCosts, solutionGraphs } from '../packages/engine/line/path/beam/graph.mjs';
import { beamFacts } from '../packages/engine/line/path/beam/facts.mjs';
import { runOnExamples } from '../packages/engine/line/path/beam/runExamples.mjs';
import { beamOnFail } from '../packages/engine/line/path/beam/fillReplan.mjs';
import { LSP_SHADOW_LOG } from '../packages/engine/line/lsp/profile.mjs';
import { clearHostCache } from '../packages/engine/lsp/host.mjs';

delete process.env.LINE_LSP;
const BOOKS = [{ id: 'a', title: 'Alpha', author: 'Ann' }, { id: 'b', title: 'Beta', author: 'Bob' }];
const BOOK_T = 'type Book = { id: string; title: string; author: string };';
const svc = (name, sig, body) => `${BOOK_T}\nimport books from '../../../library/fixtures/books.json';\nexport function ${name}${sig} {\n  ${body}\n}\n`;
const BASE = {
  'architecture.yml': 'version: 1\npreset: line\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, resolveJsonModule: true, esModuleInterop: true, lib: ['es2020'] }, include: ['**/*.ts'] }),
  'library/fixtures/books.json': JSON.stringify(BOOKS),
  'features/book/pages/BookPage.tsx': 'export default function BookPage() { return null; }\n',
  'features/book/services/findBook.ts': svc('findBook', '({ id }: { id: string }): Book | undefined', 'return (books as Book[]).find((b) => b.id === id);'),
  'features/book/services/bookList.ts': svc('bookList', '(): Book[]', 'return [...(books as Book[])];'),
  'features/book/services/bookByTitle.ts': svc('bookByTitle', '({ id }: { id: string }): Book | undefined', 'return (books as Book[]).find((b) => b.title === id);'),
};
function project(files = {}) {
  const root = makeTempDir('construct-beam-');
  for (const [rel, t] of Object.entries({ ...BASE, ...files })) {
    if (t == null) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t);
  }
  fs.mkdirSync(path.join(root, 'line'), { recursive: true });
  clearHostCache();
  return root;
}
const bookSlot = (o = {}) => ({ id: 'book', kind: 'api', layer: 'service', name: 'findBook', entity: 'book', in: '{ id: string }', out: 'Book | undefined', types: BOOK_T,
  contract: { target: 'library/fixtures/books', exists: true },
  examples: [{ id: 'find-a', input: { id: 'a' }, expect: BOOKS[0] }, { id: 'find-none', input: { id: 'zzz' }, expect: undefined }], ...o });
const point = (traits, slots = [bookSlot()], o = {}) => ({ id: 'BK-1', feature: 'book', text: 'The book page.', page: { name: 'BookPage', exists: true }, traits, slots, ...o });
const strip = (p) => JSON.stringify(p, (k, v) => (k === 'ms' ? undefined : v));

test('runOnExamples: a finished service on its examples in the vm; a wrong one fails with the example', () => {
  const root = project();
  const ok = runOnExamples(root, { file: 'features/book/services/findBook.ts', name: 'findBook' }, bookSlot().examples);
  assert.equal(ok.ok, true, JSON.stringify(ok.results));
  const bad = runOnExamples(root, { file: 'features/book/services/bookByTitle.ts', name: 'bookByTitle' }, bookSlot().examples);
  assert.equal(bad.ok, false);
  assert.equal(bad.failing.id, 'find-a');
});

test('Knuth costs over the AND-OR graph equal the cheapest enumerated solution', () => {
  const root = project();
  const facts = beamFacts(root);
  const g = buildGraph(point({ state: true, action: true }), facts, { root });
  const { cost } = knuthCosts(g);
  const sols = solutionGraphs(g, cost);
  const sum = (s) => s.leaves.reduce((t, id) => t + g.nodes.get(id).weight, 0);
  assert.equal(cost.get('root'), Math.min(...sols.map(sum)));
  assert.ok(sols.length > 8, 'the graph offers more than the beam cap');
});

test('forced fork, one survivor: every stage prunes something, the proven reuse is taken with no model', () => {
  const root = project();
  const plan = shortestPlan(root, point({ state: false, action: false, shared: false }));
  assert.ok(plan.forked >= 2, 'the beam always forks');
  assert.ok(plan.pruned.structure > 0, 'view-model kinds with nothing to do are pruned');
  assert.ok(plan.pruned.types > 0, `bookList(): Book[] does not fit {id} -> Book | undefined: ${strip(plan.pruned)}`);
  assert.ok(plan.pruned.behaviour > 0, 'bookByTitle type-checks but gives the wrong book');
  assert.equal(plan.survivors.length, 1);
  assert.deepEqual(plan.decision, { kind: 'take', key: plan.survivors[0].key, model: false });
  assert.equal(plan.survivors[0].vm, 'computed');
  assert.ok(plan.survivors[0].nodes.some((n) => n.step === 'reuse' && n.target === 'book/services/findBook'));
  assert.deepEqual(plan.provenSlots, ['book/services/findBook']);
  const typed = plan.candidates.find((c) => c.prunedAt?.stage === 'types');
  assert.match(typed.prunedAt.why, /missing the following properties|not assignable|Expected/);
  const wrong = plan.candidates.find((c) => c.prunedAt?.stage === 'behaviour');
  assert.equal(wrong.prunedAt.example.id, 'find-a');
});

test('two survivors produce a compare package; 3 answers outside the options -> NEEDS_YOU', () => {
  const root = project();
  const plan = shortestPlan(root, point({ state: true, action: true, shared: false }));
  assert.equal(plan.decision.kind, 'compare');
  const pkg = plan.decision.package;
  assert.equal(pkg.options.length, 2);
  assert.deepEqual(pkg.candidates.map((c) => c.vm).sort(), ['controller', 'hook']);
  for (const c of pkg.candidates) {
    assert.ok(c.fit.exists >= 2 && c.fit.new >= 1, JSON.stringify(c.fit));
    assert.deepEqual(c.nearby, ['book/services/findBook']);
    assert.ok(c.stableIds.includes('book/services/findBook'));
  }
  assert.deepEqual(pkg.schema.properties.option.enum, pkg.options);
  assert.deepEqual(resolveCompare(pkg, ['nope', pkg.options[1]]), { kind: 'take', key: pkg.options[1], tries: 2, model: true });
  const out = resolveCompare(pkg, ['a', 'b', 'c', pkg.options[0]]);
  assert.equal(out.kind, 'needs_you');
});

test('no survivor: NEEDS_YOU with each path tried, its stuck unit and its failing example', () => {
  const root = project({ 'features/book/services/bookList.ts': null, 'features/book/services/bookByTitle.ts': null,
    'features/book/services/findBook.ts': svc('findBook', '({ id }: { id: string }): Book | undefined', 'return (books as Book[]).find((b) => b.id !== id);') });
  const plan = shortestPlan(root, point({ state: false, action: false }));
  assert.equal(plan.survivors.length, 0);
  assert.equal(plan.decision.kind, 'needs_you');
  assert.equal(plan.decision.tried.length, plan.forked);
  const stuck = plan.decision.tried.find((t) => t.stage === 'behaviour');
  assert.equal(stuck.stuckStub, 'book/services/findBook');
  assert.equal(stuck.failingExample.id, 'find-a');
});

test('re-plan: a stub failing 3 fills moves to the next surviving path; none left -> NEEDS_YOU', () => {
  const root = project();
  const plan = shortestPlan(root, point({ state: true, action: true }));
  const [first, second] = plan.survivors;
  const r1 = replan(plan, { current: first.key, stuckStub: first.stubs[0], failure: { id: 'ex-1' } });
  assert.deepEqual(r1.decision, { kind: 'take', key: second.key, model: false, replanned: true });
  const r2 = replan(r1, { stuckStub: second.stubs[0], failure: { id: 'ex-2' } });
  assert.equal(r2.decision.kind, 'needs_you');
  assert.deepEqual(r2.decision.tried.map((t) => [t.key, t.stuckStub, t.failingExample.id]), [[first.key, first.stubs[0], 'ex-1'], [second.key, second.stubs[0], 'ex-2']]);
});

test('re-plan wired into path-first fill under lsp.beam (shadow): the third failed fill logs the next path', () => {
  const root = project({ 'features/book/domains/label.ts': 'export function label(b: { title: string }): string {\n  throw new Error(\'TODO(path-stub book.domain.label)\');\n}\n' });
  const p = { version: 1, points: { 'BK-1': {} }, units: [
    { id: 'book.page.BookPage', kind: 'wiring', layer: 'page', file: 'features/book/pages/BookPage.tsx', export: 'BookPage', point: 'BK-1' },
    { id: 'book.domain.label', kind: 'stub', layer: 'domain', file: 'features/book/domains/label.ts', fn: 'label', export: 'label', point: 'BK-1', examples: [{ id: 'l1', input: { title: 'Alpha' }, expect: 'Alpha' }] },
  ] };
  const u = p.units[1];
  const fails = (n) => fs.writeFileSync(path.join(root, 'line/path/fills.jsonl'), Array.from({ length: n }, (_, i) => JSON.stringify({ stubId: u.id, n: i + 1, pass: false, failure: { example: 'l1' } })).join('\n') + '\n');
  fs.mkdirSync(path.join(root, 'line/path'), { recursive: true });
  fails(2);
  assert.equal(beamOnFail(root, p, u), null, 'two failures: no re-plan yet');
  fails(3);
  const r = beamOnFail(root, p, u);
  assert.equal(r.mode, 'shadow');
  assert.equal(r.stuck, 'book/domains/label');
  assert.ok(['take', 'needs_you'].includes(r.would.kind));
  const rows = fs.readFileSync(path.join(root, LSP_SHADOW_LOG), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.at(-1).flag, 'lsp.beam');
  assert.equal(beamOnFail(root, p, u, { lsp: { beam: 'off' } }), null);
});

test('Steiner merge across 2 spec points: the shared create is built once', () => {
  const root = project({ 'features/book/services/findBook.ts': null, 'features/book/services/bookList.ts': null, 'features/book/services/bookByTitle.ts': null,
    'features/book/services/bookById.ts': svc('bookById', '({ id }: { id: string }): Book | undefined', 'return (books as Book[]).find((b) => b.id === id);') });
  const facts = beamFacts(root);
  const p1 = shortestPlan(root, point({}, [bookSlot({ entity: 'catalogue' })], { id: 'P-1' }), { facts });
  const p2 = shortestPlan(root, point({}, [bookSlot()], { id: 'P-2' }), { facts });
  assert.ok(p2.survivors[0].nodes.some((n) => n.target === 'book/services/bookById'), 'alone, P-2 reuses bookById');
  const m = steinerMerge([p2, p1]);
  assert.deepEqual(m.order, ['P-1', 'P-2'], 'the point with no choice commits first');
  assert.ok(m.chosen['P-2'].includes('create book/services/findBook'), 'merged, P-2 shares P-1\'s new findBook');
  assert.ok(m.shared.includes('create book/services/findBook'));
  assert.ok(m.total < m.separate + 1);
});

test('determinism: 20 runs give the same plan', () => {
  const root = project();
  const facts = beamFacts(root);
  const first = strip(shortestPlan(root, point({ state: true, action: true }), { facts }));
  for (let i = 0; i < 19; i++) assert.equal(strip(shortestPlan(root, point({ state: true, action: true }), { facts })), first);
});
