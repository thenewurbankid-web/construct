// #913: the bench driver writes each turn's exact request to Ollama (logs/turn-input/<turn>.json, the system prompt once
// in logs/system-prompt.txt, referenced by sha256) and its raw response (logs/turn-output/<turn>.json). A fake Ollama
// scripts three turns (read_file with a thinking field, list_dir, finish) over a plain-arm project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { flags, runAgent } from '../bench/ecommerce/driver/qwen-agent.mjs';

const README = 'Hello from the project.\nSecond line.\n';
const SCRIPT = [
  { role: 'assistant', content: '', thinking: 'I should read the readme first.', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'README.md' } } }] },
  { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_dir', arguments: { path: '.' } } }] },
  { role: 'assistant', content: '', tool_calls: [{ function: { name: 'finish', arguments: { summary: 'done' } } }] },
];

/** A fake Ollama /api/chat answering SCRIPT in order; records every raw request body. */
async function fakeOllama() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      bodies.push(b);
      const message = SCRIPT[Math.min(bodies.length - 1, SCRIPT.length - 1)];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', message, done: true, prompt_eval_count: 100, eval_count: 10 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, bodies, close: () => new Promise((r) => server.close(r)) };
}

/** One run with BENCH_LOG_TURN_IO set to `env` (undefined = unset, the default). */
async function run(env) {
  const parent = fs.realpathSync(makeTempDir('turn-io-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), README);
  const ollama = await fakeOllama();
  const prev = process.env.BENCH_LOG_TURN_IO;
  if (env === undefined) delete process.env.BENCH_LOG_TURN_IO; else process.env.BENCH_LOG_TURN_IO = env;
  try {
    const o = flags(['--project', project, '--arm', 'plain', '--builder', 'turn-io-test', '--model', 'qwen3:4b', '--seed', '7', '--num-ctx', '8192', '--ollama', ollama.url]);
    const r = await runAgent(o, { resultsDir: path.join(parent, 'results') });
    const logs = path.join(parent, 'logs');
    const jsonl = (f) => fs.readFileSync(path.join(logs, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { r, logs, bodies: ollama.bodies, turns: jsonl('turns.jsonl'), calls: jsonl('calls.jsonl') };
  } finally {
    if (prev === undefined) delete process.env.BENCH_LOG_TURN_IO; else process.env.BENCH_LOG_TURN_IO = prev;
    await ollama.close();
  }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const stripAt = (e) => { const { at: _at, ms: _ms, ...rest } = e; return rest; };

test('turn input/output files: the exact request (system prompt by sha), the raw response with thinking, pointers in turns.jsonl', async () => {
  const { r, logs, bodies, turns } = await run(undefined);
  assert.equal(r.stop, 'finish: done');
  assert.equal(bodies.length, 3);
  const sys = fs.readFileSync(path.join(logs, 'system-prompt.txt'), 'utf8');
  const sha = crypto.createHash('sha256').update(sys).digest('hex');
  assert.equal(fs.readFileSync(path.join(logs, 'system-prompt.sha256'), 'utf8').trim(), sha);
  const turnRows = turns.filter((t) => t.kind === 'turn');
  assert.equal(turnRows.length, 3);
  for (const [i, t] of turnRows.entries()) {
    const n = i + 1;
    assert.equal(t.inputFile, `turn-input/${n}.json`);
    assert.equal(t.outputFile, `turn-output/${n}.json`);
    assert.equal(t.inputBytes, fs.statSync(path.join(logs, t.inputFile)).size);
    assert.equal(t.outputBytes, fs.statSync(path.join(logs, t.outputFile)).size);
    const input = readJson(path.join(logs, t.inputFile));
    const sent = JSON.parse(bodies[i]);
    // The system message is a reference; put the stored prompt back and it is exactly the request Ollama got.
    assert.deepEqual(input.messages[0], { role: 'system', sha256: sha, file: 'system-prompt.txt' });
    const { turn, ...rest } = input;
    assert.equal(turn, n);
    assert.deepEqual({ ...rest, messages: [{ role: 'system', content: sys }, ...rest.messages.slice(1)] }, sent);
    assert.deepEqual(input.options, { num_ctx: 8192, temperature: 0.2, seed: 7 });
    assert.equal(input.model, 'qwen3:4b');
    const output = readJson(path.join(logs, t.outputFile));
    assert.deepEqual(output.response.message, SCRIPT[i]);
    assert.equal(output.parsedCalls[0].function.name, SCRIPT[i].tool_calls[0].function.name);
  }
  // The thinking field survives in the raw output; read_file's content is verbatim in the next turn's input.
  assert.equal(readJson(path.join(logs, 'turn-output/1.json')).response.message.thinking, 'I should read the readme first.');
  const tool = readJson(path.join(logs, 'turn-input/2.json')).messages.find((m) => m.role === 'tool');
  assert.equal(JSON.parse(tool.content).content, README);
  // The system prompt is stored once, not per turn.
  for (const n of [1, 2, 3]) assert.ok(!fs.readFileSync(path.join(logs, `turn-input/${n}.json`), 'utf8').includes(sys.slice(0, 200)));
});

test('BENCH_LOG_TURN_IO=0 writes nothing: no turn-input/, turn-output/, system-prompt.txt, and no pointers in turns.jsonl', async () => {
  const { r, logs, turns } = await run('0');
  assert.equal(r.stop, 'finish: done');
  for (const f of ['turn-input', 'turn-output', 'system-prompt.txt', 'system-prompt.sha256']) assert.equal(fs.existsSync(path.join(logs, f)), false, f);
  for (const t of turns) for (const k of ['inputFile', 'outputFile', 'inputBytes', 'outputBytes']) assert.equal(k in t, false, `${t.kind} has ${k}`);
});

test('logging on vs off: byte-identical requests to Ollama, identical tool calls and calls.jsonl entries', async () => {
  const on = await run(undefined);
  const off = await run('0');
  assert.deepEqual(on.bodies, off.bodies);
  const callsOf = (turns) => turns.filter((t) => t.kind === 'turn').map((t) => t.calls);
  assert.deepEqual(callsOf(on.turns), callsOf(off.turns));
  assert.deepEqual(on.calls.map(stripAt), off.calls.map(stripAt));
  const turnRow = (t) => { const { ms: _m, inputFile: _i, outputFile: _o, inputBytes: _ib, outputBytes: _ob, ...rest } = t; return rest; };
  assert.deepEqual(on.turns.filter((t) => t.kind === 'turn').map(turnRow), off.turns.filter((t) => t.kind === 'turn').map(turnRow));
});
