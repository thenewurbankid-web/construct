// Mission Control "full input / raw output" (#913): reads a turn's files written by qwen-agent.mjs (createTurnIo),
// puts the system prompt back from its sha reference, renders it, and the client adds the toggle only to rows whose
// turns.jsonl record points at those files (the client runs in a vm over a tiny fake DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../../test-utils/tmpdir.mjs';
import { createTurnIo } from '../../../../bench/ecommerce/driver/qwen-agent.mjs';
import { readTurnIo, renderTurnIo, handleTurnIoRoute } from './turn-io.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = 'You are the builder. <rules>';

function makeRun() {
  const run = fs.realpathSync(makeTempDir('mc-turn-io-'));
  const logs = path.join(run, 'logs');
  fs.mkdirSync(logs);
  const io = createTurnIo({ logDir: logs, enabled: true });
  io.input(1, { model: 'qwen3:4b', stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Start building.' }, { role: 'tool', content: '{"ok":true,"content":"file <body>"}' }], tools: [{ type: 'function', function: { name: 'read_file' } }], options: { num_ctx: 8192, temperature: 0.2, seed: 7 } });
  io.output(1, { model: 'qwen3:4b', message: { role: 'assistant', content: '', thinking: 'Plan: read first.', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a' } } }] }, eval_count: 9 }, [{ function: { name: 'read_file', arguments: { path: 'a' } } }]);
  return run;
}

test('readTurnIo puts the system prompt back; renderTurnIo shows every message, thinking and parsed calls (escaped)', () => {
  const run = makeRun();
  const v = readTurnIo(run, 1);
  assert.equal(v.systemPrompt, SYSTEM);
  assert.match(v.systemSha, /^[0-9a-f]{64}$/);
  assert.equal(v.input.options.seed, 7);
  const html = renderTurnIo(v);
  assert.match(html, /3 messages as sent/);
  assert.ok(html.includes('You are the builder. &lt;rules&gt;'));
  assert.ok(html.includes('file &lt;body&gt;'));
  assert.match(html, /thinking<\/h5><pre>Plan: read first\.<\/pre>/);
  assert.match(html, /parsed calls/);
  assert.equal(readTurnIo(run, 2), null);
  assert.equal(readTurnIo(run, 0), null);
  assert.match(renderTurnIo(null), /BENCH_LOG_TURN_IO=0/);
});

test('the route serves the client script and the rendered turn; 404 for a turn without files', () => {
  const run = makeRun();
  const call = (url) => {
    const out = { status: 0, body: '' };
    handleTurnIoRoute(new URL(url, 'http://x'), { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = String(b ?? ''); } }, () => run);
    return out;
  };
  const js = call('/turn-io/view.js');
  assert.equal(js.status, 200); assert.match(js.body, /window\.turnIo/);
  const ok = call('/turn-io/api?turn=1');
  assert.equal(ok.status, 200); assert.match(JSON.parse(ok.body).html, /Raw output/);
  assert.equal(call('/turn-io/api?turn=5').status, 404);
});

// A tiny DOM: enough for decorate (createElement, querySelector('.tools'/'.muted'), insertBefore, events).
function fakeDom() {
  const mk = (tag) => ({ tag, className: '', id: '', textContent: '', innerHTML: '', attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.listeners[k] = f; },
    insertBefore(n, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); },
    querySelector(sel) { const c = sel.slice(1); const walk = (n) => { for (const k of n.children) { if (k.className.split(' ').includes(c)) return k; const f = walk(k); if (f) return f; } return null; }; return walk(this); } });
  const det = mk('div'); det.id = 'det';
  return { det, mk, document: { createElement: mk, getElementById: (id) => (id === 'det' ? det : null) } };
}

test('the client: renderDetail is wrapped; the toggle appears only when the turn has files, and click turns the view on', async () => {
  const dom = fakeDom();
  const fetched = [];
  let rendered = 0;
  const win = {};
  const ctx = vm.createContext({ window: win, document: dom.document, fetch: async (u) => { fetched.push(u); return { ok: true, json: async () => ({ html: '<h4>Raw output</h4>' }) }; } });
  win.renderDetail = (d) => {
    rendered += 1;
    dom.det.children = []; const tools = dom.mk('div'); tools.className = 'tools'; const muted = dom.mk('span'); muted.className = 'muted'; tools.children.push(muted); dom.det.children.push(tools);
    void d;
  };
  vm.runInContext(fs.readFileSync(path.join(here, 'turn-io.client.js'), 'utf8'), ctx);
  const btn = () => dom.det.querySelector('.tools').children.find((c) => c.id === 'detTurnIo');

  win.renderDetail({ row: { id: 'c1' }, turn: { turn: 3, calls: [] } });
  assert.equal(btn(), undefined, 'no files: no toggle');

  const d = { row: { id: 'c2' }, turn: { turn: 4, inputFile: 'turn-input/4.json', outputFile: 'turn-output/4.json', inputBytes: 10, outputBytes: 5 } };
  win.renderDetail(d);
  assert.equal(btn().textContent, 'full input / raw output');
  assert.equal(btn().attrs['aria-pressed'], 'false');
  assert.equal(dom.det.children.length, 1);

  btn().listeners.click();
  assert.equal(win.turnIo.on, true);
  assert.equal(btn().attrs['aria-pressed'], 'true');
  const box = dom.det.children.find((c) => c.className.includes('turnio'));
  assert.ok(box);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetched, ['/turn-io/api?turn=4']);
  assert.equal(box.innerHTML, '<h4>Raw output</h4>');
  assert.equal(rendered, 3);
});
