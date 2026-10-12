// #903: the NLP arms' readings (contract Reading shape), static as the default, the others in shadow, forks, the
// shadow switch and record. The sidecar is faked (`post`); the real one is exercised by trace/tools/jev/test_arms.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { draft } from '../../../packages/engine/line/drafter/index.mjs';
import { buildIntentCatalog } from '../../../packages/engine/line/drafter/contract.mjs';
import { LINE_PLAN_TOOLS } from '../../../packages/engine/line/contract.mjs';
import { armsSwitch, runArmsShadow, ARMS_SHADOW_FILE, ARM_STEPS } from '../../../packages/engine/line/drafter/shadow.mjs';
import { stepProfile, stepOn } from '../../../packages/core/ai-profiles.mjs';
import { assertReading } from './contract.mjs';
import { readingsFromDists, readCandidates, streamFromParse, armForks, armsRecord, mergeReadings, ARMS } from './arms.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const CATALOG = buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));

function ctxOf(request, root = SAMPLE) {
  const d = draft(root, request, { verify: false, shadow: false });
  return { request, normalized: { text: d.request, tokens: d.tokens }, slots: d.slots, bindings: d.bindings, catalog: CATALOG, labels: d.labels };
}

/** A fake sidecar. Each arm answers what `want` says; jev (no arm) answers its numbered options. */
function fakeSidecar(want = {}) {
  const calls = [];
  const post = async (body) => {
    calls.push(body);
    const arm = body.arm ?? 'jev';
    if (want[arm] === 'down') throw new Error('down');
    if (arm === 'spacy') {
      // "add a Button to the orders page" -> add(ROOT) Button(dobj) to(prep) [orders page](pobj, merged by the ruler)
      return { parse: body.words.length === 6 ? [] : [
        { i: 0, ws: [0, 1], lemma: 'add', pos: 'VERB', dep: 'ROOT', head: 0 },
        { i: 1, ws: [1, 2], lemma: 'a', pos: 'DET', dep: 'det', head: 2 },
        { i: 2, ws: [2, 3], lemma: 'button', pos: 'PROPN', dep: 'dobj', head: 0 },
        { i: 3, ws: [3, 4], lemma: 'to', pos: 'ADP', dep: 'prep', head: 0 },
        { i: 4, ws: [4, 5], lemma: 'the', pos: 'DET', dep: 'det', head: 5 },
        { i: 5, ws: [5, 7], lemma: 'orders page', pos: 'NOUN', dep: 'pobj', head: 3 },
      ] };
    }
    const pick = want[arm] ?? {};
    return {
      ms: 1,
      answers: body.questions.map((q) => {
        const opts = q.options;
        const choice = pick[q.key] ? opts.find((o) => o === pick[q.key] || o.endsWith(`) ${pick[q.key]}`) || o.startsWith(`${pick[q.key]} `)) : opts[0];
        const probabilities = Object.fromEntries(opts.map((o) => [o, o === choice ? 0.8 : 0.2 / (opts.length - 1)]));
        return { key: q.key, choice, probabilities, confidence: pick.conf ?? 0.8 };
      }),
    };
  };
  return { post, calls };
}

test('readingsFromDists: verb x object within the catalog, best slots, recall-first layers, small k', () => {
  const r = readingsFromDists({ verb: { add: 0.7, fix: 0.3 }, object: { component: 0.6, problem: 0.1, banana: 0.3 }, slot: { F1: 0.6, P1: 0.3, none: 0.1 }, layers: { ui: 0.9, workflow: 0.35, api: 0.1 } }, CATALOG, { k: 3 });
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].intent, r[0].object, r[0].target], ['add.component', 'component', 'F1']);
  assert.deepEqual(r[0].layers, ['ui', 'workflow']);
  for (const x of r) assertReading(x, CATALOG);
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].confidence >= x.confidence));
  assert.equal(readingsFromDists({ intent: { 'fix.problem': 1 }, slot: { none: 1 }, layers: { ui: 0.1 } }, CATALOG)[0].target, null);
  assert.deepEqual(readingsFromDists({ intent: { 'fix.problem': 1 }, layers: { ui: 0.1, api: 0.2 } }, CATALOG)[0].layers, ['api'], 'at least the best layer');
});

test('readCandidates: static decides; every other arm answers in shadow with contract readings; union keeps them', async () => {
  const ctx = ctxOf('add a Button to the orders page');
  const { post, calls } = fakeSidecar({ lr: { intent: 'add.component', slot: 'P1' }, nb: { intent: 'base-on.component' }, nli: { verb: 'add', object: 'component', slot: 'P1' }, jev: { verb: 'add', object: 'page', conf: 0.1 } });
  const res = await readCandidates(ctx, { post });
  assert.deepEqual(Object.keys(res.byArm).sort(), [...ARMS].sort());
  for (const a of ARMS) { assert.ok(res.byArm[a]?.readings.length, a); for (const r of res.byArm[a].readings) assertReading(r, CATALOG); }
  assert.deepEqual(res.active, ['static']);
  assert.deepEqual(res.readings, mergeReadings([res.byArm.static.readings]), 'with every arm off the beam opens static readings only');
  assert.ok(res.union.length >= res.readings.length);
  assert.ok(res.union.some((r) => r.intent === 'base-on.component'));
  // The lr / nb arms never see the project's names: only slot tokens and words.
  const lr = calls.find((c) => c.arm === 'lr');
  assert.ok(!JSON.stringify(lr).includes('OrdersPage') && !JSON.stringify(lr).includes('"src"'));
  // jev under the gate and arms disagreeing are forks, never a guess.
  const f = res.shadowForks.find((x) => x.label === 'intent');
  assert.ok(f && f.reason === 'both' && f.low.includes('jev'));
  assert.equal(res.forks.length, res.byArm.static.confidence < 0.5 ? 1 : 0);
});

test('readCandidates: an arm switched on joins the readings; a sidecar that is down leaves static standing', async () => {
  const ctx = ctxOf('add a Button to the orders page');
  const on = await readCandidates(ctx, { arms: ['static', 'lr'], on: ['lr'], post: fakeSidecar({ lr: { intent: 'base-on.component' } }).post });
  assert.deepEqual(on.active, ['static', 'lr']);
  assert.ok(on.readings.some((r) => r.intent === 'base-on.component'));
  const down = await readCandidates(ctx, { post: async () => { throw new Error('ECONNREFUSED'); } });
  for (const a of ARMS.filter((x) => x !== 'static')) assert.equal(down.byArm[a], null, a);
  assert.deepEqual(down.readings, mergeReadings([down.byArm.static.readings]));
});

test('spacy: the root verb leads, its object next, and a destination preposition picks the target', async () => {
  const ctx = ctxOf('please add a Button to the orders page');
  const words = ctx.normalized.tokens.flatMap((t) => t.src);
  assert.deepEqual(words, ['please', 'add', 'a', 'Button', 'to', 'the', 'orders', 'page']);
  const wordTok = ctx.normalized.tokens.flatMap((t, i) => t.src.map(() => i));
  const parse = [
    { i: 0, ws: [0, 1], lemma: 'please', pos: 'INTJ', dep: 'intj', head: 1 },
    { i: 1, ws: [1, 2], lemma: 'add', pos: 'VERB', dep: 'ROOT', head: 1 },
    { i: 2, ws: [2, 3], lemma: 'a', pos: 'DET', dep: 'det', head: 3 },
    { i: 3, ws: [3, 4], lemma: 'button', pos: 'PROPN', dep: 'dobj', head: 1 },
    { i: 4, ws: [4, 5], lemma: 'to', pos: 'ADP', dep: 'prep', head: 1 },
    { i: 5, ws: [5, 6], lemma: 'the', pos: 'DET', dep: 'det', head: 6 },
    { i: 6, ws: [6, 8], lemma: 'orders page', pos: 'NOUN', dep: 'pobj', head: 4 },
  ];
  const { tokens, dest } = streamFromParse(parse, wordTok, ctx.normalized);
  assert.equal(tokens[0].t, 'add');
  assert.equal(tokens[2].slot, 'L1');
  assert.equal(dest, 'P1');
  assert.equal(tokens.length, ctx.normalized.tokens.length, 'every normalized token kept once');
});

test('armForks: disagreement per label, low confidence once on the intent', () => {
  const R = (intent, target, conf) => ({ readings: [{ intent, object: intent.split('.')[1], target, layers: ['ui'], confidence: conf }], confidence: conf });
  assert.deepEqual(armForks({ static: R('add.component', 'P1', 0.9), lr: R('add.component', 'P1', 0.8) }, ['static', 'lr']), []);
  const f = armForks({ static: R('add.component', 'P1', 0.9), lr: R('add.component', 'F1', 0.3) }, ['static', 'lr']);
  assert.deepEqual(f.map((x) => [x.label, x.reason]), [['intent', 'low-confidence'], ['target', 'both']]);
});

test('every arm step ships off and unmeasured; shadow is off by default (no call, nothing written), on per project', async () => {
  for (const step of Object.values(ARM_STEPS).filter(Boolean)) { const p = stepProfile(step); assert.equal(stepOn(p), false, step); assert.equal(p.ladder.measured, null, step); }
  const dir = makeTempDir('line-arms-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  const prev = process.env.LINE_ARMS_SHADOW; delete process.env.LINE_ARMS_SHADOW;
  try {
    assert.deepEqual(armsSwitch(dir), { shadow: [], on: [] });
    const ctx = ctxOf('add a Button to the orders page', dir);
    assert.equal(runArmsShadow(dir, ctx, { post: async () => { throw new Error('must not be called'); } }), null);
    fs.mkdirSync(path.join(dir, 'line'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'line', 'ai-profiles.json'), JSON.stringify({ v: 1, steps: { 'construct.intent-lr': { shadow: true }, 'construct.intent-nli': { on: true, shadow: true } } }));
    assert.deepEqual(armsSwitch(dir), { shadow: ['lr', 'nli'], on: [] }, 'on without a measured win stays off');
    const { post } = fakeSidecar({ lr: { intent: 'add.component', slot: 'P1' }, nli: { verb: 'add', object: 'component' } });
    const rec = await runArmsShadow(dir, ctx, { post });
    assert.ok(rec);
    const logged = fs.readFileSync(path.join(dir, 'line', ARMS_SHADOW_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(logged, [rec]);
    assert.deepEqual(Object.keys(rec.arms).sort(), ['lr', 'nli']);
    assert.deepEqual(rec.used, ['static']);
    // Slot form only: no project names reach the log.
    assert.ok(!/OrdersPage|Button|orders/.test(JSON.stringify(rec)), JSON.stringify(rec));
    assert.deepEqual(Object.keys(armsRecord(ctx, await readCandidates(ctx, { arms: ['static'] }))).sort(), ['arms', 'at', 'decision', 'forks', 'gate', 'request', 'static', 'used', 'v']);
  } finally { if (prev !== undefined) process.env.LINE_ARMS_SHADOW = prev; fs.rmSync(dir, { recursive: true, force: true }); }
});
