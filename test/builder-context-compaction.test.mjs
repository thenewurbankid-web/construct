// #932 (a): the builder driver's context budget. lending-qwen-7b-r1 turn 16 sent ~16.2k prompt tokens (Ollama's count,
// already cut at num_ctx 16384): the same refused setCode on PicksPage and its TYPE_ERROR refusal 7 times, the 4.9k-char
// plan_status answer 4 times. compactHistory collapses the repeats, counts done steps, summarises old large answers and
// keeps the system prompt and the first message whole; num_ctx defaults to 32768.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactHistory, estimateTokens, collapseDone, summarise, exchangesOf } from '../bench/ecommerce/driver/compact.mjs';
import { flags, chatOptions } from '../bench/ecommerce/driver/qwen-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const T16 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/builder-context/lending-r1-turn16.json'), 'utf8'));
const SYSTEM = { role: 'system', content: T16.system };
const FIRST = { role: 'user', content: T16.first };

const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });
const reply = (o) => ({ role: 'tool', content: JSON.stringify(o) });

test('num_ctx: 32768 by default, --num-ctx and BENCH_NUM_CTX change it', () => {
  const prev = process.env.BENCH_NUM_CTX;
  try {
    delete process.env.BENCH_NUM_CTX;
    assert.equal(flags([]).numCtx, 32768);
    assert.equal(chatOptions(flags([])).num_ctx, 32768);
    assert.equal(flags(['--num-ctx', '16384']).numCtx, 16384);
    process.env.BENCH_NUM_CTX = '24576';
    assert.equal(flags([]).numCtx, 24576);
  } finally { if (prev === undefined) delete process.env.BENCH_NUM_CTX; else process.env.BENCH_NUM_CTX = prev; }
});

test('identical failed calls collapse to the last attempt with its error and "(repeated N times)"', () => {
  const bad = { tool: 'line.setCode', args: { file: 'features/picks/pages/PicksPage.tsx', code: 'x' } };
  const refusal = (n) => reply({ ok: false, code: 'TYPE_ERROR', sentence: `Refused (TYPE_ERROR) try ${n}` });
  const history = [
    call('plan_add', bad), refusal(1),
    call('plan_status', {}), reply({ ok: true, sentence: 'status' }),
    call('plan_add', bad), refusal(2),
    call('plan_add', { ...bad, args: { ...bad.args, code: 'y' } }), refusal(3),
    call('plan_add', bad), refusal(4),
  ];
  const r = compactHistory(history);
  assert.equal(r.collapsed, 2, 'two of the three identical x calls go; the y call is another call');
  const kept = exchangesOf(r.messages);
  const xs = kept.filter((x) => JSON.stringify(x.assistant?.tool_calls).includes('"code":"x"'));
  assert.equal(xs.length, 1);
  const last = JSON.parse(xs[0].replies[0].content);
  assert.equal(last.sentence, 'Refused (TYPE_ERROR) try 4', 'the last attempt and its error stay');
  assert.equal(last.repeated, '(repeated 3 times)');
  assert.ok(kept.some((x) => JSON.stringify(x.assistant?.tool_calls).includes('"code":"y"')), 'a different call stays');
  assert.equal(history.length, 10, 'the history itself is not changed');
});

test('plan_status done steps become a count; an old large answer becomes its first sentence line', () => {
  const status = JSON.stringify({ ok: true, steps: [{ n: 1, state: 'done', sentence: 'Saved.' }, { n: 2, state: 'ready', sentence: 'Ready.' }], sentence: 'The plan has 2 steps.\nmore' });
  assert.deepEqual(JSON.parse(collapseDone(status)).steps.map((s) => s.n), [2]);
  assert.equal(JSON.parse(collapseDone(status)).doneSteps, 1);
  const big = JSON.stringify({ ok: false, code: 'TYPE_ERROR', sentence: `Refused (TYPE_ERROR): line one.\n${'x'.repeat(2000)}` });
  assert.deepEqual(JSON.parse(summarise(big)), { ok: false, code: 'TYPE_ERROR', sentence: 'Refused (TYPE_ERROR): line one.', compacted: `${big.length} characters cut; call the tool again for the whole answer` });
});

test('lending-r1 turn 16 replay: system prompt and spec kept, repeats collapsed, the estimate under a 16k and a 32k budget', () => {
  const fixed = [SYSTEM, FIRST];
  const before = estimateTokens([...fixed, ...T16.history], T16.tools);
  // The estimate over-counts Ollama's own count a little (it was cut at 16384, so it reported 16185).
  assert.ok(before > T16.promptEvalCount, `${before} > ${T16.promptEvalCount}`);
  for (const numCtx of [16384, 32768]) {
    const r = compactHistory(T16.history, { fixed, tools: T16.tools, budget: numCtx - 2048 });
    assert.equal(r.before, before);
    assert.ok(r.after <= numCtx - 2048, `${r.after} under ${numCtx - 2048}`);
    assert.equal(r.dropped, 0, 'compaction alone fits; no exchange had to go');
    // Seven identical refused setCode calls -> one, with the count.
    const sets = exchangesOf(r.messages).filter((x) => String(x.assistant?.content).includes('PicksPage.tsx'));
    assert.ok(r.collapsed >= 5, `collapsed ${r.collapsed}`);
    assert.ok(r.messages.some((m) => m.role === 'tool' && /repeated \d+ times/.test(m.content)));
    assert.ok(sets.length <= 3, `${sets.length} PicksPage calls left`);
    // The latest plan_status (the current feature's points, the spec) stays whole, done steps as a count.
    const statuses = r.messages.filter((m) => m.role === 'tool' && m.content.includes('"planId"'));
    const lastStatus = JSON.parse(statuses.at(-1).content);
    assert.equal(lastStatus.doneSteps, 11);
    assert.match(lastStatus.sentence, /PCK-1 \[open\]: Every page shows a link/);
    console.log(`turn 16 replay, num_ctx ${numCtx}: estimate ${r.before} -> ${r.after} tokens (collapsed ${r.collapsed}, summarised ${r.summarised}, dropped ${r.dropped}); Ollama counted ${T16.promptEvalCount} (cut at ${T16.numCtx})`);
  }
});

test('over budget: the oldest exchanges go whole; the system prompt and the first message never do', () => {
  const history = Array.from({ length: 30 }, (_, i) => [call('read_file', { path: `f${i}.ts` }), reply({ ok: true, sentence: `file ${i}`, code: 'y'.repeat(400) })]).flat();
  const fixed = [SYSTEM, FIRST];
  const budget = estimateTokens(fixed) + 1000;
  const r = compactHistory(history, { fixed, budget });
  assert.ok(r.dropped > 0);
  assert.ok(r.after <= budget, `${r.after} <= ${budget}`);
  assert.equal(r.messages[0].role, 'assistant', 'a tool answer never leads');
  assert.ok(JSON.stringify(r.messages.at(-1)).includes('file 29'), 'the newest exchange stays');
});
