// Train Line over MCP: Claude lists cases, proposes one (stored without project words, labelled 'claude', a draft) and
// runs eval (nothing saved). There is no tool that agrees, disagrees or approves: only the owner does, in Cockpit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { connectInProcess, callTool, REPO } from '../test-utils/harness.mjs';

test('train over MCP: list, propose (verified, delexicalized, a draft), refuse a failing route, eval saves nothing, no review tool', async (t) => {
  const trainRoot = fs.realpathSync(makeTempDir('construct-mcp-train-'));
  process.env.LINE_TRAIN_ROOT = trainRoot;
  t.after(() => { delete process.env.LINE_TRAIN_ROOT; });
  const root = fs.realpathSync(makeTempDir('construct-mcp-train-project-'));
  fs.cpSync(path.join(REPO, 'examples/line-sample'), root, { recursive: true });
  const { client, close } = await connectInProcess({ root, ratePerMinute: 600 });
  t.after(close);
  const call = (name, args) => callTool(client, name, args);

  const { tools } = await client.listTools();
  assert.equal(tools.some((x) => /approve|agree|review/.test(x.name)), false, 'no MCP tool reviews or approves');

  const listed = await call('train_list_cases', { filter: 'claude', limit: 3 });
  assert.equal(listed.isError, false, listed.text);
  assert.equal(listed.body.cases.length, 3);
  assert.ok(listed.body.total >= 300);

  const proposed = await call('train_propose_case', {
    world: 'sample', request: 'Make SummaryCard in orders, based on Card.', intent: 'add.component',
    routes: [{ label: 'Inside orders only', steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Card', feature: 'orders', name: 'SummaryCard' } }] }],
  });
  assert.equal(proposed.isError, false, proposed.text);
  assert.equal(proposed.body.case.labelledBy, 'claude');
  assert.equal(proposed.body.case.status, 'draft');
  assert.equal(proposed.body.case.request, 'Make SummaryCard in orders, based on Card.');
  assert.deepEqual(proposed.body.case.routes[0].steps, ['Make SummaryCard in orders, based on the library Card.']);
  const stored = fs.readFileSync(path.join(trainRoot, 'train/cases.jsonl'), 'utf8').split('\n').find((l) => l.includes(proposed.body.case.id));
  assert.doesNotMatch(stored, /orders|SummaryCard|"Card"/);
  assert.equal(fs.existsSync(path.join(root, 'features/orders/components/SummaryCard.tsx')), false, 'the open project is never touched');

  const failing = await call('train_propose_case', {
    world: 'sample', request: 'Make TotalBadge in orders, based on Badge.', intent: 'add.component',
    routes: [{ steps: [{ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'OrderButton' } }] }],
  });
  assert.equal(failing.isError, true);
  assert.equal(failing.body.error.code, 'TRAIN_REFUSED');

  const ev = await call('train_run_eval', {});
  assert.equal(ev.isError, false, ev.text);
  assert.ok(ev.body.total.heldout >= 50);
  assert.equal(fs.existsSync(path.join(trainRoot, 'train/eval.json')), false, 'eval over MCP saves nothing');
});
