// #407 -- the Blocks catalogue: one row per PLAN_FLOWS entry, facts from the contract (#543), words from BLOCK_DOCS, and
// an example for every offered block that the plan validator accepts and the CLI mapping turns into the real command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_FLOWS, validatePlan, planToCommand } from '../../../packages/core/plan.mjs';
import { flowBlocks } from '../../../packages/core/block-flows.mjs';
import { BLOCK_DOCS, blockCatalogue, exampleStep, runCounts } from './blockCatalogue.mjs';
import { NOT_OFFERED } from './planService.mjs';

const ids = Object.keys(PLAN_FLOWS);

test('BLOCK_DOCS has exactly one entry per flow: a new flow cannot ship without plain words and an example', () => {
  assert.deepEqual(Object.keys(BLOCK_DOCS).sort(), [...ids].sort());
  for (const id of ids) {
    const d = BLOCK_DOCS[id];
    assert.ok(typeof d.purpose === 'string' && d.purpose.length > 10 && d.purpose.length < 140 && d.purpose.endsWith('.'), `${id} purpose is one sentence`);
    assert.ok(typeof d.reads === 'string' && d.reads.length > 0, `${id} says what it reads`);
    assert.ok(d.writes === null || (typeof d.writes === 'string' && d.writes.length > 0), `${id} says what it writes`);
    assert.equal(d.writes === null, !PLAN_FLOWS[id].writes, `${id}: "writes nothing" matches the contract's read-only flag`);
  }
});

test('the catalogue has one row per block, in registry order, with the facts from the contract', () => {
  const rows = blockCatalogue();
  assert.deepEqual(rows.map((r) => r.id), ids);
  const contract = flowBlocks();
  for (const r of rows) {
    const flow = PLAN_FLOWS[r.id];
    assert.equal(r.writesFiles, contract[r.id].writes, r.id);
    assert.equal(r.scope, contract[r.id].meta.scope, r.id);
    assert.equal(r.modelCalls, flow.executors.includes('local-model') ? 'optional' : 'none', r.id);
    assert.deepEqual(r.engines.includes('ai'), flow.executors.includes('local-model'), r.id);
    assert.equal(r.offered, !Object.hasOwn(NOT_OFFERED, r.id), r.id);
    assert.deepEqual(r.args.map((a) => a.name), Object.keys(flow.args), `${r.id} arguments come from the flow schema`);
    assert.equal(r.runs, 0);
  }
  // "model calls: 0" for everything but the four blocks that can take a model.
  assert.deepEqual(rows.filter((r) => r.modelCalls === 'optional').map((r) => r.id), ['create.layer', 'create.unit', 'import.unit', 'import.plan']);
  assert.equal(rows.filter((r) => !r.writesFiles).length, 9 + 0, '9 read-only blocks');
});

test('every offered block has an example the validator accepts, and the command it maps to is real', () => {
  for (const r of blockCatalogue()) {
    if (!r.offered) { assert.equal(r.example, null, `${r.id} is not offered, so it has no example`); continue; }
    assert.ok(r.example, `${r.id} has an example`);
    const step = exampleStep(r.id);
    const plan = { version: 1, ticket: { source: 'text', title: 'Example' }, steps: [step] };
    const { errors } = validatePlan(plan);
    assert.deepEqual(errors, [], `${r.id}: ${JSON.stringify(errors)}`);
    assert.equal(step.flow, r.id);
    if (PLAN_FLOWS[r.id].cli === null) {
      assert.equal(r.example.argv, null, 'a by-hand block has no command');
    } else {
      assert.deepEqual(r.example.argv, ['construct', ...planToCommand(step).argv]);
    }
  }
});

test('an AI example is the same step tagged local-model with the local provider, and only where the block supports it', () => {
  for (const id of ids) {
    const step = exampleStep(id, { engine: 'ai' });
    if (!step) continue;
    if (PLAN_FLOWS[id].executors.includes('local-model')) {
      assert.equal(step.executor, 'local-model', id);
      assert.equal(step.args.llm, 'ollama', id);
      assert.deepEqual(validatePlan({ version: 1, ticket: { source: 'text', title: 'x' }, steps: [step] }).errors, [], id);
    } else {
      assert.notEqual(step.executor, 'local-model', `${id} can never be shown as AI`);
      assert.equal(step.args.llm, undefined);
    }
  }
});

test('an unknown flow has no example step', () => {
  for (const id of ['nope', '__proto__', 'constructor', 'toString', '']) assert.equal(exampleStep(id), null, id);
});

test('settings are shown per block: turned off, default engine and model, defaults everywhere else', () => {
  const rows = blockCatalogue({ blocks: { validate: { enabled: false }, 'create.unit': { engine: 'ai', model: 'qwen2.5-coder:7b' } } });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.validate.settings, { enabled: false, engine: 'mechanical', provider: null, model: null });
  assert.deepEqual(by['create.unit'].settings, { enabled: true, engine: 'ai', provider: 'ollama', model: 'qwen2.5-coder:7b' });
  assert.deepEqual(by.sync.settings, { enabled: true, engine: 'mechanical', provider: null, model: null });
  assert.equal(by['create.unit'].example.executor, 'deterministic', 'the example stays the plain mechanical step; the card offers AI separately');
});

test('runCounts counts finished steps (done or failed) by the flow of their plan step, in this project only', () => {
  const rec = (planSteps, steps) => ({ plan: { steps: planSteps }, steps });
  const counts = runCounts([
    rec([{ id: 'a', flow: 'validate' }, { id: 'b', flow: 'create.unit' }, { id: 'c', flow: 'validate' }], [{ id: 'a', status: 'done' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'pending' }]),
    rec([{ id: 'a', flow: 'validate' }], [{ id: 'a', status: 'done' }]),
    rec([{ id: 'a', flow: 'nope' }, { id: 'b', flow: '__proto__' }], [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }]),
    rec([{ id: 'a', flow: 'sync' }], [{ id: 'a', status: 'skipped' }]),
    null,
    {},
  ]);
  assert.deepEqual(counts, { validate: 2, 'create.unit': 1 });
  assert.deepEqual(runCounts(undefined), {});
  assert.equal(blockCatalogue({ runs: counts }).find((r) => r.id === 'validate').runs, 2);
});
