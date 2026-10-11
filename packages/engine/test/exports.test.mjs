// LINE-MODULE: @line/construct-engine's public entries. Every "exports" subpath loads by the package name and offers
// what its contract (contract.d.ts, generated from "exports") names; other packages may use only these.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contractSource } from '../../tools/line-module/contracts.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const keys = Object.keys(pkg.exports).filter((k) => k !== './package.json');

test('contract.d.ts is the one generated from "exports"', () => {
  assert.equal(fs.readFileSync(new URL('../contract.d.ts', import.meta.url), 'utf8'), contractSource(pkg));
});

for (const key of keys) {
  test(`${pkg.name}${key.slice(1)} loads by name and exports something`, async () => {
    const mod = await import(`${pkg.name}${key.slice(1)}`);
    assert.ok(Object.keys(mod).length > 0, `${key} exports nothing`);
  });
}
