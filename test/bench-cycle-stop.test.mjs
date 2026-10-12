// #918: the bench driver stops when the same (tool call, reply) pair comes back K times (6) within W turns (20), other
// calls between them or not. Replays the two loops the r4 bench ran into: pilot-qwen-7b-r4 (a 4-call cycle: refused
// setCode ListPage, plan_status, setCode spec.md, baseOn; 48 times from turns.jsonl:10) and pilot-qwen-7b-r4-s2 (a
// 2-call cycle: NO_CHANGE setCode and plan_status; 93 times from turns.jsonl:15). A fake Ollama drives the 2-call shape
// end to end through runAgent (plain arm), so the stop reason and the end record are checked as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { cycleWatch, replyKey, refusalStreak, flags, runAgent } from '../bench/ecommerce/driver/qwen-agent.mjs';

const SET_LIST = { tool: 'line.setCode', args: { file: 'features/catalog/pages/ListPage.tsx', code: '// @line-base pages/ListPage\n...' } };
const typeError = (n) => ({ ok: false, code: 'TYPE_ERROR', sentence: `Stop: this exact call was already refused ${n} times with TYPE_ERROR and will not succeed if sent again.` });
const status = (steps) => ({ ok: true, code: null, sentence: `The plan has ${steps} steps.\nOpen work: 9 items remain (catalog 6, product 1, cart 1, checkout 1).` });

test('(r4) the 4-call cycle stops on its 6th round, though no call repeats back to back', () => {
  const c = cycleWatch();
  const s = refusalStreak(10);
  let turn = 0; let stoppedAt = null;
  for (let round = 1; round <= 48 && stoppedAt === null; round += 1) {
    const calls = [
      ['plan_add', SET_LIST, typeError(round + 2)],
      ['plan_status', { feature: 'catalog' }, status(3 + round * 2)],
      ['plan_add', { tool: 'line.setCode', args: { file: 'features/catalog/spec.md', code: '# catalog' } }, { ok: true, sentence: `Step ${4 + round * 2} joined the plan and Auto approved it; run-next lands it.` }],
      ['plan_add', { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' } }, { ok: true, sentence: `Step ${5 + round * 2} joined the plan and Auto approved it; run-next lands it.` }],
    ];
    for (const [name, args, out] of calls) {
      turn += 1;
      c.see(turn, name, args, out); s.see(name, args, out);
      if (c.hit) { stoppedAt = turn; break; }
    }
  }
  // The refused setCode opens each round (turns 1, 5, 9, 13, 17, 21): its 6th time is turn 21, 20 turns after its first.
  assert.equal(stoppedAt, 21);
  assert.equal(s.hit, false, 'the consecutive-refusal streak never sees this cycle');
  assert.equal(c.count, 6);
  assert.match(c.pair?.call ?? '', /^plan_add .*ListPage\.tsx/);
  assert.match(c.pair?.reply ?? '', /^refused\|TYPE_ERROR\|Stop: this exact call was already refused # times/);
});
test('(r4-s2) the 2-call cycle stops on the 6th NO_CHANGE within 20 turns; another call in between does not reset it', () => {
  const c = cycleWatch();
  const noChange = { ok: false, code: 'NO_CHANGE', sentence: 'Refused (NO_CHANGE): Nothing changed; this is the code that is already there.' };
  const st = { ok: true, sentence: 'The plan has 3 steps.\nOpen work: 6 items remain (catalog 3, product 1, cart 1, checkout 1).' };
  let turn = 0; let hitAt = null;
  for (let i = 0; i < 93 && hitAt === null; i += 1) {
    for (const [name, args, out] of [['plan_add', SET_LIST, noChange], ['plan_status', { feature: 'catalog' }, st]]) {
      turn += 1; c.see(turn, name, args, out);
      if (c.hit) { hitAt = turn; break; }
    }
    if (i === 2 && hitAt === null) { turn += 1; c.see(turn, 'read_file', { path: 'SPEC.md' }, { ok: true, sentence: 'Read SPEC.md (40 lines).' }); }
  }
  assert.equal(hitAt, 12, 'NO_CHANGE at turns 1, 3, 5, 8, 10, 12 (a read_file at turn 7)');
  assert.equal(c.count, 6);
});

test('(G4) replyKey blanks counts; a different reply is a different pair; the window forgets old pairs; limit 0 never stops', () => {
  assert.equal(replyKey(typeError(3)), replyKey(typeError(48)));
  assert.notEqual(replyKey({ ok: false, code: 'NO_CHANGE', sentence: 'a' }), replyKey({ ok: false, code: 'TYPE_ERROR', sentence: 'a' }));
  const c = cycleWatch({ limit: 3, window: 5 });
  c.see(1, 'x', {}, { ok: true, sentence: 'same' });
  c.see(2, 'x', {}, { ok: true, sentence: 'same' });
  c.see(10, 'x', {}, { ok: true, sentence: 'same' });
  assert.equal(c.hit, false, 'turns 1 and 2 left the window (turn 10 and the 5 before it)');
  c.see(11, 'x', {}, { ok: true, sentence: 'same' });
  c.see(12, 'x', { b: 1, a: 2 }, { ok: true, sentence: 'same' });
  c.see(13, 'x', {}, { ok: true, sentence: 'different' });
  assert.equal(c.hit, false);
  c.see(14, 'x', {}, { ok: true, sentence: 'same' });
  assert.equal(c.hit, true);
  const off = cycleWatch({ limit: 0 });
  for (let i = 1; i < 30; i += 1) off.see(i, 'x', {}, { ok: true });
  assert.equal(off.hit, false);
  const o = flags(['--project', 'p']);
  assert.equal(o.maxCycleRepeats, 6);
  assert.equal(o.cycleWindow, 20);
  assert.equal(o.maxRepeatRefusals, 10, 'the consecutive-refusal stop stays');
  const p = flags(['--project', 'p', '--max-cycle-repeats', '4', '--cycle-window', '12']);
  assert.deepEqual([p.maxCycleRepeats, p.cycleWindow], [4, 12]);
});

test('(G4) runAgent stops a 2-call cycle with "repeated cycle" and writes the pair and its count in the end record', async () => {
  const parent = fs.realpathSync(makeTempDir('cycle-stop-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'Hello.\n');
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      n += 1;
      const call = n % 2 ? { name: 'read_file', arguments: { path: 'README.md' } } : { name: 'list_dir', arguments: { path: '.' } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', message: { role: 'assistant', content: '', tool_calls: [{ function: call }] }, done: true, prompt_eval_count: 10, eval_count: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const prev = process.env.BENCH_LOG_TURN_IO;
  process.env.BENCH_LOG_TURN_IO = '0';
  try {
    const o = flags(['--project', project, '--arm', 'plain', '--builder', 'cycle-test', '--max-turns', '50', '--ollama', `http://127.0.0.1:${port}`]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'repeated cycle');
    assert.equal(r.turns, 11, 'read_file at turns 1, 3, 5, 7, 9, 11');
    const turns = fs.readFileSync(path.join(parent, 'logs', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const end = turns.at(-1);
    assert.equal(end.kind, 'end');
    assert.equal(end.stop, 'repeated cycle');
    assert.equal(end.cycle.times, 6);
    assert.equal(end.cycle.window, 20);
    assert.equal(end.cycle.call, 'read_file {"path":"README.md"}');
    assert.match(end.cycle.reply, /^ok\|/);
  } finally {
    if (prev === undefined) delete process.env.BENCH_LOG_TURN_IO; else process.env.BENCH_LOG_TURN_IO = prev;
    await new Promise((r) => server.close(r));
  }
});
