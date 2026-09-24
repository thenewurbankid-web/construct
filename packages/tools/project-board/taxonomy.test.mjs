import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXONOMY, MODULES, SUB_MODULES, AREAS, OTHER, areaOf, checkArea } from './taxonomy.mjs';

test('every module has Other as its catch-all sub-module and no duplicates', () => {
  for (const m of MODULES) {
    assert.ok(TAXONOMY[m].includes(OTHER), `${m} has no Other`);
    assert.equal(new Set(TAXONOMY[m]).size, TAXONOMY[m].length, `${m} has duplicate sub-modules`);
  }
});

test('Front-end Blocks and Design modules exist with their sub-modules', () => {
  assert.deepEqual(TAXONOMY['Front-end Blocks'], ['Chooser engine', 'Screen shapes', 'Data & services', 'States & proof', 'Chain UI', OTHER]);
  assert.deepEqual(TAXONOMY.Design, ['Design system', 'Cockpit shell', 'Screens', 'Accessibility & review', OTHER]);
});

test('Areas are unique and derived from Module + Sub-module; Sub-module names are shared, not duplicated', () => {
  assert.equal(new Set(AREAS).size, AREAS.length);
  assert.ok(AREAS.includes(areaOf('Front-end Blocks', 'Chain UI')));
  assert.ok(AREAS.includes(areaOf('Design', 'Design system')) && AREAS.includes(areaOf('Web UI', 'Design system')));
  assert.equal(new Set(SUB_MODULES).size, SUB_MODULES.length);
});

test('checkArea accepts the new modules and rejects cross-module sub-modules', () => {
  assert.equal(checkArea({ module: 'Front-end Blocks', subModule: 'Chooser engine', area: 'Front-end Blocks › Chooser engine' }), null);
  assert.match(checkArea({ module: 'Design', subModule: 'Chooser engine', area: null }), /does not belong/);
});
