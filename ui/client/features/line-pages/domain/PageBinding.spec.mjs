// cu5: the Pages screen's two bindings of one page, side by side, on the contract's mock (the same shapes the server
// sends): one row per part with its library component (Morpheus) and its data, states and actions (Trace); a fix is a
// line.bindInteraction plan step carrying the page hash (on the server every bind is a plan step: the e2e spec).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { assertLinePageBinding } from '../../../../../packages/engine/line/contract.mjs';
import { bindingRows, bindPartRequest, coverageSentence, fixStep, resolutionPill } from './PageBinding.ts';

const ORDERS = 'features/orders/pages/OrdersPage.tsx';

test('bindingRows: one row per part, the library side and the data side next to each other', () => {
  const b = createMockLineOps().readPageBinding('/mock', ORDERS);
  assertLinePageBinding(b);
  const rows = bindingRows(b);
  assert.deepEqual(rows.map((r) => r.tag), ['ListPage']);
  const [row] = rows;
  assert.deepEqual(row.library, { sentence: 'The library page ListPage (pages/ListPage).', bound: true, libraryId: 'pages/ListPage' });
  assert.equal(row.data.sentence, 'Static text, no data.');
  assert.deepEqual(row.data.actions.map((a) => [a.pill, a.resolution]), [['Needs a home', 'unresolved']]);
  assert.deepEqual(row.targets, [], 'a part already from the library offers no other binding');
  assert.equal(resolutionPill('api'), 'Calls the API');
});

test('a part that is not from the library offers every library component to bind it to', () => {
  const ops = createMockLineOps();
  const b = ops.readPageBinding('/mock', ORDERS);
  const own = { ...b, parts: [{ ...b.parts[0], tag: 'section', base: { kind: 'html', libraryId: null, from: null, sentence: 'A plain <section> element, not a library component.' } }] };
  const [row] = bindingRows(own);
  assert.deepEqual(row.targets.map((t) => t.id), ['components/Button', 'components/Dialog', 'components/TextField']);
  assert.deepEqual(bindPartRequest(b, 'n0', 'components/Button'), { file: ORDERS, partId: 'n0', libraryId: 'components/Button', contentHash: b.contentHash });
});

test('coverageSentence and fixStep: how many actions have a home; a fix becomes a plan step with the page hash', () => {
  const ops = createMockLineOps();
  const b = ops.readPageBinding('/mock', ORDERS);
  assert.equal(coverageSentence(b), '0 of 1 action has a home (0 call the API, 0 on the page, 0 stubs to write).');
  const step = fixStep(b.findings[0].fixes[0], b.contentHash);
  assert.deepEqual(step, { tool: 'line.bindInteraction', args: { file: ORDERS, interactionId: 'n0:onMore', to: 'endpoint', endpoint: 'GET /api/orders', contentHash: b.contentHash } });
  // In mock mode the step lands at once; the next read shows the action calling the API.
  assert.equal(ops.applyChange('/mock', ops.planBindInteraction('/mock', step.args)).ok, true);
  const after = ops.readPageBinding('/mock', ORDERS);
  assert.equal(coverageSentence(after), '1 of 1 action has a home (1 calls the API, 0 on the page, 0 stubs to write).');
  assert.deepEqual(bindingRows(after)[0].data.actions.map((a) => a.pill), ['Calls the API']);
  assert.equal(coverageSentence({ ...after, via: 'static' }), 'Actions are not read while Trace is unavailable.');
});
