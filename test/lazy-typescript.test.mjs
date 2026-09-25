// #657: modules that only reach the AST package (placement, plan, decide) must not load the TypeScript compiler at import;
// the compiler (about 72 MB, 450 ms) loads on the first call that needs it, and then works as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compilerLoaded = `import { createRequire } from 'node:module';
const r = createRequire(import.meta.url);
const loaded = () => Object.keys(r.cache).some((k) => /node_modules[\\\\/]typescript[\\\\/]/.test(k));`;

function child(body) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', `${compilerLoaded}\n${body}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}
const url = (rel) => JSON.stringify(pathToFileURL(path.join(ROOT, rel)).href);

for (const mod of ['packages/core/placement.mjs', 'packages/core/plan.mjs', 'packages/core/decision-project.mjs', 'packages/core/cli.mjs']) {
  test(`importing ${mod} does not load the TypeScript compiler`, () => {
    assert.equal(child(`await import(${url(mod)}); console.log(JSON.stringify(loaded()));`), false);
  });
}

test('the compiler loads on first use and the lazy view behaves like the module', () => {
  const out = child(`
    const { ts, printNode, parseTsSource } = await import(${url('packages/ast/index.mjs')});
    const before = loaded();
    const src = printNode(ts.factory.createIdentifier('hello'));
    console.log(JSON.stringify({ before, after: loaded(), src, kind: typeof ts.SyntaxKind.Identifier, has: 'factory' in ts, parsed: typeof parseTsSource }));`);
  assert.deepEqual(out, { before: false, after: true, src: 'hello', kind: 'number', has: true, parsed: 'function' });
});
