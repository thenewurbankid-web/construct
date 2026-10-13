// #945 -- the Line LSP tools through the SDK's in-process client: listed read-only with their schemas, each answers on
// a small Line project, a file outside the root is refused, and nothing is written (line_fixes returns edits only).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { LSP_TOOLS } from '../src/server.mjs';
import { connectInProcess, callTool, hashTree } from '../test-utils/harness.mjs';

process.env.CONSTRUCT_STATE_DIR = makeTempDir('construct-mcp-lsp-state-');
const NAMES = ['line_next_steps', 'line_completions', 'line_symbol_info', 'line_smith_check', 'line_fixes'];
const FILES = {
  'architecture.yml': 'version: 1\npreset: line\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['es2020'] }, include: ['**/*.ts'] }),
  'features/book/domains/twice.ts': 'export function twice(n: number): number {\n  return n * 2;\n}\n',
  'features/book/domains/formatAuthor.ts': "export function formatAuthor(author: string): string {\n  throw new Error('TODO(path-stub book.formatAuthor)');\n}\n",
  'features/book/services/useIt.ts': 'export function useIt(n: number): number {\n  return twice(n);\n}\n',
};
let root; let session;
before(async () => {
  root = fs.realpathSync(makeTempDir('construct-mcp-lsp-'));
  for (const [rel, t] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), t); }
  session = await connectInProcess({ root, ratePerMinute: 600 }, 'claude-code');
});
after(async () => { await session.close(); });
const call = (name, args) => callTool(session.client, name, args);

test('the five Line LSP tools are listed, read-only, each with an object schema', async () => {
  assert.deepEqual(LSP_TOOLS.map((t) => t.name), NAMES);
  const { tools } = await session.client.listTools();
  for (const n of NAMES) {
    const t = tools.find((x) => x.name === n);
    assert.ok(t, n);
    assert.equal(t.inputSchema.type, 'object');
    assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint, t.annotations.openWorldHint], [true, false, false], n);
  }
  assert.deepEqual(tools.find((t) => t.name === 'line_smith_check').inputSchema.required, ['file', 'fn', 'plan']);
});

test('each tool answers, and the project is byte-identical afterwards (line_fixes returns edits, applies none)', async () => {
  const before = hashTree(root);
  const next = await call('line_next_steps', { need: 'book/domains/formatAuthor', from: 'book' });
  assert.deepEqual([next.body.ok, next.body.step.step, next.body.schema.properties.option.enum], [true, 'complete_stub', ['complete_stub book/domains/formatAuthor']]);
  const reuse = await call('line_next_steps', { need: 'book/domains/twice', from: 'book' });
  assert.equal(reuse.body.step.step, 'reuse');
  const comp = await call('line_completions', { file: 'features/book/services/useIt.ts', text: 'export function useIt(n: number): number {\n  return /*HOLE*/;\n}\n', at: '/*HOLE*/' });
  assert.equal(comp.body.ok, true);
  assert.ok(comp.body.items.some((i) => i.name === 'n'));
  assert.deepEqual(comp.body.schema.properties.name.enum, comp.body.items.map((i) => i.name));
  const failure = await call('line_completions', { file: 'features/book/services/useIt.ts', line: 2, col: 10, code: 2304 });
  assert.deepEqual([failure.body.kind, failure.body.items[0]], ['import-source', '../domains/twice']);
  const info = await call('line_symbol_info', { file: 'features/book/domains/twice.ts', symbol: 'twice' });
  assert.deepEqual([info.body.type, info.body.locations[0].file], ['function twice(n: number): number', 'features/book/domains/twice.ts']);
  const all = await call('line_symbol_info', { file: 'features/book/domains/twice.ts' });
  assert.deepEqual(all.body.lines, ['features/book/domains/twice.ts:1 function twice(n: number): number']);
  const smith = await call('line_smith_check', { file: 'features/book/domains/twice.ts', fn: 'twice', plan: ['It returns n * 2.'] });
  assert.equal(smith.body.ok, true);
  if (!smith.body.skipped) assert.equal(smith.body.pass, true);
  const fx = await call('line_fixes', { file: 'features/book/services/useIt.ts' });
  assert.deepEqual([fx.body.applies, fx.body.applied.map((a) => a.fix), fx.body.edits[0].newText], [false, ['fixMissingImport'], "import { twice } from '../domains/twice';\n\n"]);
  assert.equal(hashTree(root), before, 'nothing was written');
});

test('a file outside the root, or missing, is refused with a typed error', async () => {
  for (const file of ['../x.ts', '/etc/passwd', '~/x.ts', 'C:\\x.ts']) {
    for (const name of ['line_fixes', 'line_symbol_info', 'line_completions']) {
      const r = await call(name, { file, ...(name === 'line_completions' ? { at: 0 } : {}) });
      assert.equal(r.isError, true, `${name} ${file}`);
      assert.equal(r.body.error.code, 'PATH_OUTSIDE_ROOT', `${name} ${file}`);
    }
  }
  assert.equal((await call('line_fixes', { file: 'features/nope.ts' })).body.error.code, 'NOT_FOUND');
  assert.equal((await call('line_next_steps', { need: '../../etc', from: 'book' })).body.error.code, 'INVALID_INPUT');
});
