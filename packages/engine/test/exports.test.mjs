// LINE-MODULE: @line/construct-engine's public entries. Every "exports" subpath loads by the package name and offers
// what its contract (contract.d.ts, generated from "exports") names; other packages may use only these.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const keys = Object.keys(pkg.exports).filter((k) => k !== './package.json');

// (That contract.d.ts is current with "exports" is checked by test/line-module-contracts.test.mjs: the generator
// lives in packages/tools, which the open engine package must not import, not even from a test.)
test('contract.d.ts names every public entry', () => {
  const contract = fs.readFileSync(new URL('../contract.d.ts', import.meta.url), 'utf8');
  for (const key of keys) assert.ok(contract.includes(`\`${pkg.name}${key.slice(1)}\``), `contract.d.ts lacks ${key}`);
});

for (const key of keys) {
  test(`${pkg.name}${key.slice(1)} loads by name and exports something`, async () => {
    const mod = await import(`${pkg.name}${key.slice(1)}`);
    assert.ok(Object.keys(mod).length > 0, `${key} exports nothing`);
  });
}
