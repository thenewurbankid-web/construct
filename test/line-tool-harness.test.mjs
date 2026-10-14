// #938: the tool harness (packages/engine/line/harness/toolHarness.mjs) uses Ollama's native tool calls only. Native calls are
// split into offered and wrong; text is never parsed; a text answer or a wrong tool gets one nudge line naming the
// same tools; L3 checks arguments with an example of a correct call; the layered turn forces only the choice (L1
// format enum), offers only the chosen tool in L2, retries a missing call once and repeats L2 (never L1) after a
// refusal. Also: the cleaned prompt, the per-turn tool subset, qwen-agent's wiring (nudge + same tool set) and the old
// text recovery, kept only for models whose profile says textFallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { validate, exampleOf, checkArgs, callNative, nudge, layeredTurn, intentSchema, ASK } from '../packages/engine/line/harness/toolHarness.mjs';
import { cleanPrompt, promptVariant, BARE_PROMPT } from '../bench/ecommerce/driver/prompt-variants.mjs';
import { CHOOSING_TOOLS, toolsForTurn, situation, intentsFor, TURN_SETS } from '../bench/ecommerce/driver/turn-tools.mjs';
import { TOOLS, flags, runAgent, systemPrompt, textToolCalls, modelProfile } from '../bench/ecommerce/driver/qwen-agent.mjs';

const READ = CHOOSING_TOOLS.read_file;
const ADD = CHOOSING_TOOLS.plan_add;

/** A fetch that answers `replies` in order (each an Ollama /api/chat message) and records every request body. */
function scripted(replies) {
  const bodies = [];
  const fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const message = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return new Response(JSON.stringify({ model: 'fake', message, done: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fetch)), bodies };
}
const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });

test('validate: types, required, enum, nested properties; exampleOf builds a call that validates', () => {
  const s = ADD.function.parameters;
  assert.deepEqual(validate(s, { why: 'x', tool: 'line.setCode', args: {} }), []);
  assert.match(validate(s, { tool: 'line.setCode' }).map((e) => e.message).join(), /arguments\.why is required/);
  assert.match(validate(s, { why: 'x', tool: 'line.nope' }).map((e) => e.message).join(), /arguments\.tool must be one of/);
  assert.match(validate(READ.function.parameters, { path: 3 }).map((e) => e.message).join(), /arguments\.path must be string, not integer/);
  for (const t of Object.values(CHOOSING_TOOLS)) assert.deepEqual(validate(t.function.parameters, exampleOf(t.function.parameters)), [], t.function.name);
  assert.deepEqual(exampleOf(READ.function.parameters), { path: 'features/picks/pages/PicksPage.tsx' });
});

test('checkArgs: schema and the caller check refuse with BAD_ARGS and an example of a correct call; a good call is null', () => {
  assert.equal(checkArgs(READ, { path: 'features/a.ts' }), null);
  const bad = checkArgs(READ, {});
  assert.equal(bad?.code, 'BAD_ARGS');
  assert.match(bad.sentence, /arguments\.path is required/);
  assert.match(bad.sentence, /A correct call: read_file \{"path":"features\/picks\/pages\/PicksPage\.tsx"\}/);
  const scoped = checkArgs(READ, { path: '../etc/passwd' }, { check: (_n, a) => (a.path.includes('..') ? 'the path is outside the project' : null) });
  assert.match(scoped?.sentence ?? '', /the path is outside the project/);
});

test('callNative: offered native calls in `calls`, other tools in `wrong`, string arguments parsed, content never parsed', async () => {
  const f = scripted([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }, { function: { name: 'write_file', arguments: {} } }] },
    { role: 'assistant', content: '{"name": "read_file", "arguments": {"path": "a.ts"}}' },
  ]);
  const a = await callNative({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [READ], fetch: f.fetch });
  assert.deepEqual(a.calls, [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }]);
  assert.deepEqual(a.wrong.map((c) => c.function.name), ['write_file']);
  assert.deepEqual(f.bodies[0].tools, [READ]);
  assert.equal('format' in f.bodies[0], false);
  const b = await callNative({ model: 'm', messages: [], tools: [READ], fetch: f.fetch });
  assert.deepEqual(b.calls, []);
  assert.deepEqual(b.wrong, []);
  assert.equal(nudge(b, [READ, ADD]), 'You answered in text; call one of your tools: read_file, plan_add.');
  assert.equal(nudge({ calls: [], wrong: a.wrong }, [READ]), 'write_file is not a tool this turn; call one of: read_file.');
  assert.equal(nudge(a, [READ]), null);
});

test('callNative: an HTTP error throws with the request and the parsed response attached', async () => {
  const fetch = /** @type {any} */ (async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }));
  await assert.rejects(callNative({ model: 'm', messages: [], tools: [READ], fetch }), (e) => /** @type {any} */ (e).message === 'model not found' && /** @type {any} */ (e).request.model === 'm');
});

test('layeredTurn: L1 forces only the choice; L2 offers only that tool, retries a missing call once, repeats L2 (not L1) after a refusal', async () => {
  const tools = [CHOOSING_TOOLS.plan_status, READ, ADD];
  const intents = intentsFor(tools);
  const f = scripted([
    { role: 'assistant', content: '{"next": "Read a project file"}' },
    { role: 'assistant', content: 'I will read it.' }, // L2: no call -> retry
    call('read_file', { path: 7 }), // L2 retry: bad args -> refused, L2 again
    call('read_file', { path: 'features/picks/spec.md' }),
  ]);
  const ran = [];
  const r = await layeredTurn({ model: 'm', tools, intents, fetch: f.fetch,
    decideMessages: [{ role: 'user', content: 'What next?' }],
    callMessages: (tool, refusal) => [{ role: 'user', content: `Call ${tool.function.name} now.${refusal ? ` ${refusal.sentence}` : ''}` }],
    run: async (name, args) => { ran.push([name, args]); return { ok: true, sentence: 'features/picks/spec.md (12 lines).' }; } });
  assert.equal(r.tool, 'read_file');
  assert.equal(r.valid, true);
  assert.equal(r.requests, 4);
  assert.equal(r.refusals.length, 1);
  assert.deepEqual(ran, [['read_file', { path: 'features/picks/spec.md' }]]);
  assert.equal(r.sentence, 'read_file features/picks/spec.md: features/picks/spec.md (12 lines).');
  // L1: format enum of the intent sentences and no tools; L2: only the chosen tool, never a format.
  assert.deepEqual(f.bodies[0].format, intentSchema(Object.keys(intents)));
  assert.equal('tools' in f.bodies[0], false);
  for (const b of f.bodies.slice(1)) { assert.deepEqual(b.tools.map((t) => t.function.name), ['read_file']); assert.equal('format' in b, false); }
  assert.match(f.bodies[3].messages[0].content, /Refused \(BAD_ARGS\): arguments\.path must be string/);
  // #948: 'Write the code for this step' is write_function's (code never goes in plan_add's JSON), offered with it.
  assert.ok(!Object.keys(intents).includes('Write the code for this step') && Object.keys(intents).includes(ASK));
  assert.equal(intentsFor([...tools, CHOOSING_TOOLS.write_function])['Write the code for this step'], 'write_function');
});

test('layeredTurn: "Ask a question" is a miss without an L2 call; two calls-less L2 replies are a miss', async () => {
  const tools = [READ];
  const ask = scripted([{ role: 'assistant', content: JSON.stringify({ next: ASK }) }]);
  const a = await layeredTurn({ model: 'm', tools, intents: intentsFor(tools), fetch: ask.fetch, decideMessages: [], callMessages: () => [] });
  assert.equal(a.miss, true);
  assert.equal(ask.bodies.length, 1);
  const silent = scripted([{ role: 'assistant', content: '{"next": "Read a project file"}' }, { role: 'assistant', content: 'no' }]);
  const s = await layeredTurn({ model: 'm', tools, intents: intentsFor(tools), fetch: silent.fetch, decideMessages: [], callMessages: () => [] });
  assert.equal(s.miss, true);
  assert.equal(s.requests, 3);
});

test('turn tools: the situation picks the set, max cuts it, choosing descriptions and the same names as TOOLS.line', () => {
  assert.equal(situation(null), 'start');
  assert.equal(situation({ name: 'plan_add', out: { ok: true, state: 'ready' } }), 'waiting');
  assert.equal(situation({ name: 'plan_status', out: { ok: true, counts: { done: 11, ready: 2 } } }), 'waiting');
  assert.equal(situation({ name: 'plan_add', out: { ok: false, code: 'TYPE_ERROR' } }), 'refused');
  assert.equal(situation({ name: 'plan_run_next', out: { ok: true } }), 'landed');
  assert.deepEqual(toolsForTurn({ name: 'plan_add', out: { ok: false } }, { max: 3 }).map((t) => t.function.name), TURN_SETS.refused.slice(0, 3));
  assert.deepEqual(Object.keys(CHOOSING_TOOLS).sort(), TOOLS.line.map((t) => t.function.name).sort());
  for (const t of Object.values(CHOOSING_TOOLS)) assert.match(t.function.description, /^Use this when /);
});

test('cleanPrompt: the Line prompt loses its CLI table and every bare-JSON reply; bare is the minimal prompt', () => {
  const current = systemPrompt('line', path.resolve('bench/lending'));
  assert.match(current, /plan-cli\.mjs <command>/);
  const clean = cleanPrompt(current);
  assert.doesNotMatch(clean, /plan-cli\.mjs|\| Command \||send \{"fix"|send `\{"fix"|`add --fix/);
  assert.match(clean, /## Your tools/);
  assert.match(clean, /call plan_add with \{"fix": "f1", "why": "\.\.\."\}/);
  assert.match(clean, /## The spec/);
  assert.equal(promptVariant(current, 'bare'), BARE_PROMPT);
  assert.equal(promptVariant(current, 'current'), current);
});

/** A fake Ollama answering `replies` in order over HTTP. */
async function fakeOllama(replies) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      bodies.push(JSON.parse(b));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', message: replies[Math.min(bodies.length - 1, replies.length - 1)], done: true, prompt_eval_count: 1, eval_count: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, bodies, close: () => new Promise((r) => server.close(r)) };
}

test('qwen-agent: a text answer is not parsed; the next turn says so in one line with the same tools, then the native call runs', async () => {
  const parent = fs.realpathSync(makeTempDir('tool-harness-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'hi\n');
  const ollama = await fakeOllama([
    { role: 'assistant', content: '{"name": "read_file", "arguments": {"path": "README.md"}}' },
    call('finish', { summary: 'done' }),
  ]);
  try {
    const o = flags(['--project', project, '--arm', 'plain', '--builder', 'harness-test', '--model', 'fake-model', '--ollama', ollama.url]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'finish: done');
    assert.equal(ollama.bodies.length, 2);
    const nudgeLine = ollama.bodies[1].messages.at(-1);
    assert.deepEqual(nudgeLine, { role: 'user', content: `You answered in text; call one of your tools: ${TOOLS.plain.map((t) => t.function.name).join(', ')}.` });
    assert.deepEqual(ollama.bodies[1].tools, ollama.bodies[0].tools);
    const turns = fs.readFileSync(path.join(parent, 'logs', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.kind === 'turn');
    assert.equal(turns[0].textAnswer, true);
    assert.deepEqual(turns[0].calls, []);
  } finally { await ollama.close(); }
});

test('textToolCalls (the old recovery): balanced {name, arguments} spans in text, strings respected, other JSON skipped', () => {
  assert.deepEqual(textToolCalls('Sure. {"name": "read_file", "arguments": {"path": "a}.ts"}} and {"x": 1}'), [{ function: { name: 'read_file', arguments: { path: 'a}.ts' } } }]);
  assert.deepEqual(textToolCalls('```json\n{"name": "finish", "parameters": {"summary": "s"}}\n```'), [{ function: { name: 'finish', arguments: { summary: 's' } } }]);
  assert.deepEqual(textToolCalls('no call here'), []);
});

test('qwen-agent: a model whose profile has textFallback (qwen2.5-coder:7b) gets its text call run, logged as textCalls', async () => {
  // #948: sanctioned exception (owner 2026-10-14) until LoRA native calls; remove then. Off for every other profile.
  assert.equal(modelProfile('qwen2.5-coder:7b').textFallback, true);
  assert.equal(modelProfile('qwen3:4b').textFallback, false);
  const parent = fs.realpathSync(makeTempDir('tool-harness-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'hi\n');
  const ollama = await fakeOllama([
    { role: 'assistant', content: '{"name": "read_file", "arguments": {"path": "README.md"}}' },
    call('finish', { summary: 'done' }),
  ]);
  try {
    const o = flags(['--project', project, '--arm', 'plain', '--builder', 'harness-test', '--model', 'qwen2.5-coder:7b', '--ollama', ollama.url]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    assert.equal(r.stop, 'finish: done');
    const turns = fs.readFileSync(path.join(parent, 'logs', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.kind === 'turn');
    assert.equal(turns[0].textCalls, true);
    assert.deepEqual(turns[0].calls.map((c) => [c.name, c.ok]), [['read_file', true]]);
    assert.equal(ollama.bodies[1].messages.at(-1).role, 'tool');
  } finally { await ollama.close(); }
});
