// Line logic verification, step 1 (packages/engine/line/logicVerify/): every validator accepts a good value and refuses
// a broken one with one sentence naming the field; the builder, sentence, summary, escalation policy, sentinels and the
// layout value strategy behave as the contract says; the reused shapes still match their sources in this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  assertUnitRef, assertEffectChain, assertVerdictLocation, assertUnitVerdict, assertLayerResult, assertStepSummary, inClosedSet,
  VERDICT_STATUSES, VERIFY_LAYERS, LAYER_STRENGTH, LEVEL_OF_LAYER, TRANSFORM_IDS, TRANSFORM_SOURCES, EFFECT_NAMES, MORPHEUS_EFFECTS,
  LOGIC_KIND_EFFECTS, LAYER_OUTCOMES, PURE_EQUIVALENCE_OUTCOME, LAYER_WORDS, AST_PATH,
} from '../packages/engine/line/logicVerify/contract.mjs';
import { buildUnitVerdict, verdictSentence, summarizeStep, stepSentence, countStatuses, shareOf } from '../packages/engine/line/logicVerify/verdict.mjs';
import { LEVELS, LAYER_ORDER, levelsFor, layerOrder, isDecisive, nextLayer, decideUnit } from '../packages/engine/line/logicVerify/escalation.mjs';
import { FAKE_ENV, FAKE_EFFECTS, SENTINEL_PATTERN, sentinel, findSentinels, assertEffectRecord, assertUnitRun } from '../packages/engine/line/logicVerify/fakes.mjs';
import { LAYOUT_FAKE_TYPES, LAYOUT_EVENTS, LAYOUT_STRING_VALUES, LARGE, MAX_LITERALS, layoutValues } from '../packages/engine/line/logicVerify/layoutFakes.mjs';
import { SEMANTIC_DIFF_VERDICTS } from '../packages/ast/semanticDiff.mjs';
import { LOGIC_UNIT_KINDS } from '../packages/engine/line/importV2/contract.mjs';
import { EDGE_LAYER } from '../packages/engine/line/graph/contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ONE_SENTENCE = /^[A-Z][^\n]*\.$/;
const refuses = (fn, field) => assert.throws(fn, (e) => e instanceof TypeError && ONE_SENTENCE.test(e.message) && e.message.includes(field));

const UNIT = Object.freeze({ fingerprint: '0123456789abcdef', id: 'src/age.ts#isAdult:export:0', kind: 'export', file: 'src/age.ts', fn: 'isAdult', line: 1 });
const LOC = Object.freeze({ astPath: 'isAdult/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/BinaryExpression.operator', file: 'src/age.ts', line: 2 });
const base = (over = {}) => ({ unit: UNIT, purity: 'pure', effectChain: [], status: 'proven', layer: 'L0-canonical', transforms: ['move'], ...over });

// ---- contract ------------------------------------------------------------------------------------------------------

test('logic verify contract: closed lists are complete and consistent', () => {
  assert.deepEqual([...TRANSFORM_IDS], ['move', 'rename', 'extract-function', 'extract-expression', 'wrap-adapter', 'repoint-imports', 'repoint-mocks']);
  assert.deepEqual(Object.keys(TRANSFORM_SOURCES).sort(), [...TRANSFORM_IDS].sort());
  assert.deepEqual([...VERDICT_STATUSES], ['proven', 'tested', 'unverified', 'changed', 'not-extracted']);
  for (const l of VERIFY_LAYERS) {
    assert.ok(LAYER_WORDS[l], `words for ${l}`);
    if (l !== 'none') { assert.ok(LAYER_STRENGTH[l], `strength for ${l}`); assert.ok(LEVEL_OF_LAYER[l], `level for ${l}`); }
  }
  for (const order of Object.values(LAYER_ORDER)) for (const l of order) assert.ok(VERIFY_LAYERS.includes(l));
  for (const e of Object.values(MORPHEUS_EFFECTS)) assert.ok(EFFECT_NAMES.includes(e));
  for (const [k, e] of Object.entries(LOGIC_KIND_EFFECTS)) { assert.ok(LOGIC_UNIT_KINDS.includes(k)); assert.ok(EFFECT_NAMES.includes(e)); }
  for (const e of Object.values(FAKE_EFFECTS)) assert.ok(EFFECT_NAMES.includes(e));
});

test('logic verify contract: reused shapes still match their sources', () => {
  // layer outcomes extend ast/semanticDiff's verdicts; pureExportEquivalence's map onto them
  assert.deepEqual(LAYER_OUTCOMES.slice(0, 3), [...SEMANTIC_DIFF_VERDICTS]);
  for (const o of Object.values(PURE_EQUIVALENCE_OUTCOME)) assert.ok(LAYER_OUTCOMES.includes(o));
  assert.match(fs.readFileSync(path.join(ROOT, 'packages/ast/pureExportEquivalence.mjs'), 'utf8'), /'equivalent'\|'diverged'\|'skipped'\|'cant-tell'/);
  // G1's unit node is `unit:<fingerprint>`, the fingerprint a UnitRef carries
  assert.equal(EDGE_LAYER.CALLED_AT_RUNTIME, 'runtime');
  // the fake env is the characterizer's
  const runtime = fs.readFileSync(path.join(ROOT, 'packages/engine/line/characterize/runtime.cjs'), 'utf8');
  assert.ok(runtime.includes(`new Date('${FAKE_ENV.now}')`));
  assert.ok(runtime.includes(`mulberry32(${FAKE_ENV.seed})`));
  for (const op of ["'router.navigate'", "'storage.setItem'"]) assert.ok(runtime.includes(op), op);
  // every transform source file exists
  for (const src of Object.values(TRANSFORM_SOURCES)) assert.ok(fs.existsSync(path.join(ROOT, src.split(' ')[0])), src);
});

test('assertUnitRef: accepts the G2 UnreachedUnit shape, refuses each bad field', () => {
  assertUnitRef(UNIT);
  refuses(() => assertUnitRef(null), 'The unit');
  refuses(() => assertUnitRef({ ...UNIT, fingerprint: 'xyz' }), 'fingerprint');
  refuses(() => assertUnitRef({ ...UNIT, kind: 'widget' }), 'kind');
  refuses(() => assertUnitRef({ ...UNIT, file: '/abs/age.ts' }), 'file');
  refuses(() => assertUnitRef({ ...UNIT, file: '../age.ts' }), 'file');
  refuses(() => assertUnitRef({ ...UNIT, fn: '' }), 'fn');
  refuses(() => assertUnitRef({ ...UNIT, line: 0 }), 'line');
});

test('assertEffectChain: effects once each, via Morpheus item ids', () => {
  assertEffectChain([]);
  assertEffectChain([{ effect: 'fetch', via: ['src/api.ts#api'] }, { effect: 'toast', via: [] }]);
  refuses(() => assertEffectChain({}), 'effect chain');
  refuses(() => assertEffectChain([{ effect: 'teleport', via: [] }]), 'effect');
  refuses(() => assertEffectChain([{ effect: 'fetch', via: [] }, { effect: 'fetch', via: [] }]), 'fetch');
  refuses(() => assertEffectChain([{ effect: 'fetch', via: ['saveOrder'] }]), 'via[0]');
  refuses(() => assertEffectChain([{ effect: 'fetch' }]), 'via');
});

test('assertVerdictLocation: astPath grammar, app-relative file, 1-based line, side', () => {
  assertVerdictLocation(LOC);
  assertVerdictLocation({ ...LOC, column: 10, side: 'before' });
  assertVerdictLocation({ astPath: '<module>/ExpressionStatement', file: 'a.ts', line: 1 });
  for (const ok of ['f/A.b', 'f/A.b[0]/C', 'obj.method/CallExpression.arguments[2]']) assert.match(ok, AST_PATH);
  for (const bad of ['isAdult', 'isAdult/', 'isAdult/binary', 'isAdult/A.b/c.d', 'a b/C']) assert.doesNotMatch(bad, AST_PATH);
  refuses(() => assertVerdictLocation({ ...LOC, astPath: 'isAdult' }), 'astPath');
  refuses(() => assertVerdictLocation({ ...LOC, file: '/x.ts' }), 'file');
  refuses(() => assertVerdictLocation({ ...LOC, line: 0 }), 'line');
  refuses(() => assertVerdictLocation({ ...LOC, column: 0 }), 'column');
  refuses(() => assertVerdictLocation({ ...LOC, side: 'middle' }), 'side');
});

test('inClosedSet: only arrays of closed-set ids', () => {
  assert.equal(inClosedSet([]), true);
  assert.equal(inClosedSet(['move', 'repoint-mocks']), true);
  assert.equal(inClosedSet(null), false);
  assert.equal(inClosedSet(['move', 'inline-everything']), false);
});

test('assertUnitVerdict: accepts each status, enforces the rules', () => {
  const ok = (v) => assertUnitVerdict({ ...v, sentence: verdictSentence(v) });
  ok(base());
  ok(base({ status: 'tested', layer: 'fast-check' }));
  ok(base({ status: 'tested', layer: 'L0-canonical', transforms: null }));
  ok(base({ status: 'changed', layer: 'z3', transforms: null, location: LOC, input: [18] }));
  ok(base({ status: 'unverified', layer: 'none', transforms: null }));
  ok(base({ status: 'unverified', layer: 'isolated' }));
  ok(base({ status: 'not-extracted', layer: 'round-trip', transforms: ['extract-function'] }));
  ok(base({ purity: 'impure', effectChain: [{ effect: 'fetch', via: [] }], status: 'tested', layer: 'isolated' }));

  const bad = (over, field) => { const v = base(over); refuses(() => assertUnitVerdict({ ...v, sentence: verdictSentence(v) }), field); };
  bad({ transforms: null }, 'outside the closed transform set');               // the rule: out-of-set code is never proven
  bad({ transforms: ['move', 'hand-edit'] }, 'transforms[1]');
  bad({ layer: 'fast-check' }, 'only samples inputs');                           // a sample layer never proves
  bad({ layer: 'isolated' }, 'only samples inputs');
  bad({ layer: 'none' }, 'status');
  bad({ status: 'changed', layer: 'z3' }, 'location');                           // changed names its location
  bad({ status: 'changed', layer: 'none', location: LOC }, 'layer');
  bad({ status: 'tested', layer: 'none' }, 'layer');
  bad({ status: 'not-extracted', layer: 'L0-canonical' }, 'round-trip');
  bad({ input: [1] }, 'input');
  bad({ purity: 'impure' }, 'purity');                                           // impure needs a chain
  bad({ effectChain: [{ effect: 'fetch', via: [] }] }, 'purity');                // a chain means impure
  bad({ status: 'fine' }, 'status');
  bad({ layer: 'vibes' }, 'layer');
  refuses(() => assertUnitVerdict({ ...base(), sentence: 'no full stop' }), 'sentence');
  refuses(() => assertUnitVerdict({ ...base(), sentence: 'Two lines.\nHere.' }), 'sentence');
  refuses(() => assertUnitVerdict(null), 'The unit verdict');
});

test('assertLayerResult: layer, outcome, location, ms', () => {
  assertLayerResult({ layer: 'z3', outcome: 'changed', location: LOC, input: [18], ms: 3 });
  refuses(() => assertLayerResult({ layer: 'none', outcome: 'skipped' }), 'layer');
  refuses(() => assertLayerResult({ layer: 'z3', outcome: 'maybe' }), 'outcome');
  refuses(() => assertLayerResult({ layer: 'z3', outcome: 'changed', location: { ...LOC, line: -1 } }), 'line');
  refuses(() => assertLayerResult({ layer: 'z3', outcome: 'changed', ms: -1 }), 'ms');
});

// ---- builder, sentence, summary ------------------------------------------------------------------------------------

test('buildUnitVerdict: fills the sentence, defaults transforms to null, refuses forbidden verdicts', () => {
  const v = buildUnitVerdict(base());
  assert.equal(v.sentence, 'isAdult (export in src/age.ts) is proven unchanged by the canonical compare.');
  const t = buildUnitVerdict({ ...base({ status: 'tested', layer: 'fast-check' }), transforms: undefined });
  assert.equal(t.transforms, null);
  assert.equal(t.sentence, "isAdult (export in src/age.ts) behaved the same under fast-check property runs, but it was edited outside Line's transforms, so it is tested, not proven.");
  assert.throws(() => buildUnitVerdict(base({ transforms: null })), /never|outside the closed transform set/);
  assert.equal(Object.hasOwn(v, 'location'), false);
});

test('verdictSentence: one line per status, the changed one names place and input', () => {
  const s = (over) => verdictSentence(base(over));
  assert.equal(s({ status: 'tested', layer: 'isolated' }), 'isAdult (export in src/age.ts) behaved the same under isolated execution, so it is tested, not proven.');
  assert.equal(s({ status: 'changed', layer: 'z3', location: LOC, input: [18] }), 'isAdult (export in src/age.ts) changed at src/age.ts:2 (BinaryExpression.operator) for input [18], found by a Z3 proof.');
  assert.equal(s({ status: 'changed', layer: 'isolated', location: { ...LOC, side: 'before' } }), 'isAdult (export in src/age.ts) changed at the old src/age.ts:2 (BinaryExpression.operator), found by isolated execution.');
  assert.equal(s({ status: 'unverified', layer: 'none' }), 'isAdult (export in src/age.ts) is unverified: no layer ran, so it is not assumed fine.');
  assert.equal(s({ status: 'unverified', layer: 'semantic-diff' }), 'isAdult (export in src/age.ts) is unverified: the semantic diff could not decide, so it is not assumed fine.');
  assert.equal(s({ status: 'not-extracted', layer: 'round-trip' }), 'isAdult (export in src/age.ts) is not extracted: it sits in no atom or block.');
  const long = s({ status: 'changed', layer: 'fast-check', location: LOC, input: { text: 'x'.repeat(200) } });
  assert.ok(long.includes('...') && long.length < 220 && !long.includes('\n'));
  for (const st of VERDICT_STATUSES) assert.match(s({ status: st, location: LOC }), /^\S[^\n]*\.$/);
});

test('summarizeStep, stepSentence, shareOf: "N proven, M tested, K unverified" plus divergences', () => {
  const verdicts = [
    buildUnitVerdict(base()),
    buildUnitVerdict(base({ status: 'tested', layer: 'fast-check', transforms: null })),
    buildUnitVerdict(base({ status: 'unverified', layer: 'none', transforms: null })),
    buildUnitVerdict(base({ status: 'changed', layer: 'z3', transforms: null, location: LOC, input: [18] })),
  ];
  const s = summarizeStep('import-3', verdicts);
  assertStepSummary(s);
  assert.deepEqual(s.counts, { proven: 1, tested: 1, unverified: 1, changed: 1, 'not-extracted': 0 });
  assert.equal(s.sentence, '1 proven, 1 tested, 1 unverified, 1 changed.');
  assert.equal(s.divergences.length, 1);
  assert.deepEqual(s.divergences[0].input, [18]);
  assert.equal(stepSentence(countStatuses([])), '0 proven, 0 tested, 0 unverified.');
  assert.equal(stepSentence({ proven: 2, tested: 0, unverified: 0, changed: 0, 'not-extracted': 3 }), '2 proven, 0 tested, 0 unverified, 3 not extracted.');
  assert.deepEqual(shareOf(s.counts), { proven: 0.25, tested: 0.25, unverified: 0.25, total: 4 });
  assert.deepEqual(shareOf(countStatuses([])), { proven: 0, tested: 0, unverified: 0, total: 0 });
  refuses(() => assertStepSummary({ ...s, total: 9 }), 'total');
  refuses(() => assertStepSummary({ ...s, divergences: [] }), 'divergences');
  refuses(() => assertStepSummary({ ...s, counts: { ...s.counts, proven: -1 } }), 'proven');
  refuses(() => assertStepSummary({ ...s, step: '' }), 'step');
});

// ---- escalation ----------------------------------------------------------------------------------------------------

test('levelsFor and layerOrder: L0 always, L1 for touched units, L2 for server-rendered, L3 opt-in', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['L0', 'L1', 'L2', 'L3']);
  assert.deepEqual(levelsFor(), ['L0']);
  assert.deepEqual(levelsFor({ serverRendered: true, browser: true }), ['L0']);
  assert.deepEqual(levelsFor({ touched: true }), ['L0', 'L1']);
  assert.deepEqual(levelsFor({ touched: true, serverRendered: true, browser: true }), ['L0', 'L1', 'L2', 'L3']);
  assert.deepEqual(layerOrder('pure'), ['L0-canonical', 'semantic-diff', 'z3', 'fast-check', 'isolated', 'runtime']);
  assert.deepEqual(layerOrder('impure'), ['L0-canonical', 'semantic-diff', 'isolated', 'runtime']);
  assert.deepEqual(layerOrder('impure', { levels: ['L0'] }), ['L0-canonical', 'semantic-diff']);
  assert.deepEqual(layerOrder('pure', { levels: ['L0'], extracted: true }), ['round-trip', 'L0-canonical', 'semantic-diff', 'z3', 'fast-check']);
  assert.deepEqual(layerOrder('impure', { levels: levelsFor({ touched: true, serverRendered: true }) }).slice(-1), ['dev-server']);
  // cheapest first: levels never go down along an order
  for (const order of Object.values(LAYER_ORDER)) {
    const lv = order.map((l) => LEVEL_OF_LAYER[l]);
    assert.deepEqual(lv, [...lv].sort());
  }
});

test('isDecisive: same always; changed unless a text compare on an out-of-set edit', () => {
  assert.equal(isDecisive({ layer: 'fast-check', outcome: 'same-behaviour' }, null), true);
  assert.equal(isDecisive({ layer: 'z3', outcome: 'cant-tell' }, ['move']), false);
  assert.equal(isDecisive({ layer: 'z3', outcome: 'skipped' }, ['move']), false);
  assert.equal(isDecisive({ layer: 'L0-canonical', outcome: 'changed' }, ['move']), true);   // Alive2-style: a transform must match
  assert.equal(isDecisive({ layer: 'L0-canonical', outcome: 'changed' }, null), false);
  assert.equal(isDecisive({ layer: 'semantic-diff', outcome: 'changed' }, null), false);
  assert.equal(isDecisive({ layer: 'z3', outcome: 'changed' }, null), true);
});

test('nextLayer: stops at the first decisive layer, else walks the order', () => {
  const order = layerOrder('pure');
  assert.equal(nextLayer(order, [], null), 'L0-canonical');
  assert.equal(nextLayer(order, [{ layer: 'L0-canonical', outcome: 'changed' }], null), 'semantic-diff');
  assert.equal(nextLayer(order, [{ layer: 'L0-canonical', outcome: 'changed' }], ['move']), null);
  assert.equal(nextLayer(order, [{ layer: 'L0-canonical', outcome: 'same-behaviour' }], null), null);
  const all = order.map((layer) => ({ layer, outcome: 'cant-tell' }));
  assert.equal(nextLayer(order, all, null), null);
});

test('decideUnit: the policy as a pure function', () => {
  assert.deepEqual(decideUnit({ results: [], transforms: ['move'], inBlock: false }), { status: 'not-extracted', layer: 'round-trip' });
  assert.deepEqual(decideUnit({ results: [], transforms: ['move'] }), { status: 'unverified', layer: 'none' });
  assert.deepEqual(decideUnit({ results: [{ layer: 'L0-canonical', outcome: 'same-behaviour' }], transforms: ['move'] }), { status: 'proven', layer: 'L0-canonical' });
  assert.deepEqual(decideUnit({ results: [{ layer: 'L0-canonical', outcome: 'same-behaviour' }], transforms: null }), { status: 'tested', layer: 'L0-canonical' });
  assert.deepEqual(decideUnit({ results: [{ layer: 'fast-check', outcome: 'same-behaviour' }], transforms: ['rename'] }), { status: 'tested', layer: 'fast-check' });
  assert.deepEqual(decideUnit({ results: [{ layer: 'L0-canonical', outcome: 'changed', location: LOC }], transforms: ['move'] }), { status: 'changed', layer: 'L0-canonical', location: LOC });
  assert.deepEqual(decideUnit({ results: [{ layer: 'L0-canonical', outcome: 'changed' }, { layer: 'semantic-diff', outcome: 'cant-tell' }], transforms: null }), { status: 'unverified', layer: 'semantic-diff' });
  // the first decisive result wins, even if a later one disagrees
  assert.deepEqual(decideUnit({ results: [{ layer: 'z3', outcome: 'changed', location: LOC, input: [18] }, { layer: 'fast-check', outcome: 'same-behaviour' }], transforms: null }),
    { status: 'changed', layer: 'z3', location: LOC, input: [18] });
  // a decided verdict always builds
  for (const transforms of [null, ['move']]) {
    for (const outcome of LAYER_OUTCOMES) {
      for (const layer of VERIFY_LAYERS.filter((l) => l !== 'none')) {
        const d = decideUnit({ results: [{ layer, outcome, location: LOC }], transforms });
        buildUnitVerdict({ ...base(), transforms, ...d });
      }
    }
  }
});

// ---- recording fakes and sentinels ---------------------------------------------------------------------------------

test('sentinel and findSentinels: the marker format round-trips through JSON, URLs and HTML', () => {
  const a = sentinel(42, 0);
  const b = sentinel(0xdeadbeef, 17);
  assert.equal(a, '__line_0000002a_0__');
  assert.equal(b, '__line_deadbeef_17__');
  assert.match(a, SENTINEL_PATTERN);
  const carriers = [JSON.stringify({ name: a, nested: [b] }), `/api/orders?q=${encodeURIComponent(a)}`, `<p title="${b}">${a}</p>`, `${a}${b}${a}`];
  for (const c of carriers) assert.ok(findSentinels(c).includes('0000002a_0'), c);
  assert.deepEqual(findSentinels(`${a} ${b} ${a}`), ['0000002a_0', 'deadbeef_17']);
  assert.deepEqual(findSentinels('nothing here __line_xyz_1__'), []);
  assert.throws(() => sentinel(-1, 0), /seed/);
  assert.throws(() => sentinel(1, 1.5), /number/);
});

test('assertEffectRecord: shapes and names only, never values', () => {
  const { shapeOf, urlPattern } = require('../packages/engine/line/graph/runtime/recorder.cjs');
  const order = { id: sentinel(42, 0), total: 12.5, lines: [{ sku: 'a' }] };
  const rec = { seq: 0, effect: 'fetch', op: 'axios.post', method: 'POST', key: urlPattern('/api/orders/123?draft=1'), args: [shapeOf('/api/orders'), shapeOf(order)], sentinels: findSentinels(JSON.stringify(order)) };
  assertEffectRecord(rec);
  assert.equal(rec.key, '/api/orders/:id?draft=');
  assertEffectRecord({ seq: 1, effect: 'toast', op: 'toast.success', args: ['string'], sentinels: [] });
  refuses(() => assertEffectRecord({ ...rec, args: ['"Order saved"'] }), 'args[0]');
  refuses(() => assertEffectRecord({ ...rec, args: [order.id] }), 'args[0]');
  refuses(() => assertEffectRecord({ ...rec, key: `/api/${order.id}` }), 'key');
  refuses(() => assertEffectRecord({ ...rec, value: order }), 'value');
  refuses(() => assertEffectRecord({ ...rec, effect: 'email' }), 'effect');
  refuses(() => assertEffectRecord({ ...rec, method: 'post' }), 'method');
  refuses(() => assertEffectRecord({ ...rec, sentinels: [order.id] }), 'sentinels[0]');
  refuses(() => assertEffectRecord({ ...rec, seq: -1 }), 'seq');
});

test('assertUnitRun: inputs, output, thrown, effects, transitions, sentinels, branches', () => {
  const run = { inputs: ['number'], output: 'boolean', thrown: null, effects: [{ seq: 0, effect: 'storage', op: 'storage.setItem', key: 'cart', args: ['string', 'string'], sentinels: [] }], transitions: [{ seq: 1, key: 'compact' }], sentinels: [], branches: { covered: 2, total: 2 } };
  assertUnitRun(run);
  assertUnitRun({ ...run, thrown: 'TypeError', branches: undefined });
  refuses(() => assertUnitRun({ ...run, inputs: ["'x'"] }), 'inputs');
  refuses(() => assertUnitRun({ ...run, output: sentinel(1, 1) }), 'output');
  refuses(() => assertUnitRun({ ...run, thrown: 'boom happened' }), 'thrown');
  refuses(() => assertUnitRun({ ...run, transitions: [{ seq: 0 }] }), 'transition');
  refuses(() => assertUnitRun({ ...run, branches: { covered: 3, total: 2 } }), 'branches');
  refuses(() => assertUnitRun({ ...run, effects: [{ ...run.effects[0], effect: 'x' }] }), 'Effect record 0');
});

// ---- layout fakes --------------------------------------------------------------------------------------------------

test('layout fake types and events are named after lib.dom.d.ts', () => {
  const dom = fs.readFileSync(require.resolve('typescript/lib/lib.dom.d.ts'), 'utf8');
  const body = (name) => {
    const m = new RegExp(`^interface ${name} [^{]*\\{([\\s\\S]*?)^\\}`, 'm').exec(dom);
    assert.ok(m, `interface ${name} in lib.dom.d.ts`);
    return m[1];
  };
  for (const t of LAYOUT_FAKE_TYPES) {
    assert.ok(new RegExp(`^(interface|declare var) ${t.name}\\b`, 'm').test(dom), `${t.name} in lib.dom.d.ts`);
    const b = body(t.from);
    for (const m of Object.keys(t.members)) assert.match(b, new RegExp(`^\\s+(readonly )?${m}\\??:`, 'm'), `${t.from}.${m}`);
  }
  const maps = ['WindowEventMap', 'DocumentEventMap', 'ElementEventMap', 'GlobalEventHandlersEventMap', 'MediaQueryListEventMap'].map(body).join('\n');
  for (const e of LAYOUT_EVENTS) {
    assert.match(maps, new RegExp(`"${e.event}": ${e.interface};`), `${e.event}: ${e.interface}`);
    for (const r of e.reads) {
      const [type, member] = r.split('.');
      assert.ok(LAYOUT_FAKE_TYPES.find((t) => t.name === type)?.members[member], r);
    }
  }
  assert.match(dom, /type DocumentVisibilityState = "hidden" \| "visible";/);
  assert.deepEqual([...LAYOUT_STRING_VALUES.visibilityState].sort(), ['hidden', 'visible']);
});

test('layoutValues: mined literals at the boundary +-1, plus 0, negative and large', () => {
  const pools = { strings: ['(max-width: 767px)', 'Save', '(prefers-reduced-motion: reduce)'], numbers: [3, 768, 0.5], byKey: { innerWidth: [768, 1024], intersectionRatio: [0.5] } };
  assert.deepEqual(layoutValues('Window', 'innerWidth', pools), [-1, 0, 767, 768, 769, 1023, 1024, 1025, LARGE]);
  assert.deepEqual(layoutValues('IntersectionObserverEntry', 'intersectionRatio', pools), [-1, 0, 0.4, 0.5, 0.6, LARGE]);
  // no keyed literal: every mined number
  assert.deepEqual(layoutValues('Element', 'scrollTop', pools), [-1, 0, 0.4, 0.5, 0.6, 2, 3, 4, 767, 768, 769, LARGE]);
  assert.deepEqual(layoutValues('Element', 'scrollTop', { strings: [], numbers: [], byKey: {} }), [-1, 0, LARGE]);
  assert.deepEqual(layoutValues('MediaQueryList', 'matches', pools), [false, true]);
  assert.deepEqual(layoutValues('MediaQueryList', 'media', pools), ['(max-width: 767px)', '(prefers-reduced-motion: reduce)']);
  assert.deepEqual(layoutValues('Document', 'visibilityState', pools), ['visible', 'hidden']);
  assert.deepEqual(layoutValues('PointerEvent', 'pointerType', pools), ['mouse', 'pen', 'touch']);
  const many = { strings: [], numbers: Array.from({ length: 20 }, (_, i) => (i + 1) * 100), byKey: {} };
  assert.equal(layoutValues('Window', 'innerHeight', many).length, 3 + 3 * MAX_LITERALS);
  assert.deepEqual(layoutValues('Window', 'innerWidth', pools), layoutValues('Window', 'innerWidth', pools));   // deterministic
  assert.throws(() => layoutValues('Window', 'zoom', pools), /LAYOUT_FAKE_TYPES/);
  assert.throws(() => layoutValues('Canvas', 'width', pools), /LAYOUT_FAKE_TYPES/);
});
