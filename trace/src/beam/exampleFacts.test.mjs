// #904: a request about a Trace example is read against that example's own facts (no Line project, no model).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleSummary, exampleMap, readExample, targetOf } from './exampleFacts.mjs';
import { toReadings, assertReading } from './contract.mjs';
import { readCandidates } from './arms.mjs';
import { CATALOG } from '../../tools/jev/intentGold.mjs';

const EX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples');
const read = (app, request) => readExample(path.join(EX, app), request, CATALOG);
const top = (app, request) => { const c = read(app, request); const r = toReadings(c.labels)[0]; return { ...r, target: targetOf(r.target, c) }; };

test('exampleSummary: the feature, its one page, the page fields, endpoint fields and actions as handler props', () => {
  const s = exampleSummary(path.join(EX, 'contacts'));
  assert.equal(s.feature, 'contacts');
  assert.deepEqual(s.features[0].items.map((i) => [i.kind, i.name]), [['pages', 'ContactsPage']]);
  const props = s.pages[0].parts[0].props.map((p) => p.name);
  for (const n of ['contactCount', 'fullName', 'first', 'last', 'onCall', 'onDelete']) assert.ok(props.includes(n), n);
  assert.deepEqual(s.specs, [], 'the story is not a weak source');
  const map = exampleMap(s);
  assert.equal(map.synonyms.call, 'prop:onCall', 'a grammar action word names its handler');
  assert.equal(map.synonyms.delete, undefined, 'a verb word stays the verb');
  assert.ok(map.entries.find((e) => e.key === 'prop:onForecast') === undefined);
  assert.ok(exampleMap(exampleSummary(path.join(EX, 'deals'))).entries.find((e) => e.key === 'prop:onForecast').forms.includes('forecast button'));
});

test('readings come from the example: real intent, the page as target, never "unknown" for these', () => {
  const cases = [
    ['contacts', "In the contacts table, show each person's full name, first and last name together, in the Name column.", 'update.prop'],
    ['contacts', 'When I press Call on a contact, log that we called that person so I can see it later.', 'update.handler'],
    ['orders', 'Let me mark an order as shipped from the orders list.', 'add.handler'],
    ['deals', "Show each deal's owner and CSM in the deals list.", 'update.prop'],
    ['deals', 'When I click the Forecast button, open the forecasting view.', 'update.handler'],
    ['invoices', 'Let me archive an invoice from the invoices list.', 'add.handler'],
    ['roster', "Show each project's owner and backup in the roster.", 'update.prop'],
  ];
  for (const [app, request, intent] of cases) {
    const r = top(app, request);
    assert.equal(r.intent, intent, `${app}: ${request}`);
    assert.deepEqual(r.target, { kind: 'page', name: app });
    assert.ok(r.layers.includes('ui'));
  }
});

test('the arms get the same context: static readings are contract readings; a prop target keeps its own name', async () => {
  const ctx = read('deals', "Show each deal's owner and CSM in the deals list.");
  const cand = await readCandidates(ctx, { arms: ['static'] });
  assert.ok(cand.readings.length >= 1);
  for (const r of cand.readings) assertReading(r, CATALOG);
  assert.ok(ctx.map.entries.length > 5 && typeof ctx.map.stamp === 'string');
  assert.deepEqual(targetOf('A1', ctx), { kind: 'prop', name: ctx.bindings.A1.name });
  assert.deepEqual(targetOf(null, { slots: {}, bindings: {} }), { kind: 'slot', name: '' });
});
