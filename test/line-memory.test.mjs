// im3 + j5: Line's memory of past answers per step. Records are slotted (no project word, no code), stored per project
// through Construct's writer, recalled exactly then by slot and structure similarity, and used only to reorder options
// Construct already checked. Privacy ("Memory tests", docs/line-test-plan.md row 21): never sent anywhere, project A
// never read in project B, deleting an entry removes it from recall, export and import round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import {
  assertMemoryRecord, assertMemoryExport, createMemory, memoryOf, recordOutcome, recall, recallFrom, preferenceOf, memoryOver, routeKey, draftContext,
  embeddingsEnabled, createOllamaEmbedder, recallWithEmbeddings, decisionText, MIN_CONSISTENT,
} from '../packages/engine/line/memory/index.mjs';
import { createPlanDrafter } from '../packages/engine/line/drafter/planDraft.mjs';
import { draft } from '../packages/engine/line/drafter/index.mjs';
import { createDecider } from '../packages/core/line-decide.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { assertDecideResult } from '../packages/engine/line/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(HERE, '../examples/line-sample');
const MEMORY_SRC = path.resolve(HERE, '../packages/engine/line/memory');
const copy = () => { const dir = makeTempDir('line-memory-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const REQUEST = 'use OrderButton in billing';
const fakePlan = () => ({ addStep: async () => ({ ok: true, stepId: `s${Math.random().toString(16).slice(2)}`, steps: [] }), view: async () => ({}) });
const CTX = { intent: 'add.component', structure: 'sha256:aaaaaaaaaaaaaaaa', slots: ['F:feature', 'C:component kind=components role=on:atom'], neighbourhood: ['ui=sha256:bbbbbbbbbbbbbbbb'] };
const pick = (chosen, o = {}) => ({ kind: 'picked', chosen, by: 'person', ...o });
const proposal = (o = {}) => ({ ...CTX, options: ['via-library:ui:C>F', 'base-on:ui:L>F'], proposed: 'via-library:ui:C>F', ...o });

test('contract: a record is slotted closed data; bad shapes are refused in one sentence', async () => {
  const dir = copy();
  const mem = createMemory(dir, { words: [] });
  const r = await mem.recordOutcome('drafter.route', proposal(), pick('base-on:ui:L>F'));
  assertMemoryRecord(r);
  assert.equal(r.agreed, false);
  assert.equal(fs.readFileSync(path.join(dir, 'line/memory/drafter.route.jsonl'), 'utf8').trim(), JSON.stringify(r));
  assert.throws(() => assertMemoryRecord({ ...r, kind: 'liked' }), /kind must be one of/);
  assert.throws(() => assertMemoryRecord({ ...r, extra: 1 }), /carry only its own fields/);
  await assert.rejects(mem.recordOutcome('Bad Step!', proposal(), pick('x')), /not a memory step/);
  await assert.rejects(mem.recordOutcome('drafter.route', proposal({ options: ['has space'] }), pick('x')), /closed option key/);
  assertMemoryExport(mem.exportAll());
});

test('leak guard: a project word or code text is never remembered', async () => {
  const dir = copy();
  const mem = createMemory(dir);
  await assert.rejects(mem.recordOutcome('drafter.route', proposal({ slots: ['F:orders'] }), pick('base-on:ui:L>F')), (e) => e.code === 'LEAK' && /"orders"/.test(e.sentence));
  await assert.rejects(mem.recordOutcome('drafter.route', proposal(), pick('OrderButton')), (e) => e.code === 'LEAK');
  await assert.rejects(mem.recordOutcome('drafter.route', proposal({ intent: '() => save()' }), pick('x')), (e) => e.code === 'BAD_RECORD' && /no code/.test(e.sentence));
  await assert.rejects(mem.recordOutcome('drafter.route', proposal({ slots: ['<Button onClick={go} />'] }), pick('x')), (e) => e.code === 'BAD_RECORD');
  assert.deepEqual(mem.sizes(), {});
  // Line's own vocabulary (layers, kinds) is not a leak even when a project uses the word.
  await mem.recordOutcome('drafter.route', proposal({ neighbourhood: ['data=sha256:cccccccccccccccc'] }), pick('base-on:ui:L>F'));
  assert.deepEqual(mem.sizes(), { 'drafter.route': 1 });
});

test('recall: the exact past outcome first (step + intent + structure), then similar ones by slots and structure only', async () => {
  const dir = copy();
  const mem = createMemory(dir, { words: [] });
  await mem.recordOutcome('drafter.route', proposal({ intent: 'promote.component' }), pick('promote:library:I'));
  const exact = await mem.recordOutcome('drafter.route', proposal(), pick('base-on:ui:L>F'));
  await mem.recordOutcome('drafter.route', proposal({ structure: 'sha256:dddddddddddddddd' }), pick('via-library:ui:C>F'));
  await mem.recordOutcome('plan.step', { ...proposal(), options: ['line.baseOn'], proposed: 'line.baseOn' }, { kind: 'approved', chosen: 'line.baseOn', by: 'person' });
  const got = mem.recall('drafter.route', CTX, 5);
  assert.equal(got[0].how, 'exact');
  assert.equal(got[0].record.id, exact.id);
  assert.equal(got[0].record.chosen, 'base-on:ui:L>F');
  assert.ok(got.some((x) => x.how === 'similar' && x.record.chosen === 'via-library:ui:C>F'), 'same intent and slots, other structure: similar');
  assert.ok(got.every((x) => x.record.step === 'drafter.route'), 'another step is never recalled');
  assert.ok(!got.some((x) => x.record.intent === 'promote.component' && x.score > got.find((y) => y.record.chosen === 'via-library:ui:C>F').score));
  // Same answer through the module-level calls.
  assert.equal(recall(dir, 'drafter.route', CTX, 1)[0].record.id, exact.id);
});

test('preference: only 3 consistent person picks reorder; agents never steer; a later refusal breaks the run', () => {
  const rec = (n, chosen, o = {}) => ({ v: 1, id: `m-test${String(n).padStart(4, '0')}`, step: 'drafter.route', at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), ...CTX, options: ['via-library:ui:C>F', 'base-on:ui:L>F'], proposed: 'via-library:ui:C>F', kind: 'picked', chosen, by: 'person', agreed: false, ...o });
  const ids = ['via-library:ui:C>F', 'base-on:ui:L>F'];
  const two = [rec(1, 'base-on:ui:L>F'), rec(2, 'base-on:ui:L>F')];
  assert.equal(memoryOver(two).prefer('drafter.route', CTX, ids), null);
  const three = [...two, rec(3, 'base-on:ui:L>F')];
  const p = memoryOver(three).prefer('drafter.route', CTX, ids, { labelOf: () => 'via the library' });
  assert.equal(p?.option, 'base-on:ui:L>F');
  assert.equal(p?.count, MIN_CONSISTENT);
  assert.match(p?.sentence ?? '', /^Recalled from 3 past decisions: the last 3 times you picked via the library\.$/);
  assert.equal(memoryOver([...three.map((r) => ({ ...r, by: 'agent' }))]).prefer('drafter.route', CTX, ids), null, 'agents never steer');
  assert.equal(memoryOver([...three, rec(4, null, { kind: 'refused', proposed: 'base-on:ui:L>F' })]).prefer('drafter.route', CTX, ids), null);
  assert.equal(memoryOver(three).prefer('drafter.route', CTX, ['via-library:ui:C>F']), null, 'an option not offered now is never added');
  assert.equal(preferenceOf(recallFrom(three, 'drafter.route', CTX, 10), ids)?.option, 'base-on:ui:L>F');
});

test('drafter: after 3 consistent picks of the same drafted route, the 4th draft recommends it first and says why', async () => {
  const dir = copy();
  const d = createPlanDrafter({ root: dir, plan: fakePlan(), enabled: true });
  const first = await d.draft(REQUEST);
  const staticRec = first.recommended;
  const other = first.routes.find((r) => r.status === 'ok' && routeKey(r.id) !== routeKey(staticRec));
  assert.ok(other, 'two checked routes');
  for (let i = 0; i < 3; i++) {
    const v = await d.draft(REQUEST);
    assert.equal(v.recommended, staticRec, `pick ${i + 1}: static order still`);
    assert.equal(v.memory, null);
    await d.addRoute(REQUEST, other.id, 'ui');
  }
  const fourth = await d.draft(REQUEST);
  assert.equal(fourth.recommended, other.id);
  assert.equal(fourth.routes[0].id, other.id);
  assert.match(fourth.memory?.sentence ?? '', /^Recalled from 3 past decisions: the last 3 times you picked /);
  assert.equal(fourth.routes[0].memory, fourth.memory?.sentence);
  const noMemory = await createPlanDrafter({ root: dir, plan: fakePlan(), enabled: true, memory: null }).draft(REQUEST);
  assert.equal(noMemory.recommended, staticRec);
  assert.deepEqual(new Set(fourth.routes.map((r) => r.id)), new Set(noMemory.routes.map((r) => r.id)), 'memory never adds a route');
  const text = fs.readFileSync(path.join(dir, 'line/memory/drafter.route.jsonl'), 'utf8');
  for (const w of ['OrderButton', 'billing', 'orders', 'Button']) assert.ok(!text.includes(w), `no ${w} in memory`);
  // Agent picks are remembered but do not steer.
  const dir2 = copy();
  const d2 = createPlanDrafter({ root: dir2, plan: fakePlan(), enabled: true });
  for (let i = 0; i < 3; i++) { await d2.draft(REQUEST); await d2.addRoute(REQUEST, other.id, 'agent'); }
  assert.equal((await d2.draft(REQUEST)).recommended, staticRec);
});

test('privacy: project A\'s memory is never read in project B', async () => {
  const a = copy(); const b = copy();
  const da = createPlanDrafter({ root: a, plan: fakePlan(), enabled: true });
  const first = await da.draft(REQUEST);
  const other = first.routes.find((r) => r.status === 'ok' && r.id !== first.recommended);
  for (let i = 0; i < 3; i++) { await da.draft(REQUEST); await da.addRoute(REQUEST, other.id, 'ui'); }
  assert.equal((await da.draft(REQUEST)).recommended, other.id);
  const db = createPlanDrafter({ root: b, plan: fakePlan(), enabled: true });
  const inB = await db.draft(REQUEST);
  assert.equal(inB.recommended, first.recommended);
  assert.equal(inB.memory, null);
  assert.equal(fs.existsSync(path.join(b, 'line/memory')), false);
  assert.deepEqual(memoryOf(b).sizes(), {});
  assert.equal(memoryOf(b).recall('drafter.route', draftContext(draft(b, REQUEST, { verify: false })), 5).length, 0);
});

test('privacy: deleting an entry removes it from recall; Forget clears the step and the ranking goes back to static', async () => {
  const dir = copy();
  const mem = createMemory(dir, { words: [] });
  const r1 = await mem.recordOutcome('drafter.route', proposal(), pick('base-on:ui:L>F'));
  const r2 = await mem.recordOutcome('drafter.route', proposal(), pick('base-on:ui:L>F'));
  assert.equal(mem.remove('drafter.route', r1.id), true);
  assert.deepEqual(mem.recall('drafter.route', CTX, 5).map((x) => x.record.id), [r2.id]);
  assert.equal(mem.remove('drafter.route', r1.id), false);
  const d = createPlanDrafter({ root: dir, plan: fakePlan(), enabled: true, memory: mem });
  const first = await d.draft(REQUEST);
  const other = first.routes.find((r) => r.status === 'ok' && r.id !== first.recommended);
  for (let i = 0; i < 3; i++) await d.addRoute(REQUEST, other.id, 'ui');
  assert.equal((await d.draft(REQUEST)).recommended, other.id);
  assert.deepEqual(mem.forget('drafter.route'), { step: 'drafter.route', removed: 4 });
  assert.equal(mem.recall('drafter.route', CTX, 5).length, 0);
  assert.equal((await d.draft(REQUEST)).recommended, first.recommended);
});

test('privacy: export and import round trip; an import is checked against the receiving project\'s words', async () => {
  const a = copy(); const c = copy();
  const ma = createMemory(a, { words: [] });
  await ma.recordOutcome('drafter.route', proposal(), pick('base-on:ui:L>F'));
  await ma.recordOutcome('plan.fix', { ...proposal(), options: ['LINE-BASE:set-base'], proposed: 'LINE-BASE:set-base' }, { kind: 'fix-picked', chosen: 'LINE-BASE:set-base', by: 'person' });
  const bundle = JSON.parse(JSON.stringify(ma.exportAll()));
  const mc = createMemory(c, { words: [] });
  assert.deepEqual(await mc.importAll(bundle), { added: 2, skipped: 0 });
  assert.deepEqual(mc.exportAll(), ma.exportAll());
  assert.deepEqual(await mc.importAll(bundle), { added: 0, skipped: 2 });
  const leaky = { v: 1, kind: 'line-memory', steps: { 'drafter.route': [{ ...bundle.steps['drafter.route'][0], id: 'm-leaky000001', slots: ['F:billing'] }] } };
  await assert.rejects(createMemory(c).importAll(leaky), (e) => e.code === 'LEAK');
  await assert.rejects(mc.importAll({ v: 1, kind: 'other', steps: {} }), (e) => e.code === 'BAD_EXPORT');
});

test('privacy: memory is never sent anywhere; embeddings are off by default, local only, and embed slotted text only', async () => {
  for (const f of ['contract.mjs', 'store.mjs', 'recall.mjs', 'index.mjs']) {
    const src = fs.readFileSync(path.join(MEMORY_SRC, f), 'utf8');
    assert.ok(!/\bfetch\(|node:https?|node:net|node:dgram|XMLHttpRequest|WebSocket/.test(src), `${f} opens no connection`);
  }
  assert.equal(embeddingsEnabled({}), false);
  assert.equal(embeddingsEnabled({ LINE_MEMORY_EMBED: '1' }), true);
  assert.throws(() => createOllamaEmbedder({ url: 'https://api.example.com' }), /localhost/);
  assert.equal(decisionText(CTX), 'add component f feature c component kind components role on atom ui sha256 bbbbbbbbbbbbbbbb');
  const sent = [];
  const embed = async (texts) => { sent.push(...texts); return texts.map((t) => [t.length, 1]); };
  const recs = [{ v: 1, id: 'm-emb0000001', step: 'drafter.route', at: '2026-10-01T00:00:00.000Z', ...CTX, structure: null, options: ['a'], proposed: 'a', kind: 'picked', chosen: 'a', by: 'person', agreed: true }];
  const got = await recallWithEmbeddings(/** @type {any} */ (recs), 'drafter.route', CTX, 1, embed);
  assert.equal(got[0].how, 'embedding');
  assert.ok(sent.every((t) => !/[{};]|=>/.test(t)), 'only slotted decision text is embedded');
  const down = await recallWithEmbeddings(/** @type {any} */ (recs), 'drafter.route', CTX, 1, async () => { throw new Error('down'); });
  assert.equal(down[0].how, 'similar', 'falls back to non-neural recall');
});

test('decide (cu2): recalled outcomes lead the checked options and the record says why; memory never adds an option', async () => {
  const decider = createDecider({ loadReason: async () => ({ module: null, note: 'not linked' }), jev: 'off' });
  const ids = ['via-library', 'new-item'];
  const store = memoryOver([1, 2, 3].map((n) => ({ v: 1, id: `m-dec000000${n}`, step: 'trace.pick-fields', at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), ...CTX, options: ids, proposed: 'via-library', kind: 'picked', chosen: 'new-item', by: 'person', agreed: false })));
  const options = [{ id: 'via-library', label: 'Use the library item' }, { id: 'new-item', label: 'Make a new item' }];
  const without = await decider.decide('trace.pick-fields', options, {});
  assert.equal(without.choice, 'via-library');
  const withMem = await decider.decide('trace.pick-fields', options, { memory: { store, context: CTX } });
  assertDecideResult(withMem, ids);
  assert.equal(withMem.choice, 'new-item');
  assert.equal(withMem.by, 'memory');
  assert.equal(withMem.reasons[0], 'Recalled from 3 past decisions: the last 3 times you picked "Make a new item".');
  assert.equal(withMem.memory?.count, 3);
  const unchecked = await decider.decide('trace.pick-fields', options, { memory: { store, context: CTX }, check: (id) => (id === 'new-item' ? 'Construct refused it.' : null) });
  assert.equal(unchecked.choice, 'via-library', 'a remembered option that fails the checks is never chosen');
  assert.equal(unchecked.by, 'single');
});

test('plan feedback: an approval is remembered per step, slotted', async () => {
  const dir = copy();
  const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
  const svc = createLinePlanService({ root: dir, commands: null, trace: null, load: (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK }) });
  const added = await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } }, 'ui');
  assert.equal(added.ok, true);
  await svc.approve(added.stepId, 'ui');
  await new Promise((r) => setTimeout(r, 50));
  const recs = memoryOf(dir).records('plan.step');
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].kind, recs[0].chosen, recs[0].by], ['approved', 'line.baseOn', 'person']);
  assert.ok(!JSON.stringify(recs).includes('StatusBadge') && !JSON.stringify(recs).includes('orders'));
});

// Measured 12 Oct on all 130 held-out cases (node packages/engine/line/memory/eval.mjs --embed): preferred 100% -> 100%
// with memory, 0 cases changed; recall top-1 100% when the answer is in memory (20 cases), embeddings the same (off).
// Floors only go up.
const FLOORS = { preferredWith: 1, top1WhenAnswerIsInMemory: 1 };
test('eval: on Train Line\'s held-out cases, memory never lowers preferred-route accuracy (floors only go up)', async () => {
  const { memoryEval } = await import('../packages/engine/line/memory/eval.mjs');
  const r = await memoryEval({ limitWorlds: 8 });
  assert.ok(r.cases > 20);
  assert.ok(Number(r.preferredWith) >= Number(r.preferredWithout), `with ${r.preferredWith} < without ${r.preferredWithout}`);
  assert.ok(Number(r.preferredWith) >= FLOORS.preferredWith);
  if (r.recall.answerInMemory) assert.ok(Number(r.recall.top1WhenAnswerIsInMemory) >= FLOORS.top1WhenAnswerIsInMemory);
});
