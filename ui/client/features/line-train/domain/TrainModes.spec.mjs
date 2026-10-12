import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { TRAIN_MODES as P, TRAIN_MODE_DATA as D } from './TrainModes.ts';

test('Train modes: the provider passes the contract; Teach opens beside the chat and its crumb lands under the hood at the Teach panel', () => {
  assert.equal(P.defaultMode, 'hood');
  const root = { screen: 'train', steps: [] };
  assert.deepEqual(providerProblems(P, root, D), []);
  let s = chatOption(chatStart(P, root, D), P, D, 'train.open');
  s = chatPick(s, P, D, s.log.at(-1).id, 'teach');
  assert.deepEqual(providerProblems(P, s.place, D), []);
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Train Line', 'Teach a new request']);
  assert.equal(crumbTarget(crumbs[1]).href, '/train?section=teach');
  assert.equal(P.anchor(s.place), 'ltr-teach-head');
  assert.match(chatOption(s, P, D, 'train.explain').log.at(-1).text, /^Teach a new request: /);
});
