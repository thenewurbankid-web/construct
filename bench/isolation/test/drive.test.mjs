// drive.mjs / drive-mcp.mjs (#941). No model: lists the MCP tools, calls task_show over a linked in-memory transport
// (packages/mcp/test-utils/harness.mjs's pattern) and the stdio server, and unit-tests the summary join.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createDriveMcpServer } from '../drive-mcp.mjs';
import { summarize, sessionRecord, normalizeOpencode } from '../drive.mjs';

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
