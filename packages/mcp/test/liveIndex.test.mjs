// #950 -- one live Line LSP index per MCP session: started once, in the background, off by flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLiveIndex, liveIndexNow, stopLiveIndex, liveIndexOn } from '../src/liveIndex.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { connectInProcess, callTool, hashTree } from '../test-utils/harness.mjs';

const sleep = (t) => new Promise((r) => setTimeout(r, t));
async function until(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await sleep(50); } }
const entries = (root) => { const d = path.join(root, 'line', '.index', 'v1'); try { return fs.readdirSync(d, { recursive: true }).filter((n) => String(n).endsWith('.json')).length; } catch { return 0; } };
const FILES = {
  'architecture.yml': 'version: 1\npreset: line\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['es2020'] }, include: ['**/*.ts'] }),
  'features/book/domains/twice.ts': 'export function twice(n: number): number {\n  return n * 2;\n}\n',
  'features/book/services/useIt.ts': "import { twice } from '../domains/twice';\nexport function useIt(n: number): number {\n  return twice(n);\n}\n",
};
const lineProject = () => {
  const root = fs.realpathSync(makeTempDir('construct-mcp-live-ro-'));
  for (const [rel, t] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); }
  return root;
};

test('read-only (line_*): the session index reads and computes in memory, writes nothing, no indexer, no watcher; plan_* switches it and flushes', async () => {
  const root = lineProject();
  try {
    const before = hashTree(root);
    const ctx = { root };
    const lsp = await startLiveIndex(ctx, 'read');
    assert.ok(lsp);
    assert.equal(lsp.readOnly, true);
    assert.equal(lsp.background, null, 'no background indexer while read-only');
    assert.equal(lsp.watching, false, 'no watcher while read-only');
    assert.ok(lsp.cold.misses > 0, 'misses computed in memory');
    assert.equal(lsp.store.writes, 0);
    assert.equal(hashTree(root), before, 'nothing was written');
    assert.equal(fs.existsSync(path.join(root, 'line')), false);
    const sw = await startLiveIndex(ctx, 'write');
    assert.equal(sw, lsp, 'the same index, switched');
    assert.equal(lsp.readOnly, false);
    assert.equal(entries(root), lsp.cold.misses, 'the in-memory misses were flushed');
    assert.ok(lsp.background, 'the background indexer starts on the switch');
    assert.equal(lsp.watching, true, 'the watcher starts on the switch');
    await Promise.race([until(() => ['done', 'stopped', 'failed'].includes(lsp.background.state)), sleep(10000)]);
    stopLiveIndex(ctx);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('over MCP: line_* calls leave the project byte-identical; the first plan_* call flushes the index to line/.index/', async () => {
  const root = lineProject();
  process.env.CONSTRUCT_STATE_DIR ??= makeTempDir('construct-mcp-live-state-');
  const session = await connectInProcess({ root, ratePerMinute: 600 }, 'claude-code');
  try {
    const before = hashTree(root);
    const info = await callTool(session.client, 'line_symbol_info', { file: 'features/book/domains/twice.ts', symbol: 'twice' });
    assert.equal(info.isError, false, info.text);
    await callTool(session.client, 'line_completions', { file: 'features/book/services/useIt.ts', at: 0 });
    await sleep(1500); // the read-only index builds in the background meanwhile
    assert.equal(hashTree(root), before, 'nothing was written by line_* or the read-only index');
    assert.equal(entries(root), 0);
    const st = await callTool(session.client, 'plan_status', {});
    assert.equal(st.isError, false, st.text);
    assert.ok(await until(() => entries(root) > 0), 'plan_* switched the index to read-write and flushed it');
    await sleep(500); // the background indexer of this small project finishes
  } finally { await session.close(); fs.rmSync(root, { recursive: true, force: true }); }
});


test('live index: one per session, built in the background with the indexer and the watcher on; off by flag', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mcp-live-')));
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler' } }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 1;\n}\n');
    const ctx = { root };
    const p1 = startLiveIndex(ctx);
    assert.equal(startLiveIndex(ctx), p1, 'one index per session');
    assert.equal(liveIndexNow(ctx), null, 'nobody waits for the cold build');
    const lsp = await p1;
    assert.ok(lsp, 'built');
    assert.equal(liveIndexNow(ctx), lsp);
    assert.equal(lsp.scope.mode, 'scoped');
    assert.ok(lsp.background, 'the background indexer runs in an MCP session');
    stopLiveIndex(ctx);
    assert.equal(liveIndexOn({ root, liveIndex: false }), false);
    assert.equal(liveIndexOn({ root }, { LINE_LSP_LIVE: 'off' }), false);
    assert.equal(await startLiveIndex({ root, liveIndex: false }), null);
    // a project without tsconfig.json has no index, and that is not an error
    assert.equal(await startLiveIndex({ root: path.join(root, 'src') }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
