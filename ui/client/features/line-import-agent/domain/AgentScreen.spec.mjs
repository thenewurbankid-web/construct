import test from 'node:test';
import assert from 'node:assert/strict';
import { canChange, mainAction, moveTargets } from './AgentRules.ts';
import { editArgs, editValue, orderedOptions } from './AgentEdit.ts';
import { agentScreen, isRefusal } from './AgentScreen.ts';
import { agentReducer, initialAgent } from '../workflows/AgentFlow.ts';
import { createMockImportAgentService, createMockPlanService } from '../../../../../packages/engine/line/mockImportAgent.mjs';

const FOLDER = 'src/alerts';

test('the main action follows the process: start, approve the plan, approve and run, resume; none when done', async () => {
  const svc = createMockImportAgentService();
  const agent = svc.agentFor(FOLDER);
  assert.deepEqual(mainAction(null), { id: 'start', label: 'Start the import' });
  let v = await agent.start('ui');
  assert.deepEqual(mainAction(v), { id: 'approve-all', label: 'Approve the plan' });
  v = await agent.editStep('ui', { action: 'approve-all' });
  assert.deepEqual(mainAction(v), { id: 'approve-run', label: 'Approve and run' });
  const paused = await agent.pause('ui');
  assert.deepEqual(mainAction(paused), { id: 'resume', label: 'Resume' });
  await svc.planService.approve(v.waiting.planStepId, 'ui');
  v = await agent.resume('ui');
  assert.equal(v.state, 'done');
  assert.equal(mainAction(v), null);
});

test('a step can change only before it runs; moves stay after the first step', async () => {
  const agent = createMockImportAgentService().agentFor(FOLDER);
  const v = await agent.start('ui');
  const [mark, second, third] = v.steps;
  assert.equal(canChange(v, mark), true);
  assert.deepEqual(moveTargets(v, mark), { up: null, down: null });
  assert.deepEqual(moveTargets(v, second), { up: null, down: 2 });
  assert.deepEqual(moveTargets(v, third), { up: 1, down: 3 });
  assert.equal(canChange({ ...v, state: 'done' }, second), false);
  assert.equal(canChange(v, { ...second, run: 'done' }), false);
});

test('edit values: features become a list, empty fields are left out; a question lists the recommended option first', async () => {
  assert.deepEqual(editArgs('line.import.mark', { features: 'alerts, inbox ' }), { features: ['alerts', 'inbox'] });
  assert.deepEqual(editArgs('line.import.toFeature', { name: 'AlertLine', feature: '', base: ' ' }), { name: 'AlertLine' });
  assert.equal(editValue({ args: { features: ['a', 'b'] } }, 'features'), 'a, b');
  const planService = createMockPlanService({ refuse: (s) => s.tool === 'line.import.toFeature' && s.args.name === 'AlertRow' });
  const svc = createMockImportAgentService({ planService });
  const agent = svc.agentFor(FOLDER);
  await agent.start('ui');
  let v = await agent.editStep('ui', { action: 'approve-all' });
  for (let i = 0; i < 10 && v.waiting?.for === 'approval'; i += 1) { await planService.approve(v.waiting.planStepId, 'ui'); v = await agent.resume('ui'); }
  const q = v.waiting.question;
  assert.deepEqual(orderedOptions(q).map((o) => [o.id, o.recommended]), [['fix:set-base', true], ['leave', false]]);
});

test('the screen state: a refusal keeps the view and says why; a new folder forgets the old view', () => {
  const view = { ok: true, folder: FOLDER, state: 'review' };
  let s = agentReducer(initialAgent, { type: 'SET_FOLDER', folder: FOLDER });
  s = agentReducer(s, { type: 'CALL' });
  s = agentReducer(s, { type: 'VIEW', view });
  s = agentReducer(s, { type: 'CALL' });
  s = agentReducer(s, { type: 'REFUSED', sentence: 'This step is already approved.' });
  assert.deepEqual([s.view, s.error, s.busy], [view, 'This step is already approved.', false]);
  s = agentReducer(s, { type: 'SET_FOLDER', folder: 'src/other' });
  assert.equal(s.view, null);
  assert.equal(isRefusal({ ok: false, sentence: 'No.' }), true);
  assert.equal(isRefusal(view), false);
});

test('the screen model: plain labels, the actions each row allows, the record in sentences', async () => {
  const agent = createMockImportAgentService().agentFor(FOLDER);
  assert.deepEqual(agentScreen(null, null).main, { id: 'start', label: 'Start the import' });
  const v = await agent.start('ui');
  const s = agentScreen(v, 'import-3-lib-AlertRow');
  assert.equal(s.started, true);
  assert.deepEqual([s.rows[0].skipLabel, s.rows[0].reviewLabel, s.rows[0].runLabel], [null, 'Not approved yet', 'To do']);
  assert.deepEqual([s.rows[1].skipLabel, s.rows[1].canApprove, s.rows[1].up, s.rows[1].down], ['Skip', true, null, 2]);
  assert.equal(s.rows[2].editing, true);
  assert.deepEqual(s.rows[2].fields.map((f) => [f.key, f.value]), [['name', 'AlertRow'], ['level', '']]);
  assert.equal(s.changes[0], 'You: Started the import of src/alerts.');
  assert.match(s.decisions[0], /Line took the recommended option: library\./);
  assert.equal(s.canPause, true);
});
