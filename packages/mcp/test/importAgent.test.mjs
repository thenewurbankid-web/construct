// ci2 -- an agent drives the Import agent over MCP: it starts the import, edits and approves the plan (the review), and
// resumes it; every write still waits for a person's approval of the plan step (played here by the engine's plan service
// as "ui", on the same project, as Cockpit's routes call it). Its edits are recorded as the agent's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanService } from '../../engine/line/planService.mjs';
import { connectInProcess, callTool, REPO } from '../test-utils/harness.mjs';

const FOLDER = 'src/alerts';

test('import over MCP: start, edit and approve the review as the agent; no write until the person approves the plan step', async (t) => {
  const root = fs.realpathSync(makeTempDir('construct-mcp-import-'));
  fs.cpSync(path.join(REPO, 'examples/import-sample'), root, { recursive: true });
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  t.after(close);
  const call = (name, args) => callTool(client, name, args);

  const outside = await call('import_start', { folder: '../etc' });
  assert.equal(outside.isError, true);
  assert.equal(outside.body.error.code, 'INVALID_INPUT');

  const started = await call('import_start', { folder: FOLDER });
  assert.equal(started.isError, false, started.text);
  assert.equal(started.body.state, 'review');

  const edited = await call('import_plan_edit', { folder: FOLDER, action: 'edit', stepId: 'import-8-feature-AlertRow', args: { name: 'AlertLine' } });
  assert.equal(edited.isError, false, edited.text);
  assert.equal(edited.body.changes.at(-1).by, 'agent');
  const bad = await call('import_plan_edit', { folder: FOLDER, action: 'skip', stepId: 'import-1-mark' });
  assert.equal(bad.isError, true);
  assert.equal(bad.body.error.reason, 'NEEDED');

  const approved = await call('import_plan_edit', { folder: FOLDER, action: 'approve-all' });
  assert.equal(approved.isError, false, approved.text);
  assert.equal(approved.body.state, 'execute');
  assert.equal(approved.body.waiting.for, 'approval', 'the agent\'s review approval does not approve a write');
  assert.equal(fs.existsSync(path.join(root, FOLDER, 'architecture.yml')), false);

  const person = createLinePlanService({ root, commands: null });
  assert.equal((await person.approve(approved.body.waiting.planStepId, 'ui')).ok, true);
  const resumed = await call('import_resume', { folder: FOLDER });
  assert.equal(resumed.isError, false, resumed.text);
  assert.ok(fs.existsSync(path.join(root, FOLDER, 'architecture.yml')), 'the approved step landed');
  assert.equal(resumed.body.waiting.for, 'approval', 'the next step waits for the person again');

  const status = await call('import_status', { folder: FOLDER });
  assert.equal(status.isError, false);
  assert.equal(status.body.steps.find((s) => s.id === 'import-1-mark').run, 'done');
  // Line Import v2: the status says, in plain English, what the logic map holds and how much of it was kept.
  assert.match(status.body.logic.sentence, /^\d+ logic units in \d+ files; \d+ of \d+ kept/);
  assert.equal(status.body.logic.steps[0].status, 'ok');

  // The person approves the rest; at verify no unit has a test, and only the owner may waive that: the agent is refused.
  let v = status.body;
  for (let i = 0; i < 30 && v.waiting?.for === 'approval'; i += 1) {
    assert.equal((await person.approve(v.waiting.planStepId, 'ui')).ok, true);
    v = (await call('import_resume', { folder: FOLDER })).body;
  }
  assert.equal(v.waiting?.question?.id, 'verify', v.sentence);
  const waive = await call('import_answer', { folder: FOLDER, questionId: 'verify', optionId: 'waive' });
  assert.equal(waive.isError, true);
  assert.equal(waive.body.error.reason, 'OWNER_ONLY');
});

test('import over MCP: a route seeds the logic map (the route and its sub-routes, across the folder)', async (t) => {
  const root = fs.realpathSync(makeTempDir('construct-mcp-import-route-'));
  fs.cpSync(path.join(REPO, 'examples/import-sample'), root, { recursive: true });
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  t.after(close);
  const started = await callTool(client, 'import_start', { folder: FOLDER, route: '/alerts' });
  assert.equal(started.isError, false, started.text);
  assert.equal(started.body.state, 'review');
  assert.equal(started.body.logic.route, '/alerts');
  assert.match(started.body.logic.sentence, /^Route \/alerts: /);
});
