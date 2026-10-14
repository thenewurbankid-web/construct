// #948 item 1 -- no code in tool-call JSON. Code goes only through a prefilled one-function request
// (packages/engine/line/coder/prefill); tools carry names, ids and choices. Fake models only: one puts code in the JSON,
// one writes two functions; both are refused with a concrete example. LINE_LEGACY_IO=1 keeps the old path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { flags, runAgent, TOOLS, LEGACY_TOOLS, codeRefusal, writeFunction, modelProfile } from '../bench/ecommerce/driver/qwen-agent.mjs';
import { checkArgs, layeredTurn, codeBearing } from '../packages/engine/line/harness/toolHarness.mjs';
import { codeInArgs, functionsIn, fillOne, takeBody, closingBrace, STOP } from '../packages/engine/line/coder/prefill/index.mjs';

const names = (list) => list.map((t) => t.function.name);
const withLegacy = async (fn) => { const prev = process.env.LINE_LEGACY_IO; process.env.LINE_LEGACY_IO = '1'; try { return await fn(); } finally { if (prev === undefined) delete process.env.LINE_LEGACY_IO; else process.env.LINE_LEGACY_IO = prev; } };

test('the modelled tools carry no code argument; the legacy ones keep write_file.content and fill.body', () => {
  for (const arm of ['line', 'path', 'plain']) for (const t of TOOLS[arm]) assert.equal(codeBearing(t), false, `${arm}.${t.function.name}`);
  assert.ok(names(TOOLS.line).includes('write_function') && names(TOOLS.plain).includes('write_function') && !names(TOOLS.plain).includes('write_file'));
  assert.deepEqual(Object.keys(TOOLS.path.find((t) => t.function.name === 'fill').function.parameters.properties), ['stubId']);
  assert.ok(codeBearing(LEGACY_TOOLS.plain.find((t) => t.function.name === 'write_file')) && codeBearing(LEGACY_TOOLS.path.find((t) => t.function.name === 'fill')));
});

test('a fake that puts code in the JSON is refused (CODE_IN_JSON) with an example of the call that writes code', () => {
  const setCode = codeRefusal('line', 'plan_add', { tool: 'line.setCode', args: { file: 'features/a/pages/A.tsx', code: 'export default function A() {\n  return <div/>;\n}' }, why: 'x' });
  assert.equal(setCode.code, 'CODE_IN_JSON');
  assert.match(setCode.sentence, /A correct call: write_function \{"file": /);
  const plain = codeRefusal('plain', 'write_function', { path: 'a.ts', name: 'a', signature: 'export function a() { return 1; }' });
  assert.match(plain.sentence, /arguments\.signature carries code[\s\S]*A correct call: write_function \{"path"/);
  assert.equal(codeRefusal('line', 'plan_add', { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'picks', name: 'PicksPage' }, why: 'The picks page.' }), null);
  assert.equal(codeRefusal('line', 'plan_add', { fix: 'f1', why: 'Take the recommended fix.' }), null, 'a typed fix ref is not code');
  // checkArgs (L3) refuses it too, with a correct call.
  const tool = { type: 'function', function: { name: 'note', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } };
  const bad = checkArgs(tool, { text: 'const total = items.reduce((s, i) => s + i.price, 0);' });
  assert.match(bad.sentence, /carries code; code never goes inside a tool call[\s\S]*A correct call: note/);
  assert.equal(checkArgs(tool, { text: 'Sum the item prices.' }), null);
  assert.equal(codeInArgs({ path: 'features/cart/pages/CartPage.tsx', why: 'The cart lists items; it needs a total.' }), null);
});

test('layeredTurn never sends a code-bearing tool as an L2 call: the caller\'s prefilled fill runs it', async () => {
  const chats = [];
  const fetch = async (_url, init) => { chats.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ message: { role: 'assistant', content: JSON.stringify({ next: 'Write the code for this step' }) } }) }; };
  const write = LEGACY_TOOLS.plain.find((t) => t.function.name === 'write_file');
  const filled = [];
  const r = await layeredTurn({ model: 'm', tools: [write], intents: { 'Write the code for this step': 'write_file' }, decideMessages: [], callMessages: () => [], fetch,
    fill: async (name) => { filled.push(name); return { ok: true, sentence: 'Wrote total.' }; } });
  assert.equal(chats.length, 1, 'only L1 (the choice) went to /api/chat');
  assert.deepEqual(filled, ['write_file']);
  assert.equal(r.valid, true);
  const none = await layeredTurn({ model: 'm', tools: [write], intents: { 'Write the code for this step': 'write_file' }, decideMessages: [], callMessages: () => [], fetch });
  assert.equal(none.miss, true);
  assert.match(none.sentence, /prefilled fill/);
});

test('prefill: the reply is cut at the prefilled function\'s closing brace; a second function is refused with an example', async () => {
  assert.deepEqual(STOP, ['\n}']);
  assert.equal(closingBrace('  return `}${x}`;\n}\nmore'), 19);
  assert.deepEqual(takeBody('  return a + b;\n}\n', 'export function add(a: number, b: number): number {'), { body: '  return a + b;', trailing: false, closed: true });
  assert.equal(takeBody('export function add(a: number, b: number): number {\n  return a + b;\n}', 'export function add(a: number, b: number): number {').body, '  return a + b;', 'a restated signature is unwrapped');
  const source = 'export function add(a: number, b: number): number {\n  return 0;\n}\n';
  const asked = [];
  const twoFns = async (q) => { asked.push(q); return asked.length === 1 ? '  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}' : '  return a + b;\n}'; };
  const r = await fillOne({ source, file: 'm.ts', target: { name: 'add' }, generate: twoFns, user: 'Add two numbers.' });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(asked[0].prefill, 'export function add(a: number, b: number): number {\n');
  assert.match(asked[1].user, /Refused \(ONE_FUNCTION\)[\s\S]*a valid reply is only/);
  assert.ok(!asked[1].user.includes('sub('), 'the retry carries the refusal, not the earlier reply');
  assert.equal(r.source, 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  const typed = await fillOne({ source, file: 'm.ts', target: { name: 'add' }, generate: async () => '  return "x";\n}', user: '', maxAttempts: 1 });
  assert.equal(typed.code, 'TSC');
  assert.match(typed.sentence, /TS2322[\s\S]*a valid reply is only/);
});

test('writeFunction (line arm): one prefilled request, then plan_add line.setCode with the spliced file; a missing function needs its signature', async () => {
  const file = 'features/cart/domain/cart.ts';
  const content = 'export function itemCount(items: number[]): number {\n  return 0;\n}\n';
  const runs = [];
  const cli = { run: async (cmd, rest, o) => { runs.push({ cmd, rest, o }); return cmd === 'read' ? { ok: true, content, contentHash: 'h1' } : { ok: true, sentence: 'Step 1 joined the plan.' }; } };
  const out = await writeFunction(cli, 'line', { file, name: 'itemCount', why: 'Count the items.' }, { generate: async () => '  return items.length;\n}' });
  assert.equal(out.ok, true);
  const add = runs.find((x) => x.cmd === 'add');
  assert.equal(add.rest[0], 'line.setCode');
  assert.deepEqual(JSON.parse(add.rest[1]), { file, code: 'export function itemCount(items: number[]): number {\n  return items.length;\n}\n', contentHash: 'h1' });
  const missing = await writeFunction(cli, 'line', { file, name: 'total', why: 'x' }, { generate: async () => '' });
  assert.equal(missing.code, 'NO_FUNCTION');
  assert.match(missing.sentence, /A correct call: write_function \{"file": .*"signature": "export function total/);
  const added = await writeFunction(cli, 'line', { file, name: 'total', signature: 'export function total(items: number[]): number', why: 'Sum them.' }, { generate: async () => '  return items.reduce((s, n) => s + n, 0);\n}' });
  assert.equal(added.ok, true);
  assert.deepEqual(functionsIn(JSON.parse(runs.filter((x) => x.cmd === 'add').pop().rest[1]).code, file).map((f) => f.name), ['itemCount', 'total']);
});

/** A fake Ollama: /api/chat answers the scripted tool calls in order; /api/generate is the prefilled request. */
async function fakeOllama(script, generated) {
  const chat = []; const gen = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/api/generate') { gen.push(body); res.end(JSON.stringify({ response: generated[Math.min(gen.length - 1, generated.length - 1)], done: true })); return; }
      chat.push(body);
      res.end(JSON.stringify({ model: 'fake', message: script[Math.min(chat.length - 1, script.length - 1)], done: true, prompt_eval_count: 10, eval_count: 5 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, chat, gen, close: () => new Promise((r) => server.close(r)) };
}

const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });

test('runAgent (plain arm, fake Ollama): write_file with code is not offered; write_function writes one prefilled function', async () => {
  const parent = fs.realpathSync(makeTempDir('modelled-io-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'sum.ts'), 'export function sum(xs: number[]): number {\n  return 0;\n}\n');
  const ollama = await fakeOllama([
    call('write_file', { path: 'sum.ts', content: 'export function sum(xs: number[]) {\n  return xs.reduce((a, b) => a + b, 0);\n}\n' }),
    call('write_function', { path: 'sum.ts', name: 'sum' }),
    call('finish', { summary: 'done' }),
  ], ['  return xs.reduce((a, b) => a + b, 0);\n']);
  try {
    const o = flags(['--project', project, '--arm', 'plain', '--builder', 'modelled-io-test', '--model', 'qwen3:4b', '--num-ctx', '8192', '--ollama', ollama.url]);
    await runAgent(o, { resultsDir: path.join(parent, 'results') });
  } finally { await ollama.close(); }
  assert.ok(!ollama.chat[0].tools.some((t) => t.function.name === 'write_file'), 'write_file is not offered');
  assert.equal(ollama.gen.length, 1);
  assert.equal(ollama.gen[0].raw, true);
  assert.deepEqual(ollama.gen[0].options.stop, ['\n}']);
  assert.ok(ollama.gen[0].prompt.endsWith('<|im_start|>assistant\nexport function sum(xs: number[]): number {\n'), 'the assistant turn is prefilled with the signature');
  assert.equal(fs.readFileSync(path.join(project, 'sum.ts'), 'utf8'), 'export function sum(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n');
  const turns = fs.readFileSync(path.join(parent, 'logs', 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((t) => t.kind === 'turn');
  assert.deepEqual(turns[0].wrongCalls, ['write_file'], 'a call of the code tool is not run');
});

test('textToolCalls is off by default; on for qwen2.5-coder only (sanctioned exception until LoRA native calls)', async () => {
  for (const m of ['qwen2.5-coder:7b', 'qwen2.5-coder:1.5b']) { assert.equal(modelProfile(m).textFallback, true); assert.equal('textFallbackLegacy' in modelProfile(m), false); }
  assert.equal(modelProfile('qwen3:4b').textFallback, false);
  await withLegacy(async () => assert.ok(names((await import('../bench/ecommerce/driver/qwen-agent.mjs')).LEGACY_TOOLS.plain).includes('write_file')));
});
