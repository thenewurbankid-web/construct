import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slotMarkerLines,
  renderSlotRegion,
  projectSlotIntoSource,
  slotRegionMatches,
  findValueImportsInSlot,
} from '../packages/core/slot-projection.mjs';

test('renderSlotRegion wraps the body in stable begin/end markers keyed by member id', () => {
  const region = renderSlotRegion('m_a1b2c3d4', 'return a + b;');
  const { begin, end } = slotMarkerLines('m_a1b2c3d4');
  assert.equal(region, `${begin}\nreturn a + b;\n${end}`);
});

test('renderSlotRegion falls back to a TODO placeholder when the slot has no body yet', () => {
  const region = renderSlotRegion('m_a1b2c3d4', undefined);
  assert.match(region, /TODO/);
});

test('projectSlotIntoSource appends a marked region when none exists yet', () => {
  const source = 'export function submitRefund() {\n}\n';
  const projected = projectSlotIntoSource(source, 'm_a1b2c3d4', 'return a + b;');
  assert.ok(projected.startsWith(source));
  assert.ok(slotRegionMatches(projected, 'm_a1b2c3d4', 'return a + b;'));
});

test('projectSlotIntoSource replaces an existing marked region wholesale on every call (total regeneration)', () => {
  let source = projectSlotIntoSource('export const x = 1;\n', 'm_a1b2c3d4', 'return a + b;');
  assert.ok(slotRegionMatches(source, 'm_a1b2c3d4', 'return a + b;'));
  source = projectSlotIntoSource(source, 'm_a1b2c3d4', 'return a - b; // updated');
  assert.ok(slotRegionMatches(source, 'm_a1b2c3d4', 'return a - b; // updated'));
  assert.ok(!source.includes('return a + b;'));
  // Only one region for this member, never a second appended alongside the old one.
  const { begin } = slotMarkerLines('m_a1b2c3d4');
  assert.equal(source.split(begin).length - 1, 1);
});

test('projectSlotIntoSource keeps two different members\' regions independent', () => {
  let source = 'export const x = 1;\n';
  source = projectSlotIntoSource(source, 'm_aaaaaaaa', 'return 1;');
  source = projectSlotIntoSource(source, 'm_bbbbbbbb', 'return 2;');
  assert.ok(slotRegionMatches(source, 'm_aaaaaaaa', 'return 1;'));
  assert.ok(slotRegionMatches(source, 'm_bbbbbbbb', 'return 2;'));
  source = projectSlotIntoSource(source, 'm_aaaaaaaa', 'return 99;');
  assert.ok(slotRegionMatches(source, 'm_aaaaaaaa', 'return 99;'));
  assert.ok(slotRegionMatches(source, 'm_bbbbbbbb', 'return 2;')); // untouched
});

test('findValueImportsInSlot allows type-only imports', () => {
  const body = "import type { Refund } from '../domain/Refund';\nreturn refund.total;";
  assert.deepEqual(findValueImportsInSlot(body), []);
});

test('findValueImportsInSlot flags a plain named value import', () => {
  const body = "import { chargeCard } from '../services/PaymentService';\nreturn chargeCard();";
  const hits = findValueImportsInSlot(body);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, '../services/PaymentService');
});

test('findValueImportsInSlot flags a default import and a namespace import', () => {
  const body = [
    "import PaymentService from '../services/PaymentService';",
    "import * as ledger from '../services/Ledger';",
  ].join('\n');
  const hits = findValueImportsInSlot(body);
  assert.equal(hits.length, 2);
});

test('findValueImportsInSlot flags a mixed named import where only some specifiers are type-only', () => {
  const body = "import { type Refund, chargeCard } from '../services/PaymentService';";
  const hits = findValueImportsInSlot(body);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].specifier, 'chargeCard');
});
