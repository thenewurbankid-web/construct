import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapsOf, compare, measure } from '../packages/tools/api-coverage/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('api coverage: a documented export has no gaps', () => {
  const src = `/**\n * Add two numbers.\n * @param {number} a First.\n * @param {number} b Second.\n * @returns {number} The sum.\n */\nexport function add(a, b) { return a + b; }\n`;
  assert.equal(gapsOf(src).length, 0);
});

test('api coverage: names what is missing, per export', () => {
  const src = [
    'export function bare(a) { return a; }',
    '/** Described only. */\nexport const arrow = (a) => a * 2;',
    '/** A class. */\nexport class Documented {}',
    'export class Undocumented {}',
    '/** No params, no return. */\nexport function effect() { console.log(1); }',
    'function local(a) { return a; }\nexport { local };',
    'export const notAFunction = 1;',
  ].join('\n');
  const gaps = Object.fromEntries(gapsOf(src).map((g) => [g.name, g.missing]));
  assert.deepEqual(gaps, {
    bare: ['description', '@param', '@returns'],
    arrow: ['@param', '@returns'],
    Undocumented: ['description'],
    local: ['description', '@param', '@returns'],
  });
});

test('api coverage: compare flags a rise per file and never a fall', () => {
  const { regressions, improvements } = compare({ 'a.mjs': 3, 'b.mjs': 1, 'new.mjs': 1 }, { 'a.mjs': 2, 'b.mjs': 4, 'gone.mjs': 2 });
  assert.deepEqual(regressions.map((r) => r.file).sort(), ['a.mjs', 'new.mjs']);
  assert.deepEqual(improvements.map((r) => r.file).sort(), ['b.mjs', 'gone.mjs']);
});

test('api coverage ratchet: the repository has no more undocumented exports than the committed baseline', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/tools/api-coverage/baseline.json'), 'utf8')).files;
  const { files } = measure(ROOT);
  const current = Object.fromEntries(Object.entries(files).map(([f, g]) => [f, g.length]));
  const { regressions } = compare(current, baseline);
  assert.deepEqual(regressions, [], 'document the new exports (description, @param, @returns); the baseline only decreases');
});
