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
  resolveUnitName,
  loadUnitMap,
  unitMapPath,
  unitFromPath,
  validateUnitMap,
  rootUnitMapIndex,
  generateLayerWithUnit,
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
    ['adapter', 'Invoice'],
    ['viewmodel', 'Invoice'],
    ['page', 'Invoice'],
    ['controller', 'Invoice'],
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
