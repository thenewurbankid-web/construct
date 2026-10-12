import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { OPEN_MODES as P } from './OpenModes.ts';

const data = { workspaceRoot: '/ws', lastProject: '/ws/shop', samplePath: null };
const root = { screen: 'open', steps: [] };

test('Open a project modes: the provider passes the contract and opens in Chat', () => {
  assert.equal(P.defaultMode, 'chat', 'every screen opens in Chat until the person picks (owner, 12 Oct)');
  assert.deepEqual(providerProblems(P, root, data), []);
  assert.deepEqual(providerProblems(P, { screen: 'open', steps: [{ param: 'section', id: 'new', label: 'New project' }] }, data), []);
});

test('Open a project modes: Reopen names the last project; the sample is disabled with a reason when there is none', () => {
  const opts = P.options(root, data);
  assert.deepEqual(opts.map((o) => o.id), ['open.reopen', 'open.sample', 'open.start', 'open.explain']);
  assert.equal(opts[0].label, 'Reopen shop');
  assert.equal(opts[1].disabled, 'Your workspace has no sample shop folder.');
  assert.equal(P.options(root, { ...data, lastProject: null })[0].disabled, 'There is no project you had open before.');
  assert.equal(P.answer('open.reopen', root, data), null, 'the screen opens it with its own handler');
});

test('Open a project modes: picking a way in opens it beside the chat; its crumb is under the hood at ?section=', () => {
  let s = chatStart(P, root, data);
  s = chatOption(s, P, data, 'open.start');
  s = chatPick(s, P, data, s.log.at(-1).id, 'new');
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Open a project', 'New project']);
  assert.equal(crumbTarget(crumbs[1]).href, '/?section=new');
  assert.equal(s.log[0].text, 'New project is open beside this chat.');
});
