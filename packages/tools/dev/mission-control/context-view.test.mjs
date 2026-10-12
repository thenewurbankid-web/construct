// Mission Control's Context / jev view (#899): the join of logged context lines, static scores (contextScore.mjs),
// jev shadow scores and the cap, over fixtures/runs/fixture-context (the #886-#890 calls.jsonl shapes plus an older
// refusal without them, which is reconstructed with trace/tools/jev/contextLines.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContextView, readContextView, joinScores, hintTotals } from './context-view.mjs';
import { jsonlSplitter } from './bench-log.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs/fixture-context');
const read = (f) => jsonlSplitter().push(fs.readFileSync(path.join(dir, 'logs', f), 'utf8')).records;

test('logged context: static and jev ranks, KEPT/DROPPED under the cap, and the disagreements', () => {
  const v = readContextView(dir);
  assert.equal(v.hintState, true);
  const [e] = v.entries;
  assert.deepEqual([e.rowId, e.turn, e.source, e.via, e.cap, e.capSource, e.jev, e.jevMs], ['c1', 2, 'logged', 'static', 5, 'logged', 'logged', 42]);
  assert.equal(e.lines.length, 7);
  // Static order is the logged score order; the logged kept list is what was shown.
  assert.deepEqual(e.lines.map((l) => l.staticRank), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(e.lines.map((l) => l.keptStatic), [true, true, true, true, true, false, false]);
  assert.deepEqual(e.lines.map((l) => l.shown), [true, true, true, true, true, false, false]);
  // jev ranks the last line first and the second last of all: two lines flip between kept and dropped.
  assert.deepEqual(e.lines.map((l) => l.jevRank), [2, 7, 3, 4, 5, 6, 1]);
  assert.deepEqual(e.lines.filter((l) => l.disagree).map((l) => [l.i, l.keptStatic, l.keptJev]), [[1, true, false], [6, false, true]]);
  assert.equal(e.fixes[0].why, 'LINE-ROUTE-001 routes name an existing page.');
  assert.equal(e.card.layer, 'route');
  assert.match(e.spec, /CAT-1/);
});

test('a repeat logs cap 15; an unreachable jev leaves the jev columns empty and no disagreement', () => {
  const e = readContextView(dir).entries[1];
  assert.deepEqual([e.cap, e.repeat, e.jev], [15, 1, 'unreachable']);
  assert.ok(e.lines.every((l) => l.keptStatic && l.jev === null && l.keptJev === null && !l.disagree));
});

test('older refusals are reconstructed and scored by the static scorer; hint-state.json bounds the repeat', () => {
  const v = readContextView(dir);
  const rec = v.entries.filter((e) => e.source === 'reconstructed');
  assert.deepEqual(rec.map((e) => [e.rowId, e.code, e.capSource, e.repeat, e.cap]), [['c3', 'BAD_ARGS', 'hint-state', 0, 5], ['c4', 'BAD_ARGS', 'hint-state', 0, 5]]);
  assert.ok(rec[0].lines.length >= 3 && rec[0].lines.every((l) => typeof l.static === 'number' && l.jev === null));
  assert.equal(rec[0].lines[0].kind, 'fix', 'a fix clause ranks first');
  // Without hint-state.json the in-run repeat counts: the second BAD_ARGS of the same tool gets cap 15.
  const noHs = buildContextView({ calls: read('calls.jsonl'), turns: read('turns.jsonl'), hintState: null }).entries.at(-1);
  assert.deepEqual([noHs.capSource, noHs.repeat, noHs.cap], ['run', 1, 15]);
  assert.deepEqual([...hintTotals({ 'p|A|x': 2, 'p|A|y': 1, 'p|B|z': 1 })], [['A', 2], ['B', 1]]);
});

test('the run summary: lines shown, kept %, static-vs-jev disagreement %', () => {
  const s = readContextView(dir).summary;
  assert.deepEqual(s, { refusals: 4, logged: 2, reconstructed: 2, jevLogged: 1, jevUnreachable: 1, candidates: 20, shown: 18, keptPct: 90, jevLines: 7, disagree: 2, disagreePct: 28.6, drift: 0 });
});

test('joinScores scores lines without a logged score with contextScore.mjs, and ties keep Line order', () => {
  const lines = joinScores([{ text: 'a', kind: 'status', keys: ['x'] }, { text: 'b', kind: 'status', keys: ['x'] }, { text: 'c', kind: 'fix', keys: ['x'] }], { cap: 2 });
  assert.deepEqual(lines.map((l) => [l.text, l.staticRank, l.keptStatic]), [['c', 1, true], ['a', 2, true], ['b', 3, false]]);
});
