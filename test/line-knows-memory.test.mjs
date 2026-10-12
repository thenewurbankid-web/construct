// "What Line knows", Memory tab (packages/engine/line/knows/memory.mjs): the page's memory service on im3's real store
// (<state>/memory/<step>.jsonl through writeLineState). Every change is logged in <state>/memory.log.jsonl; the
// embeddings switch is per project (<state>/memory.settings.json), off by default, LINE_MEMORY_EMBED overrides it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createMemory, embeddingsEnabled } from '../packages/engine/line/memory/index.mjs';
import { createMemoryService, MEMORY_LOG_FILE, MEMORY_SETTINGS_FILE } from '../packages/engine/line/knows/memory.mjs';
import { assertMemoryRecordsView, assertMemoryExport } from '../packages/engine/line/knows/contract.mjs';

const proposal = (intent = 'use.item') => ({ intent, structure: null, slots: ['F:feature'], neighbourhood: [], options: ['via-library:ui:I>F', 'base-on:ui:L>F'], proposed: 'via-library:ui:I>F' });
const pick = (chosen) => ({ kind: /** @type {const} */ ('picked'), chosen, by: /** @type {const} */ ('person') });

async function seeded() {
  const root = makeTempDir('line-knows-memory-');
  const memory = createMemory(root, { words: [] });
  for (let i = 0; i < 3; i++) await memory.recordOutcome('drafter.route', proposal(), pick('via-library:ui:I>F'));
  await memory.recordOutcome('plan.fix', { ...proposal('fix.problem'), options: ['LINE-DIR:promote', 'LINE-DIR:remove'], proposed: 'LINE-DIR:promote' }, { kind: 'fix-picked', chosen: 'LINE-DIR:remove', by: 'person' });
  const svc = createMemoryService(root, { memory, env: {} });
  return { root, memory, svc };
}
const readLog = (root) => fs.readFileSync(path.join(root, 'line', MEMORY_LOG_FILE), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('records: every step, or one; the view passes the contract; embeddings off by default; nothing logged by a read', async () => {
  const { root, svc } = await seeded();
  const all = svc.records();
  assertMemoryRecordsView(all);
  assert.equal(all.step, null);
  assert.equal(all.records.length, 4);
  assert.deepEqual(all.embeddings, { on: false, covers: 'slotted-text' });
  assert.deepEqual(all.log, []);
  assert.match(all.sentence, /4 decisions/);
  const one = svc.records({ step: 'plan.fix' });
  assert.equal(one.records.length, 1);
  assert.equal(one.step, 'plan.fix');
  assert.equal(svc.records({ step: '../etc' }).code, 'BAD_ARGS');
  assert.equal(fs.existsSync(path.join(root, 'line', MEMORY_LOG_FILE)), false);
});

test('edit: a person corrects one record to another offered option; the store keeps it and the log says so', async () => {
  const { root, memory, svc } = await seeded();
  const id = memory.records('drafter.route')[0].id;
  const v = svc.edit({ id, chosen: 'base-on:ui:L>F' });
  assertMemoryRecordsView(v);
  const r = memory.records('drafter.route').find((x) => x.id === id);
  assert.equal(r?.chosen, 'base-on:ui:L>F');
  assert.equal(r?.kind, 'edited');
  assert.equal(r?.agreed, false);
  assert.equal(memory.records('drafter.route').length, 3, 'edit keeps the other records');
  assert.deepEqual(v.log.map((e) => [e.by, e.action, e.target]), [['person', 'edit', id]]);
  assert.equal(readLog(root).length, 1);
  assert.equal(svc.edit({ id, chosen: 'made-up-route' }).code, 'BAD_ARGS', 'only an offered option');
  assert.equal(svc.edit({ id: 'm-nothere000', chosen: 'base-on:ui:L>F' }).code, 'UNKNOWN_RECORD');
  assert.equal(readLog(root).length, 1, 'a refused edit is not logged as a change');
});

test('forget one record, one step, then all: gone from the store, each logged', async () => {
  const { root, memory, svc } = await seeded();
  const id = memory.records('drafter.route')[1].id;
  const v1 = svc.forgetRecord({ id });
  assert.equal(memory.records('drafter.route').length, 2);
  assert.ok(!memory.records('drafter.route').some((r) => r.id === id));
  assert.equal(v1.records.length, 3);
  assert.equal(svc.forgetRecord({ id }).code, 'UNKNOWN_RECORD');
  const v2 = svc.forgetStep({ step: 'plan.fix' });
  assert.equal(memory.records('plan.fix').length, 0);
  assert.equal(v2.records.length, 2);
  const v3 = svc.forgetAll();
  assert.equal(v3.records.length, 0);
  assert.deepEqual(memory.sizes(), {});
  assert.deepEqual(readLog(root).map((e) => [e.action, e.target]), [['forget', id], ['forgetStep', 'plan.fix'], ['forgetAll', 'all']]);
  assert.match(v3.sentence, /nothing|no memory/i);
});

test('export and import round trip into another project; import is logged and skips records already there', async () => {
  const { svc } = await seeded();
  const file = svc.exportMemory();
  assertMemoryExport(file);
  assert.equal(Object.values(file.steps).flat().length, 4);
  const other = makeTempDir('line-knows-memory-b-');
  const svc2 = createMemoryService(other, { memory: createMemory(other, { words: [] }), env: {} });
  const v = await svc2.importMemory(JSON.parse(JSON.stringify(file)));
  assertMemoryRecordsView(v);
  assert.equal(v.records.length, 4);
  assert.match(v.sentence, /4/);
  const again = await svc2.importMemory(file);
  assert.equal(again.records.length, 4);
  assert.deepEqual(readLog(other).map((e) => [e.action, e.target]), [['import', '4 records'], ['import', '0 records']]);
  const bad = await svc2.importMemory({ v: 1, kind: 'not-memory', steps: {} });
  assert.equal(bad.code, 'BAD_EXPORT');
});

test('embeddings: a per-project switch in Line state, off by default; the env var overrides it; slotted text only', async () => {
  const { root, svc } = await seeded();
  const on = svc.setEmbeddings({ on: true });
  assert.equal(on.embeddings.on, true);
  assert.equal(on.embeddings.covers, 'slotted-text');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'line', MEMORY_SETTINGS_FILE), 'utf8')), { v: 1, embeddings: true });
  assert.equal(svc.embeddingsOn(), true);
  assert.equal(svc.setEmbeddings({ on: 'yes' }).code, 'BAD_ARGS');
  const off = svc.setEmbeddings({ on: false });
  assert.equal(off.embeddings.on, false);
  assert.deepEqual(readLog(root).map((e) => [e.action, e.target]), [['embeddings', 'on'], ['embeddings', 'off']]);
  // LINE_MEMORY_EMBED overrides the stored switch either way.
  const forced = createMemoryService(root, { env: { LINE_MEMORY_EMBED: '1' } });
  assert.equal(forced.embeddingsOn(), true);
  svc.setEmbeddings({ on: true });
  assert.equal(createMemoryService(root, { env: { LINE_MEMORY_EMBED: 'off' } }).embeddingsOn(), false);
  assert.equal(embeddingsEnabled({}, true), true);
  assert.equal(embeddingsEnabled({ LINE_MEMORY_EMBED: '0' }, true), false);
  assert.equal(embeddingsEnabled({}), false);
});

test('every write goes through Construct\'s writer: the log and settings live under the Line state folder only', () => {
  const src = fs.readFileSync(new URL('../packages/engine/line/knows/memory.mjs', import.meta.url), 'utf8');
  assert.ok(!/fs\.(writeFileSync|appendFileSync|rmSync|unlinkSync)/.test(src), 'no direct file write');
  assert.match(src, /writeLineState/);
  assert.ok(!/\bfetch\(|node:https?|node:net/.test(src), 'memory never leaves the machine');
});
