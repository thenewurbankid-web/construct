import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, hrefOf, optionsAt, placeFromSearch, providerProblems } from '../../../lib/lineModes.ts';
import { COMPONENTS_CHAT, componentPlace } from './ComponentsChat.ts';
import { buildLibraryView } from './LibraryView.ts';
import { mockLineProject } from '../services/LineApi.mock.ts';

const view = buildLibraryView(mockLineProject());
const P = COMPONENTS_CHAT;
const root = { screen: 'components', steps: [] };
const pickMsg = (s) => [...s.log].reverse().find((m) => m.pick);
const ids = (place) => optionsAt(P, place, view).map((o) => o.id);

/** In chat: open the orders feature, then its OrderButton component. */
function openOrderButton() {
  let s = chatStart(P, root, view);
  s = chatOption(s, P, view, 'components.open-feature');
  s = chatPick(s, P, view, pickMsg(s).id, 'orders');
  s = chatOption(s, P, view, 'components.open-component');
  return chatPick(s, P, view, pickMsg(s).id, 'OrderButton');
}

test('components chat: passes the options-provider contract at every level, an unknown name in the URL included', () => {
  for (const search of ['', '?feature=orders', '?feature=orders&component=OrderButton', '?feature=nope', '?feature=orders&component=Nope']) {
    assert.deepEqual(providerProblems(P, placeFromSearch(P, search, view), view), [], search);
  }
  const empty = buildLibraryView({ ...mockLineProject(), library: [], features: [] });
  assert.deepEqual(providerProblems(P, root, empty), []);
  assert.equal(P.options(root, empty).find((o) => o.id === 'components.open-feature').disabled, 'No feature has its own components yet.');
});

test('components chat: stable option ids per level (feature, component), with Back to ... once something is open', () => {
  assert.deepEqual(ids(root), ['components.open-feature', 'components.library']);
  assert.deepEqual(ids(placeFromSearch(P, '?feature=orders', view)), ['components.open-component', 'components.explain', 'components.up']);
  assert.deepEqual(ids(placeFromSearch(P, '?feature=orders&component=OrderButton', view)), ['components.explain', 'components.promote', 'components.up']);
});

test('components chat: the answers read in plain English (features to pick, the library by level, what a component is based on)', () => {
  const features = P.answer('components.open-feature', root, view);
  assert.deepEqual(features.pick.items.map((i) => [i.id, i.text]), [['orders', 'One component.']]);
  assert.equal(P.answer('components.library', root, view).text, 'The library has 3 components. Atoms: Button, TextField. Molecules: Dialog.');
  const at = placeFromSearch(P, '?feature=orders&component=OrderButton', view);
  assert.equal(P.answer('components.explain', at, view).text, 'OrderButton is in feature orders. Based on Button.');
  assert.deepEqual(P.answer('components.explain', at, view).details, ['features/orders/components/OrderButton.tsx']);
  assert.equal(P.answer('components.explain', placeFromSearch(P, '?feature=orders', view), view).text, 'orders has one component: OrderButton.');
  assert.equal(P.answer('components.promote', at, view), null, 'Promote is a plan step the screen runs');
  assert.equal(P.intro(at, view).text, 'OrderButton is open. Based on Button.');
});

test('components chat: the breadcrumb follows the chat as it opens a feature and a component', () => {
  const s = openOrderButton();
  assert.deepEqual(crumbsOf(P, s.place).map((c) => c.label), ['Components', 'orders', 'OrderButton']);
  assert.equal(hrefOf(P, s.place), '/components?feature=orders&component=OrderButton');
});

test('components chat: clicking the feature crumb switches to Under the hood with that feature selected', () => {
  const s = openOrderButton();
  const crumb = crumbsOf(P, s.place).find((c) => c.label === 'orders');
  const target = crumbTarget(crumb);
  assert.deepEqual([target.mode, target.href], ['hood', '/components?feature=orders']);
  // Under the hood reads the same URL: the feature selected, no component.
  assert.deepEqual(componentPlace(new URL(target.href, 'http://x').search), { feature: 'orders', component: null });
  assert.deepEqual(componentPlace('?feature=orders&component=OrderButton'), { feature: 'orders', component: 'OrderButton' });
  assert.deepEqual(componentPlace(''), { feature: null, component: null });
});
