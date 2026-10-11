// Train Line, real engine: imaginary worlds pass the line profile, the committed seed is verified and delexicalized,
// "Try it" runs Construct in a scratch copy only, the store logs who changed what, only the owner reviews, and eval
// scores held-out worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENT_IDS, TRAIN_INTENT_MAP, assertTrainCase, assertDelexicalized, assertScoreboard, assertTryResult } from '../packages/engine/line/train/contract.mjs';
import { INTENT_DEFS } from '../packages/engine/line/train/routes.mjs';
import { WORLD_IDS, HELDOUT_FROM, isHeldOut, materialize, SAMPLE_DIR } from '../packages/engine/line/train/corpus.mjs';
import { factsOf } from '../packages/engine/line/train/facts.mjs';
import { worldFacts } from '../packages/engine/line/train/generate.mjs';
import { tryRoute } from '../packages/engine/line/train/verify.mjs';
import { normalizeRequest } from '../packages/engine/line/train/draft.mjs';
import { createTrainService, worldIdentifiers } from '../packages/engine/line/train/service.mjs';
import { CASES, LOG } from '../packages/engine/line/train/store.mjs';
import { trainRecords, feedsRetrieval } from '../packages/engine/line/train/records.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SEED = path.join(REPO, 'line');
const seed = fs.readFileSync(path.join(SEED, CASES), 'utf8').split('\n').filter(Boolean);
const tmp = () => makeTempDir('line-train-test-');
/** Train eval floors on the real drafter (see the eval test). */
const FLOORS = Object.freeze({ recall: 0.96, precision: 0.91, preferred: 1 });
/** Per tool family (preferred picked), measured with "System 1 accuracy" (docs/line/review.md). */
const FAMILY_FLOORS = Object.freeze({ 'line.baseOn': 1, 'line.promote': 1, 'line.setPageProp': 1, 'line.setFragment': 1, 'line.fix': 1, none: 1 });
const treeHash = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else h.update(`${path.relative(dir, p)}\0${fs.readFileSync(p)}`); } };
  walk(dir);
  return h.digest('hex');
};

test('worlds: every imaginary clean world passes the line profile; each variant plants exactly one problem with typed fixes', () => {
  for (const id of WORLD_IDS) {
    for (const variant of ['clean', 'cross-feature', 'missing-base']) {
      const dir = materialize({ kind: 'corpus', id, variant });
      try {
        const f = factsOf(dir);
        if (variant === 'clean') assert.deepEqual(f.findings.map((x) => x.rule), [], `${id} clean`);
        else {
          assert.deepEqual(f.findings.map((x) => x.rule), [variant === 'cross-feature' ? 'LINE-DIR' : 'LINE-BASE'], `${id} ${variant}`);
          assert.ok(f.findings[0].fixes.some((x) => x.step), `${id} ${variant} has a fix that runs`);
        }
        assert.ok(f.features.length >= 2 && f.features.length <= 4);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }
});

test('worlds: the construct CLI agrees (validate --profile line exits clean on two worlds)', () => {
  for (const id of ['w00', 'w31']) {
    const dir = materialize({ kind: 'corpus', id, variant: 'clean' });
    try {
      execFileSync(process.execPath, [path.join(REPO, 'packages/cli/construct.mjs'), 'validate', '--dir', dir, '--profile', 'line'], { stdio: 'pipe' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('seed: a few hundred cases, every one in the contract shape, every intent of the drafter catalog the families map to, several routes where a request has them', () => {
  assert.ok(seed.length >= 300, `${seed.length} cases`);
  const cases = seed.map((l) => JSON.parse(l));
  cases.forEach(assertTrainCase);
  const intents = new Set(Object.values(INTENT_DEFS).map((d) => d.intent));
  assert.equal(intents.size, 8);
  for (const i of intents) assert.ok(INTENT_IDS.includes(i) && cases.some((c) => c.intent === i), `intent ${i}`);
  assert.ok(cases.every((c) => !Object.keys(TRAIN_INTENT_MAP).includes(c.intent) || TRAIN_INTENT_MAP[c.intent] === c.intent), 'no mirrored intent id is stored');
  for (const outcome of ['refusal', 'question']) assert.ok(cases.some((c) => c.gold.routes.some((r) => r.outcome === outcome)), `a ${outcome} route`);
  for (const i of ['add.component', 'add.page', 'promote.component', 'fix.problem']) assert.ok(cases.some((c) => c.intent === i && c.gold.routes.length > 1), `multi-route ${i}`);
  assert.ok(cases.every((c) => c.labelledBy === 'claude' && c.status === 'draft'));
  assert.ok(cases.every((c) => Object.values(c.verified.routes).length === c.gold.routes.length && Object.values(c.verified.routes).every((v) => v.ok)), 'every gold route verified');
  assert.ok(cases.filter((c) => c.sample).length >= 30, 'a review sample');
});

test('seed: no saved case contains an identifier or domain word of its world', () => {
  for (const line of seed) {
    const c = JSON.parse(line);
    assertDelexicalized(line, worldIdentifiers(c.world, worldFacts(c.world)));
  }
});

test('seed: whole worlds are held out (w30..w39 only in heldout, never in train)', () => {
  const cases = seed.map((l) => JSON.parse(l));
  for (const c of cases) assert.equal(c.split, c.world.kind === 'corpus' && isHeldOut(c.world.id) ? 'heldout' : 'train');
  assert.ok(cases.filter((c) => c.split === 'heldout').length >= 50);
  assert.equal(HELDOUT_FROM, 30);
});

test('try it: a gold route passes in a scratch copy, a wrong check fails, refusal and question routes behave; the sample is never touched', () => {
  const before = treeHash(SAMPLE_DIR);
  const cases = seed.map((l) => JSON.parse(l)).filter((c) => c.world.kind === 'sample');
  const make = cases.find((c) => c.intent === 'add.component');
  const t = tryRoute({ world: make.world, slots: make.slots, route: make.gold.routes[0] });
  assertTryResult(t);
  assert.equal(t.ok, true, t.sentence);
  const wrong = { ...make.gold.routes[0], expect: [{ hasLibrary: 'components/Nothing' }] };
  const w = tryRoute({ world: make.world, slots: make.slots, route: wrong });
  assert.equal(w.ok, false);
  assert.match(w.checks[0].sentence, /^Expected that the library has a component Nothing, but it is not there\.$/);
  const refuse = cases.find((c) => c.gold.routes[0].outcome === 'refusal');
  const r = tryRoute({ world: refuse.world, slots: refuse.slots, route: refuse.gold.routes[0] });
  assert.equal(r.ok, true, r.sentence);
  assert.match(r.sentence, /^Construct refused it as expected/);
  const ask = cases.find((c) => c.gold.routes[0].outcome === 'question');
  const q = tryRoute({ world: ask.world, slots: ask.slots, route: ask.gold.routes[0] });
  assert.equal(q.ok, true);
  assert.match(q.sentence, /^Line must ask first: /);
  assert.equal(treeHash(SAMPLE_DIR), before, 'examples/line-sample is byte-identical');
});

test('domain map: the drafter\'s map makes names slots; a near miss offers "Did you mean"; the answer becomes a synonym of that world', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root });
    const sample = { kind: 'sample' };
    const n = normalizeRequest(sample, 'Change the title of OrdersPage to "My orders".');
    assert.equal(n.request, 'Change the title of <item:I1> to "<text:T1>".');
    assert.deepEqual(n.slots.T1, { type: 'text', of: 'F1', role: 'my' });
    assert.deepEqual(n.slots.F1, { type: 'feature', ref: 'feature#1' });
    const made = normalizeRequest(sample, 'Make StatusTooltip in orders, based on Tooltip.');
    assert.equal(made.request, 'Make <name:N1> in <feature:F1>, based on <missing:M1>.');
    assert.deepEqual(made.slots.N1, { type: 'name', role: 'status', of: 'M1' });
    const typo = normalizeRequest(sample, 'Add a Badge to ordrs.');
    assert.equal(typo.unknown.length, 1);
    assert.equal(typo.unknown[0].word, 'ordrs');
    assert.deepEqual(typo.unknown[0].choices[0], { ref: 'feature#1', name: 'orders' });
    assert.match(svc.addSynonym({ world: 'sample', word: 'ordrs', ref: 'feature#1' }).sentence, /"ordrs" means orders/);
    const d = svc.draft({ request: 'Add a Badge to ordrs.', world: 'sample' });
    assert.equal(d.request, 'Add a <library:L1> to <feature:F1>.');
    assert.equal(svc.store.log().at(-1).by, 'owner');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store: seeded on first open, every change logged with who made it, only the owner agrees or disagrees', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root, seedFrom: SEED });
    assert.equal(svc.store.all().length, seed.length);
    assert.equal(svc.store.log()[0].by, 'claude');
    const first = svc.cases({ filter: 'sample', limit: 2 });
    assert.equal(first.cases.length, 2);
    assert.ok(first.cases[0].filled.routes.length >= 1);
    const id = first.cases[0].id;
    assert.throws(() => svc.review({ id, verdict: 'agree' }, 'claude'), (e) => e.code === 'NOT_OWNER');
    assert.equal(svc.review({ id, verdict: 'agree' }).case.status, 'agreed');
    const other = first.cases[1].id;
    const dis = svc.review({ id: other, verdict: 'disagree', note: 'The preferred route should stay inside the feature.' }).case;
    assert.equal(dis.status, 'disputed');
    assert.equal(dis.notes.at(-1).text, 'The preferred route should stay inside the feature.');
    assert.deepEqual(svc.store.log().slice(-2).map((l) => [l.by, l.action, l.caseId]), [['owner', 'agree', id], ['owner', 'disagree', other]]);
    assert.ok(fs.readFileSync(path.join(root, LOG), 'utf8').endsWith('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('owner and Claude cases: a typed request is drafted, corrected with closed choices, saved delexicalized; a route that fails is refused', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root, seedFrom: SEED });
    const d = svc.draft({ request: 'Make StatusBadge in orders, based on Badge.', world: 'sample' });
    assert.equal(d.intent, 'add.component');
    assert.equal(d.filled.routes[0].steps[0].sentence, 'Make StatusBadge in orders, based on the library Badge.');
    // correct the feature with one closed choice: billing instead of orders
    const billing = svc.choices('sample').features.find((f) => f.name === 'billing').ref;
    const slots = { ...d.slots, F1: { ...d.slots.F1, ref: billing } };
    const p = svc.preview({ world: 'sample', slots, routes: d.routes, preferred: d.recommended, request: d.request });
    assert.equal(p.request, 'Make StatusBadge in billing, based on Badge.');
    const saved = svc.save({ world: 'sample', request: d.request, intent: d.intent, slots, routes: d.routes, preferred: d.recommended }).case;
    assert.equal(saved.labelledBy, 'owner');
    assert.equal(saved.status, 'agreed');
    const line = fs.readFileSync(path.join(root, CASES), 'utf8').split('\n').find((l) => l.includes(saved.id));
    assert.doesNotMatch(line, /billing|StatusBadge|Badge/);
    // an added route with closed choices (tool + values from the lists)
    const add = svc.addRoute({ world: 'sample', slots, tool: 'line.baseOn', args: { libraryId: 'components/Card', feature: 'billing', name: 'StatusCard' } });
    assert.equal(add.route.steps[0].args.libraryId, '<library:L2>');
    // a route that does not pass is refused before it is saved
    const bad = { ...d.routes[0], id: 'bad', expect: [{ hasLibrary: 'components/<name:N1>' }] };
    assert.throws(() => svc.save({ world: 'sample', request: d.request, intent: d.intent, slots, routes: [bad], preferred: 'bad' }), (e) => e.code === 'ROUTE_FAILS' && /does not pass in a scratch copy/.test(e.sentence));
    // Claude proposes with real values; stored as slots, labelled claude, a draft
    const c = svc.propose({ world: 'sample', request: 'billing should use OrderButton from orders too.', intent: 'promote.component', routes: [{ label: 'Through the library', steps: [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }] }] }).case;
    assert.equal(c.labelledBy, 'claude');
    assert.equal(c.status, 'draft');
    assert.equal(c.request, '<feature:F1> should use <item:I1> from <feature:F2> too.');
    assert.equal(c.filled.routes[0].steps[0].sentence, 'Move OrderButton from orders into the library.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('retrieval: Train\'s train-split cases feed the drafter\'s retrieval; no held-out case or held-out world ever leaks, and no record holds a project word', () => {
  const cases = seed.map((l) => JSON.parse(l));
  const records = trainRecords(cases);
  assert.ok(records.length >= 200, `${records.length} records`);
  const byId = new Map(cases.map((c) => [c.id, c]));
  for (const r of records) {
    const c = byId.get(r.group);
    assert.equal(c.split, 'train', `${r.group} is a train case`);
    assert.ok(!(c.world.kind === 'corpus' && isHeldOut(c.world.id)), `${r.group} is not on a held-out world`);
    assert.equal(r.approved, true);
    assertDelexicalized(JSON.stringify(r), worldIdentifiers(c.world, worldFacts(c.world)));
  }
  // Held-out cases contribute nothing: the records are the same with or without them.
  const trainOnly = cases.filter((c) => c.split === 'train');
  assert.deepEqual(trainRecords(trainOnly), records);
  // Not even a held-out world's case that claims the train split and the owner's agreement, nor a disputed case.
  const held = cases.find((c) => c.split === 'heldout');
  assert.equal(feedsRetrieval({ ...held, split: 'train', status: 'agreed' }), false);
  assert.equal(feedsRetrieval({ ...trainOnly[0], status: 'disputed' }), false);
  assert.equal(feedsRetrieval({ ...trainOnly[0], split: 'heldout' }), false);
  // No held-out request reaches the index as a held-out case: every record's case id is a train case's.
  const heldIds = new Set(cases.filter((c) => c.split === 'heldout').map((c) => c.id));
  assert.ok(records.every((r) => !heldIds.has(r.group) && !heldIds.has(String(r.routeId).split(':')[1])));
});

test('eval: the REAL drafter drafts every held-out case and is scored on recall, precision and the preferred route per family and intent', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root, seedFrom: SEED });
    const before = svc.scoreboard();
    assert.equal(before.lastRun, null);
    const sb = svc.runEval();
    assertScoreboard(sb);
    assert.ok(sb.lastRun);
    assert.ok(sb.total.heldout >= 50);
    // Floors measured 2026-10-11 when Train Line first scored the real drafter (docs/line/review.md "System 1
    // reconcile", 38/38/40), raised by "System 1 accuracy" (retrieval from the train split, everyday verbs, ask vs
    // invent, refuse vs ask, handler templates). Raise them as the drafter improves, never lower them.
    assert.ok(sb.total.recall >= FLOORS.recall, `recall ${sb.total.recall}`);
    assert.ok(sb.total.precision >= FLOORS.precision, `precision ${sb.total.precision}`);
    assert.ok(sb.total.preferred >= FLOORS.preferred, `preferred ${sb.total.preferred}`);
    for (const fam of ['line.baseOn', 'line.promote', 'line.setPageProp', 'line.setFragment', 'line.fix', 'none']) {
      assert.ok(sb.byFamily[fam]?.heldout > 0, fam);
      assert.ok(sb.byFamily[fam].preferred >= FAMILY_FLOORS[fam], `${fam} preferred ${sb.byFamily[fam].preferred}`);
    }
    for (const i of new Set(svc.store.all().map((c) => c.intent))) assert.ok(sb.byIntent[i], i);
    assert.equal(svc.store.log().at(-1).action, 'eval');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
