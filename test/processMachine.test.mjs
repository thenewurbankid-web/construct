// #287 — the process lifecycle machine.
//
// The load-bearing test here is the last one: PROCESS_MACHINE is rendered as
// real source and fed to workflowExtractor.mjs, the same parser that reads a
// user's own machines, and the description this module builds by hand must
// match the one the parser derives. That is what makes "it is a real XState
// machine" a checked claim rather than a comment, given core src/ deliberately
// does not depend on `xstate`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROCESS_MACHINE,
  PROCESS_STATES,
  PROCESS_EVENTS,
  RUNNING_SUBSTATES,
  TERMINAL_STATES,
  PROCESS_GUARDS,
  transition,
  allowedEvents,
  initialProcessState,
  resolveEntry,
  topLevelState,
  isTerminal,
  describeProcessMachine,
  narrateProcessLifecycle,
  processLifecycleScenarios,
} from '../packages/engine/processMachine.mjs';
import { extractMachines } from '../packages/engine/workflowExtractor.mjs';

test('the state set is exactly what the ticket specifies, and running is the only compound one', () => {
  assert.deepEqual(PROCESS_STATES, ['queued', 'running', 'paused', 'failed', 'done', 'cancelled']);
  assert.deepEqual(Object.keys(PROCESS_MACHINE.states), PROCESS_STATES);
  assert.deepEqual(Object.keys(PROCESS_MACHINE.states.running.states), RUNNING_SUBSTATES);
  assert.equal(initialProcessState(), 'queued');
  assert.equal(resolveEntry('running'), 'running.active', 'entering a compound state enters its initial child');
});

test('only done and cancelled are terminal — failed still accepts retry, which #292 puts next to pause and cancel', () => {
  assert.deepEqual(TERMINAL_STATES, ['done', 'cancelled']);
  assert.equal(isTerminal('failed'), false);
  assert.deepEqual(allowedEvents('failed'), ['CANCEL', 'RETRY']);
  assert.deepEqual(allowedEvents('done'), []);
  assert.deepEqual(allowedEvents('cancelled'), []);
});

// Every transition, spelled out. A change to the lifecycle has to be a
// deliberate edit to this table, not a silent consequence.
const TRANSITIONS = [
  ['queued', 'START', {}, 'running.active'],
  ['queued', 'CANCEL', {}, 'cancelled'],
  ['queued', 'PAUSE', {}, null],
  ['queued', 'RESUME', {}, null],
  ['running.active', 'PAUSE', {}, 'running.stopping'],
  ['running.active', 'CANCEL', {}, 'running.stopping'],
  ['running.active', 'STEP_FAILED', {}, 'failed'],
  ['running.active', 'FINISHED', {}, 'done'],
  ['running.active', 'STEP_COMPLETED', {}, 'running.active'],
  ['running.active', 'RESUME', {}, null],
  ['running.active', 'YIELDED', {}, null],
  ['running.stopping', 'YIELDED', { pendingControl: 'cancel' }, 'cancelled'],
  ['running.stopping', 'YIELDED', { pendingControl: 'pause' }, 'paused'],
  ['running.stopping', 'YIELDED', {}, 'paused'],
  ['running.stopping', 'STEP_FAILED', {}, 'failed'],
  ['running.stopping', 'FINISHED', {}, 'done'],
  ['paused', 'RESUME', {}, 'running.active'],
  ['paused', 'CANCEL', {}, 'cancelled'],
  ['paused', 'PAUSE', {}, null],
  ['failed', 'RETRY', {}, 'running.active'],
  ['failed', 'CANCEL', {}, 'cancelled'],
  ['failed', 'RESUME', {}, null],
  ['done', 'RETRY', {}, null],
  ['done', 'CANCEL', {}, null],
  ['cancelled', 'RESUME', {}, null],
];

test('every transition behaves exactly as the table says, and an unaccepted event returns null rather than doing nothing quietly', () => {
  for (const [from, event, context, expected] of TRANSITIONS) {
    const result = transition(from, event, context);
    if (expected === null) {
      assert.equal(result, null, `${from} should not accept ${event}`);
    } else {
      assert.equal(result?.value, expected, `${from} + ${event} should reach ${expected}`);
    }
  }
});

test('a step completing is not a lifecycle change — it is a targetless transition, so progress never looks like a state change', () => {
  const result = transition('running.active', 'STEP_COMPLETED', {});
  assert.equal(result.changed, false);
  assert.equal(result.value, 'running.active');
  assert.deepEqual(result.actions, ['recordStepResult']);
});

test('STEP_FAILED and FINISHED are declared on the compound parent, so they fire while a step is winding down too', () => {
  // The event bubbles from running.stopping up to running.
  assert.equal(transition('running.stopping', 'STEP_FAILED', {}).value, 'failed');
  assert.equal(transition('running.active', 'STEP_FAILED', {}).value, 'failed');
});

test('the cancel guard is what separates the two YIELDED outcomes', () => {
  assert.equal(PROCESS_GUARDS.cancelRequested({ pendingControl: 'cancel' }), true);
  assert.equal(PROCESS_GUARDS.cancelRequested({ pendingControl: 'pause' }), false);
  assert.equal(PROCESS_GUARDS.cancelRequested({}), false);
  assert.deepEqual(
    transition('running.stopping', 'YIELDED', { pendingControl: 'cancel' }).actions,
    ['discardStepTransaction', 'markFinished'],
  );
});

test('topLevelState keeps #292 on the six-state vocabulary even while the machine is in a substate', () => {
  assert.equal(topLevelState('running.stopping'), 'running');
  assert.equal(topLevelState('paused'), 'paused');
  for (const [from] of TRANSITIONS) assert.ok(PROCESS_STATES.includes(topLevelState(from)));
});

test('allowedEvents is the authority a UI enables its buttons from', () => {
  assert.deepEqual(allowedEvents('queued'), ['START', 'CANCEL']);
  assert.deepEqual(allowedEvents('running.active'), ['STEP_COMPLETED', 'STEP_FAILED', 'FINISHED', 'PAUSE', 'CANCEL']);
  assert.deepEqual(allowedEvents('paused'), ['CANCEL', 'RESUME']);
  for (const event of PROCESS_EVENTS) {
    assert.equal(transition('done', event, {}), null, `a finished process must accept nothing, including ${event}`);
  }
});

test('the lifecycle narrates itself in plain English through the same block that explains users\' workflows', () => {
  const narration = narrateProcessLifecycle();
  assert.match(narration.summary, /starts in \*queued\* and can end in \*done\* or \*cancelled\*/);
  const stopping = narration.states.find((s) => s.path === 'running.stopping');
  assert.equal(
    stopping.sentences.some((s) => s.includes('the flow moves to *cancelled*') && s.includes('only if the "cancel requested" condition holds')),
    true,
    'the guard that decides pause-vs-cancel must be explained, not just implemented',
  );
  const running = narration.states.find((s) => s.path === 'running');
  assert.equal(running.kind, 'compound');
  assert.equal(running.sentences.some((s) => s.includes('made up of 2 smaller steps')), true);
});

test('the lifecycle is structurally healthy: no unreachable state, no dead end', () => {
  const { scenarios, health, total } = processLifecycleScenarios();
  assert.deepEqual(health, [], 'a lifecycle with an unreachable or stuck state is a bug, not a style choice');
  assert.equal(total > 5, true);
  const happy = scenarios[0];
  assert.equal(happy.happy, true);
  assert.deepEqual(happy.events, ['START', 'FINISHED']);
  assert.equal(happy.end.state, 'done');
  // A route that cancels mid-step exists and ends cancelled.
  assert.equal(
    scenarios.some((s) => s.events.join(',') === 'START,CANCEL,YIELDED' && s.end.state === 'cancelled'),
    true,
  );
});

// --- the claim that it really is XState ------------------------------------

/** Render PROCESS_MACHINE as the source a user would have written. */
function asSource() {
  return `import { createMachine } from 'xstate';\nexport const processMachine = createMachine(${JSON.stringify(PROCESS_MACHINE, null, 2)});\n`;
}

const stripLines = (machine) => ({
  id: machine.id,
  exportName: machine.exportName,
  initial: machine.initial,
  error: machine.error,
  states: machine.states.map(({ line, ...rest }) => rest),
  transitions: machine.transitions,
  context: machine.context,
});

test('PROCESS_MACHINE is a real XState config: the repo\'s own extractor parses it into exactly the description this module builds by hand', () => {
  const { machines, error } = extractMachines(asSource());
  assert.equal(error, null);
  assert.equal(machines.length, 1);
  assert.equal(machines[0].error, null, 'a machine the extractor cannot analyse is not a machine Construct can explain');

  assert.deepEqual(stripLines(machines[0]), stripLines(describeProcessMachine()));
});

test('the narration derived from real parsed source is identical to the one this module produces', async () => {
  const { narrateMachine } = await import('../packages/engine/workflowNarrator.mjs');
  const parsed = extractMachines(asSource()).machines[0];
  assert.equal(narrateMachine(parsed).text, narrateProcessLifecycle().text);
});
