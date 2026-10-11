// cu1 -- the two thin adapters over the linked Line modules, tested against mocks only (packages/line-links/mocks.mjs):
// @mx/reason as a decision provider, and @mx/plan's registry over Construct's command registry. No source repo needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReasonProvider, registerReasonProvider, REASON_PROVIDER_NAME } from '../packages/core/reason-provider.mjs';
import { suggest, unregisterDecisionProvider } from '../packages/core/decision-provider.mjs';
import { commandPlanRegistry, commandToolName, ARGV_SCHEMA } from '../packages/core/plan-registry.mjs';
import { createCommandRegistry } from '../packages/core/command-registry.mjs';
import { createMockReason, createMockPicker, createMockPlanRunner } from '../packages/line-links/mocks.mjs';

const summary = (ids, disabled = []) => ({ id: 'next.step', question: 'What next?', options: ids.map((id) => ({ id, label: id, enabled: !disabled.includes(id), why: '' })), chosen: null });

test('reason provider: one enabled option is decided by the static step, no picker asked', async () => {
  const picker = createMockPicker(0);
  const p = createReasonProvider({ loadReason: async () => createMockReason(), picker });
  assert.deepEqual(await p.suggest(summary(['a', 'b'], ['b'])), { option: 'a', reason: 'It is the only step that passed the checks.', runnerUp: null });
  assert.equal(picker.calls.length, 0);
});

test('reason provider: several options and no model keep the static order', async () => {
  const p = createReasonProvider({ loadReason: async () => createMockReason() });
  const s = await p.suggest(summary(['a', 'b', 'c']));
  assert.equal(s.option, 'a');
  assert.equal(s.runnerUp, 'b');
  assert.match(s.reason, /no model was asked/);
});

test('reason provider: with jev up, its pick is the suggestion and only enabled options reach it', async () => {
  const picker = createMockPicker(1);
  const p = createReasonProvider({ loadReason: async () => createMockReason(), picker });
  const s = await p.suggest(summary(['a', 'b', 'c'], ['b']));
  assert.deepEqual(picker.calls, [['a', 'c']]);
  assert.equal(s.option, 'c');
  assert.equal(s.runnerUp, 'a');
});

test('reason provider: reason not linked -> static answer that says so in plain English', async () => {
  const p = createReasonProvider({ loadReason: async () => null });
  const s = await p.suggest(summary(['x', 'y']));
  assert.deepEqual(s, { option: 'x', reason: 'First available step; the reason module is not linked, so Line used the static order.', runnerUp: 'y' });
});

test('reason provider: a throwing reason module falls back to the static answer', async () => {
  const p = createReasonProvider({ loadReason: async () => createMockReason({ fail: true }) });
  const s = await p.suggest(summary(['x', 'y']));
  assert.equal(s.option, 'x');
  assert.match(s.reason, /reason module failed/);
  assert.match(p.lastNote(), /mock reason failure/);
});

test('reason provider: nothing enabled -> abstains', async () => {
  const p = createReasonProvider({ loadReason: async () => createMockReason() });
  assert.equal(await p.suggest(summary(['a'], ['a'])), null);
});

test('reason provider registers in the decision-provider seam and its answer is validated there', async () => {
  registerReasonProvider({ loadReason: async () => createMockReason() });
  try {
    const s = await suggest(summary(['a', 'b']), { provider: REASON_PROVIDER_NAME });
    assert.equal(s.option, 'a');
    assert.equal(s.provider, 'reason');
    assert.equal(s.version, 'reason-adapter-1');
  } finally {
    unregisterDecisionProvider(REASON_PROVIDER_NAME);
  }
});

function fakeCommands() {
  const commands = createCommandRegistry();
  commands.register({ name: 'validate', summary: 'Run the enforcers', handler: async (argv) => { console.log(JSON.stringify({ argv })); } });
  commands.register({ name: 'check-change', summary: 'Verdict for an edit', handler: () => { console.error('warn'); process.exitCode = 3; } });
  commands.register({ name: 'generate', summary: 'Scaffold a layer', handler: () => { throw new Error('Unknown layer "x".\nmore detail'); } });
  commands.register({ name: 'repl', summary: 'Interactive', handler: () => process.exit(0) });
  commands.register({ name: 'doctor', summary: 'Report', handler: () => process.exit(2) });
  return commands;
}

test('plan registry: tool names, read/write marks and sentences come from the command registry', () => {
  const reg = commandPlanRegistry(fakeCommands());
  const specs = reg.list();
  assert.deepEqual(specs.map((t) => t.name), ['construct.checkChange', 'construct.doctor', 'construct.generate', 'construct.validate']);
  assert.deepEqual(Object.fromEntries(specs.map((t) => [t.name, t.kind])), { 'construct.checkChange': 'read', 'construct.doctor': 'read', 'construct.generate': 'write', 'construct.validate': 'read' });
  assert.equal(specs.find((t) => t.name === 'construct.validate').describe, 'Run the enforcers.');
  assert.equal(commandToolName('add-rule'), 'construct.addRule');
  assert.equal(commandPlanRegistry(fakeCommands(), { only: ['validate'] }).list().length, 1);
});

test('plan registry: the args schema takes argv strings only, with a plain reason otherwise', () => {
  assert.deepEqual(ARGV_SCHEMA.safeParse({}), { success: true, data: { argv: [] } });
  assert.equal(ARGV_SCHEMA.safeParse({ argv: [1] }).success, false);
  assert.equal(ARGV_SCHEMA.safeParse({ dir: '.' }).error.issues[0].path[0], 'dir');
});

test('plan registry: a call runs the handler with argv and returns its captured output and exit code', async () => {
  const reg = commandPlanRegistry(fakeCommands());
  const r = await reg.call('construct.validate', { argv: ['--format', 'json'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json, { argv: ['--format', 'json'] });
  const c = await reg.call('construct.checkChange', {});
  assert.deepEqual([c.ok, c.exitCode, c.stderr], [false, 3, 'warn\n']);
  assert.equal(process.exitCode, undefined, 'the exit code is restored after the call');
  const d = await reg.call('construct.doctor', {});
  assert.deepEqual([d.ok, d.exitCode], [false, 2]);
});

test('plan registry: a command that throws, an unknown tool and bad args each throw one sentence', async () => {
  const reg = commandPlanRegistry(fakeCommands());
  await assert.rejects(reg.call('construct.generate', {}), { message: 'construct generate stopped: Unknown layer "x"' });
  await assert.rejects(reg.call('construct.repl', {}), /no tool named construct.repl/);
  await assert.rejects(reg.call('construct.validate', { argv: 'x' }), /argv must be a list of strings/);
});

test('plan registry under a (mock) plan runner: steps are checked, then run through registry.call', async () => {
  const runner = createMockPlanRunner(commandPlanRegistry(fakeCommands()));
  assert.match(runner.add({ tool: 'construct.nope', args: {} }), /no tool/);
  assert.match(runner.add({ tool: 'construct.generate', args: {}, kind: 'read' }), /marked write/);
  assert.equal(runner.add({ tool: 'construct.validate', args: { argv: ['--x'] } }), null);
  const s = await runner.runNext();
  assert.equal(s.status, 'done');
  assert.deepEqual(s.result.json, { argv: ['--x'] });
});
