// #524 (epic #616), scoped in LIN-82 -- the debug chain (reproduce -> isolate -> fix -> verify) is the second worked
// example the harness needs before any general engine. Every option is a real chooser.mjs option over an existing
// Zero-LLM PLAN_FLOWS flow, so the chain compiles to a plan the same way any other chooser chain does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooserSummary, compileChain, validateChooser } from '../packages/core/chooser.mjs';
import { GUARDRAILS } from '../packages/core/block-contract.mjs';
import { buildDebugChain, debugChainSteps, shouldReiterate } from '../packages/core/debug-chain.mjs';

test('buildDebugChain needs a non-empty feature name', () => {
  assert.throws(() => buildDebugChain(''), TypeError);
  assert.throws(() => buildDebugChain(undefined), TypeError);
});

test('every chooser of the chain is independently valid', () => {
  const chain = buildDebugChain('cart');
  for (const chooser of debugChainSteps(chain)) {
    assert.equal(validateChooser(chooser).valid, true, `${chooser.id} should validate`);
  }
});

test('the chain asks the four named questions, each with 2-5 options', () => {
  const chain = buildDebugChain('cart');
  const [reproduce, isolate, fix, verify] = debugChainSteps(chain);
  assert.equal(reproduce.id, 'debug.reproduce');
  assert.equal(isolate.id, 'debug.isolate');
  assert.equal(fix.id, 'debug.fix');
  assert.equal(verify.id, 'debug.verify');
  for (const chooser of [reproduce, isolate, fix, verify]) {
    assert.ok(chooser.options.length >= 2 && chooser.options.length <= 5);
  }
});

test('debug.fix exits as an ai fill carrying every guardrail, not a new free ChooserExit kind (LIN-82 decision a)', () => {
  const { fix } = buildDebugChain('cart');
  assert.equal(fix.exit.kind, 'ai');
  assert.deepEqual([...fix.exit.gates].sort(), [...GUARDRAILS].sort());
});

test('a summary of any step is a fixed, small, capped-text shape', () => {
  const { reproduce } = buildDebugChain('cart');
  const summary = chooserSummary(reproduce, {});
  assert.equal(summary.id, 'debug.reproduce');
  assert.ok(summary.options.length <= 5);
  for (const option of summary.options) assert.ok(option.label.length <= 60);
});

test('a full answer set (excluding the ai exit) compiles to a valid, ordered plan', () => {
  const chain = buildDebugChain('cart');
  const steps = debugChainSteps(chain);
  const result = compileChain(
    steps,
    {
      'debug.reproduce': 'playwright-test',
      'debug.isolate': 'narrow',
      'debug.fix': 'add-unit',
      'debug.verify': 'rerun-repro',
    },
    { root: process.cwd() },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.plan.steps.length, 4);
  assert.deepEqual(
    result.plan.steps.map((s) => s.flow),
    ['test.run', 'test.run', 'create.unit', 'test.run'],
  );
  for (let i = 1; i < result.plan.steps.length; i += 1) {
    assert.deepEqual(result.plan.steps[i].dependsOn, [result.plan.steps[i - 1].id]);
  }
});

test('answering debug.fix with its exit is rejected: an ai fill is a reviewable diff, not a plan step', () => {
  const chain = buildDebugChain('cart');
  const steps = debugChainSteps(chain);
  const result = compileChain(
    steps,
    {
      'debug.reproduce': 'playwright-test',
      'debug.isolate': 'narrow',
      'debug.fix': 'exit',
      'debug.verify': 'rerun-repro',
    },
    { root: process.cwd() },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.code), ['CHAIN_ANSWER_EXIT_UNSUPPORTED']);
});

test('shouldReiterate: only an explicit pass ends the debug.verify loop', () => {
  assert.equal(shouldReiterate({ passed: false }), true);
  assert.equal(shouldReiterate({ passed: true }), false);
  assert.equal(shouldReiterate(undefined), true);
  assert.equal(shouldReiterate({}), true);
});
