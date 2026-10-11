// cp1 -- an agent drives the same Line plan Cockpit shows, over MCP: it adds a step and runs the next one, but a write
// waits for a person's approval (there is no approve tool, and the plan refuses an agent's approval). The person is
// played by the engine's plan service as "ui", on the same project, exactly as Cockpit's routes call it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLinePlanService } from '../../engine/line/planService.mjs';
import { connectInProcess, callTool, REPO } from '../test-utils/harness.mjs';

const BADGE = { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' };
const BADGE_FILE = 'features/orders/components/StatusBadge.tsx';

test('plan over MCP: the agent adds Base on, cannot run or approve it; after the person approves, plan_run_next writes it', async (t) => {
  const root = fs.realpathSync(makeTempDir('construct-mcp-plan-'));
  fs.cpSync(path.join(REPO, 'examples/line-sample'), root, { recursive: true });
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  t.after(close);
  const call = (name, args) => callTool(client, name, args);

  const { tools } = await client.listTools();
  assert.equal(tools.some((x) => /approve/.test(x.name)), false, 'no MCP tool approves');

  const empty = await call('plan_status', {});
  assert.equal(empty.isError, false, empty.text);
  assert.deepEqual(empty.body.steps, []);

  const added = await call('plan_add_step', { tool: 'line.baseOn', args: BADGE });
  assert.equal(added.isError, false, added.text);
  const step = added.body.steps.find((s) => s.id === added.body.stepId);
  assert.equal(step.state, 'waiting');
  assert.equal(step.sentence, 'Waiting for your approval: Creates StatusBadge in feature orders, based on the library Badge.');
  assert.ok(fs.existsSync(path.join(root, 'line/plans/ses-cockpit.json')), 'the same plan file Cockpit reads');

  const early = await call('plan_run_next', {});
  assert.equal(early.isError, true);
  assert.equal(early.body.error.code, 'PLAN_REFUSED');
  assert.match(early.body.error.message, /waits for a person to approve it\.$/);
  assert.equal(fs.existsSync(path.join(root, BADGE_FILE)), false, 'nothing is written before a person approves');

  const refused = await call('plan_add_step', { tool: 'line.baseOn', args: { ...BADGE, name: 'OrderButton' } });
  assert.equal(refused.isError, true);
  assert.equal(refused.body.error.reason, 'NAME_TAKEN');

  const person = createLinePlanService({ root, commands: null });
  assert.equal((await person.approve(added.body.stepId, 'agent')).ok, false, 'an agent cannot approve a write even through the service');
  assert.equal((await person.approve(added.body.stepId, 'ui')).ok, true);

  const ran = await call('plan_run_next', {});
  assert.equal(ran.isError, false, ran.text);
  const done = ran.body.steps.find((s) => s.id === added.body.stepId);
  assert.equal(done.state, 'done');
  assert.match(done.sentence, /^Saved\. Creates StatusBadge/);
  assert.deepEqual(done.result.checks.map((c) => c.ok), [true, true]);
  assert.ok(fs.existsSync(path.join(root, BADGE_FILE)));
  const seen = await person.view();
  assert.equal(seen.steps.find((s) => s.id === added.body.stepId).state, 'done', 'Cockpit sees the step the agent ran');
});
