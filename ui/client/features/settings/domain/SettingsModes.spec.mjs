import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { SETTINGS_MODES as P, SETTINGS_MODE_DATA as D } from './SettingsModes.ts';

test('Settings modes: the provider passes the contract; a section opens beside the chat and its crumb lands under the hood there', () => {
  assert.equal(P.defaultMode, 'chat', 'every screen opens in Chat until the person picks (owner, 12 Oct)');
  const root = { screen: 'settings', steps: [] };
  assert.deepEqual(providerProblems(P, root, D), []);
  let s = chatOption(chatStart(P, root, D), P, D, 'settings.open');
  assert.deepEqual(s.log.at(-1).pick.items.map((i) => i.id), ['project', 'git', 'remote', 'github', 'ai']);
  s = chatPick(s, P, D, s.log.at(-1).id, 'git');
  assert.deepEqual(providerProblems(P, s.place, D), []);
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Settings', 'Saving to git']);
  assert.equal(crumbTarget(crumbs[1]).href, '/settings?section=git');
  assert.equal(P.anchor(s.place), 'settings-git');
  assert.equal(P.anchor(root), null);
});
