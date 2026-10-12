// #902: Mission Control's Beam eval panel, server side: routes (panel module, Trace's renderers, Trace's eval API),
// the fall-through to Mission Control's own handler, the live run tree tailed from events.jsonl over SSE, and the
// results-changed push. Fixture data only; no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBeamEval } from './beam-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const self = path.resolve(here, '../../../..');

async function boot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-beam-'));
  const env = { TRACE_BEAM_RESULTS: path.join(d, 'results'), TRACE_BEAM_RUNS: path.join(d, 'runs') };
  const server = http.createServer((req, res) => { res.writeHead(404); res.end('mission-control'); });
  const timers = [];
  const beam = await attachBeamEval(server, { every: () => null, timers, self, env });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { d, env, server, beam, base, timers };
}

/** Read SSE frames until `want` frames of `type` arrived. */
function sse(url, type, want, act) {
  return new Promise((resolve, reject) => {
    const got = [];
    const req = http.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const t = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (t === 'beam-trees') act();
          if (t === type) { got.push(JSON.parse(data)); if (got.length >= want) { req.destroy(); resolve(got); } }
        }
      });
    });
    req.on('error', (e) => { if (got.length < want) reject(e); });
    setTimeout(() => { req.destroy(); reject(new Error(`no ${type} frame`)); }, 4000).unref();
  });
}

test('one-line hooks: server.mjs and index.html each mention the panel once', () => {
  const srv = fs.readFileSync(path.join(here, 'server.mjs'), 'utf8').split('\n').filter((l) => l.includes('beam-eval'));
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8').split('\n').filter((l) => l.includes('beam-eval'));
  assert.equal(srv.length, 1);
  assert.equal(html.length, 1);
  assert.match(html[0], /<section class="panel" aria-label="Beam eval".*src="\/beam-eval\/panel.mjs"/);
});

test('routes: the panel module, Trace renderers and eval API; anything else falls through to Mission Control', async () => {
  const { server, base, timers } = await boot();
  try {
    assert.equal(timers.length, 1, 'one poller');
    const panel = await fetch(`${base}/beam-eval/panel.mjs`);
    assert.equal(panel.status, 200);
    assert.match(await panel.text(), /import \{ mountBeam \} from '\/beam-eval\/ui\/beam.mjs'/);
    const ui = await (await fetch(`${base}/beam-eval/ui/beam.mjs`)).text();
    assert.match(ui, /export function renderTree/);
    assert.doesNotMatch(ui, /^import /m, 'self-contained: the browser loads it alone');
    const setups = await (await fetch(`${base}/api/beam/setups`)).json();
    assert.ok(setups.setups.some((s) => s.id === 'r-v1.g-v3'));
    assert.equal(setups.live, false, 'live Opus runs stay off unless TRACE_BEAM_LIVE=1');
    const view = await (await fetch(`${base}/api/beam/setup?id=r-v1.g-v3`)).json();
    assert.equal(view.rubric.version, 'v2');
    assert.equal(view.summary.maxTotal, 10);
    assert.equal(view.items[0].id, 'orders-2', 'disagreeing by >= 2 first');
    assert.equal(view.metrics.perArm.static.rescued, 1);
    assert.ok(view.items.every((i) => i.tree), 'every fixture item has its run tree');
    const other = await fetch(`${base}/api/health`);
    assert.equal(other.status, 404);
    assert.equal(await other.text(), 'mission-control');
  } finally { server.close(); }
});

test('live: a growing events.jsonl is re-folded and pushed as beam-tree; an owner grade pushes beam-results', async () => {
  const { server, base, beam, env } = await boot();
  try {
    const dir = path.join(env.TRACE_BEAM_RUNS, 'r-v1.g-v3', 'orders-9');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'events.jsonl');
    const reading = { intent: 'update.prop', object: 'prop', target: 'F1', layers: ['ui'], confidence: 0.7 };
    fs.writeFileSync(f, `${JSON.stringify({ t: 'runOpened', run: 'r1', parent: null, reading, forks: [] })}\n${JSON.stringify({ t: 'runOpened', run: 'r2', parent: 'r1', reading: { ...reading, intent: 'update.handler', object: 'handler' }, forks: [] })}\n`);
    assert.equal(beam.scan().length, 1);
    assert.equal(beam.scan().length, 0, 'unchanged file: nothing pushed');
    const frames = await sse(`${base}/beam-eval/events`, 'beam-tree', 1, () => {
      fs.appendFileSync(f, `${JSON.stringify({ t: 'runClosed', run: 'r2', reason: 'goal', detail: 'goal false' })}\n${JSON.stringify({ t: 'done', outcome: 'plan', run: 'r1', open: 1, closed: 1 })}\n`);
      beam.scan();
    });
    const t = frames[0];
    assert.deepEqual([t.setup, t.item], ['r-v1.g-v3', 'orders-9']);
    assert.deepEqual(t.tree.runs.map((r) => [r.id, r.status, r.reason]), [['r1', 'won', null], ['r2', 'closed', 'goal']]);
    assert.equal(t.tree.runs[1].parent, 'r1');

    const pushed = sse(`${base}/beam-eval/events`, 'beam-results', 1, async () => {
      const r = await fetch(`${base}/api/beam/owner`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setup: 'r-v1.g-v3', item: 'orders-1', scores: { fits: 3, layer: 2, asked: 2, clarity: 2 }, note: 'ok' }) });
      assert.equal(r.status, 200);
      beam.scan();
    });
    assert.ok((await pushed)[0].at);
    const after = await (await fetch(`${base}/api/beam/setup?id=r-v1.g-v3`)).json();
    const o1 = after.items.find((i) => i.id === 'orders-1');
    assert.equal(o1.agreement.overall.diff, 0);
    assert.equal(o1.metrics.final.right, true, 'graded: the item metrics are shown now');
    const bad = await fetch(`${base}/api/beam/owner`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setup: 'r-v1.g-v3', item: 'orders-1', scores: { fits: 4 } }) });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});
