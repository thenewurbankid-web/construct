import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { IMPORT_MODES as P } from './ImportModes.ts';

const data = { folders: ['src/alerts', 'src/orders'], folder: '', phase: 'pick', summary: null, error: null };
const root = { screen: 'import', steps: [] };

test('Import modes: the provider passes the contract; a folder opens beside the chat and its crumb lands under the hood there', () => {
  assert.equal(P.defaultMode, 'hood');
  assert.deepEqual(providerProblems(P, root, data), []);
  let s = chatOption(chatStart(P, root, data), P, data, 'import.folder');
  s = chatPick(s, P, data, s.log.at(-1).id, 'src/alerts');
  assert.deepEqual(providerProblems(P, s.place, { ...data, folder: 'src/alerts' }), []);
  assert.deepEqual(P.options(s.place, data).map((o) => o.id), ['import.scan', 'import.status', 'import.agent', 'import.explain']);
  assert.equal(P.answer('import.scan', s.place, data), null, 'Read is the screen\'s own action');
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Import', 'src/alerts']);
  assert.equal(crumbTarget(crumbs[1]).href, '/import?folder=src%2Falerts');
});

test('Import modes: Pick a folder waits until the folders are read', () => {
  assert.equal(P.options(root, { ...data, folders: null })[0].disabled, 'Still reading the folders of this project.');
  assert.equal(P.options(root, data)[0].disabled, undefined);
});

test('Import modes: Where is it? follows the import; a refusal keeps its sentence; the agent is a link', () => {
  const at = { screen: 'import', steps: [{ param: 'folder', id: 'src/alerts', label: 'src/alerts' }] };
  assert.equal(P.answer('import.status', at, { ...data, phase: 'planned' }).text, 'The plan is ready beside this chat. Read its steps, then Apply.');
  assert.deepEqual(P.answer('import.status', at, { ...data, error: 'That folder is outside the project' }), { text: 'That folder is outside the project.', tone: 'refusal' });
  assert.equal(P.answer('import.agent', root, data).link.href, '/import/agent');
  assert.equal(P.answer('import.folder', root, { ...data, folders: [] }).text, 'Line found no folder it can import in this project.');
});
