import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIntent, SAMPLE_NOTE } from '../briefGuard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES = ['listPicks', 'addPick', 'removePick'];

test('checkIntent (arm I brief tool): empty or valid intent passes, code or another function is sent back with a sample', () => {
  assert.deepEqual(checkIntent(undefined, { fn: 'addPick', others: NAMES }), { ok: true, note: null });
  assert.deepEqual(checkIntent('Add the id only when it is not stored yet.', { fn: 'addPick', others: NAMES }), { ok: true, note: 'Add the id only when it is not stored yet.' });
  const code = checkIntent('```ts\nexport function addPick(id: string): void {\n  const a = 1;\n  const b = 2;\n  save(a, b, id);\n}\n```', { fn: 'addPick', others: NAMES });
  assert.equal(code.ok, false);
  assert.match(code.text, /^Brief not built: the brief contains an implementation \(addPick has a 3-statement body\)/);
  assert.ok(code.text.includes(`Example of a valid note: '${SAMPLE_NOTE}'`));
  const other = checkIntent('Reuse listPicks.', { fn: 'addPick', others: NAMES });
  assert.match(other.text, /one function per note: write the note for addPick only \(it names listPicks\)/);
});

test('run.mjs arm I\'s brief tool runs checkIntent before building the brief', () => {
  const src = readFileSync(join(HERE, '..', '..', 'run.mjs'), 'utf8');
  const tool = src.slice(src.indexOf('async brief({ intent } = {})'), src.indexOf('async code({ n } = {})'));
  assert.match(tool, /checkIntent\(intent,/);
  assert.match(tool, /if \(!guard\.ok\) return \{ ok: false, text: guard\.text \}/);
  assert.doesNotMatch(tool, /String\(intent\)/);
});
