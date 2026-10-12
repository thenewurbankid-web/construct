// #892: the owner's intent loop: eval-intent on a fixture (deterministic with a fixed seed and a deterministic jev),
// the label CLI round trip (add, from-last, edit, list, rm), ask's Trace path, and the training rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreRows, summarize, renderMarkdown, metrics } from './eval-intent.mjs';
import { run } from './intent-label.mjs';
import { ask } from './ask.mjs';
import { trainRow } from './build-intent-data.mjs';
import { readGold, splitOf, GOLD_FILE, CATALOG } from './intentGold.mjs';
import { staticPagePath, renderAsk, STUB, FN, UNDECIDED } from './tracePath.mjs';

const GOLD = [
  { id: 'f-001', project: 'examples/line-sample', request: 'set the title of the invoices page to "Alpha"', gold: { intent: 'update.prop', object: 'prop', slot: 'page:InvoicesPage', layers: ['ui'] }, source: 'hand' },
  { id: 'f-002', project: 'examples/line-sample', request: 'promote OrderButton to the library', gold: { intent: 'promote.component', object: 'component', slot: 'component:OrderButton', layers: ['library'] }, source: 'hand' },
  { id: 'f-003', project: 'examples/line-sample', request: 'fix all problems', gold: { intent: 'fix.problem', object: 'problem', slot: null, layers: ['ui'] }, source: 'hand' },
  { id: 'f-004', project: 'examples/line-sample', request: 'hello there', gold: { intent: 'unknown', object: null, slot: null, layers: [] }, source: 'hand', uncertain: 'chit-chat' },
];
/** A deterministic jev: always the first option, confidence by question. */
const firstJev = async ({ structured }) => ({ text: JSON.stringify({ choice: 1, fact: 1 }), confidence: structured.question.includes('layer') ? 0.3 : 0.7 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jev-intent-'));

test('the seeded gold file is valid and covers every intent that has a template', () => {
  const rows = readGold(GOLD_FILE);
  assert.ok(rows.length >= 40 && rows.length <= 80, `${rows.length} rows`);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  const have = new Set(rows.map((r) => r.gold.intent));
  for (const e of CATALOG.filter((x) => x.templates.length)) assert.ok(have.has(e.id), e.id);
  assert.ok(rows.every((r) => ['hand', 'requester'].includes(r.source)));
});

test('eval-intent on a fixture: static-only and with jev, deterministic for a fixed seed', async () => {
  const off = await scoreRows(GOLD, { jev: false, seed: 7 });
  const s = metrics(off, 'static');
  assert.equal(s.n, 4);
  assert.equal(s.intent, 100);
  assert.equal(metrics(off, 'jev').n, 0);
  const a = summarize(await scoreRows(GOLD, { choose: firstJev, seed: 7 }), { seed: 7, jev: 'fake' });
  const b = summarize(await scoreRows(GOLD, { choose: firstJev, seed: 7 }), { seed: 7, jev: 'fake' });
  assert.deepEqual(a, b);
  assert.equal(a.tables.all.jev.n, 4);
  assert.equal(a.tables.all.jev.intent, 0, 'jev always says add.variable here');
  assert.equal(a.tables.all.forks.forkRate, 100);
  assert.ok(a.tables.all.forks.containsGold > 0, 'static is right, so the fork holds the gold value');
  assert.equal(a.tables['held-out'].static.n, GOLD.filter((g) => splitOf(g.id, 7) === 'test').length);
  const md = renderMarkdown(a);
  assert.match(md, /\| intent \(exact\) \| 100% \| 0% \|/);
  assert.match(md, /Top confusions/);
});

test('label CLI round trip: add (static guess, --yes), add with flags, edit, from-last, list, rm', async () => {
  const dir = tmp();
  const gold = path.join(dir, 'gold.jsonl');
  const askLog = path.join(dir, 'ask.jsonl');
  try {
    let r = await run(['add', 'remove InvoiceCard', '--gold', gold]);
    assert.match(r.lines.join('\n'), /static {4}intent remove\.component \| slot component:InvoiceCard \| layers ui/);
    assert.match(r.lines.at(-1), /^Not saved\./);
    assert.equal(readGold(gold).length, 0);
    r = await run(['add', 'remove InvoiceCard', '--gold', gold, '--yes']);
    assert.equal(r.code, 0);
    r = await run(['add', 'change the orders flow', '--gold', gold, '--layers', 'ui,workflow', '--uncertain', 'which flow']);
    assert.equal(r.code, 0);
    r = await run(['add', 'remove InvoiceCard', '--gold', gold, '--yes']);
    assert.equal(r.code, 1, 'a duplicate request is refused');
    r = await run(['add', 'x', '--gold', gold, '--intent', 'frobnicate.page']);
    assert.match(r.lines.at(-1), /Not saved: gold\.intent must be a catalog id/);
    let rows = readGold(gold);
    assert.deepEqual(rows.map((x) => [x.id, x.gold.intent, x.gold.slot, x.gold.layers, x.uncertain ?? null]), [
      ['hand-001', 'remove.component', 'component:InvoiceCard', ['ui'], null],
      ['hand-002', 'update.feature-flow', 'feature:orders', ['ui', 'workflow'], 'which flow'],
    ]);
    r = await run(['edit', 'hand-002', '--gold', gold, '--slot', 'none', '--sure']);
    assert.equal(r.code, 0);
    rows = readGold(gold);
    assert.equal(rows[1].gold.slot, null);
    assert.equal(rows[1].uncertain, undefined);
    r = await run(['from-last', '--gold', gold, '--yes'], { askLog });
    assert.equal(r.code, 1, 'no ask yet');
    await ask('promote OrderButton to the library', { choose: firstJev, log: askLog, verify: false });
    r = await run(['from-last', '--gold', gold, '--yes'], { askLog });
    assert.equal(r.code, 0);
    assert.equal(readGold(gold)[2].gold.intent, 'promote.component');
    r = await run(['list', '--gold', gold]);
    assert.match(r.lines.join('\n'), /3 rows; per intent: promote\.component 1, remove\.component 1, update\.feature-flow 1/);
    r = await run(['rm', 'hand-001', '--gold', gold]);
    assert.equal(readGold(gold).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ask: the plan as a Trace path with static and jev per decision, logged for from-last', async () => {
  const dir = tmp();
  try {
    const log = path.join(dir, 'ask.jsonl');
    const r = await ask('when more is asked for on the orders page run `() => go()`', { choose: firstJev, log, verify: false });
    assert.equal(r.labels.static.intent, 'update.handler');
    assert.equal(r.labels.jev.intent, 'add.variable');
    assert.ok(r.labels.forks.some((f) => f.label === 'intent'));
    assert.equal(r.path[0].file, 'features/orders/pages/OrdersPage.tsx');
    const chain = [];
    for (let n = r.path[0].parts[0]; n; n = n.children[0]) chain.push(n.layer);
    assert.deepEqual(chain, ['part', 'dynamic', 'source', 'source', 'controller', 'hook', 'provider', 'service', 'contract']);
    assert.ok(r.shadow.length >= 7 && r.shadow.every((x) => x.jev !== null));
    const line = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    assert.deepEqual(Object.keys(line).filter((k) => ['request', 'labels', 'path', 'shadow'].includes(k)).sort(), ['labels', 'path', 'request', 'shadow']);
    const text = renderAsk(r);
    assert.match(text, /Trace path \(page part -> dynamic\? -> api \| computed -> controller -> hook -> provider -> service -> contract\)/);
    assert.match(text, /FORK/);
    const off = await ask('promote OrderButton to the library', { jev: false, log: null, verify: false });
    assert.equal(off.labels.jev, null);
    assert.deepEqual(off.shadow, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the static path follows the binding: stub-first per layer, undecided where no static logic exists', () => {
  const binding = {
    page: 'P', file: 'features/a/pages/P.tsx', via: 'trace',
    contract: { endpoints: [{ id: 'GET /api/a' }], sentence: 'c' },
    parts: [{ id: 'n0', tag: 'List', base: { libraryId: 'pages/ListPage' }, data: { kind: 'list', endpoint: 'GET /api/a', sentence: 'rows' } }, { id: 'n1', tag: 'h1', base: {}, data: { kind: 'static', sentence: 'text' } }],
    interactions: [{ id: 'n0:onMore', partId: 'n0', prop: 'onMore', label: 'More', handler: 'stub', resolution: 'stub', endpoint: null, sentence: 's' }],
    findings: [],
  };
  const p = staticPagePath(binding);
  assert.equal(p.parts.length, 1, 'a static part without an action is left out');
  const by = {};
  for (let n = p.parts[0].children[0]; n; n = n.children[0]) by[n.layer] = n;
  assert.equal(by.dynamic.decision.static, 'dynamic');
  assert.equal(by.source.decision.static, 'api');
  assert.equal(by.controller.decision.static, STUB);
  assert.equal(by.controller.state, 'placeholder');
  assert.equal(by.hook.decision.static, UNDECIDED);
  assert.equal(by.contract.decision.static, FN);
  assert.equal(staticPagePath(binding, { all: true }).parts.length, 2);
});

test('training rows carry the provider\'s exact questions and the gold option index', () => {
  const row = trainRow(GOLD[0], 0);
  const q = Object.fromEntries(row.questions.map((x) => [x.key, x]));
  assert.equal(q.verb.options[q.verb.gold], '2) update');
  assert.equal(q.object.options[q.object.gold], '2) prop');
  assert.match(q.slot.options[q.slot.gold], /^\d+\) P\d page$/);
  assert.equal(q['layer:ui'].gold, 0);
  assert.equal(q['layer:api'].gold, 1);
  assert.equal(trainRow(GOLD[3], 0).questions.find((x) => x.key === 'verb').gold, null, 'unknown intent: no verb target');
});
