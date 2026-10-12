// cu5 -- the Pages screen's two bindings of one page, side by side: Morpheus binds each part to a library component;
// Trace binds the same parts to API data (Trace's page map, reused through its package entry line-matcher/pagemap):
// the data each part shows, its states, and every interaction wired to an endpoint, a controller or a stub. The same
// story runs on the contract's mock and on a copy of examples/line-sample with the real engine; every edit is a staged
// change that lands only through applyChange, and only after a person approves it as a plan step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertLinePageBinding, assertStagedChange, assertLineStepResult, LineOpError, LINE_PLAN_TOOLS, LINE_API } from '../packages/engine/line/contract.mjs';
import { createMockLineOps } from '../packages/engine/line/mock.mjs';
import { PAGE_BINDING_OPS, readPageBinding, planBindInteraction, planBindPart } from '../packages/engine/line/pageBinding.mjs';
import { loadTracePagemap, exportedFile, TRACE_DIR } from '../packages/engine/line/tracePagemap.mjs';
import { applyChange } from '../packages/engine/line/ops.mjs';
import { createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { entryById, createToolRegistry, lineHandlers, realLineOps } from '../packages/engine/line/toolRegistry.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { LINE_CONTROLS, TOOL_PATHS } from '../packages/engine/line/controls.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const ORDERS = 'features/orders/pages/OrdersPage.tsx';
const INVOICES = 'features/billing/pages/InvoicesPage.tsx';
const copy = () => { const dir = makeTempDir('line-binding-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const refused = (code) => (e) => e instanceof LineOpError && e.code === code && /[.?!]$/.test(e.sentence);
const NO_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };

const REAL = { ...PAGE_BINDING_OPS, applyChange };
const IMPLS = [
  ['mock', () => ({ ops: createMockLineOps(), root: '/mock', read: (ops, f) => ops.files()[f] })],
  ['real', () => { const root = copy(); return { ops: REAL, root, read: (_ops, f) => fs.readFileSync(path.join(root, f), 'utf8') }; }],
];

for (const [kind, make] of IMPLS) {
  test(`${kind}: OrdersPage shows both bindings: ListPage from the library, its "More" action not bound to the API, with typed fixes`, () => {
    const { ops, root } = make();
    const b = ops.readPageBinding(root, ORDERS);
    assertLinePageBinding(b);
    assert.deepEqual([b.feature, b.page, b.via], ['orders', 'OrdersPage', 'trace']);
    assert.equal(b.contract.state, 'ok');
    assert.equal(b.contract.sentence, 'The API contract of orders (openapi.json) has 3 endpoints.');
    assert.deepEqual(b.contract.endpoints.map((e) => [e.id, e.role]), [['GET /api/orders', 'list'], ['POST /api/orders', 'create'], ['DELETE /api/orders/:id', 'remove']]);
    const part = b.parts.find((p) => p.tag === 'ListPage');
    assert.deepEqual([part.base.kind, part.base.libraryId], ['library', 'pages/ListPage']);
    assert.equal(part.base.sentence, 'The library page ListPage (pages/ListPage).');
    assert.equal(part.data.kind, 'static');
    assert.deepEqual(b.interactions.map((i) => [i.id, i.prop, i.label, i.verb, i.handler, i.resolution]), [[`${part.id}:onMore`, 'onMore', 'More', 'more', 'function', 'unresolved']]);
    assert.deepEqual(part.interactions, [`${part.id}:onMore`]);
    assert.equal(b.findings.length, 1);
    const f = b.findings[0];
    assert.equal(f.sentence, 'More on ListPage is not bound to the API: "more" is not a known action and the handler is not a stub.');
    assert.deepEqual(f.fixes.map((x) => x.id), ['endpoint:GET /api/orders', 'endpoint:POST /api/orders', 'endpoint:DELETE /api/orders/:id', 'controller:select', 'controller:clear'],
      'the list endpoint first (a "more" reads like loading more), no stub because the handler already runs code');
    assert.equal(f.fixes[0].sentence, 'Bind "More" to GET /api/orders (reload the list).');
    assert.deepEqual(f.fixes[0].step, { tool: 'line.bindInteraction', args: { file: ORDERS, interactionId: `${part.id}:onMore`, to: 'endpoint', endpoint: 'GET /api/orders' } });
    assert.deepEqual(b.coverage, { total: 1, api: 0, controller: 0, stub: 0, unresolved: 1, rate: 0 });
    assert.ok(b.components.some((c) => c.id === 'components/Button'));
  });

  test(`${kind}: the recommended fix binds "More" to GET /api/orders: planned without writing, landed by applyChange, then Trace resolves it`, () => {
    const { ops, root, read } = make();
    const before = read(ops, ORDERS);
    const b = ops.readPageBinding(root, ORDERS);
    const staged = ops.planBindInteraction(root, { ...b.findings[0].fixes[0].step.args, contentHash: b.contentHash });
    assertStagedChange(staged);
    assert.equal(staged.summary, 'Binds "More" on ListPage in the page OrdersPage to GET /api/orders (reload the list).');
    assert.equal(read(ops, ORDERS), before, 'planning writes nothing');
    assert.match(staged.files[0].content, /data-action="reload"/);
    assert.equal(ops.applyChange(root, staged).ok, true);
    const after = ops.readPageBinding(root, ORDERS);
    assertLinePageBinding(after);
    assert.deepEqual(after.interactions.map((i) => [i.resolution, i.endpoint]), [['api', 'GET /api/orders']]);
    assert.equal(after.interactions[0].sentence, '"More" calls GET /api/orders (reload the list).');
    assert.deepEqual(after.findings, []);
    assert.equal(after.coverage.rate, 100);
    // The old hash is now stale: a second step planned from the old view is refused, not applied to the wrong part.
    assert.throws(() => ops.planBindInteraction(root, { ...b.findings[0].fixes[1].step.args, contentHash: b.contentHash }), refused('STALE'));
  });

  test(`${kind}: a controller binding; a stub is refused for a handler that runs code; unknown action or endpoint is one sentence`, () => {
    const { ops, root } = make();
    const b = ops.readPageBinding(root, ORDERS);
    const id = b.interactions[0].id;
    const ctl = ops.planBindInteraction(root, { file: ORDERS, interactionId: id, to: 'controller', verb: 'select' });
    assert.equal(ctl.summary, 'Binds "More" on ListPage in the page OrdersPage to a controller function: select this item (no API call).');
    assert.equal(ops.applyChange(root, ctl).ok, true);
    assert.equal(ops.readPageBinding(root, ORDERS).interactions[0].resolution, 'controller');
    assert.throws(() => ops.planBindInteraction(root, { file: ORDERS, interactionId: id, to: 'stub' }), refused('HAS_CODE'));
    assert.throws(() => ops.planBindInteraction(root, { file: ORDERS, interactionId: 'n9:onNope', to: 'stub' }), refused('UNKNOWN_ITEM'));
    assert.throws(() => ops.planBindInteraction(root, { file: ORDERS, interactionId: id, to: 'endpoint', endpoint: 'PUT /nowhere' }), refused('UNKNOWN_ENDPOINT'));
    assert.throws(() => ops.planBindInteraction(root, { file: ORDERS, interactionId: id, to: 'controller', verb: 'launch' }), refused('BAD_REQUEST'));
    assert.throws(() => ops.planBindInteraction(root, { file: ORDERS, interactionId: id, to: 'teleport' }), refused('BAD_REQUEST'));
    assert.throws(() => ops.readPageBinding(root, 'features/orders/pages/Nope.tsx'), refused('UNKNOWN_ITEM'));
  });

  test(`${kind}: Morpheus's side: a part bound to a library component becomes it and the page imports it`, () => {
    const { ops, root } = make();
    const b = ops.readPageBinding(root, ORDERS);
    const part = b.parts.find((p) => p.tag === 'ListPage');
    const staged = ops.planBindPart(root, { file: ORDERS, partId: part.id, libraryId: 'components/Button', contentHash: b.contentHash });
    assertStagedChange(staged);
    assert.equal(staged.summary, 'Replaces ListPage in the page OrdersPage with the library component Button.');
    assert.match(staged.files[0].content, /<Button title="Orders"/);
    assert.match(staged.files[0].content, /^import \{ Button \} from '\.\.\/\.\.\/\.\.\/library\/components\/Button';$/m);
    assert.throws(() => ops.planBindPart(root, { file: ORDERS, partId: part.id, libraryId: 'components/Nope' }), refused('UNKNOWN_ITEM'));
    assert.throws(() => ops.planBindPart(root, { file: ORDERS, partId: 'n42', libraryId: 'components/Button' }), refused('UNKNOWN_ITEM'));
    assert.throws(() => ops.planBindPart(root, { file: ORDERS, partId: part.id, libraryId: 'components/Button', contentHash: 'old' }), refused('STALE'));
  });

  test(`${kind}: a feature with no API contract says so in one sentence; its parts still show their library side`, () => {
    const { ops, root } = make();
    const b = ops.readPageBinding(root, INVOICES);
    assertLinePageBinding(b);
    assert.equal(b.contract.state, 'none');
    assert.equal(b.contract.sentence, 'billing has no API contract yet; add its openapi.json beside spec.md so Trace can bind this page\'s actions to endpoints.');
    assert.equal(b.parts.find((p) => p.tag === 'ListPage').base.libraryId, 'pages/ListPage');
    assert.deepEqual(b.findings, []);
  });
}

test('real: OrderButton (from another feature) is bound to the library Button; the change lands through the writer, validate adds no problem', () => {
  const root = copy();
  const b = readPageBinding(root, INVOICES);
  const ob = b.parts.find((p) => p.tag === 'OrderButton');
  assert.deepEqual([ob.base.kind, ob.base.libraryId], ['feature', 'components/Button']);
  assert.equal(ob.base.sentence, 'OrderButton from the feature orders, based on the library Button.');
  assert.throws(() => planBindPart(root, { file: INVOICES, partId: 'n0', libraryId: 'components/Button' }), refused('BAD_PART'), 'n0 is the page\'s fragment');
  const staged = planBindPart(root, { file: INVOICES, partId: ob.id, libraryId: 'components/Button', contentHash: b.contentHash });
  assert.equal(staged.summary, 'Replaces OrderButton in the page InvoicesPage with the library component Button.');
  const r = applyChange(root, staged);
  assert.equal(r.ok, true, r.sentence);
  const after = readPageBinding(root, INVOICES);
  assert.deepEqual(after.parts.find((p) => p.id === ob.id).base, { kind: 'library', libraryId: 'components/Button', from: 'library/components/Button.tsx', sentence: 'The library component Button (components/Button).' });
  assert.throws(() => planBindPart(root, { file: INVOICES, partId: ob.id, libraryId: 'components/Button' }), refused('ALREADY_BOUND'));
  const rules = validateLine(root).violations.filter((v) => v.file === INVOICES).map((v) => v.rule);
  assert.deepEqual(rules, ['LINE-DIR'], 'only the old cross-feature import is left (the page still imports OrderButton)');
});

test('real: the sample with its API contract passes validate --profile line with only the two planted findings', () => {
  const v = validateLine(copy()).violations;
  assert.deepEqual(v.map((x) => x.rule).sort(), ['LINE-BASE', 'LINE-DIR']);
});

/** A small Line project with one page Trace has much to say about: states, a known verb, a button with no handler. */
function statesProject() {
  const root = copy();
  fs.mkdirSync(path.join(root, 'features/contacts/pages'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'trace/examples/contacts/openapi.json'), path.join(root, 'features/contacts/openapi.json'));
  fs.writeFileSync(path.join(root, 'features/contacts/spec.md'), '# Contacts\n');
  fs.writeFileSync(path.join(root, 'features/contacts/pages/ContactsPage.tsx'), [
    '// @line-base pages/ListPage',
    "import { Button } from '../../../library/components/Button';",
    '',
    'export function ContactsPage({ loading, busy }: { loading: boolean; busy: boolean }) {',
    '  return (',
    '    <main>',
    '      <h1>Contacts</h1>',
    '      {loading && <p>Loading contacts...</p>}',
    '      <button disabled={busy} onClick={() => console.log(busy)}>Add</button>',
    '      <button>Archive</button>',
    '      <Button label="More" />',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n'));
  return root;
}

test('real: Trace\'s states and interactions land on the parts: a known verb calls its endpoint, a button with no handler can get a marked stub', () => {
  const root = statesProject();
  const file = 'features/contacts/pages/ContactsPage.tsx';
  const b = readPageBinding(root, file);
  assertLinePageBinding(b);
  assert.equal(b.contract.endpoints.length, 4);
  const p = b.parts.find((x) => x.tag === 'p');
  assert.deepEqual(p.states.map((s) => s.sentence), ['Loading state: shown only when loading.']);
  const add = b.parts.find((x) => x.tag === 'button' && x.line === 9);
  assert.deepEqual(add.states.map((s) => s.sentence), ['Disabled when busy.']);
  const byLabel = Object.fromEntries(b.interactions.map((i) => [i.label, i]));
  assert.deepEqual([byLabel.Add.resolution, byLabel.Add.endpoint], ['api', 'POST /api/contacts']);
  assert.deepEqual([byLabel.Archive.resolution, byLabel.Archive.handler], ['unresolved', 'none']);
  assert.equal(b.parts.find((x) => x.tag === 'Button').base.libraryId, 'components/Button');
  const fix = b.findings.find((f) => f.interactionId === byLabel.Archive.id).fixes.find((x) => x.id === 'stub');
  assert.equal(fix.sentence, 'Give "Archive" a marked stub to write later: (event) => {}.');
  const staged = planBindInteraction(root, fix.step.args);
  assert.equal(staged.summary, 'Gives "Archive" on button in the page ContactsPage a marked stub to write later (onClick).');
  assert.match(staged.files[0].content, /<button onClick=\{\(event\) => \{\}\}>Archive<\/button>/);
  assert.equal(applyChange(root, staged).ok, true);
  const after = readPageBinding(root, file);
  assert.equal(after.interactions.find((i) => i.label === 'Archive').resolution, 'stub');
  // The plain <h1> is bound to a library component: its tag changes and the import is added.
  const h1 = after.parts.find((x) => x.tag === 'h1');
  const card = planBindPart(root, { file, partId: h1.id, libraryId: 'components/Card' });
  assert.equal(card.summary, 'Replaces the <h1> element in the page ContactsPage with the library component Card.');
  assert.match(card.files[0].content, /<Card>Contacts<\/Card>/);
});

test('real: a part named like a library component but imported from elsewhere gets its import pointed at the library', () => {
  const root = copy();
  const file = 'features/orders/pages/OrdersPage.tsx';
  fs.writeFileSync(path.join(root, file), [
    '// @line-base pages/ListPage',
    "import { ListPage } from '../../../library/pages/ListPage';",
    "import { Button, Badge } from '@/subframe/components/Button';",
    '',
    'export function OrdersPage() {',
    '  return <ListPage title="Orders"><Button>Buy</Button><Badge /></ListPage>;',
    '}',
    '',
  ].join('\n'));
  const b = readPageBinding(root, file);
  const btn = b.parts.find((p) => p.tag === 'Button');
  assert.deepEqual([btn.base.kind, btn.base.from], ['outside', '@/subframe/components/Button']);
  assert.equal(btn.base.sentence, 'Button comes from @/subframe/components/Button, not from your library.');
  const staged = planBindPart(root, { file, partId: btn.id, libraryId: 'components/Button' });
  assert.equal(staged.summary, 'Points Button in the page OrdersPage at the library component Button, instead of @/subframe/components/Button.');
  assert.match(staged.files[0].content, /import \{ Badge \} from '@\/subframe\/components\/Button';\nimport \{ Button \} from '\.\.\/\.\.\/\.\.\/library\/components\/Button';/);
  const badge = b.parts.find((p) => p.tag === 'Badge').id;
  assert.throws(() => planBindPart(root, { file, partId: badge, libraryId: 'components/Button' }), refused('NAME_TAKEN'), 'Button is taken on this page by the outside one');
  assert.match(planBindPart(root, { file, partId: badge, libraryId: 'components/Card' }).files[0].content, /<Card \/>/);
});

test('no single point of failure: with Trace down the page keeps its library side and says why; binding an action is refused', () => {
  const root = copy();
  const down = { ok: false, sentence: 'Trace\'s page map could not be loaded, so only the library side of this page is shown.' };
  const b = readPageBinding(root, ORDERS, { trace: down });
  assertLinePageBinding(b);
  assert.deepEqual([b.via, b.note], ['static', down.sentence]);
  assert.equal(b.parts[0].base.libraryId, 'pages/ListPage');
  assert.deepEqual([b.interactions, b.findings], [[], []]);
  assert.equal(b.contract.sentence, 'Trace is not available, so the API contract was not read.');
  assert.throws(() => planBindInteraction(root, { file: ORDERS, interactionId: 'n0:onMore', to: 'stub' }, { trace: down }), refused('NO_TRACE'));
});

test('Trace is reused through its package entry: line-matcher/pagemap, else the same "exports" entry of the in-repo package', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(TRACE_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'line-matcher');
  assert.equal(pkg.exports['./pagemap'], './src/pagemap/index.mjs');
  assert.equal(exportedFile(TRACE_DIR, './pagemap'), path.join(TRACE_DIR, 'src/pagemap/index.mjs'));
  const loaded = await loadTracePagemap();
  assert.equal(loaded.ok, true);
  for (const name of ['buildInventory', 'classify', 'collapse', 'resolveInteractions', 'resolveAction', 'contractMatcher', 'specOfFolder', 'interactionCoverage']) assert.equal(typeof loaded.pagemap[name], 'function', name);
  const viaRepo = await loadTracePagemap({ importer: (s) => (s.startsWith('line-matcher') ? Promise.reject(new Error('not linked')) : import(s)) });
  assert.equal(viaRepo.ok && viaRepo.via, 'repo');
  const none = await loadTracePagemap({ importer: () => Promise.reject(new Error('no')), dir: makeTempDir('no-trace-') });
  assert.deepEqual(none, { ok: false, sentence: 'Trace\'s page map is not installed here, so only the library side of this page is shown.' });
  assert.equal(pathToFileURL(exportedFile(TRACE_DIR, './pagemap')).protocol, 'file:');
});

test('plan tools: line.bindPart and line.bindInteraction are in the contract, the one registry, the controls; a step runs with its checks', async () => {
  for (const n of ['line.bindPart', 'line.bindInteraction']) {
    assert.ok(LINE_PLAN_TOOLS.some((t) => t.name === n && t.kind === 'write'), n);
    assert.deepEqual([entryById(n)?.kind, entryById(n)?.writes, entryById(n)?.surfaces.plan], ['write', 'project', true]);
    assert.ok(LINE_CONTROLS.some((c) => c.toolId === n && c.screen === 'pages'), n);
    assert.deepEqual(TOOL_PATHS[n].at(-1), 'plan.approve');
  }
  assert.equal(entryById('line.pageBinding')?.kind, 'read');
  assert.ok(LINE_API.some((r) => r.path === '/api/line/page-binding' && r.method === 'GET'));
  const root = copy();
  const reg = createLinePlanRegistry({ root });
  const b = readPageBinding(root, ORDERS);
  const made = await reg.call('line.bindInteraction', b.findings[0].fixes[0].step.args);
  assertLineStepResult(made);
  assert.equal(made.apply.ok, true, made.apply.sentence);
  assert.match(fs.readFileSync(path.join(root, ORDERS), 'utf8'), /data-action="reload"/);
  await assert.rejects(reg.call('line.bindPart', { file: ORDERS, partId: 'n0' }), /libraryId/);
});

test('only a person approves: an agent\'s bind becomes a waiting plan step, nothing is written, the agent cannot approve it', async () => {
  const root = copy();
  const planService = createLinePlanService({ root, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: NO_LINK }) });
  const registry = createToolRegistry({ root, planService, handlers: lineHandlers(root, await realLineOps()) });
  const read = await registry.dispatch('line.pageBinding', { file: ORDERS }, { by: 'agent' });
  assert.equal(read.via, 'direct');
  const fix = /** @type {any} */ (read).result.findings[0].fixes[0];
  const before = fs.readFileSync(path.join(root, ORDERS), 'utf8');
  const r = await registry.dispatch(fix.step.tool, fix.step.args, { by: 'agent' });
  assert.equal(r.via, 'plan');
  assert.match(r.sentence, /^Waiting for your approval: Binds "More" on ListPage in the page OrdersPage to GET \/api\/orders/);
  assert.equal(fs.readFileSync(path.join(root, ORDERS), 'utf8'), before, 'nothing written before approval');
  const approve = await registry.dispatch('plan.approve', { stepId: r.stepId }, { by: 'agent' });
  assert.deepEqual([approve.ok, /** @type {any} */ (approve).code], [false, 'PERSON_ONLY']);
  assert.equal(fs.readFileSync(path.join(root, ORDERS), 'utf8'), before);
});
