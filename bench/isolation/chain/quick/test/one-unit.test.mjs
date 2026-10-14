// The plan writer and the fill work one function per request with constrained output (#942 audit). No model.
//   node --test bench/isolation/chain/quick/test/one-unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, TEMPLATES } from '../tasks.mjs';
import { planSchemaFor, renderLine, templateForms } from '../lib/plan-lines.mjs';
import { fillBody } from '../lib/fill.mjs';
import { writePlan, writePlanFor } from '../smith-tests.mjs';

test('plan lines are an enum of the Smith template sentences, each with its own slots', () => {
  const items = planSchemaFor().properties.lines.items.anyOf;
  assert.equal(items.length, TEMPLATES.length);
  assert.deepEqual(items.map((b) => b.properties.template.enum[0]), templateForms().map((t) => t.id));
  for (const b of items) assert.equal(b.properties.template.enum.length, 1);
  const op = items.find((b) => b.properties.OP);
  assert.deepEqual(op.properties.OP.enum, ['+', '-', '*', '/', '===', '!==', '<', '<=', '>', '>=']);
  assert.equal(renderLine({ template: 'if CONDITION: STEP', CONDITION: 'available', STEP: "return 'Available'" }), "if available: return 'Available'");
  assert.equal(renderLine({ template: 'SUBJECT VERB ARG and ARG', SUBJECT: 'sorted', VERB: 'slice', ARG: '0', ARG2: '3' }), 'sorted slice 0 and 3');
  assert.equal(renderLine({ template: 'let NAME be X', NAME: 'X', X: 'items' }), 'let X be items');
  assert.equal(renderLine({ template: 'free text' }), null);
});

test('the plan writer asks once per function, naming only that function', async () => {
  const t = TASKS.find((x) => x.functions.length > 1);
  const calls = [];
  const fake = async (req) => { calls.push(req); return { json: { lines: [{ template: 'return X', X: "'x'" }] }, promptTokens: 2, evalTokens: 1, ms: 1 }; };
  const p = await writePlan(t, 1, fake);
  assert.equal(calls.length, t.functions.length);
  calls.forEach((req, i) => {
    const fn = t.functions[i];
    assert.match(req.user, new RegExp(`Stub:\\nfunction ${fn}\\(`));
    assert.deepEqual(t.functions.filter((o) => o !== fn && new RegExp(`\\b${o}\\(`).test(req.user.split('Stub:')[1])), []);
    assert.deepEqual(req.format, planSchemaFor());
  });
  assert.deepEqual(Object.keys(p.plan), t.functions);
  assert.deepEqual(p.plan[t.functions[0]], ["return 'x'"]);
  assert.equal(p.tokens, 3 * t.functions.length);
  const one = await writePlanFor(t, t.functions[0], 5, async () => ({ json: { lines: [{ template: 'nope' }, { template: "'TEXT'", TEXT: 'On loan' }] }, promptTokens: 0, evalTokens: 0, ms: 0 }));
  assert.deepEqual(one.lines, ["'On loan'"]);
});

test('the fill prefills the signature and is cut at the function end even when the model writes on', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: "  if (available) {\n    return 'Available';\n  }\n  return 'On loan';\n}\n\nfunction extra() {\n  return 1;\n}\n", prompt_eval_count: 5, eval_count: 7 }) };
  };
  const signature = 'function formatAvailability(available: boolean): string';
  const r = await fillBody({ signature, plan: ["if available: return 'Available'", "return 'On loan'"], seed: 3, fetchImpl });
  assert.equal(sent.raw, true);
  assert.ok(sent.prompt.endsWith(`<|im_start|>assistant\n\`\`\`ts\n${signature} {\n`));
  assert.ok(sent.options.stop.includes('\n}'));
  assert.equal(r.body, "  if (available) {\n    return 'Available';\n  }\n  return 'On loan';");
  assert.equal(r.tokens, 12);
});
