// #948 item 2 -- the repair loop is modelled: a code tool (line.setCode, line.setFragment) is never repaired as JSON;
// it goes through the prefilled one-function fill. The JSON repair prompt shows only the last refused attempt plus an
// example of a valid change, never every earlier attempt. Fake models only; one writes two functions and is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRepairAttempt } from '../packages/engine/line/contract.mjs';
import { repairLoop, repairPrompt, optionSchema } from '../packages/core/line-decide.mjs';
import { profilesWithOn } from '../packages/core/line-decide-mock.mjs';
import { createRepairer, toolArgsSchema } from '../packages/engine/line/repair.mjs';

const OPTION = { tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'ordrs', name: 'StatusBadge' } };
const REFUSAL = { sentence: 'There is no feature "ordrs"; pick one of billing, orders.', code: 'UNKNOWN_FEATURE', rule: null, fixes: [{ id: 'feature:orders', sentence: 'Use the feature orders.', rank: 1 }] };
const profiles = profilesWithOn(['construct.repair']);

test('repairPrompt: only the last refused attempt and an example of a valid change, not every earlier attempt', () => {
  const tries = [1, 2, 3].map((n) => ({ n, option: { tool: OPTION.tool, args: { ...OPTION.args, feature: `try${n}` } }, refusal: { sentence: `There is no feature "try${n}".` }, outcome: 'refused' }));
  const p = repairPrompt(OPTION, REFUSAL, tries, { example: { tool: 'line.baseOn', args: { ...OPTION.args, feature: 'orders' } } });
  assert.ok(!p.includes('try1') && !p.includes('try2'), 'earlier attempts are not repeated');
  assert.match(p, /Last attempt: .*try3.* was refused too/);
  assert.match(p, /Example of a valid change .*"feature":"orders"/);
});

test('repairLoop (JSON): every attempt\'s prompt carries the example; the history stays one attempt long', async () => {
  const prompts = [];
  const propose = async (q) => { prompts.push(q.prompt); return JSON.stringify({ reason: 'r', tool: 'line.baseOn', args: { ...OPTION.args, feature: `f${prompts.length}` } }); };
  const a = await repairLoop(OPTION, REFUSAL, { profiles, reason: true, schema: optionSchema(OPTION, toolArgsSchema('line.baseOn')), propose, maxAttempts: 4, check: (o) => (o.args.feature === 'f4' ? { ok: true } : { ok: false, refusal: { sentence: `no ${o.args.feature}` } }) });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repaired');
  for (const p of prompts) assert.match(p, /Example of a valid change/);
  assert.equal((prompts[3].match(/was refused too/g) ?? []).length, 1, 'only the last attempt is shown');
  assert.ok(!prompts[3].includes('"f1"'));
});

const FILE = 'features/orders/domain/total.ts';
const BROKEN = 'export function total(xs: number[]): number {\n  return "0";\n}\n';
const SETCODE = { tool: 'line.setCode', args: { file: FILE, code: BROKEN } };
const TYPE_REFUSAL = { sentence: 'tsc TS2322 at features/orders/domain/total.ts line 2.', code: 'TYPE_ERROR', rule: null, line: 2, fixes: [] };

test('repairLoop: a code tool is never repaired as JSON; without a fill no model is asked', async () => {
  let asked = 0;
  const a = await repairLoop(SETCODE, TYPE_REFUSAL, { profiles, propose: async () => { asked += 1; return '{}'; }, check: () => ({ ok: true }) });
  assertRepairAttempt(a);
  assert.equal(asked, 0);
  assert.equal(a.outcome, 'off');
  assert.match(a.sentence, /line\.setCode carries code, so it is not repaired as JSON/);
});

test('createRepairer: line.setCode goes through the prefilled fill; a fake that writes two functions is refused with an example', async () => {
  const asked = [];
  const generate = async (q) => {
    asked.push(q);
    return asked.length === 1 ? '  return xs.length;\n}\nexport function extra() {\n  return 1;\n}' : '  return xs.reduce((s, x) => s + x, 0);\n}';
  };
  const checked = [];
  const repair = createRepairer('/nowhere', { generate, record: false, propose: async () => { throw new Error('the JSON repair must not run for a code tool'); } });
  const a = await repair(SETCODE, TYPE_REFUSAL, { check: (o) => { checked.push(o); return { ok: true }; } });
  assertRepairAttempt(a);
  assert.equal(a.outcome, 'repaired');
  assert.equal(asked[0].prefill, 'export function total(xs: number[]): number {\n', 'the signature of the function at the finding\'s line is prefilled');
  assert.deepEqual(asked[0].stop, ['\n}']);
  assert.match(asked[1].user, /Refused \(ONE_FUNCTION\)[\s\S]*a valid reply is only/, 'the retry carries the first error as an example');
  assert.deepEqual(checked.map((o) => o.args.code), ['export function total(xs: number[]): number {\n  return xs.reduce((s, x) => s + x, 0);\n}\n']);
});

test('LINE_LEGACY_IO=1: the code tool goes through the JSON repair again (one release)', async () => {
  const prev = process.env.LINE_LEGACY_IO; process.env.LINE_LEGACY_IO = '1';
  try {
    let asked = 0;
    const a = await repairLoop(SETCODE, TYPE_REFUSAL, { profiles, propose: async () => { asked += 1; return JSON.stringify({ reason: 'r', tool: 'line.setCode', args: { file: FILE, code: 'export const n = 1;\n' } }); } });
    assert.equal(asked, 1);
    assert.equal(a.outcome, 'proposed');
  } finally { if (prev === undefined) delete process.env.LINE_LEGACY_IO; else process.env.LINE_LEGACY_IO = prev; }
});
