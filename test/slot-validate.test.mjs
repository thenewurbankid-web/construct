// LIN-174 -- construct validate's two slot rules: SLOT-001 (a generated file's slot region must
// match what the map says it should be -- the "mechanical fix" drift error) and SLOT-002 (a slot
// body may only import types, never a value, naming the edge to declare instead).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFeature, generateLayer } from '../packages/core/generators.mjs';
import { registerUnit, registerMember, setMemberSlot, projectUnitSlots } from '../packages/core/unit-map.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function setupSlottedController(dir) {
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  const { id: unitId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: memberId } = registerMember(dir, 'billing', unitId, 'submitRefund');
  return { unitId, memberId };
}

test('SLOT-001 is clean once a projected file matches what the map says its slot should be', () => {
  const dir = makeTempDir('construct-slot001-clean-');
  const { unitId, memberId } = setupSlottedController(dir);
  setMemberSlot(dir, 'billing', memberId, 'return a + b;');
  projectUnitSlots(dir, 'billing', unitId);
  const hits = validateArchitecture(dir).violations.filter((v) => v.rule === 'SLOT-001');
  assert.deepEqual(hits, []);
});

test('SLOT-001 fires when a generated file is hand-edited after generation, drifting from the map', () => {
  const dir = makeTempDir('construct-slot001-drift-');
  const { unitId, memberId } = setupSlottedController(dir);
  setMemberSlot(dir, 'billing', memberId, 'return a + b;');
  const { file } = projectUnitSlots(dir, 'billing', unitId);
  // A developer hand-edits the generated file directly, inside the slot's own marked region,
  // without going through setMemberSlot -- the map and the file now disagree.
  const handEdited = fs.readFileSync(file, 'utf8').replace('return a + b;', 'return a + b + 1; // hand edit');
  fs.writeFileSync(file, handEdited);
  const hits = validateArchitecture(dir).violations.filter((v) => v.rule === 'SLOT-001');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'error');
  assert.match(hits[0].message, new RegExp(memberId));
  assert.match(hits[0].suggestedFix, /setMemberSlot/);
});

test('SLOT-002 is clean for a slot body that only imports types', () => {
  const dir = makeTempDir('construct-slot002-clean-');
  const { unitId, memberId } = setupSlottedController(dir);
  setMemberSlot(dir, 'billing', memberId, "import type { Refund } from '../domain/Refund';\nreturn refund.total;");
  projectUnitSlots(dir, 'billing', unitId);
  const hits = validateArchitecture(dir).violations.filter((v) => v.rule === 'SLOT-002');
  assert.deepEqual(hits, []);
});

test('SLOT-002 fires on a value import in a slot body, naming the edge to declare instead', () => {
  const dir = makeTempDir('construct-slot002-value-import-');
  const { unitId, memberId } = setupSlottedController(dir);
  setMemberSlot(dir, 'billing', memberId, "import { chargeCard } from '../services/PaymentService';\nreturn chargeCard(a, b);");
  projectUnitSlots(dir, 'billing', unitId);
  const hits = validateArchitecture(dir).violations.filter((v) => v.rule === 'SLOT-002');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'error');
  assert.match(hits[0].message, /chargeCard/);
  assert.match(hits[0].message, /PaymentService/);
  assert.match(hits[0].suggestedFix, /addDependency/);
  assert.match(hits[0].expected[0], /dependsOn/);
});
