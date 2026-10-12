import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, effectiveMode, hrefOf, modeKey, optionsAt, parseMode, placeFromSearch, providerProblems } from './lineModes.ts';
import { MOCK_PROVIDER as P, MOCK_WORLD as W } from './lineModesMock.ts';

const root = { screen: 'mock', steps: [] };
const pickMsg = (s) => [...s.log].reverse().find((m) => m.pick);

/** In chat: open orders, then OrdersPage, then the title part (each pick from the last answer's items). */
function walk() {
  let s = chatStart(P, root, W);
  s = chatOption(s, P, W, 'mock.open');
  s = chatPick(s, P, W, pickMsg(s).id, 'orders');
  s = chatOption(s, P, W, 'mock.open');
  s = chatPick(s, P, W, pickMsg(s).id, 'OrdersPage');
  s = chatOption(s, P, W, 'mock.open');
  return chatPick(s, P, W, pickMsg(s).id, 'title');
}

test('two modes: a mode is chat or hood, stored per login, and the screen default applies until the person picks', () => {
  assert.equal(parseMode('chat'), 'chat');
  assert.equal(parseMode('hood'), 'hood');
  assert.equal(parseMode('auto'), null);
  assert.equal(modeKey('octocat'), 'cockpit.mode.octocat');
  assert.equal(modeKey(null), 'cockpit.mode');
  assert.equal(effectiveMode(null, 'chat'), 'chat');
  assert.equal(effectiveMode('hood', 'chat'), 'hood');
});

test('two modes: the mock provider passes the contract at every level', () => {
  for (const search of ['', '?feature=orders', '?feature=orders&item=OrdersPage', '?feature=orders&item=OrdersPage&part=title']) {
    assert.deepEqual(providerProblems(P, placeFromSearch(P, search, W), W), [], search);
  }
  const bad = { ...P, options: () => [{ id: 'features.open', label: 'Open', sentence: 'no', effect: 'read' }] };
  assert.deepEqual(providerProblems(bad, root, W), ['Option "features.open" does not explain itself in a full sentence.', 'Option "features.open" does not start with its screen "mock".']);
});

test('two modes: the breadcrumb follows the chat as it opens a feature, an item and a part', () => {
  const s = walk();
  assert.deepEqual(crumbsOf(P, s.place).map((c) => c.label), ['Features', 'orders', 'OrdersPage', 'title']);
  assert.deepEqual(crumbsOf(P, s.place).map((c) => c.current), [false, false, false, true]);
  assert.equal(hrefOf(P, s.place), '/mock?feature=orders&item=OrdersPage&part=title');
  assert.equal(s.log[0].text, 'title is open.');
});

test('two modes: clicking the "orders" crumb switches to Under the hood with orders selected, at exactly that URL', () => {
  const s = walk();
  const orders = crumbsOf(P, s.place).find((c) => c.label === 'orders');
  const target = crumbTarget(orders);
  assert.equal(target.mode, 'hood');
  assert.equal(target.href, '/mock?feature=orders');
  // Under the hood reads the same URL: the place it parses is the crumb's place (Features with orders open).
  const hood = placeFromSearch(P, new URL(target.href, 'http://x').search, W);
  assert.deepEqual(hood, { screen: 'mock', steps: [{ param: 'feature', id: 'orders', label: 'orders' }] });
  assert.deepEqual(crumbTarget(crumbsOf(P, s.place)[0]).href, '/mock');
});

test('two modes: "Back to ..." goes one level up; a pick from an older message replaces that level and deeper', () => {
  let s = walk();
  assert.equal(optionsAt(P, s.place, W).at(-1).id, 'mock.up');
  assert.equal(optionsAt(P, s.place, W).at(-1).label, 'Back to OrdersPage');
  s = chatOption(s, P, W, 'mock.up');
  assert.deepEqual(s.place.steps.map((x) => x.id), ['orders', 'OrdersPage']);
  assert.equal(optionsAt(P, root, W).some((o) => o.id === 'mock.up'), false);
  // A provider answer with no pick opens nothing; an unknown option leaves the state as it is.
  const before = chatOption(s, P, W, 'mock.explain');
  assert.equal(before.log.at(-1).text, 'orders, OrdersPage is open.');
  assert.equal(chatPick(before, P, W, before.log.at(-1).id, 'x'), before);
  assert.equal(chatOption(before, P, W, 'mock.nothing'), before);
});
