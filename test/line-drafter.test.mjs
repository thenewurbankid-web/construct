// System 1 drafter (packages/engine/line/drafter): domain map, classifier, routes, Construct verification, structure
// hashes, records and the constrained-output grammar, on copies of examples/line-sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { applyChange, planBaseOn } from '../packages/engine/line/ops.mjs';
import { buildIntentCatalog, assertDraft, assertNoIdentifiers, OBJECTS } from '../packages/engine/line/drafter/contract.mjs';
import { draft, boundRoute, toRecord, appendRecord, readRecords, addSynonym } from '../packages/engine/line/drafter/index.mjs';
import { factsSummary } from '../packages/engine/line/facts.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';
import { buildDomainMap, normalize, FUNCTION_WORDS, splitWords } from '../packages/engine/line/drafter/domainMap.mjs';
import { structureGraph, readerOf, hashesOf } from '../packages/engine/line/structure.mjs';
import { verifyRoutes } from '../packages/engine/line/drafter/verify.mjs';
import { precedentsFromTraining } from '../packages/engine/line/drafter/retrieval.mjs';
import { createPlanDrafter } from '../packages/engine/line/drafter/planDraft.mjs';
import { LEXICON, assertLexicon, suggestFromLexicon } from '../packages/engine/line/drafter/lexicon.mjs';
import { generateGrammar, GRAMMAR_FILES } from '../packages/engine/line/drafter/grammar.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const CATALOG = buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));
/** The structure graph of a project on disk. */
const structureOf = (root) => structureGraph(readLineProject(root), readerOf(root));
const copy = () => { const d = makeTempDir('line-drafter-'); fs.cpSync(SAMPLE, d, { recursive: true }); return d; };
/** Every name the project's facts hold (features, items, library items, props), and their words. */
const projectNames = (root) => {
  const s = factsSummary(root);
  const names = [...s.features.map((f) => f.name), ...s.features.flatMap((f) => f.items.map((i) => i.name)), ...s.library.map((l) => l.name), ...s.pages.flatMap((p) => p.parts.flatMap((x) => x.props.map((pr) => pr.name)))];
  return [...new Set([...names, ...names.flatMap(splitWords)])].filter((w) => !FUNCTION_WORDS.has(w));
};

test('structure hash: renaming a feature, an item and a library item changes nothing; adding a page changes the feature and project', () => {
  const a = copy();
  const before = hashesOf(structureOf(a), 'billing');
  const b = copy();
  fs.renameSync(path.join(b, 'features/billing'), path.join(b, 'features/invoicing'));
  fs.renameSync(path.join(b, 'library/fixtures/user.json'), path.join(b, 'library/fixtures/account.json'));
  const card = path.join(b, 'features/orders/components/OrderCard.tsx');
  fs.writeFileSync(path.join(b, 'features/orders/components/ShopCard.tsx'), fs.readFileSync(card, 'utf8').replace(/OrderCard/g, 'ShopCard'));
  fs.rmSync(card);
  assert.deepEqual(hashesOf(structureOf(b), 'invoicing'), before, 'a rename is invisible to the hash');
  const r = applyChange(a, planBaseOn(a, { libraryId: 'pages/ListPage', feature: 'billing', name: 'ReceiptsPage' }));
  assert.equal(r.ok, true, r.sentence);
  const after = hashesOf(structureOf(a), 'billing');
  assert.notEqual(after.feature, before.feature);
  assert.notEqual(after.project, before.project);
  assert.notEqual(after.layers.ui, before.layers.ui);
  assert.equal(after.layers.workflow, before.layers.workflow, 'only the ui layer of billing changed');
});

test('domain map: the same request normalizes identically in training and in use; a renamed feature keeps the model input', () => {
  const a = copy();
  const m1 = buildDomainMap(a, factsSummary(a));
  const m2 = buildDomainMap(a, factsSummary(a));
  const req = 'Add a badge to the billing feature';
  assert.deepEqual(normalize(req, m1), normalize(req, m2));
  const b = copy();
  fs.renameSync(path.join(b, 'features/billing'), path.join(b, 'features/invoicing'));
  const nb = normalize('Add a badge to the invoicing feature', buildDomainMap(b, factsSummary(b)));
  const na = normalize(req, m1);
  assert.equal(nb.text, na.text);
  assert.equal(na.text, 'add a <library:L1> to the <feature:F1> feature');
  assert.equal(na.bindings.F1, 'billing');
  assert.equal(nb.bindings.F1, 'invoicing');
  const da = draft(a, req, { verify: false }); const db = draft(b, 'Add a badge to the invoicing feature', { verify: false });
  assert.deepEqual(db.slots, da.slots, 'slot shapes are structure only');
  assert.deepEqual(db.labels, da.labels);
});

test('domain map: no domain word reaches the classifier; NEW names, values and code become slots', () => {
  const a = copy();
  const map = buildDomainMap(a, factsSummary(a));
  for (const req of ['Set the title of the invoices page to "All bills"', 'add a refund page to orders', 'promote OrderButton to the library', 'when more orders are asked for on the orders page run `() => load()`', 'use OrderButton in billing', 'create a feature called returns', 'make the ordrs page nicer with zebra stripes']) {
    const n = normalize(req, map);
    for (const t of n.tokens.filter((x) => !x.slot)) assert.ok(FUNCTION_WORDS.has(t.t), `"${t.t}" in "${req}" is a function word`);
  }
  const n = normalize('add a refund page to orders', map);
  assert.equal(n.text, 'add a <new:N1> page to <feature:F1>');
  assert.equal(n.bindings.N1, 'RefundPage');
  assert.equal(n.fully, true);
});

test('domain map: an unknown word asks one closed question; the answer is stored as a synonym in the project and used next time', () => {
  const a = copy();
  const s = factsSummary(a);
  const n = normalize('put a badge on the ordrs screen', buildDomainMap(a, s));
  assert.equal(n.fully, false);
  assert.equal(n.questions[0].sentence, 'Did you mean the orders feature by "ordrs"?');
  assert.equal(n.questions[0].via, 'map');
  assert.ok(n.questions[0].choices.some((c) => c.key === 'feature:orders'));
  const shop = normalize('put a badge on the shop screen', buildDomainMap(a, s));
  assert.equal(shop.questions[0].suggested, null);
  assert.equal(shop.questions[0].via, 'ask');
  const viaModel = normalize('put a badge on the shop screen', buildDomainMap(a, s), { propose: () => 'feature:orders' });
  assert.equal(viaModel.questions[0].via, 'model');
  addSynonym(a, s, 'shop', 'feature:orders');
  assert.ok(fs.existsSync(path.join(a, 'line/domain-map.json')));
  const again = normalize('put a badge on the shop screen', buildDomainMap(a, factsSummary(a)));
  assert.equal(again.fully, true);
  assert.equal(again.bindings.F1, 'orders');
});

test('shared lexicon: ~150 curated words, closed roles; it only suggests (basket -> the project\'s cart)', () => {
  assertLexicon(LEXICON, Object.keys(OBJECTS));
  assert.ok(LEXICON.entries.length >= 140, `${LEXICON.entries.length} entries`);
  const map = { entries: [{ key: 'feature:cart', type: 'feature', value: { name: 'cart' }, forms: ['cart', 'carts'] }], weak: {}, synonyms: {} };
  assert.equal(suggestFromLexicon('basket', /** @type {any} */ (map)), 'feature:cart');
  assert.equal(suggestFromLexicon('zebra', /** @type {any} */ (map)), null);
});

test('draft: "add a badge to orders" gives a verified route, its steps bound to the project and its predicted hash met', () => {
  const a = copy();
  const d = draft(a, 'Add a badge to the orders feature');
  assertDraft(d, CATALOG);
  assert.equal(d.labels.intent.id, 'add.component');
  assert.equal(d.recommended, 'base-on:ui:L1>F1');
  const r = d.routes[0];
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.predicted, r.actual);
  assert.deepEqual(boundRoute(d, r.id).steps, [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'OrdersBadge' } }]);
  assert.equal(boundRoute(d, r.id).label, 'Add a new component OrdersBadge to orders, based on the library Badge.');
  assert.equal(fs.existsSync(path.join(a, 'features/orders/components/OrdersBadge.tsx')), false, 'drafting never writes the project');
});

test('draft: all routes of "use OrderButton in billing" (via the library, or a new item on the same base); the Line way first', () => {
  const d = draft(copy(), 'use OrderButton in billing');
  assertDraft(d, CATALOG);
  assert.deepEqual(d.routes.map((r) => [r.id, r.status]), [['via-library:ui:C1>F1', 'ok'], ['base-on:ui:L1>F1', 'ok']]);
  assert.equal(d.recommended, 'via-library:ui:C1>F1');
});

test('draft: "update checkout flow" lists the ui, workflow and combined routes (each needs code from a model) and drops api', () => {
  const d = draft(copy(), 'update checkout flow');
  assertDraft(d, CATALOG);
  assert.equal(d.labels.intent.id, 'update.feature-flow');
  assert.ok(d.routes.some((r) => r.scope.layers.includes('workflow')));
  assert.ok(d.routes.some((r) => r.template === 'combo'));
  assert.ok(d.routes.every((r) => r.status === 'needs-model'));
  assert.equal(d.defer.to, 'qwen');
  assert.ok(d.dropped.some((x) => x.id === 'layer:api'));
});

test('draft: a refused route keeps Construct\'s sentence; an unknown request defers to a question', () => {
  const d = draft(copy(), 'create a feature called returns');
  assert.equal(d.routes[0].status, 'refused');
  assert.equal(d.routes[0].refusal.sentence, 'Nothing was saved: there is no feature "returns"; pick an existing feature or create its folder under features/ first.');
  const u = draft(copy(), 'hello there');
  assert.equal(u.labels.inCatalog, false);
  assert.equal(u.defer.to, 'ask');
  assert.equal(u.routes.length, 0);
});

test('verify: a route whose structural delta does not match what Construct wrote is marked wrong-shape (a recorded miss)', () => {
  const a = copy();
  const d = draft(a, 'Add a badge to the orders feature', { verify: false });
  const r = d.routes.find((x) => x.id === 'base-on:ui:L1>F1');
  const bad = { ...r, delta: r.delta.filter((o) => o.op !== 'add-edge') };
  const [v] = verifyRoutes(a, [bad], d.bindings);
  assert.equal(v.status, 'wrong-shape');
  assert.notEqual(v.predicted.feature, v.actual.feature);
});

test('records: a stored transition holds slots, deltas and hashes but no name from the project; retrieval finds it again', () => {
  const a = copy();
  const s = factsSummary(a);
  const d = draft(a, 'Add a badge to the orders feature');
  const rec = toRecord(d, d.recommended, true);
  assertNoIdentifiers(rec, projectNames(a));
  assert.equal(rec.to.feature, d.routes[0].actual.feature);
  appendRecord(a, s, rec);
  assert.deepEqual(readRecords(a, s), [rec]);
  const again = draft(a, 'Please add a badge to orders');
  assert.equal(again.routes.find((r) => r.id === 'base-on:ui:L1>F1').retrieved, true);
});

test('System 1 accuracy: everyday verbs and phrases from the shared lexicon (needs, clear, titled, has no base; fix it)', () => {
  const needs = draft(copy(), 'orders needs a Badge');
  assert.equal(needs.labels.intent.id, 'add.component');
  assert.deepEqual(boundRoute(needs, needs.recommended).steps[0].args, { libraryId: 'components/Badge', feature: 'orders', name: 'OrdersBadge' });
  const clear = draft(copy(), 'Clear the reported problem on InvoicesPage.');
  assert.equal(clear.labels.intent.id, 'fix.problem');
  assert.equal(clear.questions.length, 0, '"reported" is everyday English, not a project word');
  const titled = draft(copy(), 'OrdersPage should be titled "Open orders".');
  assertDraft(titled, CATALOG);
  assert.equal(titled.labels.intent.id, 'update.prop');
  assert.deepEqual(boundRoute(titled, titled.recommended).steps[0].args, { file: 'features/orders/pages/OrdersPage.tsx', nodeId: 'n0', prop: 'title', kind: 'string', value: 'Open orders' });
  const noBase = draft(copy(), 'InvoiceCard has no base; fix it.');
  assert.equal(noBase.labels.intent.id, 'fix.problem');
  // The everyday lexicon is curated and static: well formed, never a project word.
  assertLexicon(LEXICON, Object.keys(OBJECTS));
  assert.ok(LEXICON.everyday.grammar.includes('titled') && LEXICON.everyday.verbs.add.includes('needs'));
});

test('System 1 accuracy: no name given -> one closed question (the made-up name is the suggested answer); no library item -> which one', () => {
  const d = draft(copy(), 'Add a badge to the orders feature');
  assertDraft(d, CATALOG);
  assert.equal(d.defer.to, 'ask');
  assert.equal(d.defer.about, 'name');
  assert.equal(d.defer.sentence, 'What should the new Badge in orders be called? Line suggests OrdersBadge.');
  assert.deepEqual(d.defer.choices, [d.recommended], 'the checked route with the suggested name is the one-click answer');
  const named = draft(copy(), 'Make StatusBadge in orders, based on Badge.');
  assert.equal(named.defer.to, null, 'a name given: nothing to ask');
  const part = draft(copy(), 'Add a part to billing.');
  assert.equal(part.defer.to, 'ask');
  assert.equal(part.defer.about, 'library');
  assert.equal(part.defer.sentence, 'Which library item should the new component of billing be based on?');
  assert.ok(part.defer.choices.length >= 2);
});

test('System 1 accuracy: refuse vs ask -- an unknown target nothing resolves is drafted as asked and refused by Construct; a near miss asks', () => {
  const feature = draft(copy(), 'Make StatusBadge in archive, based on Badge.');
  assertDraft(feature, CATALOG);
  assert.equal(feature.recommended, null);
  assert.equal(feature.routes[0].status, 'refused');
  assert.equal(feature.routes[0].refusal.code, 'UNKNOWN_FEATURE');
  assert.equal(feature.defer.to, null);
  assert.match(feature.defer.sentence, /^Construct refuses this as asked: .*archive/);
  const item = draft(copy(), 'Make StatusTooltip in orders, based on Tooltip.');
  assert.equal(item.recommended, null);
  assert.equal(item.routes[0].refusal.code, 'UNKNOWN_ITEM');
  assert.deepEqual(boundRoute(item, item.routes[0].id).steps[0].args, { libraryId: 'components/Tooltip', feature: 'orders', name: 'StatusTooltip' });
  const taken = draft(copy(), 'Make another OrderButton in orders, based on Button.');
  assert.equal(taken.routes[0].refusal.code, 'NAME_TAKEN');
  const typo = draft(copy(), 'put a badge on the ordrs screen');
  assert.equal(typo.defer.to, 'ask');
  assert.match(typo.defer.sentence, /^Did you mean/);
  assert.ok(typo.routes.every((r) => r.status !== 'refused'), 'a near miss is a question, never a refusal');
});

test('System 1 accuracy: handler templates write the common shapes (log); anything else needs code and is never faked', () => {
  const log = draft(copy(), 'On OrdersPage, the show-more action should log "More orders".');
  assertDraft(log, CATALOG);
  assert.equal(log.labels.intent.id, 'update.handler');
  const r = log.routes.find((x) => x.id === log.recommended);
  assert.equal(r.status, 'ok');
  assert.deepEqual(boundRoute(log, r.id).steps[0].args.code, '() => console.log("More orders")');
  const other = draft(copy(), 'When OrdersPage asks for more, email the boss.');
  assert.ok(other.routes.every((x) => x.status === 'needs-model' || x.template !== 'set-fragment' || x.invented.length), 'no made-up handler code');
  assert.ok(!other.routes.some((x) => x.status === 'ok' && x.template === 'set-fragment'));
});

test('System 1 accuracy: a strong precedent (same slots, nearly the same words) supplies the intent and its routes, preferred first', () => {
  const a = copy();
  const rec = {
    v: 1, request: 'let <feature:F1> show <component:C1> which lives in <feature:F2>', slots: { C1: { kind: 'component' } }, intent: 'promote.component', from: null,
    routeId: 'p1', template: 'promote', steps: [{ tool: 'line.promote', args: { featureItemId: '<C1>' } }], expect: [{ noNewFindings: true }], delta: [], to: null, approved: true, group: 'g1', preferred: true, unpredicted: true,
  };
  const d = draft(a, 'Let billing show OrderButton, which lives in orders.', { records: [rec] });
  assertDraft(d, CATALOG);
  assert.equal(d.labels.intent.id, 'promote.component');
  assert.deepEqual(boundRoute(d, d.recommended).steps, [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }]);
  const none = draft(a, 'Let billing show OrderButton, which lives in orders.', { records: [{ ...rec, approved: false }] });
  assert.notEqual(none.labels.intent.id === 'promote.component' && none.routes[0]?.retrieved, true, 'an unapproved record is never a precedent');
});

test('grammar: the committed JSON Schema and GBNF are current, and every drafted route validates against the schema', async () => {
  const g = await generateGrammar();
  assert.equal(fs.readFileSync(GRAMMAR_FILES.schema, 'utf8'), g.schema, 'run node packages/engine/line/drafter/grammar.mjs --write');
  assert.equal(fs.readFileSync(GRAMMAR_FILES.gbnf, 'utf8'), g.gbnf);
  const schema = JSON.parse(g.schema);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const a = copy();
  let n = 0;
  for (const req of ['Add a badge to the orders feature', 'Set the title of the invoices page to "All bills"', 'promote OrderButton to the library', 'fix all problems', 'use OrderButton in billing', 'update checkout flow', 'add a refund page to orders', 'when more orders are asked for on the orders page run `() => load()`', 'create a feature called returns', 'base InvoiceCard on the library Card']) {
    for (const r of draft(a, req, { verify: false }).routes) {
      n++;
      assert.ok(validate({ intent: r.intent, steps: r.steps, expect: r.expect }), `${req} / ${r.id}: ${JSON.stringify(validate.errors?.slice(0, 2))}`);
    }
  }
  assert.ok(n >= 15, `${n} routes checked`);
  assert.equal(validate({ intent: 'add.component', steps: [{ tool: 'line.deleteEverything', args: {} }], expect: [{ noNewFindings: true }] }), false, 'only real tools');
  assert.equal(validate({ intent: 'add.component', steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'X' } }], expect: [{ noNewFindings: true }] }), false, 'names are slots, never the project\'s words');
  for (const t of LINE_PLAN_TOOLS.filter((x) => x.kind === 'write' && x.name !== 'line.leaveAsIs')) assert.ok(g.gbnf.includes(`"\\"${t.name}\\""`), t.name);
});

// Owner decision (2026-10-11): Train Line's verified, undisputed, slotted precedents may rank routes on a real project.
test('Train precedents on a real project: the Cockpit drafter ranks by one, every route stays checked, and no domain word crosses over', async () => {
  const precedents = precedentsFromTraining();
  assert.ok(precedents.length > 100, `the committed index feeds the drafter (${precedents.length} records)`);
  const dir = copy();
  const request = 'Let billing show OrderButton, which lives in orders.';
  const without = draft(dir, request, { records: [], precedents: [] });
  assert.equal(without.recommended, null, 'no rule reads this wording');
  // The Cockpit drafter (planDraft.mjs) passes the precedents by default.
  const steps = [];
  const drafter = createPlanDrafter({ root: dir, enabled: true, record: false, plan: { addStep: async (s) => { steps.push(s); return { ok: true, stepId: `s${steps.length}` }; }, view: async () => ({}) } });
  const v = await drafter.draft(request);
  assert.equal(v.intent.id, 'promote.component', 'a precedent says what kind of change this is');
  assert.ok(v.routes.some((r) => r.via === 'retrieval'), 'the precedent\'s own route is offered too');
  const rec = v.routes.find((r) => r.id === v.recommended);
  assert.deepEqual(rec.steps, [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }]);
  assert.equal(rec.status, 'ok', 'Construct checked it on a copy');
  assert.equal((await drafter.addRoute(request, rec.id, 'ui')).added.length, 1, 'it joins the plan as a step a person approves');
  // No word of an imaginary world: every name a route binds is this project's, and the precedents hold slots only.
  const s = factsSummary(dir, readLineProject(dir));
  const names = new Set(JSON.stringify(s).match(/[A-Za-z][\w-]*/g));
  for (const r of v.routes) for (const st of r.steps) for (const val of Object.values(st.args)) for (const w of String(val).match(/[A-Za-z][\w-]*/g) ?? []) assert.ok(names.has(w), `${w} in ${r.id} comes from the project`);
  const ids = [...s.features.map((f) => f.name), ...s.features.flatMap((f) => f.items.map((i) => i.name)), ...s.library.map((l) => l.name)];
  for (const p of precedents) assertNoIdentifiers(p, ids);
});

test('Train precedents: a disputed case, an unapproved record or a word in a step never feeds a real project', () => {
  const dir = makeTempDir('line-drafter-index-');
  const rec = (extra) => ({ v: 1, request: 'promote <component:C1>', intent: 'promote.component', from: null, routeId: 'train:x:a', template: 'promote', to: null, approved: true, group: 'x', preferred: true, outcome: 'change', source: 'train', agreed: false, slots: { C1: { kind: 'component' } }, steps: [{ tool: 'line.promote', args: { featureItemId: '<C1>' } }], expect: [], delta: [], ...extra });
  const file = path.join(dir, 'retrieval-index.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, cases: {
    'tc-ok:draft': [rec({})],
    'tc-disputed:disputed': [rec({ routeId: 'train:d:a' })],
    'tc-word:draft': [rec({ routeId: 'train:w:a', steps: [{ tool: 'line.promote', args: { featureItemId: 'parts/components/Gear' } }] })],
    'tc-unapproved:draft': [rec({ routeId: 'train:u:a', approved: false })],
  } }));
  assert.deepEqual(precedentsFromTraining(file).map((r) => r.routeId), ['train:x:a']);
  assert.deepEqual(precedentsFromTraining(path.join(dir, 'missing.json')), [], 'no index: no precedents, the drafter works as before');
});
