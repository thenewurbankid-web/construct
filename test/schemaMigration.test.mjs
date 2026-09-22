// #419 — forward-compatibility policy: additive data lives in `ext`, unknown
// top-level fields stay rejected, and every stored schema version has a
// fixture that migrates, validates and round-trips through the real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { validatePlan, migratePlan, PLAN_ERROR_CODES } from '../packages/core/plan.mjs';
import { validateProcess, migrateProcess, PROCESS_ERROR_CODES } from '../packages/engine/processModel.mjs';
import { validateEnvelope, createEnvelope } from '../packages/engine/envelope.mjs';
import { openProcessStore } from '../packages/engine/processStore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', n), 'utf8'));
const fixtures = (kind) => {
  const dir = path.join(ROOT, 'test', 'fixtures', kind);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);
};
const fixture = (kind, name) => fixtures(kind).find(([f]) => f === name)[1];
const codes = (r) => r.errors.map((e) => e.code);

for (const [f, rec] of fixtures('plan')) {
  test(`plan fixture ${f} migrates, validates (code and schema) and survives a round trip`, () => {
    const migrated = migratePlan(structuredClone(rec));
    assert.deepEqual(migrated, rec);
    assert.equal(validatePlan(migrated).valid, true, JSON.stringify(validatePlan(migrated).errors));
    const ajv = new Ajv({ allErrors: true });
    assert.equal(ajv.validate(schema('plan.v1.json'), migrated), true, ajv.errorsText());
    assert.deepEqual(JSON.parse(JSON.stringify(migrated)), rec);
  });
}

for (const [f, rec] of fixtures('process')) {
  test(`process fixture ${f} migrates, validates and round-trips through the store`, () => {
    const migrated = migrateProcess(structuredClone(rec));
    assert.deepEqual(migrated, rec);
    assert.equal(validateProcess(migrated).valid, true, JSON.stringify(validateProcess(migrated).errors));
    const ajv = new Ajv({ allErrors: true });
    assert.equal(ajv.validate(schema('process.v1.json'), migrated), true, ajv.errorsText());

    const store = openProcessStore(makeTempDir('construct-mig-project-'), { stateDir: makeTempDir('construct-mig-state-') });
    store.save(migrated);
    const loaded = store.load(migrated.id);
    assert.deepEqual(loaded.ext, rec.ext);
    assert.deepEqual(loaded.plan.ext, rec.plan.ext);
    assert.equal(store.all().problems.length, 0);
  });
}

test('ext is accepted and ignored on plan, process and envelope; any object goes', () => {
  const plan = fixture('plan', 'v1.json');
  const proc = fixture('process', 'v1.json');
  const ext = { anything: [1, { deep: true }], n: null };
  assert.equal(validatePlan({ ...plan, ext }).valid, true);
  assert.equal(validateProcess({ ...proc, ext }).valid, true);
  assert.equal(validateEnvelope({ ...createEnvelope('billing'), ext }).valid, true);
  const ajv = new Ajv({ allErrors: true });
  assert.equal(ajv.validate(schema('envelope.v1.json'), { ...createEnvelope('billing'), ext }), true, ajv.errorsText());
});

test('a stray top-level field (not ext) is still rejected with the existing code', () => {
  const plan = fixture('plan', 'v1.json');
  const proc = fixture('process', 'v1.json');
  assert.ok(codes(validatePlan({ ...plan, extension: {} })).includes(PLAN_ERROR_CODES.PLAN_UNKNOWN_FIELD));
  assert.ok(codes(validateProcess({ ...proc, extension: {} })).includes(PROCESS_ERROR_CODES.PROCESS_UNKNOWN_FIELD));
  assert.equal(new Ajv().validate(schema('plan.v1.json'), { ...plan, extension: {} }), false);
  assert.equal(new Ajv().validate(schema('process.v1.json'), { ...proc, extension: {} }), false);
});

test('a non-object ext is a type error, not silently accepted', () => {
  const plan = fixture('plan', 'v1.json');
  const proc = fixture('process', 'v1.json');
  assert.ok(codes(validatePlan({ ...plan, ext: 3 })).includes(PLAN_ERROR_CODES.PLAN_FIELD_TYPE));
  assert.ok(codes(validateProcess({ ...proc, ext: [] })).includes(PROCESS_ERROR_CODES.PROCESS_FIELD_TYPE));
  assert.equal(validateEnvelope({ ...createEnvelope('billing'), ext: 'x' }).valid, false);
});
