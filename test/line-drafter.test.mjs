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
import { factsSummary } from '../packages/engine/line/drafter/facts.mjs';
import { buildDomainMap, normalize, FUNCTION_WORDS, splitWords } from '../packages/engine/line/drafter/domainMap.mjs';
import { structureOf, hashesOf } from '../packages/engine/line/drafter/structure.mjs';
import { verifyRoutes } from '../packages/engine/line/drafter/verify.mjs';
import { LEXICON, assertLexicon, suggestFromLexicon } from '../packages/engine/line/drafter/lexicon.mjs';
import { generateGrammar, GRAMMAR_FILES } from '../packages/engine/line/drafter/grammar.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const CATALOG = buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));
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
