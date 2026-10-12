import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, hrefOf, optionsAt, placeFromSearch, providerProblems } from '../../../lib/lineModes.ts';
import { PAGES_CHAT } from './PagesChat.ts';
import { mockLineProject } from '../../line-library/services/LineApi.mock.ts';

const project = mockLineProject();
const P = PAGES_CHAT;
const root = { screen: 'pages', steps: [] };
const pickMsg = (s) => [...s.log].reverse().find((m) => m.pick);
const ids = (place) => optionsAt(P, place, project).map((o) => o.id);
const ORDERS_PAGE = 'orders/pages/OrdersPage';

/** In chat: open the orders feature, then its OrdersPage. */
function openOrdersPage() {
  let s = chatStart(P, root, project);
  s = chatOption(s, P, project, 'pages.open-feature');
  s = chatPick(s, P, project, pickMsg(s).id, 'orders');
  s = chatOption(s, P, project, 'pages.open-page');
  return chatPick(s, P, project, pickMsg(s).id, ORDERS_PAGE);
}

test('pages chat: passes the options-provider contract at every level, an unknown id in the URL included', () => {
  for (const search of ['', '?feature=orders', `?feature=orders&page=${ORDERS_PAGE}`, '?feature=nope', '?feature=orders&page=nope']) {
    assert.deepEqual(providerProblems(P, placeFromSearch(P, search, project), project), [], search);
  }
  assert.deepEqual(providerProblems(P, root, { ...project, features: [] }), []);
});

test('pages chat: stable option ids per level (feature, page), with Back to ... once something is open', () => {
  assert.deepEqual(ids(root), ['pages.open-feature', 'pages.attention']);
  assert.deepEqual(ids(placeFromSearch(P, '?feature=orders', project)), ['pages.open-page', 'pages.explain', 'pages.up']);
  assert.deepEqual(ids(placeFromSearch(P, `?feature=orders&page=${ORDERS_PAGE}`, project)), ['pages.explain', 'pages.change', 'pages.up']);
});

test('pages chat: the answers read in plain English (features with their pages, what needs attention, a page\'s base)', () => {
  const features = P.answer('pages.open-feature', root, project);
  assert.deepEqual(features.pick.items.map((i) => [i.id, i.text]), [['billing', 'One page, one needs attention.'], ['orders', 'One page, all fine.']]);
  assert.match(P.answer('pages.attention', root, project).text, /^One page needs attention: InvoicesPage in billing\./);
  const pages = P.answer('pages.open-page', placeFromSearch(P, '?feature=orders', project), project);
  assert.deepEqual(pages.pick.items.map((i) => [i.id, i.name]), [[ORDERS_PAGE, 'OrdersPage']]);
  const at = placeFromSearch(P, `?feature=orders&page=${ORDERS_PAGE}`, project);
  assert.equal(P.answer('pages.explain', at, project).text, 'OrdersPage is in feature orders. Based on ListPage.');
  assert.match(P.answer('pages.change', at, project).text, /waits in the plan for your approval\.$/);
  assert.equal(P.intro(at, project).text, 'OrdersPage is open. Based on ListPage.');
});

test('pages chat: the breadcrumb says the page by name and follows the chat', () => {
  const s = openOrdersPage();
  assert.deepEqual(crumbsOf(P, s.place).map((c) => c.label), ['Pages', 'orders', 'OrdersPage']);
  assert.equal(hrefOf(P, s.place), '/pages?feature=orders&page=orders%2Fpages%2FOrdersPage');
});

test('pages chat: clicking the feature crumb switches to Under the hood with that feature selected (the URL useLinePages reads)', () => {
  const s = openOrdersPage();
  const target = crumbTarget(crumbsOf(P, s.place).find((c) => c.label === 'orders'));
  assert.deepEqual([target.mode, target.href], ['hood', '/pages?feature=orders']);
  const q = new URL(target.href, 'http://x').searchParams;
  assert.deepEqual([q.get('feature'), q.get('page')], ['orders', null]);
});
