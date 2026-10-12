// Mission Control's bench-log parser: the JSONL splitter, the calls.jsonl x turns.jsonl join, the counters, the
// timeline and the loop detector, over a fixture run (fixtures/runs/fixture-qwen, made in the qwen-agent.mjs /
// plan-cli.mjs record shapes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonlSplitter, joinRun, detectLoop, counters, timeline, callStatus } from './bench-log.mjs';

const logs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs/fixture-qwen/logs');
const read = (f) => jsonlSplitter().push(fs.readFileSync(path.join(logs, f), 'utf8')).records;

test('the splitter keeps a partial line until its newline arrives, and reports bad lines', () => {
  const s = jsonlSplitter();
  assert.deepEqual(s.push('{"a":1}\n{"b"').records, [{ a: 1 }]);
  assert.equal(s.pending(), '{"b"');
  assert.deepEqual(s.push(':2}\nnot json\n').records, [{ b: 2 }]);
  assert.deepEqual(s.push('').bad, []);
  assert.deepEqual(s.push('{oops}\n').bad, ['{oops}']);
  s.push('{"c"'); s.reset();
  assert.equal(s.pending(), '');
});

test('the join gives one row per call, idle turns and the turn in progress, with turn tokens on the first row', () => {
  const rows = joinRun(read('calls.jsonl'), read('turns.jsonl'));
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.map((r) => r.turn), [1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const t3 = rows.filter((r) => r.turn === 3);
  assert.deepEqual(t3.map((r) => [r.tool, r.status]), [['add line.createFeature', 'ok'], ['run-next', 'landed']]);
  assert.equal(t3[0].tokIn, 3200); assert.equal(t3[1].tokIn, null);
  assert.equal(t3[0].approved, true);
  assert.equal(rows[1].status, 'refused'); assert.equal(rows[1].code, 'BAD_ARGS');
  assert.equal(rows[4].status, 'idle');
  assert.equal(rows[5].fix, true);
  assert.match(rows[5].args, /^fixOf=s1 file=src\/a\.ts/);
  assert.ok(rows.every((r) => !r.mismatch));
});

test('runs without turns.jsonl (Claude builders) get call rows numbered by sequence', () => {
  const rows = joinRun(read('calls.jsonl'), []);
  assert.equal(rows.length, 13); // the approval record is not a row
  assert.ok(rows.every((r) => r.turn === null));
  assert.deepEqual(rows.slice(0, 3).map((r) => r.seq), [1, 2, 3]);
  assert.equal(timeline(rows).length, 13);
});

test('the loop detector flags the same tool and refusal code 5+ in a row, and clears on a different outcome', () => {
  const rows = joinRun(read('calls.jsonl'), read('turns.jsonl'));
  const l = detectLoop(rows);
  assert.equal(l.stuck, true);
  assert.deepEqual({ tool: l.current.tool, code: l.current.code, count: l.current.count }, { tool: 'add line.addRoute', code: 'UNKNOWN_ITEM', count: 7 });
  assert.equal(l.current.fromRow, rows[7].id);
  assert.equal(l.current.lastRow, rows[13].id);
  // Four in a row is not stuck.
  assert.equal(detectLoop(rows.slice(0, 11)).stuck, false);
  // A landed step after the loop clears it; the longest run is still reported.
  const after = [...rows, { id: 'x', tool: 'run-next', status: 'landed', code: null }];
  const l2 = detectLoop(after);
  assert.equal(l2.stuck, false);
  assert.equal(l2.longest.count, 7);
  // Same code from a different tool breaks the run.
  const mixed = rows.slice(7, 10).concat([{ id: 'y', tool: 'add line.setCode', status: 'refused', code: 'UNKNOWN_ITEM' }], rows.slice(10, 12));
  assert.equal(detectLoop(mixed).stuck, false);
});

test('counters: turn, steps, refusals by code, typed fixes, validate errors, tokens', () => {
  const turns = read('turns.jsonl');
  const rows = joinRun(read('calls.jsonl'), turns);
  const c = counters(rows, turns, Date.parse('2026-10-12T10:05:00.000Z'));
  assert.equal(c.turn, 12); assert.equal(c.maxTurns, 200); assert.equal(c.maxMinutes, 90);
  assert.equal(c.added, 2); assert.equal(c.landed, 1);
  assert.deepEqual(c.refusals, { BAD_ARGS: 1, UNKNOWN_ITEM: 7 });
  assert.equal(c.fixes, 1);
  assert.deepEqual([c.validate.errors, c.validate.warnings], [3, 1]);
  assert.equal(c.tokIn, 3000 * 5 + 3200 + 4900 * 6);
  assert.equal(c.finished, false);
  assert.equal(c.elapsedMs, 5 * 60_000 - 1500);
});

test('timeline: one cell per turn, a landed step wins the turn', () => {
  const tl = timeline(joinRun(read('calls.jsonl'), read('turns.jsonl')));
  assert.equal(tl.length, 13);
  assert.deepEqual(tl.slice(0, 4).map((x) => x.status), ['ok', 'refused', 'landed', 'idle']);
});

test('call status: crash is an error, landed false is not-landed', () => {
  assert.deepEqual(callStatus({ result: { ok: false, code: 'CRASH' } }), { status: 'error', code: 'CRASH' });
  assert.equal(callStatus({ result: { ok: true, landed: false, state: 'needs-fix' } }).status, 'not-landed');
});
