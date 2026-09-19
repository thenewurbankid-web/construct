// #173 acceptance: the current pagesEditor must reproduce, byte for byte, what the original Babel
// implementation produced for every JSX analysis/edit operation over the golden corpus.
// (Only parser-specific error *detail* text is normalized -- see normalizeGolden.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as mod from './pagesEditor.mjs';
import { runGoldenCases, normalizeGolden } from './pagesEditor.golden.cases.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./pagesEditor.golden.json', import.meta.url), 'utf8'));
const actual = runGoldenCases(mod);
const want = normalizeGolden(golden);
const got = normalizeGolden(actual);

for (const group of ['sources', 'snippets', 'scope', 'fs']) {
  for (const name of Object.keys(want[group])) {
    test(`golden ${group}/${name} matches the original implementation`, () => {
      assert.deepEqual(got[group][name], want[group][name]);
    });
  }
}

test('golden corpus covers the same cases (no case silently dropped)', () => {
  assert.deepEqual(Object.keys(got.sources), Object.keys(want.sources));
  assert.deepEqual(Object.keys(got.snippets), Object.keys(want.snippets));
  assert.deepEqual(Object.keys(got.fs), Object.keys(want.fs));
});
