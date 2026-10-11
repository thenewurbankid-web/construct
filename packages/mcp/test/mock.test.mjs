// LINE-MODULE: @line/construct-mcp's mock (mock.mjs) exports the real entry's names with the same kinds of value, and
// its server answers in the MCP tool-result shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as real from '../src/index.mjs';
import * as mock from '../mock.mjs';

test('the mock exports exactly the real entry names, each of the same kind', () => {
  assert.deepEqual(Object.keys(mock).sort(), Object.keys(real).sort());
  for (const name of Object.keys(real)) assert.equal(typeof mock[name], typeof real[name], name);
});

test('the shared limits and error codes are the real ones', () => {
  assert.equal(mock.LIMITS, real.LIMITS);
  assert.equal(mock.ERROR_CODES, real.ERROR_CODES);
});

test('the mock server answers a known tool with text plus structured content, an unknown one with isError', async () => {
  const server = mock.createConstructMcpServer({ answers: { summarize: { features: [] } } });
  await server.connect(null);
  const ok = await server.callTool('summarize', { limit: 1 });
  assert.deepEqual(ok.structuredContent, { features: [] });
  assert.equal(ok.content[0].type, 'text');
  assert.deepEqual(JSON.parse(ok.content[0].text), { features: [] });
  const bad = await server.callTool('nope');
  assert.equal(bad.isError, true);
  assert.equal(JSON.parse(bad.content[0].text).error.code, real.ERROR_CODES.INVALID_INPUT);
  assert.deepEqual(server.calls.map((c) => c.name), ['summarize', 'nope']);
  await server.close();
});
