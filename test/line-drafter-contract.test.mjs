// System 1 drafter contract (packages/engine/line/drafter/contract.mjs) and its mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_PLAN_TOOLS } from '../packages/engine/line/contract.mjs';
import { buildIntentCatalog, assertDraft, assertLabels, assertExpr, assertNoIdentifiers, TEMPLATES, VERBS, OBJECTS } from '../packages/engine/line/drafter/contract.mjs';
import { createMockDrafter } from '../packages/engine/line/drafter/mock.mjs';

const TOOLS = LINE_PLAN_TOOLS.map((t) => t.name);

test('drafter contract: the intent catalog is every verb x object, generated from the registry tools, with stable ids', () => {
  const cat = buildIntentCatalog(TOOLS);
  assert.equal(cat.length, VERBS.length * Object.keys(OBJECTS).length);
  const byId = new Map(cat.map((e) => [e.id, e]));
  assert.deepEqual(byId.get('update.feature-flow').templates, ['set-prop', 'set-fragment']);
  assert.deepEqual(byId.get('update.feature-flow').layers, ['ui', 'workflow', 'api', 'library']);
  assert.deepEqual(byId.get('add.component').templates, ['base-on', 'via-library']);
  assert.deepEqual(byId.get('fix.problem').tools, ['line.fix']);
  assert.deepEqual(byId.get('split.service').templates, [], 'a known operation without a static route yet');
  // A template whose tool is not in the registry never appears.
  const noPromote = buildIntentCatalog(TOOLS.filter((t) => t !== 'line.promote'));
  assert.deepEqual(noPromote.find((e) => e.id === 'add.component').templates, ['base-on']);
  for (const t of Object.values(TEMPLATES)) for (const id of t.intents) assert.ok(byId.has(id), `${id} is a catalog id`);
});

test('drafter contract: the mock draft passes the shape check; bad labels, routes and expressions are refused', () => {
  const d = createMockDrafter().draft('add a badge to orders');
  const cat = buildIntentCatalog(TOOLS);
  assertDraft(d, cat);
  assert.equal(d.recommended, 'base-on:ui:L1>F1');
  assert.throws(() => assertLabels({ ...d.labels, intent: { id: 'make.coffee', confidence: 1 } }, cat), /catalog id/);
  assert.throws(() => assertLabels({ ...d.labels, layers: [{ layer: 'database', confidence: 1 }] }, cat), /layers/);
  assert.throws(() => assertDraft({ ...d, routes: [d.routes[0], d.routes[0]] }, cat), /unique/);
  assert.throws(() => assertDraft({ ...d, recommended: 'nope' }, cat), /route id/);
  assert.throws(() => assertDraft({ ...d, routes: [{ ...d.routes[1], refusal: null }] }, cat), /says why/);
  assert.throws(() => assertExpr({ fileExists: 'a', hasLibrary: 'b' }), /exactly one operator/);
  assert.throws(() => assertExpr({ and: [{ teleport: 1 }] }), /"teleport" is not an operator/);
  assert.throws(() => assertExpr({ basedOn: ['only one'] }), /"basedOn" takes two texts/);
});

test('drafter contract: a stored record may hold slots but never a project name', () => {
  const d = createMockDrafter().draft('add a badge to orders');
  const { bindings, ...stored } = d;
  assertNoIdentifiers(stored, ['orders', 'Badge', 'OrdersBadge']);
  assert.throws(() => assertNoIdentifiers(d, ['orders', 'Badge', 'OrdersBadge']), /project name "orders"/);
  assert.ok(bindings);
});

test('slots: plan records, drafter transitions and Train Line cases share one word splitter and one leak guard', async () => {
  const { splitWords, projectWordIn } = await import('../packages/engine/line/slots.mjs');
  const drafter = await import('../packages/engine/line/drafter/domainMap.mjs');
  const train = await import('../packages/engine/line/train/slots.mjs');
  assert.equal(drafter.splitWords, splitWords);
  assert.equal(train.splitWords, splitWords);
  assert.deepEqual(splitWords('OrderButton'), ['order', 'button']);
  assert.equal(projectWordIn({ request: 'add a <library:L1> to <feature:F1>' }, ['orders', 'Badge']), null);
  assert.equal(projectWordIn('{"text":"All Orders"}', ['orders']), 'orders');
  assert.equal(projectWordIn('{"text":"reorders"}', ['orders']), null, 'whole words only');
});
