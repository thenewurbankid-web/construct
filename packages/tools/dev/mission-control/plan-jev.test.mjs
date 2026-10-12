// #892: Mission Control's Plan / jev panel reads the ask log, the intent shadow log and the eval report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { lastJsonl, planJevPayload, readPlanJev, forkCount, ASK_LOG_REL, EVAL_REL, SHADOW_REL } from './plan-jev.mjs';

const ask = (request, forks) => ({ at: '2026-10-12T15:00:00.000Z', request, project: 'examples/line-sample', normalized: 'x', labels: { static: { intent: 'update.prop' }, jev: null, forks: Array.from({ length: forks }, () => ({ label: 'intent' })) }, path: [], shadow: [{ fork: 'disagree' }, { fork: null }] });

test('lastJsonl keeps the last n records and counts bad lines', () => {
  const r = lastJsonl('{"a":1}\nnot json\n{"a":2}\n\n{"a":3}\n', 2);
  assert.deepEqual(r, { records: [{ a: 2 }, { a: 3 }], bad: 0, total: 4 });
  assert.equal(lastJsonl('{"a":1}\nnope\n', 5).bad, 1);
  assert.deepEqual(lastJsonl(null), { records: [], bad: 0, total: 0 });
});

test('the payload: the latest ask with its forks, earlier asks newest first, shadow fork rate, the eval tables', () => {
  const askLog = [ask('first', 0), ask('second', 2)].map((x) => JSON.stringify(x)).join('\n');
  const shadowLog = [{ jev: { intent: 'a' }, forks: [{}] }, { jev: null, forks: [] }].map((x) => JSON.stringify(x)).join('\n');
  const evalJson = JSON.stringify({ at: 'now', seed: 0, jev: 'up', rows: 80, uncertain: 11, tables: { all: { static: { intent: 87.5 }, jev: { intent: 15 }, forks: {} } }, confusions: [1, 2, 3, 4, 5, 6] });
  const p = planJevPayload({ askLog, shadowLog, evalJson });
  assert.equal(p.ask.request, 'second');
  assert.equal(forkCount(p.ask), 3);
  assert.deepEqual(p.asks.map((a) => [a.request, a.forks]), [['first', 1]]);
  assert.deepEqual([p.shadow.total, p.shadow.forkRate, p.shadow.jevAnswered], [2, 50, 1]);
  assert.equal(p.eval.tables.all.static.intent, 87.5);
  assert.equal(p.eval.confusions.length, 5);
  assert.deepEqual(planJevPayload({ evalJson: '{oops' }).eval, { error: 'intent-eval.json is not JSON' });
  assert.equal(planJevPayload({}).ask, null);
});

test('readPlanJev reads the three files under a checkout and a project', () => {
  const root = makeTempDir('mc-planjev-');
  try {
    for (const [rel, body] of [[ASK_LOG_REL, `${JSON.stringify(ask('hi', 1))}\n`], [EVAL_REL, '{"rows":1,"tables":{}}'], [path.join('proj', SHADOW_REL), '{"forks":[]}\n']]) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    const p = readPlanJev(root, 'proj');
    assert.equal(p.project, 'proj');
    assert.equal(p.ask.request, 'hi');
    assert.equal(p.shadow.total, 1);
    assert.equal(p.eval.rows, 1);
    assert.equal(readPlanJev(path.join(root, 'missing'), 'proj').ask, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
