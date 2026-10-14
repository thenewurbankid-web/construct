// #950 -- one live Line LSP index per MCP session: started once, in the background, off by flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLiveIndex, liveIndexNow, stopLiveIndex, liveIndexOn } from '../src/liveIndex.mjs';

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
