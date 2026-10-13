// #932 (owner redirect): the ledger turn builder. No history is resent: each turn is the system prompt, the ledger view
// (every earlier tool result as one sentence + cites), the current step/point with its context pack, and only the last
// call and its result. Replay of lending-qwen-7b-r1 turn 12's situation (logs/turn-input/12.json: turns 1-11, three
// identical refused setCode calls on PicksPage, ~14.9k prompt tokens): the built turn stays under a fixed budget and
// carries the PicksPage error, its example fix and the ledger facts, not the three raw failures.
import test from 'node:test';
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { hashOf } from '../packages/engine/pagesEditor.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { buildTurn } from '../bench/ecommerce/driver/turn.mjs';
import { createLedger, ledgerView, distil, loadLedger } from '../bench/ecommerce/driver/ledger.mjs';
import { estimateTokens } from '../bench/ecommerce/driver/compact.mjs';
import { flags, runAgent, textToolCalls, TOOLS } from '../bench/ecommerce/driver/qwen-agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const T16 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/builder-context/lending-r1-turn16.json'), 'utf8'));
const PICKS = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/builder-context/lending-picks.json'), 'utf8'));
const FILE = 'features/picks/pages/PicksPage.tsx';
const SEEDED = "// @line-base pages/ListPage\n// @line-route /picks\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function PicksPage() {\n  return <ListPage title=\"Picks\" />;\n}\n";
/** The fixed budget a built turn stays under (estimated tokens, tool schemas included). */
const TURN_TOKENS = 8000;

test('distil: a refusal is one sentence with its example fix and cites; identical ones count up', () => {
  const said = "Stop: this exact call was already refused 3 times ...\nRefused (TYPE_ERROR): The code does not compile, so nothing was saved: Argument of type 'string | null' is not assignable (features/picks/pages/PicksPage.tsx line 7).\nRule: ...\nExample fix for line 7: const a = JSON.parse(localStorage.getItem('picks') ?? '[]');";
  const e = distil('plan_add', { tool: 'line.setCode', args: { file: FILE, code: 'x' } }, { ok: false, code: 'TYPE_ERROR', sentence: said });
  assert.equal(e.kind, 'fact');
  assert.match(e.text, /^line\.setCode on features\/picks\/pages\/PicksPage\.tsx was refused \(TYPE_ERROR\): The code does not compile/);
  assert.match(e.text, /Example fix for line 7: const a = JSON\.parse\(localStorage\.getItem\('picks'\) \?\? '\[\]'\);$/);
  assert.deepEqual(e.cites, ['line.setCode', FILE, 'TYPE_ERROR']);
  const l = createLedger();
  l.add(e); l.add(e);
  assert.equal(l.entries.length, 1);
  assert.match(ledgerView({ ledger: l }, 500), /\(x2\) \[line\.setCode, features\/picks\/pages\/PicksPage\.tsx, TYPE_ERROR\]$/);
});

test('replay lending-r1 turn 12: a fresh small turn with the PicksPage error, the example fix and the ledger facts', async () => {
  const parent = fs.realpathSync(makeTempDir('line-ledger-turn-'));
  try {
    // The project as r1 had it (ListPage, picks' spec.md, the seeded PicksPage) and a spec with only picks.
    const r0 = createLineProject(parent, { name: 'lending', firstFeature: 'picks' });
    assert.equal(r0.ok, true, r0.sentence);
    const root = /** @type {string} */ (r0.dir);
    fs.writeFileSync(path.join(root, 'library/pages/ListPage.tsx'), PICKS.listPage);
    fs.writeFileSync(path.join(root, 'features/picks/spec.md'), PICKS.picksSpec);
    fs.mkdirSync(path.join(root, 'features/picks/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, FILE), SEEDED);
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: false, lib: ['dom', 'esnext'], jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, types: [] } }));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    const full = fs.readFileSync(path.join(here, '../bench/lending/SPEC.md'), 'utf8');
    const at = full.indexOf('\n## As a member, I want a short list');
    const spec = path.join(parent, 'SPEC.md');
    fs.writeFileSync(spec, `${full.slice(0, full.indexOf('\n## As '))}${full.slice(at, full.indexOf('\n## As', at + 5))}\n`);
    const cli = createPlanCli({ project: root, log: path.join(parent, 'logs', 'calls.jsonl'), builder: 'test', shadowJev: false, spec });

    // The ledger: turns 1-10 as logged (turn-input/12.json is turn-input/16.json's first 22 history messages), each
    // tool result distilled to one sentence.
    const ledger = createLedger();
    const logged = T16.history.slice(0, 20);
    for (let i = 0; i < logged.length; i += 2) {
      const c = logged[i].tool_calls?.[0] ?? textToolCalls(logged[i].content)[0];
      ledger.distil(c.function.name, c.function.arguments, JSON.parse(logged[i + 1].content));
    }
    // Turn 11 for real: the same PicksPage code, now refused with the example fix and the context pack.
    const args = { tool: 'line.setCode', args: { file: FILE, code: PICKS.turn8Code, contentHash: hashOf(SEEDED) }, why: 'Fill PCK-1.' };
    let out;
    for (let k = 0; k < 3; k += 1) out = await cli.run('add', [args.tool, JSON.stringify(args.args)], { why: args.why });
    assert.equal(out.code, 'TYPE_ERROR');
    const assistant = { role: 'assistant', content: JSON.stringify({ name: 'plan_add', arguments: args }) };
    const lastTool = { role: 'tool', content: JSON.stringify({ ok: out.ok, code: out.code, sentence: out.sentence, ...(out.detail ? { detail: out.detail } : {}) }) };
    ledger.distil('plan_add', args, out);

    const L = await loadLedger();
    const built = buildTurn({ system: { role: 'system', content: T16.system }, ledger, ledgerView: L.ledgerView, card: await cli.card(), last: [assistant, lastTool], tools: T16.tools });
    const all = JSON.stringify(built.messages);
    assert.ok(built.tokens <= TURN_TOKENS, `built turn ${built.tokens} tokens over ${TURN_TOKENS}`);
    assert.equal(built.messages.length, 4, 'system, ledger + card, the last call, its result: nothing else');
    assert.ok(all.includes('TS2345'), 'the PicksPage error');
    assert.ok(all.includes("Example fix for line 7: const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]') || [];"), 'its example fix');
    assert.ok(all.includes(`Context for ${FILE}`), 'the context pack');
    assert.match(built.messages[1].content, /Facts:\n/);
    assert.match(built.messages[1].content, /line\.setCode on features\/picks\/pages\/PicksPage\.tsx was refused \(TYPE_ERROR\)[^\n]*\(x\d\)/, 'the repeats are one ledger line with a count');
    // Not the three raw failures: the full refusal text is in the last tool result only.
    const raw = built.messages.filter((m) => m.role === 'tool' && /Refused \(TYPE_ERROR\)/.test(m.content));
    assert.equal(raw.length, 1);
    assert.equal(built.messages.filter((m) => m.role === 'assistant').length, 1);
    const old = [3616, 4561, 5874, 6425, 7148, 7867, 8829, 10223, 11185, 12579, 13541, 14935, 15897, 15693, 16228, 16185];
    console.log(`ledger turn at r1's turn 12: ${built.tokens} tokens (system ${built.parts.system}, ledger ${built.parts.ledger}, card ${built.parts.card}, last ${built.parts.last}; tools ~${estimateTokens([], TOOLS.line)}); r1 turns 1-16 were ${old.join(', ')} (Ollama prompt_eval_count, turn 12: ${old[11]})`);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('driver: the line arm sends a fresh turn each time (no earlier raw messages); --context history keeps the old path', async () => {
  const parent = fs.realpathSync(makeTempDir('line-ledger-run-'));
  const SCRIPT = [
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_dir', arguments: { path: '.' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'features/picks/spec.md' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'finish', arguments: { summary: 'done' } } }] },
  ];
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { bodies.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: SCRIPT[Math.min(bodies.length - 1, 2)], done: true, prompt_eval_count: 1, eval_count: 1 })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r0 = createLineProject(parent, { name: 'lending', firstFeature: 'picks' });
    const project = /** @type {string} */ (r0.dir);
    const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
    const o = flags(['--project', project, '--arm', 'line', '--builder', 'ledger-test', '--ollama', url, '--bench', path.join(here, '../bench/lending')]);
    assert.equal(o.context, 'ledger');
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'finish: done');
    assert.equal(bodies.length, 3);
    for (const b of bodies) assert.ok(b.messages.length <= 4, `${b.messages.length} messages`);
    // Turn 3: the ledger names turn 1's list_dir; only turn 2's read_file call and result are raw messages.
    const t3 = bodies[2].messages;
    assert.match(t3[1].content, /What is known so far[^]*list_dir/);
    assert.equal(t3.filter((m) => m.role === 'assistant').length, 1);
    assert.equal(t3[2].tool_calls[0].function.name, 'read_file');
    const rows = fs.readFileSync(path.join(parent, 'logs', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.kind === 'turn');
    assert.equal(rows[0].context.mode, 'ledger');
    assert.ok(rows[2].context.tokens > 0);
    assert.equal(flags(['--arm', 'line', '--context', 'history']).context, 'history');
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(parent, { recursive: true, force: true }); }
});
