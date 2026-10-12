// im2 -- the local model repairs a failed option from Construct's exact error (packages/core/line-decide.mjs repairLoop; owner,
// 12 Oct: up to 4 attempts, each reasoning from every earlier attempt and its refusal). The local model gets only the
// refusal sentence, the finding, the typed fixes, the option and its own earlier attempts; it answers a short reason and
// the option in the option's schema; each repaired option is checked again; it stops when one lands, repeats an earlier
// one, or passes no more checks; then the person decides with every attempt listed. One progress sentence per attempt.
// Nothing is written before a person approves; Ollama down leaves the static path unchanged with one sentence. Mock Qwen
// here; the live 1.5B run is `CONSTRUCT_LIVE_QWEN=1` (test/line-repair-live.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRepairAttempt } from '../packages/engine/line/contract.mjs';
import { repairLoop, repairPrompt, optionSchema, ollamaPropose } from '../packages/core/line-decide.mjs';
import { profilesWithOn } from '../packages/core/line-decide-mock.mjs';
import { checkOnCopy, toolArgsSchema, slotRepair, recordRepair } from '../packages/engine/line/repair.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const OPTION = { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'ordrs', name: 'StatusBadge' } };
const REFUSAL = { sentence: 'There is no feature "ordrs"; pick one of billing, orders.', code: 'UNKNOWN_FEATURE', rule: null, fixes: [{ id: 'feature:orders', sentence: 'Use the feature orders.', rank: 1 }] };
/** A mock Qwen: answers `replies` in turn (the last one repeats; an object is sent as JSON) and remembers what it was asked. */
const mockQwen = (...replies) => { const calls = []; const propose = async (q) => { const r = replies[Math.min(calls.length, replies.length - 1)]; calls.push(q); return typeof r === 'string' ? r : JSON.stringify(r); }; return { propose, calls }; };
const fixed = { tool: 'line.baseOn', args: { ...OPTION.args, feature: 'orders' } };
const withFeature = (feature, reason) => ({ reason, tool: 'line.baseOn', args: { ...OPTION.args, feature } });
/** Construct, mocked: only feature "orders" lands; anything else is refused with what was wrong. */
const construct = (o) => (o.args.feature === 'orders' ? { ok: true } : { ok: false, refusal: { sentence: `There is no feature "${o.args.feature}".`, code: 'UNKNOWN_FEATURE' } });

test('repairLoop: the model gets only the error, the finding, the typed fixes and the option; a reason comes first; its repair is checked and lands', async () => {
  const q = mockQwen({ reason: 'The feature ordrs does not exist; orders does.', ...fixed });
  const checked = [];
  const a = await repairLoop(OPTION, REFUSAL, { reason: true, schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: q.propose, check: (o) => { checked.push(o); return construct(o); } });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repaired');
  assert.equal(a.attempts, 1);
  assert.equal(a.maxAttempts, 4, 'construct.repair maxAttempts, default 4');
  assert.deepEqual(checked, [fixed], 'the repaired option is checked again');
  assert.equal(a.tries[0].reason, 'The feature ordrs does not exist; orders does.', 'the reason is on the trace');
  assert.equal(a.model, 'qwen2.5-coder:1.5b');
  const prompt = q.calls[0].prompt;
  assert.equal(prompt, repairPrompt(OPTION, REFUSAL));
  assert.match(prompt, /^Construct refused this change\.\nError: There is no feature "ordrs"/);
  assert.match(prompt, /Finding: UNKNOWN_FEATURE/);
  assert.match(prompt, /Typed fix 1: Use the feature orders\./);
  assert.match(prompt, /Change: \{"tool":"line\.baseOn"/);
  assert.ok(prompt.length < 900, 'a small, fixed prompt');
  // The output is grammar-constrained: a short reason first, then the option in its own schema.
  const schema = q.calls[0].schema;
  assert.deepEqual(Object.keys(schema.properties), ['reason', 'tool', 'args']);
  assert.deepEqual(schema.required, ['reason', 'tool', 'args']);
  assert.deepEqual(schema.properties.tool, { type: 'string', enum: ['line.baseOn'] });
  assert.deepEqual(Object.keys(schema.properties.args.properties).sort(), ['feature', 'libraryId', 'name']);
});

test('repairLoop: mock Qwen lands on attempt 3; each attempt sees every earlier one with its refusal; progress sentences come in order', async () => {
  const q = mockQwen(withFeature('order', 'The feature is orders, not ordrs; trying order.'), withFeature('ordres', 'Attempt 1 was refused; trying ordres.'), withFeature('orders', 'Both were refused; the error lists orders.'));
  const progress = [];
  const a = await repairLoop(OPTION, REFUSAL, { reason: true, propose: q.propose, check: construct, onProgress: (s, n) => progress.push([n, s]) });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repaired');
  assert.equal(a.attempts, 3);
  assert.deepEqual(a.tries.map((t) => t.outcome), ['refused', 'refused', 'landed']);
  assert.deepEqual(a.option, fixed);
  assert.equal(a.sentence, 'The local model repaired the change on attempt 3 of 4, and Construct accepts it.');
  assert.doesNotMatch(q.calls[0].prompt, /Attempt 1:/);
  assert.match(q.calls[2].prompt, /Attempt 1: .*"feature":"order".* was refused too: There is no feature "order"\.\nAttempt 2: .*"feature":"ordres".* was refused too: There is no feature "ordres"\.\nDo not repeat a change that was already refused\./);
  assert.deepEqual(progress, [
    [1, 'Line is asking the local model to repair it (1 of 4): the feature is orders, not ordrs; trying order.'],
    [2, 'Line is trying again (2 of 4): attempt 1 was refused; trying ordres.'],
    [3, 'Line is trying again (3 of 4): both were refused; the error lists orders.'],
  ]);
  assert.deepEqual(a.progress, progress.map(([, s]) => s), 'the live line is on the trace too');
});

test('repairLoop: an identical repeat stops early; passing no more checks stops early', async () => {
  const q = mockQwen(withFeature('order', 'Try order.'), withFeature('order', 'Try order again.'));
  const a = await repairLoop(OPTION, REFUSAL, { propose: q.propose, check: construct });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repeated');
  assert.equal(a.attempts, 2);
  assert.equal(q.calls.length, 2, 'no third attempt');
  assert.match(a.sentence, /^The local model repeated a change that was already refused, so Line stopped and you decide; all 2 attempts are under Details\.$/);
  let n = 0;
  const flat = await repairLoop(OPTION, REFUSAL, { propose: mockQwen(withFeature('a', 'a'), withFeature('b', 'b'), withFeature('c', 'c')).propose, check: () => ({ ok: false, refusal: { sentence: 'Still wrong.' }, passed: [1, 1, 2][n++] }) });
  assertRepairAttempt(flat);
  assert.equal(flat.outcome, 'no-better');
  assert.equal(flat.attempts, 2);
  // The model giving back the refused change itself: nothing to check.
  const same = await repairLoop(OPTION, REFUSAL, { propose: mockQwen(OPTION).propose, check: () => { throw new Error('never checked'); } });
  assert.equal(same.outcome, 'unchanged');
});

test('repairLoop: 4 failures go to the person with every attempt listed; replies outside the schema count as attempts', async () => {
  const q = mockQwen(withFeature('a1', 'One.'), { tool: 'line.promote', args: {} }, withFeature('a3', 'Three.'), withFeature('a4', 'Four.'));
  const a = await repairLoop(OPTION, REFUSAL, { schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: q.propose, check: construct });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'still-refused');
  assert.equal(a.attempts, 4);
  assert.deepEqual(a.tries.map((t) => [t.n, t.outcome]), [[1, 'refused'], [2, 'invalid'], [3, 'refused'], [4, 'refused']]);
  assert.equal(a.progress.length, 4);
  assert.deepEqual(a.after, { sentence: 'There is no feature "a4".', rule: null, code: 'UNKNOWN_FEATURE' });
  assert.equal(a.sentence, 'The local model did not repair it in 4 attempts (the last was refused: There is no feature "a4"), so you decide; all 4 attempts are under Details.');
  // maxAttempts is configurable; one attempt keeps the old wording.
  const once = await repairLoop(OPTION, REFUSAL, { maxAttempts: 1, propose: mockQwen(withFeature('a1', 'One.')).propose, check: construct });
  assertRepairAttempt(once);
  assert.equal(once.attempts, 1);
  assert.match(once.sentence, /^The local model's repair was refused too \(There is no feature "a1"\), so you decide\.$/);
  const bad = await repairLoop(OPTION, REFUSAL, { maxAttempts: 1, propose: mockQwen('not json').propose, check: construct });
  assert.equal(bad.outcome, 'invalid');
});

test('repairLoop: Ollama not running leaves the static path unchanged and says so in one sentence', async () => {
  const fetchDown = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };
  const a = await repairLoop(OPTION, REFUSAL, { propose: (q) => ollamaPropose({ ...q, fetch: /** @type {any} */ (fetchDown) }), check: () => { throw new Error('never checked'); } });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'no-model');
  assert.equal(a.attempts, 0);
  assert.equal(a.sentence, 'The local model qwen2.5-coder:1.5b is not running, so Line did not try a repair and the static path is unchanged.');
  // Ollama's structured output: the request carries the schema as `format` and the 1.5B model.
  let body = null;
  const fetchUp = async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ response: JSON.stringify({ reason: 'Use orders.', ...fixed }) }) }; };
  const ok = await repairLoop(OPTION, REFUSAL, { propose: (q) => ollamaPropose({ ...q, fetch: /** @type {any} */ (fetchUp) }), check: construct });
  assert.equal(ok.outcome, 'repaired');
  assert.equal(body.model, 'qwen2.5-coder:1.5b');
  assert.equal(body.format.properties.tool.enum[0], 'line.baseOn');
  assert.equal(body.format.properties.reason, undefined, 'the default asks for the option only (variant A)');
  assert.match(JSON.parse(JSON.stringify(body)).prompt, /Answer with the corrected change as JSON \{"tool", "args"\}/);
  assert.equal(body.options.temperature, 0);
});


test('repairLoop: the construct.repair profile off (no measured win) asks no model; the person decides', async () => {
  const off = profilesWithOn([]);
  for (const p of off.data.profiles) if (p.step === 'construct.repair') p.ladder = { ...p.ladder, options: { ...p.ladder.options, on: false } };
  const q = mockQwen(fixed);
  const a = await repairLoop(OPTION, REFUSAL, { profiles: off, propose: q.propose, check: construct });
  assertRepairAttempt(a);
  assert.deepEqual([a.outcome, a.attempts, a.option, q.calls.length], ['off', 0, null, 0]);
  assert.match(a.sentence, /off in its profile/);
});

test('Construct check on a copy: the refused option and its repair, on the Line sample; the sample is untouched; the record is slotted', async () => {
  const before = fs.readdirSync(path.join(SAMPLE, 'features/orders/components')).sort();
  const first = checkOnCopy(SAMPLE, OPTION);
  assert.equal(first.ok, false);
  assert.match(first.refusal.sentence, /ordrs/);
  const a = await repairLoop(OPTION, first.refusal, { schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose: mockQwen(fixed).propose, check: (o) => checkOnCopy(SAMPLE, o) });
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
