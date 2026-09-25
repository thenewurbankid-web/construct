import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirement } from '../../../../../packages/core/requirement-card.mjs';
import { placeCard, planFromBlocks } from '../../../../../packages/core/placement.mjs';
import { EXAMPLES, withAnswer } from './Examples.ts';
import { buildRequirementView } from './RequirementView.ts';
import { initialScreen } from '../workflows/RequirementMachine.ts';

// #651: the screen-shape offer. The placements are the REAL ones, from the core blocks, so the view is proven against what
// the server sends.
const PRODUCTS = 'A user wants to see a list of products';
const BILLING = EXAMPLES[0].text;
const shapeResult = (answers) => {
  const card = parseRequirement(PRODUCTS).card;
  const placement = placeCard(card, { framework: 'react-spa', answers });
  const planned = planFromBlocks(placement.blocks, { feature: 'products', root: '/x', decisions: placement.decisions });
  return { card, placement, plan: planned.plan, files: planned.files, open: placement.open, offers: placement.offers, warnings: [], summary: { readBack: [], blocks: [] } };
};
const shapeView = (result, extra = {}) => buildRequirementView({ ...initialScreen, text: PRODUCTS, read: { status: 'ready', result, error: null }, ...extra });

test('the offer view: unanswered, list is marked suggested, nothing is chosen and the plan stays the plain scaffold', () => {
  const v = shapeView(shapeResult());
  assert.equal(v.result.offers.length, 1);
  const [offer] = v.result.offers;
  assert.deepEqual([offer.id, offer.source], ['q-shape', 'placement']);
  assert.deepEqual(offer.options.map((o) => [o.id, o.label, o.suggested, o.chosen]), [['list', 'List screen, generated with typed code', true, false], ['scaffold', 'Empty scaffold', false, false]]);
  assert.match(offer.options[0].gives, /real files that validate/);
  assert.match(offer.options[1].gives, /empty stubs/);
  assert.equal(offer.decidedBy, null);
  assert.match(offer.status, /^Not chosen yet, so the plan below is the empty scaffold\. Suggested by rules: list screen/);
  assert.deepEqual([offer.suggestion.label, offer.suggestion.option], ['suggested by rules', 'list'], 'an older server: the offer carries the rules suggestion itself');
  assert.deepEqual(v.result.timeline.map((s) => s.kind), ['page-load', 'presentation'], 'the plain scaffold: no server read yet');
  assert.equal(v.result.files.length, 2);
});

test('the offer never blocks Approve: an unanswered offer approves the plain plan the screen shows', () => {
  const v = shapeView(shapeResult());
  assert.equal(v.result.open.length, 0, 'the offer is not an open question');
  assert.equal(v.result.approve.canApprove, true);
  assert.equal(v.result.approve.hint, null);
});

test('choosing list: the view names the chooser (person), the plan has 9 steps (the feature, six units, the proof and its run, #623) and the typed files; scaffold gives fewer', () => {
  const chosen = shapeResult({ 'q-shape': 'list' });
  const list = shapeView(chosen);
  const [offer] = list.result.offers;
  assert.deepEqual(offer.options.map((o) => o.chosen), [true, false]);
  assert.equal(offer.decidedBy, 'person');
  assert.equal(offer.status, 'Chosen: List screen, generated with typed code. Decided by: person.');
  assert.deepEqual(list.result.timeline.map((s) => s.kind), ['page-load', 'server-read', 'presentation'], 'the list shape reads on the server, then shows');
  assert.equal(list.result.files.length, 11, 'the ten files of the shape and the local store the rules default (#621) writes');
  assert.ok(list.result.files.includes('features/products/services/Products.service.ts'));
  assert.equal(chosen.plan.steps.length, 11);
  assert.ok(chosen.plan.steps.slice(1, 7).every((s) => s.args.shape === 'list'));
  const scaffold = shapeView(shapeResult({ 'q-shape': 'scaffold' }));
  assert.equal(scaffold.result.offers[0].decidedBy, 'person');
  assert.deepEqual(scaffold.result.offers[0].options.map((o) => o.chosen), [false, true]);
  assert.ok(scaffold.result.files.length < list.result.files.length);
  assert.equal(list.result.approve.canApprove, true);
});

test('a sentence with no offer, or a server that sends none, has no card', () => {
  const billing = parseRequirement(BILLING).card;
  const placement = placeCard(billing);
  assert.deepEqual(placement.offers, []);
  const result = { card: billing, placement, plan: null, files: {}, open: [], offers: placement.offers, warnings: [], summary: { readBack: [], blocks: [] } };
  assert.deepEqual(shapeView(result).result.offers, []);
  const { offers, ...older } = result;
  assert.deepEqual(shapeView(older).result.offers, [], 'a response without `offers` is read as none');
});

// #621: the data source (q-source) rides in `offers` beside q-shape (the server puts it there once the plan is built) and is drawn as a card of its own.
const sourceResult = (answers, plan = {}) => {
  const card = parseRequirement(PRODUCTS).card;
  const placement = placeCard(card, { framework: 'react-spa', answers: { 'q-shape': 'list' } });
  const planned = planFromBlocks(placement.blocks, { feature: 'products', root: '/x', decisions: placement.decisions, answers, ...plan });
  const offers = [...placement.offers, ...planned.offers.filter((q) => q.id === 'q-source').map((q) => ({ ...q, source: 'plan' }))];
  return { card, placement: { ...placement, decisions: planned.decisions }, plan: planned.plan, files: planned.files, open: [], offers, warnings: [], summary: { readBack: [], blocks: [] } };
};

test('the data source offer: its own card kind, the server words, the rules default marked suggested, nothing chosen, Approve stays on', () => {
  const v = shapeView(sourceResult({}));
  assert.deepEqual(v.result.offers.map((o) => [o.id, o.kind, o.source]), [['q-shape', 'shape', 'placement'], ['q-source', 'source', 'placement']], 'two cards, the shape first; the client draws the server\'s `plan` questions like its placement ones');
  const source = v.result.offers[1];
  assert.deepEqual(source.options.map((o) => [o.id, o.label, o.suggested, o.chosen]), [['local', 'Local data, no backend', true, false], ['endpoint', 'Call GET /api/products', false, false]]);
  assert.match(source.options[1].gives, /must exist in your app/);
  assert.equal(source.status, "Not chosen yet, so the plan below uses the rules' default: local data, no backend.");
  assert.equal(source.decidedBy, null);
  assert.equal(v.result.approve.canApprove, true, 'a closed question beside the plan never blocks Approve');
});

test('answering the data source: the view names the chooser, the other option is not pressed, and the answer replaces an earlier one', () => {
  const v = shapeView(sourceResult({ 'q-source': 'endpoint' }));
  const source = v.result.offers[1];
  assert.deepEqual(source.options.map((o) => o.chosen), [false, true]);
  assert.equal(source.status, 'Chosen: Call GET /api/products. Decided by: person.');
  assert.equal(source.decidedBy, 'person');
  assert.equal(v.result.files.length, 10, 'the endpoint source writes no store');
  const target = { id: 'q-source', source: 'placement' };
  assert.deepEqual(withAnswer(withAnswer([{ id: 'q-shape', option: 'list' }], target, 'endpoint'), target, 'local'), [{ id: 'q-shape', option: 'list' }, { id: 'q-source', option: 'local' }]);
});

test('a decision made by the rules names its provider; an option the table does not know keeps the server words', () => {
  const r = shapeResult({ 'q-shape': { option: 'list', by: 'decision-model', provider: 'rules' } });
  assert.equal(shapeView(r).result.offers[0].decidedBy, 'decision-model (rules)');
  const odd = shapeResult();
  odd.offers = [{ ...odd.offers[0], options: [...odd.offers[0].options, { id: 'grid', label: 'Grid shape', enabled: true, why: 'Cards in a grid.' }, { id: 'off', label: 'Off', enabled: false, why: 'w' }] }];
  const options = shapeView(odd).result.offers[0].options;
  assert.deepEqual(options.map((o) => o.id), ['list', 'scaffold', 'grid'], 'a disabled option is not offered');
  assert.deepEqual([options[2].label, options[2].gives], ['Grid shape', 'Cards in a grid.']);
});

test('answers: the shape answer is a placement answer, so a changed mind replaces it and card answers stay in order', () => {
  const shape = { id: 'q-shape', source: 'placement' };
  const a = withAnswer(withAnswer([{ id: 'o1', option: 'interact' }], shape, 'scaffold'), shape, 'list');
  assert.deepEqual(a, [{ id: 'o1', option: 'interact' }, { id: 'q-shape', option: 'list' }]);
  assert.deepEqual(withAnswer([], shape, 'list'), [{ id: 'q-shape', option: 'list' }]);
});

test('Approve waits while a new read is in flight, so the plan sent is the plan on screen for the choice made', () => {
  const ready = shapeResult({ 'q-shape': 'list' });
  assert.equal(shapeView(ready, { read: { status: 'loading', result: ready, error: null } }).result.approve.canApprove, false);
  assert.equal(shapeView(ready).result.approve.canApprove, true);
});

// #633: what the project's decision provider suggests is the server's `suggestions` (per question id), drawn as "suggested by <provider>".
const suggestion = (option, provider = 'rules', extra = {}) => ({ option, reason: 'because', runnerUp: null, provider: { name: provider, version: '1' }, ...extra });

test('a suggestion from the server: the offer and the open questions say "suggested by <provider>" with the reason; nothing is chosen', () => {
  const r = { ...shapeResult(), suggestions: { 'q-shape': suggestion('scaffold', 'jev') } };
  const [offer] = shapeView(r).result.offers;
  assert.deepEqual(offer.options.map((o) => [o.id, o.suggested, o.chosen]), [['list', false, false], ['scaffold', true, false]], 'the provider, not the offer\'s own default, decides which is marked');
  assert.deepEqual(offer.suggestion, { option: 'scaffold', label: 'suggested by jev', reason: 'because' });
  assert.match(offer.status, /^Not chosen yet, so the plan below is the empty scaffold\. Suggested by jev: empty scaffold\.$/);
  assert.equal(offer.decidedBy, null);

  const card = parseRequirement('A customer wants to frobnicate the invoice list.').card;
  const open = { card, placement: null, plan: null, files: {}, open: card.open.map((i) => ({ id: i.id, question: 'What does it do?', source: 'card', chosen: null, options: [{ id: 'read', label: 'Shows something', enabled: true, why: 'w' }, { id: 'write', label: 'Changes data', enabled: true, why: 'w' }] })), offers: [], warnings: [], summary: { readBack: [], blocks: [] }, suggestions: { o1: suggestion('write', 'rules', { fellBackFrom: 'jev' }) } };
  const [q] = buildRequirementView({ ...initialScreen, text: 'x', read: { status: 'ready', result: open, error: null } }).result.open;
  assert.deepEqual(q.options.map((o) => [o.id, o.suggested]), [['read', false], ['write', true]]);
  assert.deepEqual(q.suggestion, { option: 'write', label: 'suggested by rules (jev did not answer)', reason: 'because' });
});

test('a provider that is off (or abstained) suggests nothing, even where the offer has its own default; an older server keeps the rules default', () => {
  const off = { ...shapeResult(), suggestions: {} };
  const [offer] = shapeView(off).result.offers;
  assert.equal(offer.suggestion, null);
  assert.deepEqual(offer.options.map((o) => o.suggested), [false, false]);
  assert.equal(offer.status, 'Not chosen yet, so the plan below is the empty scaffold.');
  assert.equal(shapeView(shapeResult()).result.offers[0].options[0].suggested, true, 'no `suggestions` field at all: an older server');
});
