// drive.mjs / drive-mcp.mjs (#941). No model: lists the MCP tools, calls task_show over a linked in-memory transport
// (packages/mcp/test-utils/harness.mjs's pattern) and the stdio server, and unit-tests the summary join.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createDriveMcpServer } from '../drive-mcp.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { summarize, sessionRecord, normalizeOpencode, SESSION_FILE, fnPrompt } from '../drive.mjs';
import { checkBrief, SAMPLE_NOTE } from '../blocks/briefGuard.mjs';
import { STOP, fnGoal, chatmlPrompt, prefillFor, completeFunction } from '../blocks/prefill.mjs';
import { spliceFunction } from '../blocks/spliceApplier.mjs';
import { buildBriefs } from '../blocks/briefBuilder.mjs';

const T06 = ['listPicks', 'addPick', 'removePick'];
const T06_GOAL = 'Write the picks store. Export exactly these functions: listPicks(): string[] (the picked book ids, in the order they were added), addPick(id: string): void (adds it; adding an id that is already there does nothing), removePick(id: string): void. Keep the ids in localStorage under the key "picks" as a JSON array of strings.';

test('briefGuard rejects a brief with a full body or a long code block', () => {
  const full = 'Rewrite it like this:\n```tsx\nexport function BookPage({ params }: { params: { id: string } }) {\n  const book = books.find((b) => b.id === params.id);\n  if (!book) return null;\n  const s = book.available ? "Available" : "On loan";\n  return <p>{s}</p>;\n}\n```';
  const r = checkBrief(full);
  assert.equal(r.ok, false);
  assert.match(r.reason, /implementation \(BookPage has a 4-statement body\)/);
  assert.match(r.reason, /never write the implementation; the 1\.5b writes the code/);
  const arrow = 'Use:\nconst listX = () => {\n  const raw = localStorage.getItem("x");\n  if (!raw) return [];\n  return JSON.parse(raw);\n};';
  assert.match(checkBrief(arrow).reason, /listX has a 3-statement body/);
  const jsx = '```tsx\nreturn (\n  <DetailPage title={book.title}>\n    <p>{book.author}</p>\n  </DetailPage>\n);\n```';
  assert.match(checkBrief(jsx).reason, /5 consecutive lines of code/);
});

test('every briefGuard rejection carries one short valid sample note, and the sample itself passes', () => {
  const rejected = [
    checkBrief('```ts\nfunction f() {\n  a();\n  b();\n  c();\n}\n```'),
    checkBrief('```tsx\nreturn (\n  <A>\n    <B />\n  </A>\n);\n```'),
    checkBrief('Use listPicks.', { fn: 'addPick', others: T06 }),
  ];
  for (const r of rejected) {
    assert.equal(r.ok, false);
    assert.ok(r.reason.endsWith(`Example of a valid note: '${SAMPLE_NOTE}'`), r.reason);
  }
  assert.deepEqual(checkBrief(SAMPLE_NOTE), { ok: true });
  assert.ok(SAMPLE_NOTE.length < 200);
});

test('briefGuard passes a signature plus intent, types and a short shape example', () => {
  assert.deepEqual(checkBrief('SIGNATURE: export function BookPage({ params }: { params: { id: string } })\nShow "Available" when book.available is true, otherwise "On loan". Never print true or false.'), { ok: true });
  assert.deepEqual(checkBrief('export function listPicks(): string[]\nRead the JSON array stored under the key "picks"; return [] when it is missing.'), { ok: true });
  assert.deepEqual(checkBrief('```ts\ntype Book = {\n  id: string;\n  title: string;\n  available: boolean;\n};\n```\nShape, from a shop:\n```tsx\n<p>{item.inStock ? "In stock" : "Sold out"}</p>\n```'), { ok: true });
});

test('per-function routing: one note per function, a prompt that never names the other targets', () => {
  assert.deepEqual(checkBrief('Add the id unless it is already there; keep the order.', { fn: 'addPick', others: T06 }), { ok: true });
  assert.ok(checkBrief('Call listPicks() first, then add the id.', { fn: 'addPick', others: T06 }).reason.startsWith('one function per note: write the note for addPick only (it names listPicks).'));
  assert.equal(fnGoal(T06_GOAL, 'addPick', T06), 'Write the picks store. Export addPick(id: string): void (adds it; adding an id that is already there does nothing). Keep the ids in localStorage under the key "picks" as a JSON array of strings.');
  const task = JSON.parse(readFileSync(join(HERE, '..', 'tasks', 't06-picks-store', 'task.json'), 'utf8'));
  const read = (p) => { for (const d of ['t06-picks-store/start', '_r2', '_shared']) { try { return readFileSync(join(HERE, '..', 'tasks', d, p), 'utf8'); } catch {} } throw new Error(p); };
  const { briefs } = buildBriefs({ task, file: read(task.target), read });
  assert.deepEqual(briefs.map((b) => b.name), T06);
  for (const b of briefs) {
    const p = fnPrompt({ task, brief: b, names: T06, note: 'Keep the order they were added.', raw: false });
    assert.ok(p.includes(`SIGNATURE: export function ${b.name}(`));
    assert.ok(p.endsWith("LEAD'S NOTE: Keep the order they were added."));
    assert.deepEqual(T06.filter((n) => n !== b.name && p.includes(n)), [], `${b.name}'s prompt names another target`);
  }
  // Raw mode: the fixed bare shape for the one function, the note as INTENT; no types, how or example.
  for (const b of briefs) {
    const p = fnPrompt({ task, brief: b, note: 'Return [] when nothing is stored.', raw: true });
    assert.deepEqual(p.split('\n\n').map((s) => s.match(/^[A-Z]+(?=[: ])/)?.[0] ?? s.split(' ')[0]), ['FUNCTION', 'SIGNATURE', 'SPEC', 'INTENT', 'Write']);
    assert.ok(p.startsWith(`FUNCTION: ${b.name} in ${task.target}.`));
    assert.match(p, new RegExp(`^SIGNATURE: export function ${b.name}\\(`, 'm'));
    assert.match(p, /^INTENT: Return \[\] when nothing is stored\.$/m);
    assert.doesNotMatch(p, /HOW|EXAMPLE|TYPES IN SCOPE/);
    assert.deepEqual(T06.filter((n) => n !== b.name && p.includes(n)), [], `${b.name}'s raw prompt names another target`);
  }
});

test('prefilled reply: a fake model that writes a second function is cut at the first function\'s end', () => {
  const signature = 'export function addPick(id: string): void';
  const prompt = chatmlPrompt({ system: 'S', user: 'U', prefill: prefillFor(signature, 'ts') });
  assert.ok(prompt.endsWith('<|im_start|>assistant\n```ts\nexport function addPick(id: string): void {\n'));
  const greedy = '  const s = `${id}}`;\n  if (!s) { return; }\n  localStorage.setItem("picks", JSON.stringify([s]));\n}\n\nexport function removePick(id: string): void {\n  localStorage.removeItem(id);\n}\n```\n';
  // Ollama's stop sequence (a column-0 `}`) ends the generation before the second function...
  const stopped = greedy.slice(0, greedy.indexOf(STOP[0]));
  // ...and brace depth cuts it when the stop sequence is not applied.
  for (const generated of [stopped, greedy]) {
    const reply = completeFunction(signature, generated, 'ts');
    assert.doesNotMatch(reply, /removePick/);
    const sp = spliceFunction('// store\nexport {};\n', reply, 'addPick', 'x.ts');
    assert.equal(sp.ok, true, sp.detail);
    assert.match(sp.body, /export function addPick\(id: string\): void \{\n  const s = `\$\{id\}\}`;[\s\S]*\n\}\n$/);
  }
});

const HERE = dirname(fileURLToPath(import.meta.url));

test('lists the four tools and task_show returns the facts, not the file', async () => {
  const server = createDriveMcpServer({ run: 'test', harness: 'test' });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['task_check', 'task_show', 'task_show_code', 'task_try']);
    const r = await client.callTool({ name: 'task_show', arguments: { task: 't03-book-availability' } });
    const text = r.content[0].text;
    assert.notEqual(r.isError, true);
    assert.match(text, /^FUNCTION: BookPage/m);
    assert.match(text, /^SIGNATURE: export function BookPage/m);
    assert.ok(text.split('\n').length <= 40);
    assert.doesNotMatch(text, /return \(/); // the current body is not shown
    const bad = await client.callTool({ name: 'task_show', arguments: { task: '../etc' } });
    assert.equal(bad.isError, true);
  } finally { await client.close(); await server.close(); }
});

test('task_try passes raw through as --raw (default note mode), and CD-raw session files are recognized', async () => {
  const seen = [];
  const run = `test-raw-${process.pid}`;
  const server = createDriveMcpServer({ run, harness: 'test', exec: async (args) => { seen.push(args); return { code: 0, text: 'PASS' }; } });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  try {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'task_try');
    assert.equal(tool.inputSchema.properties.raw.type, 'boolean');
    assert.ok(!(tool.inputSchema.required ?? []).includes('raw'));
    await client.callTool({ name: 'task_try', arguments: { task: 't03-book-availability', brief: 'note' } });
    await client.callTool({ name: 'task_try', arguments: { task: 't03-book-availability', brief: 'whole prompt', raw: true } });
    await client.callTool({ name: 'task_try', arguments: { task: 't06-picks-store', brief: 'note', fn: 'addPick' } });
    assert.equal(seen.length, 3);
    assert.ok(!seen[0].includes('--raw') && !seen[0].includes('--fn'));
    assert.equal(seen[1].at(-1), '--raw');
    assert.equal(readFileSync(seen[1][seen[1].indexOf('--brief') + 1], 'utf8'), 'whole prompt');
    assert.deepEqual(seen[2].slice(-2), ['--fn', 'addPick']);
  } finally {
    await client.close(); await server.close();
    rmSync(join(HERE, '..', 'results', 'claude-drive', 'briefs', run), { recursive: true, force: true });
  }
  assert.deepEqual('claude-CD-raw-t03-book-availability.json'.match(SESSION_FILE).slice(1), ['claude', 'CD-raw', 't03-book-availability']);
  assert.deepEqual('opencode-CD-t06-picks-store.json'.match(SESSION_FILE).slice(1), ['opencode', 'CD', 't06-picks-store']);
  assert.equal('opencode-CD-t06-picks-store.events.jsonl'.match(SESSION_FILE), null);
});

test('the stdio server starts and answers tools/list', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(HERE, '..', 'drive-mcp.mjs')], env: { ...process.env, DRIVE_RUN: 'test' }, stderr: 'pipe' });
  const client = new Client({ name: 'test-stdio-client', version: '0.0.1' });
  await client.connect(transport);
  try { assert.equal((await client.listTools()).tools.length, 4); } finally { await client.close(); }
});

test('summary joins drive rows with harness sessions per task, arm and harness', () => {
  const rows = [
    { task: 't03', arm: 'CD', harness: 'claude', pass: false, failClass: 'check', briefChars: 100, coderCalls: 5, tokensIn: 10, tokensOut: 5, wallMs: 1000 },
    { task: 't03', arm: 'CD', harness: 'claude', pass: true, briefChars: 50, coderCalls: 1, tokensIn: 2, tokensOut: 1, wallMs: 500 },
    { task: 't03', arm: 'CW', harness: 'opencode', pass: true, writtenChars: 900, coderCalls: 0, wallMs: 300 },
  ];
  const sessions = [sessionRecord('claude', 'CD', 't03', { usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 100 }, num_turns: 4, total_cost_usd: 0.01, duration_ms: 9, modelUsage: { m1: { outputTokens: 3 } } })];
  const t = summarize(rows, sessions);
  assert.equal(t.length, 2);
  const cd = t.find((r) => r.arm === 'CD');
  assert.deepEqual([cd.harness, cd.pass, cd.tries, cd.chars, cd.coderCalls, cd.coderTokens, cd.wallMs], ['claude', true, 2, 150, 6, 18, 1500]);
  assert.deepEqual([cd.claude.in, cd.claude.cacheRead, cd.claude.turns, cd.claude.model], [7, 100, 4, 'm1']);
  assert.equal(t.find((r) => r.arm === 'CW').claude, null);
});

test('normalizeOpencode sums step-finish tokens and reports errors', () => {
  const r = normalizeOpencode([
    JSON.stringify({ type: 'step_finish', timestamp: 10, part: { tokens: { input: 5, output: 2, reasoning: 1, cache: { read: 7, write: 3 } }, cost: 0.5 } }),
    JSON.stringify({ type: 'text', timestamp: 20, part: { providerID: 'ollama', modelID: 'qwen3:4b' } }),
    JSON.stringify({ type: 'error', timestamp: 30, error: { message: 'nope' } }),
    'not json',
  ]);
  assert.deepEqual(r.usage, { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 });
  assert.deepEqual([r.num_turns, r.total_cost_usd, r.duration_ms, r.model, r.is_error, r.errors[0]], [1, 0.5, 20, 'ollama/qwen3:4b', true, 'nope']);
});
