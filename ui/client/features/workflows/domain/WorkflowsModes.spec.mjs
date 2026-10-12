import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { WORKFLOWS_MODES as P } from './WorkflowsModes.ts';

const data = { features: ['orders', 'billing'], featuresLoaded: true, feature: 'orders', files: ['checkout.ts'], filesLoading: false };
const place = (...ids) => ({ screen: 'workflows', steps: ids.map((id, i) => ({ param: P.params[i], id, label: id })) });
const lastPick = (s) => [...s.log].reverse().find((m) => m.pick);

test('Workflows modes: the provider passes the contract at every level and opens in Chat', () => {
  assert.equal(P.defaultMode, 'chat', 'every screen opens in Chat until the person picks (owner, 12 Oct)');
  for (const p of [place(), place('orders'), place('orders', 'checkout.ts')]) assert.deepEqual(providerProblems(P, p, data), []);
});

test('Workflows modes: open a feature, then a workflow; the breadcrumb follows and a crumb lands under the hood there', () => {
  let s = chatStart(P, place(), data);
  s = chatOption(s, P, data, 'workflows.open');
  s = chatPick(s, P, data, lastPick(s).id, 'orders');
  s = chatOption(s, P, data, 'workflows.open-file');
  s = chatPick(s, P, data, lastPick(s).id, 'checkout.ts');
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Workflows', 'orders', 'checkout.ts']);
  assert.deepEqual(crumbTarget(crumbs[1]), { mode: 'hood', href: '/workflows?feature=orders', place: place('orders') });
});

test('Workflows modes: Open a workflow waits until the feature\'s files are read', () => {
  assert.equal(P.options(place('orders'), { ...data, filesLoading: true })[0].disabled, 'Still reading the workflows of orders.');
  assert.equal(P.options(place('billing'), data)[0].disabled, 'Still reading the workflows of billing.');
  assert.equal(P.options(place('orders'), data)[0].disabled, undefined);
  assert.equal(P.options(place(), { ...data, featuresLoaded: false })[0].disabled, 'Still reading which features have workflows.');
});

test('Workflows modes: while the files are read, or for another feature, the chat says to ask again', () => {
  assert.equal(P.answer('workflows.open-file', place('billing'), data).text, 'Still reading the workflows of billing; ask again in a moment.');
  assert.equal(P.answer('workflows.open-file', place('orders'), { ...data, files: [] }).text, 'orders has no workflow files yet.');
  assert.equal(P.answer('workflows.open', place(), { ...data, features: [] }).text, 'No feature has a workflows folder yet.');
});
