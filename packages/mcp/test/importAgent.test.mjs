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
});
