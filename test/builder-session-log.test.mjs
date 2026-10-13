// #932: the layered session log (logs/session.jsonl): one English event per line per Line layer, pointing at
// turn-input/turn-output instead of copying them, and the read-only session_log tool that answers a small slice
// (filters, newest first, capped). Offered after a refusal; its answers never feed the ledger turn.
import test from 'node:test';
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { sessionLogSlice, toolEvents, selectTurnTools, SLICE_CAP, READ_TOOL_REGISTRY } from '../bench/ecommerce/driver/session-log.mjs';
import { flags, runAgent, TOOLS } from '../bench/ecommerce/driver/qwen-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = (turn, layer, english, ref = null) => ({ turn, layer, kind: 'x', english, ref });
const EVENTS = [
  ev(1, 'tool', 'plan_add line.baseOn: ok', 'features/picks/pages/PicksPage.tsx'),
  ev(2, 'gate', 'tsc TS2345 at features/picks/pages/PicksPage.tsx line 7: Argument of type string | null', 'features/picks/pages/PicksPage.tsx'),
  ev(2, 'refusal', 'line.setCode on PicksPage was refused with TYPE_ERROR', 'features/picks/pages/PicksPage.tsx'),
  ev(3, 'gate', 'tsc TS2307 at features/book/pages/BookPage.tsx line 2: Cannot find module', 'features/book/pages/BookPage.tsx'),
  ev(9, 'plan', 'Step s13 ran and landed', 's13'),
];

test('session_log slice: layer, turn, ref and query filters, newest first, default 10', () => {
  const g = sessionLogSlice(EVENTS, { layer: 'gate', ref: 'PicksPage' });
  assert.equal(g.count, 1);
  assert.match(g.sentence, /^Session log: 1 event match, newest first \(1 shown\):\n- turn 2, gate: tsc TS2345 at features\/picks\/pages\/PicksPage\.tsx line 7/);
  assert.equal(sessionLogSlice(EVENTS, { turn: 9 }).count, 1);
  assert.match(sessionLogSlice(EVENTS, { layer: 'gate' }).sentence.split('\n')[1], /^- turn 3, gate: tsc TS2307/, 'newest first');
  assert.equal(sessionLogSlice(EVENTS, { query: 'cannot find module' }).count, 1);
  assert.equal(sessionLogSlice(EVENTS, { layer: 'research' }).sentence, 'Session log: no event matches.');
  const many = Array.from({ length: 40 }, (_, i) => ev(i, 'tool', `call ${i}`));
  assert.equal(sessionLogSlice(many).shown, 10);
  assert.equal(sessionLogSlice(many, { limit: 3 }).shown, 3);
});

test('session_log slice: capped at SLICE_CAP characters', () => {
  const big = Array.from({ length: 30 }, (_, i) => ev(i, 'tool', `${'long sentence '.repeat(20)}${i}`));
  const r = sessionLogSlice(big, { limit: 30 });
  assert.ok(r.sentence.length <= SLICE_CAP + 80, `${r.sentence.length}`);
  assert.ok(r.shown < 30);
});

test('toolEvents: tool, refusal with its example fix, gate lines from the tsc detail, plan steps', () => {
  const refused = toolEvents(4, 'plan_add', { tool: 'line.setCode', args: { file: 'features/a.tsx', code: 'x' } }, { ok: false, code: 'TYPE_ERROR', sentence: "Refused (TYPE_ERROR): ...\nExample fix for line 7: a ?? ''", detail: "features/a.tsx:7 TS2345 Argument of type 'string | null'." });
  assert.deepEqual(refused.map((e) => e.layer), ['tool', 'refusal', 'gate']);
  assert.match(refused[1].english, /refused with TYPE_ERROR; Example fix for line 7: a \?\? ''/);
  assert.equal(refused[2].english, "tsc TS2345 at features/a.tsx line 7: Argument of type 'string | null'.");
  const ran = toolEvents(5, 'plan_run_next', {}, { ok: true, stepId: 's2', tool: 'line.baseOn', landed: true, files: ['features/a.tsx'], findings: [{ rule: 'LINE-PAGE', severity: 'warning', file: 'features/a.tsx', sentence: 'x' }] });
  assert.deepEqual(ran.map((e) => e.layer), ['tool', 'gate', 'plan']);
  assert.equal(ran[2].english, 'Step s2 (line.baseOn) ran and landed, writing features/a.tsx.');
});

test('session_log is registered for read-tool selection and offered after a refusal', () => {
  assert.equal(READ_TOOL_REGISTRY.session_log.function.name, 'session_log');
  assert.ok(!selectTurnTools(TOOLS.line).some((t) => t.function.name === 'session_log'));
  assert.ok(selectTurnTools(TOOLS.line, { refused: true }).some((t) => t.function.name === 'session_log'));
});

test('scripted run with a fake model: events per layer in logs/session.jsonl; the log reaches the model only when asked', async () => {
  const parent = fs.realpathSync(makeTempDir('session-log-'));
  const page = 'features/picks/pages/Broken.tsx';
  const SCRIPT = [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'plan_add', arguments: { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'picks', name: 'ExtraPage' }, why: 'Another picks page.' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'plan_run_next', arguments: {} } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'plan_add', arguments: { tool: 'line.setCode', args: { file: page, code: "// @line-base pages/ListPage\nexport const n: number = '3';\n" }, why: 'A broken file.' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'session_log', arguments: { layer: 'gate' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'finish', arguments: { summary: 'done' } } }] },
  ];
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { bodies.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: SCRIPT[Math.min(bodies.length - 1, SCRIPT.length - 1)], done: true, prompt_eval_count: 7, eval_count: 1 })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const project = /** @type {string} */ (createLineProject(parent, { name: 'lending', firstFeature: 'picks' }).dir);
    fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: false, lib: ['dom', 'esnext'], jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    const o = flags(['--project', project, '--arm', 'line', '--builder', 'session-test', '--seed-plan', '--ollama', `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`, '--bench', path.join(here, '../bench/lending')]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'finish: done');
    const events = fs.readFileSync(path.join(parent, 'logs', 'session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const e of events) for (const k of ['turn', 'at', 'layer', 'kind', 'english']) assert.ok(k in e, `${k} in ${JSON.stringify(e)}`);
    const layers = new Set(events.map((e) => e.layer));
    for (const l of ['seed', 'open-work', 'coder', 'tool', 'plan', 'refusal', 'gate', 'context', 'ledger']) assert.ok(layers.has(l), `layer ${l}: ${[...layers].join(', ')}`);
    const coder = events.find((e) => e.layer === 'coder' && e.turn === 1);
    assert.equal(coder.ref, 'turn-input/1.json', 'a model call points at its turn-input file, it does not copy it');
    assert.ok(!JSON.stringify(coder).includes('"messages"'));
    assert.ok(events.some((e) => e.layer === 'plan' && e.kind === 'added') && events.some((e) => e.layer === 'plan' && /ran|landed/.test(e.kind)));
    // session_log is offered only after the refusal (turn 4), and answers the gate's line about the broken file.
    assert.ok(!bodies[1].tools.some((t) => t.function.name === 'session_log'));
    assert.ok(bodies[3].tools.some((t) => t.function.name === 'session_log'));
    const answer = bodies[4].messages.at(-1).content;
    assert.match(answer, /Session log: \d+ events? match/);
    assert.match(answer, /gate: tsc TS2322 at features\/picks\/pages\/Broken\.tsx line 2/);
    // The log never feeds the ledger turn unless asked: no session-log text in any turn's ledger/card message.
    for (const b of bodies) assert.ok(!b.messages[1].content.includes('Session log:'), 'not in the ledger turn');
    assert.ok(!events.some((e) => e.layer === 'ledger' && /Session log/.test(e.english)), 'its answer is not distilled into the ledger');
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(parent, { recursive: true, force: true }); }
});
