// LINE-MODULE on Construct's own packages: each generated contract.d.ts matches its package.json "exports" (so a new
// public entry cannot land without its contract), and every "exports" target is a real file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractStatus, contractSource } from '../packages/tools/line-module/contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every generated contract.d.ts is current (run node packages/tools/line-module/contracts.mjs when not)', () => {
  const status = contractStatus(ROOT);
  assert.ok(status.length >= 4, 'ast, core, engine and mcp have "exports" and a generated contract');
  for (const s of status) assert.equal(s.actual, s.expected, `${s.dir}/contract.d.ts is stale`);
});

test('every "exports" target of a workspace package exists', () => {
  for (const d of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const pj = path.join(ROOT, 'packages', d, 'package.json');
    if (!fs.existsSync(pj)) continue;
    const exp = JSON.parse(fs.readFileSync(pj, 'utf8')).exports ?? {};
    for (const [key, v] of Object.entries(exp)) {
      const t = typeof v === 'string' ? v : v.default;
      assert.ok(fs.existsSync(path.join(ROOT, 'packages', d, t)), `packages/${d} "${key}" -> ${t} is missing`);
    }
  }
});

test('contractSource: "." is re-exported flat, subpaths as namespaces, data and package.json skipped', () => {
  const src = contractSource({ name: '@x/y', exports: { '.': './index.mjs', './a-b': './aB.mjs', './data': './d.json', './package.json': './package.json', './t': { types: './t/index.ts', default: './t/index.ts' } } });
  assert.match(src, /^export \* from '\.\/index\.mjs';$/m);
  assert.match(src, /^export \* as aB from '\.\/aB\.mjs';$/m);
  assert.match(src, /^export \* as t from '\.\/t\/index';$/m);
  assert.doesNotMatch(src, /d\.json|package\.json'/);
  assert.equal(contractSource({ name: '@x/cli' }), null);
});
