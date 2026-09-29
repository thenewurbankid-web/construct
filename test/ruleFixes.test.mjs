import test from 'node:test';
import assert from 'node:assert/strict';
import { mechanicalFixAvailable, applyMechanicalFix } from '../packages/core/ruleFixes.mjs';

test('#551 mechanicalFixAvailable is true only for the covered banned-import rules', () => {
  assert.equal(mechanicalFixAvailable('PAGE-003'), true);
  assert.equal(mechanicalFixAvailable('COMPONENT-002'), true);
  assert.equal(mechanicalFixAvailable('PAGE-004'), false);
  assert.equal(mechanicalFixAvailable('TS2322'), false);
});

test('#551 applyMechanicalFix removes the banned import and its line', () => {
  const source = "import { fetchThing } from '../services/BillingService';\nexport function BillingPage() {\n  return <p>{String(fetchThing)}</p>;\n}\n";
  const fixed = applyMechanicalFix('PAGE-003', source);
  assert.equal(fixed, 'export function BillingPage() {\n  return <p>{String(fetchThing)}</p>;\n}\n');
});

test('#551 applyMechanicalFix returns null for an unknown rule', () => {
  assert.equal(applyMechanicalFix('PAGE-004', 'export const n = 1;\n'), null);
});

test('#551 applyMechanicalFix returns null when the rule\'s pattern matches nothing', () => {
  assert.equal(applyMechanicalFix('PAGE-003', 'export const n = 1;\n'), null);
});

test('#551 applyMechanicalFix only removes the first matching import, leaving the rest intact', () => {
  const source = "import { a } from '../services/A';\nimport { b } from './b';\nexport const c = a + b;\n";
  const fixed = applyMechanicalFix('PAGE-003', source);
  assert.equal(fixed, "import { b } from './b';\nexport const c = a + b;\n");
});
