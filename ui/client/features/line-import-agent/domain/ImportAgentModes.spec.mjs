import test from 'node:test';
import assert from 'node:assert/strict';
import { chatOption, chatPick, chatStart, crumbTarget, crumbsOf, providerProblems } from '../../../lib/lineModes.ts';
import { IMPORT_AGENT_MODES as P } from './ImportAgentModes.ts';

const none = { started: false, sentence: null, stages: [], rows: [] };
const planned = { started: true, sentence: 'Review the plan: approve its 2 steps.', stages: [{ label: 'Read the folder', status: 'done' }, { label: 'Review', status: 'now' }], rows: [{ id: 's1', n: 1, sentence: 'Move Table into the library', outcome: null }, { id: 's2', n: 2, sentence: 'Base AlertsPage on ListPage', outcome: null }] };
const root = { screen: 'import-agent', steps: [] };

test('Import agent modes: the provider passes the contract; with no plan, Open a step says why it is off', () => {
  assert.equal(P.defaultMode, 'chat', 'every screen opens in Chat until the person picks (owner, 12 Oct)');
  assert.deepEqual(providerProblems(P, root, none), []);
  assert.deepEqual(providerProblems(P, root, planned), []);
  assert.equal(P.options(root, none).find((o) => o.id === 'import-agent.steps').disabled, 'The agent has no plan yet; start the import beside this chat first.');
  assert.equal(P.answer('import-agent.status', root, none).text, 'The import has not started. Pick a folder and start it beside this chat.');
  assert.equal(P.answer('import-agent.status', root, planned).text, 'Review the plan: approve its 2 steps.');
});

test('Import agent modes: a step opens beside the chat as "Step 2"; its crumb lands under the hood at the plan', () => {
  let s = chatOption(chatStart(P, root, planned), P, planned, 'import-agent.steps');
  s = chatPick(s, P, planned, s.log.at(-1).id, 's2');
  const crumbs = crumbsOf(P, s.place);
  assert.deepEqual(crumbs.map((c) => c.label), ['Import agent', 'Step 2']);
  assert.equal(crumbTarget(crumbs[1]).href, '/import/agent?step=s2');
  assert.equal(P.anchor(s.place), 'la-plan-h');
  assert.equal(chatOption(s, P, planned, 'import-agent.explain').log.at(-1).text, 'Step 2: Base AlertsPage on ListPage.');
});
