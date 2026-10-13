// #937 -- construct-mcp exposes Line's registry reads from the registry itself: every kind:'read' entry with a handler
// (toolRegistry.mjs readHandlers) is a tool named mcpNameOf(entry), with the entry's sentence and fields; Cockpit-only reads are skipped
// with a reason. Run for real on a copy of examples/line-sample through the SDK's in-process client.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { mcpNameOf, registryReads, READ_SKIPPED, createReadDispatcher } from '@line/construct-engine/line/tool-registry';
import { registryReadTools, TOOLS, PLAN_TOOLS, IMPORT_AGENT_TOOLS, TRAIN_MCP_TOOLS } from '../src/server.mjs';
import { REPO, connectInProcess, callTool } from '../test-utils/harness.mjs';

process.env.CONSTRUCT_STATE_DIR = makeTempDir('construct-mcp-reads-state-');
let root;
let session;
before(async () => {
  root = fs.realpathSync(makeTempDir('construct-mcp-reads-'));
  fs.cpSync(path.join(REPO, 'examples', 'line-sample'), root, { recursive: true });
  session = await connectInProcess({ root }, 'claude-code');
});
after(async () => { await session.close(); });

const HAND = new Set([...TOOLS, ...PLAN_TOOLS, ...IMPORT_AGENT_TOOLS, ...TRAIN_MCP_TOOLS].map((t) => t.name));

test('every registry read with a handler is an MCP tool under its registry name; every other read is skipped with a reason or is a hand-written tool', async () => {
  const { tools } = await session.client.listTools();
  const names = new Set(tools.map((t) => t.name));
  const d = await createReadDispatcher(root);
  for (const id of d.ids) assert.ok(names.has(mcpNameOf(d.entry(id))), `${id} is listed as ${mcpNameOf(d.entry(id))}`);
  for (const e of registryReads()) {
    const listed = names.has(mcpNameOf(e)) || (e.surfaces.mcp && HAND.has(e.surfaces.mcp));
    assert.ok(listed || typeof READ_SKIPPED[e.id] === 'string', `${e.id} is exposed or skipped with a reason`);
  }
  assert.deepEqual(registryReadTools().map((t) => t.name).filter((n) => HAND.has(n)), [], 'a registry read never shadows a hand-written tool');
  for (const name of ['feature_summary', 'scope', 'atoms', 'line_pageTree', 'line_trace']) assert.ok(names.has(name), name);
  for (const id of Object.keys(READ_SKIPPED)) assert.ok(!names.has(id.replace(/\./g, '_')), `${id} is skipped`);
  const scope = tools.find((t) => t.name === 'scope');
  assert.deepEqual(scope.inputSchema.required, ['file']);
  assert.equal(scope.annotations.readOnlyHint, true);
  assert.match(scope.description, /^Lists what one file may import/);
});

test('feature_summary, scope and atoms answer in English through MCP; a file outside the project is refused', async () => {
  const f = await callTool(session.client, 'feature_summary', { name: 'orders' });
  assert.equal(f.isError, false);
  assert.match(f.body.sentence, /^orders has 1 page, 2 components and 1 workflow\./);
  const s = await callTool(session.client, 'scope', { file: 'features/orders/pages/OrdersPage.tsx' });
  assert.equal(s.isError, false);
  assert.match(s.body.sentence, /may import \d+ files/);
  const a = await callTool(session.client, 'atoms', { request: 'paginate the list' });
  assert.match(a.body.sentence, /line\.useAtom/);
  const out = await callTool(session.client, 'scope', { file: '../../etc/passwd' });
  assert.equal(out.isError, true);
  assert.equal(out.body.error.code, 'PATH_OUTSIDE_ROOT');
  const missing = await callTool(session.client, 'feature_summary', { name: 'nope' });
  assert.equal(missing.body.error.code, 'UNKNOWN_ITEM');
});
