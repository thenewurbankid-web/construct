// im2 -- Qwen repairs a failed option once from Construct's exact error (packages/core/line-decide.mjs repairOnce):
// the local model gets only the refusal sentence, the finding and the typed fixes plus the option, answers in the
// option's schema, and the repaired option is checked again; a second failure goes to the person; nothing is written
// before a person approves; Ollama down leaves the static path unchanged and says so in one sentence. Mock Qwen here;
// the live 1.5B run is `CONSTRUCT_LIVE_QWEN=1` (test/line-repair-live.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRepairAttempt, assertDecideLoopResult } from '../packages/engine/line/contract.mjs';
import { repairOnce, repairPrompt, optionSchema, ollamaPropose } from '../packages/core/line-decide.mjs';
import { createMockDecide } from '../packages/core/line-decide-mock.mjs';
import { checkOnCopy, toolArgsSchema, slotRepair, recordRepair } from '../packages/engine/line/repair.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const OPTION = { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'ordrs', name: 'StatusBadge' } };
const REFUSAL = { sentence: 'There is no feature "ordrs"; pick one of billing, orders.', code: 'UNKNOWN_FEATURE', rule: null, fixes: [{ id: 'feature:orders', sentence: 'Use the feature orders.', rank: 1 }] };
/** A mock Qwen: answers with `reply` (an object is sent as JSON) and remembers what it was asked. */
const mockQwen = (reply) => { const calls = []; const propose = async (q) => { calls.push(q); return typeof reply === 'string' ? reply : JSON.stringify(reply); }; return { propose, calls }; };
const fixed = { tool: 'line.baseOn', args: { ...OPTION.args, feature: 'orders' } };

test('repairOnce: the model gets only the error, the finding, the typed fixes and the option; its repair is checked and lands', async () => {
  const q = mockQwen(fixed);
  const checked = [];
  const a = await repairOnce(OPTION, REFUSAL, { schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: q.propose, check: (o) => { checked.push(o); return { ok: o.args.feature === 'orders' }; } });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repaired');
  assert.equal(a.attempts, 1);
  assert.equal(q.calls.length, 1, 'exactly one attempt');
  assert.deepEqual(checked, [fixed], 'the repaired option is checked again');
  assert.equal(a.model, 'qwen2.5-coder:1.5b');
  const prompt = q.calls[0].prompt;
  assert.equal(prompt, repairPrompt(OPTION, REFUSAL));
  assert.match(prompt, /^Construct refused this change\.\nError: There is no feature "ordrs"/);
  assert.match(prompt, /Finding: UNKNOWN_FEATURE/);
  assert.match(prompt, /Typed fix 1: Use the feature orders\./);
  assert.match(prompt, /Change: \{"tool":"line\.baseOn"/);
  assert.ok(prompt.length < 800, 'a small, fixed prompt');
  // The output is constrained to the option's schema: the tool is fixed, the arguments are the tool's own.
  assert.deepEqual(q.calls[0].schema.properties.tool, { type: 'string', enum: ['line.baseOn'] });
  assert.deepEqual(Object.keys(q.calls[0].schema.properties.args.properties).sort(), ['feature', 'libraryId', 'name']);
});

test('repairOnce: a second failure goes to the person; a reply outside the schema or the same change is not checked', async () => {
  const still = await repairOnce(OPTION, REFUSAL, { propose: mockQwen(fixed).propose, check: () => ({ ok: false, refusal: { sentence: 'The name StatusBadge is taken in orders.', code: 'NAME_TAKEN' } }) });
  assertRepairAttempt(still);
  assert.equal(still.outcome, 'still-refused');
  assert.match(still.sentence, /^The local model's one repair was refused too \(The name StatusBadge is taken in orders\), so you decide\.$/);
  let checks = 0;
  for (const reply of [{ tool: 'line.promote', args: {} }, { tool: 'line.baseOn', args: { ...fixed.args, extra: 1 } }, 'not json']) {
    const bad = await repairOnce(OPTION, REFUSAL, { schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: mockQwen(reply).propose, check: () => { checks += 1; return { ok: true }; } });
    assertRepairAttempt(bad);
    assert.equal(bad.outcome, 'invalid');
  }
  const same = await repairOnce(OPTION, REFUSAL, { propose: mockQwen(OPTION).propose, check: () => { checks += 1; return { ok: true }; } });
  assert.equal(same.outcome, 'unchanged');
  assert.equal(checks, 0);
});

test('repairOnce: Ollama not running leaves the static path unchanged and says so in one sentence', async () => {
  const fetchDown = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };
  const a = await repairOnce(OPTION, REFUSAL, { propose: (q) => ollamaPropose({ ...q, fetch: /** @type {any} */ (fetchDown) }), check: () => { throw new Error('never checked'); } });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'no-model');
  assert.equal(a.attempts, 0);
  assert.equal(a.sentence, 'The local model qwen2.5-coder:1.5b is not running, so Line did not try a repair and the static path is unchanged.');
  // Ollama's structured output: the request carries the schema as `format` and the 1.5B model.
  let body = null;
  const fetchUp = async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ response: JSON.stringify(fixed) }) }; };
  const ok = await repairOnce(OPTION, REFUSAL, { propose: (q) => ollamaPropose({ ...q, fetch: /** @type {any} */ (fetchUp) }), check: () => ({ ok: true }) });
  assert.equal(ok.outcome, 'repaired');
  assert.equal(body.model, 'qwen2.5-coder:1.5b');
  assert.equal(body.format.properties.tool.enum[0], 'line.baseOn');
  assert.equal(body.options.temperature, 0);
});

/** A plan where every option waits for a person's approval; Construct checks it on a copy first (nothing written). */
function fakePlan() {
  const waiting = []; const written = [];
  const construct = (o) => (o.args.feature === 'orders' ? { ok: true } : { ok: false, refusal: REFUSAL });
  return {
    waiting, written,
    add: (o) => { const r = construct(o); if (r.ok) waiting.push(o); return r; },
    approve: () => { written.push(...waiting.splice(0)); },
  };
}

test('decideUntilAccepted: the option jev chose is refused, repaired once by the model, lands as a waiting step; nothing is written before approval', async () => {
  const plan = fakePlan();
  const q = mockQwen(fixed);
  const opts = [{ id: 'ordrs', label: 'In ordrs' }, { id: 'billing', label: 'In billing' }];
  const loop = await createMockDecide({ pick: 0 }).decideUntilAccepted('construct.chooser', opts, {}, {
    apply: (id) => plan.add({ ...OPTION, args: { ...OPTION.args, feature: id } }),
    optionOf: (id) => ({ ...OPTION, args: { ...OPTION.args, feature: id } }),
    applyOption: (o) => plan.add(o),
    repair: { propose: q.propose },
  });
  assertDecideLoopResult(loop);
  assert.equal(loop.outcome, 'accepted');
  assert.equal(loop.rounds.length, 1);
  assert.equal(loop.rounds[0].decision.via, 'jev');
  assert.equal(loop.rounds[0].repair.outcome, 'repaired', 'the attempt is kept in the decision trace');
  assert.deepEqual(plan.waiting, [fixed]);
  assert.deepEqual(plan.written, [], 'nothing is written before a person approves');
  plan.approve();
  assert.deepEqual(plan.written, [fixed]);
});

test('decideUntilAccepted: the repair refused too asks the person one question; a static choice is never repaired', async () => {
  const opts = [{ id: 'ordrs', label: 'In ordrs' }, { id: 'billing', label: 'In billing' }];
  const run = (q) => ({ apply: () => ({ ok: false, refusal: REFUSAL }), optionOf: (id) => ({ ...OPTION, args: { ...OPTION.args, feature: id } }), applyOption: () => ({ ok: false, refusal: { sentence: 'The name StatusBadge is taken in orders.' } }), repair: { propose: q.propose } });
  const q1 = mockQwen(fixed);
  const loop = await createMockDecide({ pick: 0 }).decideUntilAccepted('construct.chooser', opts, {}, run(q1));
  assertDecideLoopResult(loop);
  assert.equal(loop.outcome, 'ask');
  assert.equal(loop.rounds.at(-1).repair.outcome, 'still-refused');
  assert.match(loop.question.sentence, /^The name StatusBadge is taken in orders\. Which fix should Line try\?$/);
  assert.equal(q1.calls.length, 1);
  // Static order (no jev, no Qwen): no repair, the loop goes on with the typed fixes as before.
  const q2 = mockQwen(fixed);
  const st = await createMockDecide().decideUntilAccepted('construct.chooser', opts, {}, run(q2));
  assertDecideLoopResult(st);
  assert.equal(q2.calls.length, 0);
  assert.ok(st.rounds.every((r) => r.repair === undefined));
});

test('Construct check on a copy: the refused option and its repair, on the Line sample; the sample is untouched; the record is slotted', async () => {
  const before = fs.readdirSync(path.join(SAMPLE, 'features/orders/components')).sort();
  const first = checkOnCopy(SAMPLE, OPTION);
  assert.equal(first.ok, false);
  assert.match(first.refusal.sentence, /ordrs/);
  const a = await repairOnce(OPTION, first.refusal, { schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: mockQwen(fixed).propose, check: (o) => checkOnCopy(SAMPLE, o) });
  assert.equal(a.outcome, 'repaired');
  assert.deepEqual(fs.readdirSync(path.join(SAMPLE, 'features/orders/components')).sort(), before, 'nothing written to the project');
  const rec = slotRepair(a, readLineProject(SAMPLE), { where: 'drafter', at: '2026-10-12T00:00:00.000Z' });
  const text = JSON.stringify(rec);
  for (const name of ['orders', 'Badge', 'StatusBadge']) assert.ok(!text.includes(`"${name}"`) && !text.includes(`/${name}`), `no ${name} in ${text}`);
  assert.equal(rec.before.tool, 'line.baseOn');
  assert.equal(rec.outcome, 'repaired');
  let line = '';
  assert.equal(recordRepair(SAMPLE, a, { where: 'drafter', write: (l) => { line = l; } }).ok, true);
  assert.equal(JSON.parse(line).kind, 'repair');
});
