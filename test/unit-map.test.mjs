import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFeature, generateLayer, layerTargetFile } from '../packages/core/generators.mjs';
import {
  registerUnit,
  registerMember,
  tombstoneUnit,
  tombstoneMember,
  setMemberSlot,
  getMemberSlot,
  resolveUnitName,
  loadUnitMap,
  unitMapPath,
  unitFromPath,
  validateUnitMap,
  rootUnitMapIndex,
  generateLayerWithUnit,
  addDependency,
  removeDependency,
  dependenciesOf,
  dependentsOf,
  composedDependencyShape,
} from '../packages/core/unit-map.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-unit-map-');
}

test('registerUnit assigns a stable opaque id and records name/path/layer as attributes', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'RefundRequest', 'billing');
  const { id, record } = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  assert.match(id, /^u_[0-9a-f]{8}$/);
  assert.equal(record.feature, 'billing');
  assert.equal(record.layer, 'page');
  assert.equal(record.name, 'RefundRequestPage');
  assert.ok(record.path.endsWith(path.join('pages', 'RefundRequestPage.tsx')));
});

test('registerUnit is idempotent for the same feature/layer/unit', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'RefundRequest', 'billing');
  const first = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  const second = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  assert.equal(first.id, second.id);
  const map = loadUnitMap(dir, 'billing');
  assert.equal(Object.keys(map.units).length, 1);
});

test('renaming a unit is a map edit, not a physical rename: name resolves from the map even after edit', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'RefundRequest', 'billing');
  const { id } = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  const map = loadUnitMap(dir, 'billing');
  map.units[id].name = 'RefundIntakePage'; // display-name override, no file touched
  fs.writeFileSync(unitMapPath(dir, 'billing'), `${JSON.stringify(map, null, 2)}\n`);
  assert.equal(resolveUnitName(dir, 'billing', 'page', 'RefundRequest'), 'RefundIntakePage');
});

test('a unit with no map entry falls back to the derived default name', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  assert.equal(resolveUnitName(dir, 'billing', 'controller', 'Invoice'), 'InvoiceController');
});

test('tombstoning a unit id keeps the record but marks it dead -- the id is never reused', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'RefundRequest', 'billing');
  const { id } = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  tombstoneUnit(dir, 'billing', id);
  const map = loadUnitMap(dir, 'billing');
  assert.equal(map.units[id].tombstoned, true);
  // Re-registering the same physical unit after a tombstone mints a fresh id
  // rather than reviving the dead one -- the tombstoned entry stays a
  // permanent record of "this id was deleted".
  const revived = registerUnit(dir, 'billing', 'page', 'RefundRequest');
  assert.notEqual(revived.id, id);
});

test('member ids are scoped to their owning unit and independently tombstonable', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  const { id: unitId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const m1 = registerMember(dir, 'billing', unitId, 'loadBalance');
  const m2 = registerMember(dir, 'billing', unitId, 'loadHistory');
  assert.notEqual(m1.id, m2.id);
  assert.equal(m1.record.unitId, unitId);
  tombstoneMember(dir, 'billing', m1.id);
  const map = loadUnitMap(dir, 'billing');
  assert.equal(map.members[m1.id].tombstoned, true);
  assert.equal(map.members[m2.id].tombstoned, false);
});

test('setMemberSlot stores the business-logic body on the member record; regenerating the file cannot clobber it because the logic never lives there', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  const { id: unitId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: memberId } = registerMember(dir, 'billing', unitId, 'loadBalance');
  assert.equal(getMemberSlot(dir, 'billing', memberId), null);
  const slot = setMemberSlot(dir, 'billing', memberId, 'return a + b;', 'ts');
  assert.equal(slot.body, 'return a + b;');
  assert.equal(getMemberSlot(dir, 'billing', memberId).body, 'return a + b;');
  // Persisted in the feature's map file, not anywhere on disk under the unit's path.
  const map = loadUnitMap(dir, 'billing');
  assert.equal(map.members[memberId].slot.body, 'return a + b;');
});

test('setMemberSlot and getMemberSlot reject an unknown member id', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  assert.throws(() => setMemberSlot(dir, 'billing', 'm_deadbeef', 'x'), /unknown member id/);
  assert.throws(() => getMemberSlot(dir, 'billing', 'm_deadbeef'), /unknown member id/);
});

test('registerMember rejects an unknown unit id', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  assert.throws(() => registerMember(dir, 'billing', 'u_deadbeef', 'loadBalance'), /unknown unit id/);
});

// LIN-154's own instruction: "extend layerFileBaseName/layerTargetFile
// rather than adding a second naming path, and add a test asserting the
// mapping is total and round-trips (path -> {layer, unit} -> path)".
test('unitFromPath round-trips every layer: path -> {layer, unit} -> path', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  const cases = [
    ['domain', 'CalculateTotal'],
    ['service', 'FetchInvoice'],
    ['workflow', 'CheckoutFlow'],
    ['hook', 'Cart'],
    ['component', 'PriceTag'],
    ['expression', 'ShowDiscount'],
    // LIN-163: page -> viewmodel -> controller -> adapter -> api, so a viewmodel needs its
    // controller (and a controller needs its page) already generated first.
    ['adapter', 'Invoice'],
    ['page', 'Invoice'],
    ['controller', 'Invoice'],
    ['viewmodel', 'Invoice'],
  ];
  for (const [layer, name] of cases) {
    generateLayer(dir, layer, name, 'billing');
    const file = layerTargetFile(dir, layer, name, 'billing');
    const { layer: gotLayer, unit } = unitFromPath(dir, file);
    assert.equal(gotLayer, layer, `layer round-trip for ${layer}/${name}`);
    const back = layerTargetFile(dir, gotLayer, unit, 'billing');
    assert.equal(back, file, `path round-trip for ${layer}/${name}`);
  }
});

test('validateUnitMap reports a live unit whose file was deleted from disk', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Invoice', 'billing');
  const { id } = registerUnit(dir, 'billing', 'page', 'Invoice');
  fs.rmSync(layerTargetFile(dir, 'page', 'Invoice', 'billing'));
  const { missingOnDisk } = validateUnitMap(dir, 'billing');
  assert.equal(missingOnDisk.length, 1);
  assert.equal(missingOnDisk[0].id, id);
});

test('validateUnitMap reports a generated file with no map entry', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Invoice', 'billing');
  // Deliberately not registered.
  const { missingFromMap } = validateUnitMap(dir, 'billing');
  assert.equal(missingFromMap.length, 1);
  assert.match(missingFromMap[0].path, /InvoicePage\.tsx$/);
});

test('validateUnitMap is clean once every generated file is registered', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayerWithUnit(dir, 'page', 'Invoice', 'billing');
  const { missingOnDisk, missingFromMap } = validateUnitMap(dir, 'billing');
  assert.deepEqual(missingOnDisk, []);
  assert.deepEqual(missingFromMap, []);
});

test('rootUnitMapIndex aggregates units across features without becoming a second source of truth', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  createFeature(dir, 'shipping');
  generateLayerWithUnit(dir, 'page', 'Invoice', 'billing');
  generateLayerWithUnit(dir, 'page', 'Tracking', 'shipping');
  const index = rootUnitMapIndex(dir);
  const names = Object.values(index.units).map((u) => u.name).sort();
  assert.deepEqual(names, ['InvoicePage', 'TrackingPage']);
});

// LIN-155's cardinality correction: this module must not encode any 1:1
// assumption between a unit and a single downstream dependency -- there is
// no "parent"/"dependsOn" field on a unit or member record at all.
test('unit and member records carry no dependency/edge field (nodes only, per LIN-155)', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  const { id: unitId, record: unitRecord } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { record: memberRecord } = registerMember(dir, 'billing', unitId, 'loadBalance');
  for (const forbidden of ['dependsOn', 'parent', 'composedOf', 'dependencies']) {
    assert.equal(forbidden in unitRecord, false, `unit record must not carry "${forbidden}"`);
    assert.equal(forbidden in memberRecord, false, `member record must not carry "${forbidden}"`);
  }
});

// LIN-155: a controller member composing N services -- the many-to-many
// edge set this whole task exists to add.
test('addDependency records a many-to-many edge: one controller member depends on N services', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  generateLayer(dir, 'service', 'Ledger', 'billing');
  generateLayer(dir, 'service', 'Notification', 'billing');
  const { id: controllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: ledgerId } = registerUnit(dir, 'billing', 'service', 'Ledger');
  const { id: notificationId } = registerUnit(dir, 'billing', 'service', 'Notification');
  const { id: memberId } = registerMember(dir, 'billing', controllerId, 'submitRefund');
  addDependency(dir, 'billing', memberId, paymentId);
  addDependency(dir, 'billing', memberId, ledgerId);
  addDependency(dir, 'billing', memberId, notificationId);
  const deps = dependenciesOf(dir, 'billing', memberId);
  assert.equal(deps.length, 3);
  assert.deepEqual(deps.map((d) => d.to).sort(), [ledgerId, notificationId, paymentId].sort());
  for (const d of deps) assert.equal(d.kind, 'dependsOn');
});

test('addDependency is idempotent on (from, to, kind) and rejects unknown endpoints or kinds', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: controllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: memberId } = registerMember(dir, 'billing', controllerId, 'submitRefund');
  const first = addDependency(dir, 'billing', memberId, paymentId);
  const second = addDependency(dir, 'billing', memberId, paymentId);
  assert.equal(first.id, second.id);
  assert.equal(dependenciesOf(dir, 'billing', memberId).length, 1);
  assert.throws(() => addDependency(dir, 'billing', 'm_deadbeef', paymentId), /unknown "from" id/);
  assert.throws(() => addDependency(dir, 'billing', memberId, 'u_deadbeef'), /unknown "to" unit id/);
  assert.throws(() => addDependency(dir, 'billing', memberId, paymentId, 'callsInto'), /unknown edge kind/);
});

test('dependentsOf answers "who else uses this service" by reverse edge lookup, both directions many-to-many', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'page', 'Invoice', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Invoice', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: refundControllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: invoiceControllerId } = registerUnit(dir, 'billing', 'controller', 'Invoice');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: refundMemberId } = registerMember(dir, 'billing', refundControllerId, 'submitRefund');
  const { id: invoiceMemberId } = registerMember(dir, 'billing', invoiceControllerId, 'loadInvoice');
  addDependency(dir, 'billing', refundMemberId, paymentId);
  addDependency(dir, 'billing', invoiceMemberId, paymentId);
  const dependents = dependentsOf(dir, 'billing', paymentId);
  assert.equal(dependents.length, 2);
  assert.deepEqual(dependents.map((d) => d.from).sort(), [invoiceMemberId, refundMemberId].sort());
});

test('composedDependencyShape keys are derived from each dependency\'s own unit name and stay unchanged when a sibling dependency is added', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  generateLayer(dir, 'service', 'Ledger', 'billing');
  const { id: controllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: ledgerId } = registerUnit(dir, 'billing', 'service', 'Ledger');
  const { id: memberId } = registerMember(dir, 'billing', controllerId, 'submitRefund');
  addDependency(dir, 'billing', memberId, paymentId);
  const before = composedDependencyShape(dir, 'billing', memberId);
  assert.deepEqual(before.map((d) => d.key), ['payment']);
  addDependency(dir, 'billing', memberId, ledgerId);
  const after = composedDependencyShape(dir, 'billing', memberId);
  assert.deepEqual(after.find((d) => d.unitId === paymentId).key, 'payment'); // unchanged by the new sibling
  assert.deepEqual(after.map((d) => d.key).sort(), ['ledger', 'payment']);
});

test('removeDependency deletes the edge and reports the now-orphaned unit only when no dependent remains', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'page', 'Invoice', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Invoice', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: refundControllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: invoiceControllerId } = registerUnit(dir, 'billing', 'controller', 'Invoice');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: refundMemberId } = registerMember(dir, 'billing', refundControllerId, 'submitRefund');
  const { id: invoiceMemberId } = registerMember(dir, 'billing', invoiceControllerId, 'loadInvoice');
  const { id: edge1 } = addDependency(dir, 'billing', refundMemberId, paymentId);
  const { id: edge2 } = addDependency(dir, 'billing', invoiceMemberId, paymentId);
  const first = removeDependency(dir, 'billing', edge1);
  assert.equal(first.orphaned, null); // invoiceController still depends on it
  const second = removeDependency(dir, 'billing', edge2);
  assert.equal(second.orphaned, paymentId); // last dependent removed
  assert.throws(() => removeDependency(dir, 'billing', 'e_deadbeef'), /unknown edge id/);
});

test('tombstoneUnit cascades to its own members and their edges, and reports a dependency left with no remaining dependent', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: controllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: memberId } = registerMember(dir, 'billing', controllerId, 'submitRefund');
  addDependency(dir, 'billing', memberId, paymentId);
  const { orphaned } = tombstoneUnit(dir, 'billing', controllerId);
  assert.deepEqual(orphaned, [paymentId]);
  const map = loadUnitMap(dir, 'billing');
  assert.equal(map.units[controllerId].tombstoned, true);
  assert.equal(map.members[memberId].tombstoned, true);
  assert.equal(map.units[paymentId].tombstoned, false); // the shared service itself is never deleted
  assert.deepEqual(dependenciesOf(dir, 'billing', memberId), []);
});

test('tombstoneUnit does not orphan a service another controller still depends on', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'page', 'Invoice', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Invoice', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: refundControllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: invoiceControllerId } = registerUnit(dir, 'billing', 'controller', 'Invoice');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: refundMemberId } = registerMember(dir, 'billing', refundControllerId, 'submitRefund');
  const { id: invoiceMemberId } = registerMember(dir, 'billing', invoiceControllerId, 'loadInvoice');
  addDependency(dir, 'billing', refundMemberId, paymentId);
  addDependency(dir, 'billing', invoiceMemberId, paymentId);
  const { orphaned } = tombstoneUnit(dir, 'billing', refundControllerId);
  assert.deepEqual(orphaned, []);
  assert.equal(dependentsOf(dir, 'billing', paymentId).length, 1);
});

test('validateUnitMap reports a dangling edge whose endpoint was tombstoned outside tombstoneUnit\'s own cascade', () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  generateLayer(dir, 'page', 'Refund', 'billing');
  generateLayer(dir, 'controller', 'Refund', 'billing');
  generateLayer(dir, 'service', 'Payment', 'billing');
  const { id: controllerId } = registerUnit(dir, 'billing', 'controller', 'Refund');
  const { id: paymentId } = registerUnit(dir, 'billing', 'service', 'Payment');
  const { id: memberId } = registerMember(dir, 'billing', controllerId, 'submitRefund');
  addDependency(dir, 'billing', memberId, paymentId);
  const map = loadUnitMap(dir, 'billing');
  map.units[paymentId].tombstoned = true; // hand-edited, bypassing tombstoneUnit's cascade
  fs.writeFileSync(unitMapPath(dir, 'billing'), `${JSON.stringify(map, null, 2)}\n`);
  const { danglingEdges } = validateUnitMap(dir, 'billing');
  assert.equal(danglingEdges.length, 1);
  assert.equal(danglingEdges[0].to, paymentId);
});
