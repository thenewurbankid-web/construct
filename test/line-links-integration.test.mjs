// cu1 -- integration, last: the real @mx/plan runner (linked) drives Construct's real built-in commands through the
// registry adapter (plan-registry.mjs over command-registry.mjs). A read step runs `construct validate`; a write step
// waits for a person; bad args are refused by plan's own checks. Skipped when the source is not linked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLinked, linkStatus } from '../packages/line-links/index.mjs';
import { createCommandRegistry } from '../packages/core/command-registry.mjs';
import { registerBuiltinCommands } from '../packages/core/builtin-commands.mjs';
import { commandPlanRegistry } from '../packages/core/plan-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = linkStatus();
const skip = status.ok ? false : status.message;

async function setup(t) {
  const plan = await importLinked('@mx/plan');
  assert.equal(plan.ok, true, plan.reason);
  const commands = createCommandRegistry();
  registerBuiltinCommands(commands);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'cu1-int-'));
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const api = plan.module.createPlanApi({ registry: commandPlanRegistry(commands), writer: plan.module.createFileWriter(store) });
  const created = await api.plan_create({ goal: 'Check the architecture of the fixtures.', by: 'user' });
  assert.equal(created.ok, true, created.reason);
  return { api, plan: created.plan, catalog: plan.module.toolCatalog(commandPlanRegistry(commands)) };
}

test('a plan step runs construct validate through the registry adapter and keeps its JSON result', { skip }, async (t) => {
  const { api, plan, catalog } = await setup(t);
  assert.ok(catalog.some((c) => c.name === 'construct.validate' && c.kind === 'read'));
  assert.ok(!catalog.some((c) => c.name === 'construct.repl'));
  const valid = path.join(ROOT, 'fixtures/architecture-valid-react-spa');
  const invalid = path.join(ROOT, 'fixtures/architecture-invalid');
  let r = await api.plan_add_step({ planId: plan.id, version: plan.version, by: 'agent', step: { tool: 'construct.validate', args: { argv: ['--format', 'json', '--dir', valid] }, why: 'Validate the clean fixture.' } });
  assert.equal(r.ok, true, r.reason);
  r = await api.plan_add_step({ planId: plan.id, version: r.plan.version, by: 'agent', step: { tool: 'construct.validate', args: { argv: ['--format', 'json', '--dir', invalid] }, why: 'Validate the broken fixture.' } });
  assert.equal(r.ok, true, r.reason);
  r = await api.plan_run_next({ planId: plan.id, version: r.plan.version, by: 'agent' });
  assert.equal(r.ok, true, r.reason);
  const first = r.plan.steps[0];
  assert.equal(first.status, 'done');
  assert.deepEqual([first.result.command, first.result.ok, first.result.exitCode], ['validate', true, 0]);
  r = await api.plan_run_next({ planId: plan.id, version: r.plan.version, by: 'agent' });
  const second = r.plan.steps[1];
  assert.equal(second.status, 'done', 'findings are a result, not a failed step');
  assert.equal(second.result.ok, false);
  assert.notEqual(second.result.exitCode, 0);
  assert.ok(second.result.json, 'validate --format json output is parsed');
  assert.equal(r.plan.status, 'done');
  assert.equal(process.exitCode, undefined, 'the runner process keeps its own exit code');
});

test('a write command waits for a person, and bad args are refused by plan\'s checks with a sentence', { skip }, async (t) => {
  const { api, plan } = await setup(t);
  const bad = await api.plan_add_step({ planId: plan.id, version: plan.version, by: 'agent', step: { tool: 'construct.validate', args: { dir: '.' }, why: 'Validate with a wrong argument.' } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /The arguments do not fit construct\.validate: dir is not an argument/);
  const added = await api.plan_add_step({ planId: plan.id, version: plan.version, by: 'agent', step: { tool: 'construct.generate', args: { argv: ['--help'] }, why: 'Generate a layer.' } });
  assert.equal(added.ok, true, added.reason);
  assert.equal(added.plan.steps[0].approval, 'needed');
  const run = await api.plan_run_next({ planId: plan.id, version: added.plan.version, by: 'agent' });
  assert.equal(run.ok, false);
  assert.match(run.reason, /waits for a person to approve it/);
});

test('a command that stops with an error marks the step failed with one sentence', { skip }, async (t) => {
  const { api, plan } = await setup(t);
  const added = await api.plan_add_step({ planId: plan.id, version: plan.version, by: 'agent', step: { tool: 'construct.validate', args: { argv: ['--profile'] }, why: 'Validate with a missing profile name.' } });
  const run = await api.plan_run_next({ planId: plan.id, version: added.plan.version, by: 'agent' });
  const step = run.plan.steps[0];
  assert.equal(step.status, 'failed');
  assert.match(step.error, /^The tool construct\.validate failed: construct validate stopped: --profile needs a profile name/);
});
