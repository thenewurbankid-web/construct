// Train Line, real engine: imaginary worlds pass the line profile, the committed seed is verified and delexicalized,
// "Try it" runs Construct in a scratch copy only, the store logs who changed what, only the owner reviews, and eval
// scores held-out worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTENT_IDS, assertTrainCase, assertDelexicalized, assertScoreboard, assertTryResult } from '../packages/engine/line/train/contract.mjs';
import { WORLD_IDS, HELDOUT_FROM, isHeldOut, materialize, SAMPLE_DIR } from '../packages/engine/line/train/corpus.mjs';
import { factsOf } from '../packages/engine/line/train/facts.mjs';
import { worldFacts } from '../packages/engine/line/train/generate.mjs';
import { tryRoute } from '../packages/engine/line/train/verify.mjs';
import { normalize, buildDomainMap } from '../packages/engine/line/train/slots.mjs';
import { createTrainService, worldIdentifiers } from '../packages/engine/line/train/service.mjs';
import { CASES, LOG } from '../packages/engine/line/train/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SEED = path.join(REPO, 'line');
const seed = fs.readFileSync(path.join(SEED, CASES), 'utf8').split('\n').filter(Boolean);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-train-test-')));
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

test('seed: a few hundred cases, every one in the contract shape, every intent covered, several routes where a request has them', () => {
  assert.ok(seed.length >= 300, `${seed.length} cases`);
  const cases = seed.map((l) => JSON.parse(l));
  cases.forEach(assertTrainCase);
  for (const i of INTENT_IDS) assert.ok(cases.some((c) => c.intent === i), `intent ${i}`);
  for (const i of ['add.component', 'add.page', 'share.item', 'fix.problem']) assert.ok(cases.some((c) => c.intent === i && c.gold.routes.length > 1), `multi-route ${i}`);
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
  const refuse = cases.find((c) => c.intent === 'refuse.not-possible');
  const r = tryRoute({ world: refuse.world, slots: refuse.slots, route: refuse.gold.routes[0] });
  assert.equal(r.ok, true, r.sentence);
  assert.match(r.sentence, /^Construct refused it as expected/);
  const ask = cases.find((c) => c.intent === 'ask.missing-detail');
  const q = tryRoute({ world: ask.world, slots: ask.slots, route: ask.gold.routes[0] });
  assert.equal(q.ok, true);
  assert.match(q.sentence, /^Line must ask first: /);
  assert.equal(treeHash(SAMPLE_DIR), before, 'examples/line-sample is byte-identical');
});

test('domain map: names become slots; a near miss offers "Did you mean"; the answer becomes a synonym of that world', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root });
    const map = buildDomainMap(worldFacts({ kind: 'sample' }));
    const n = normalize('Change the title of OrdersPage to "My orders".', map);
    assert.equal(n.request, 'Change the title of <item:I1> to "<text:T1>".');
    assert.deepEqual(n.slots.T1, { type: 'text', of: 'F1', role: 'my' });
    const typo = normalize('Add a Badge to ordrs.', map);
    assert.deepEqual(typo.unknown, [{ word: 'ordrs', choices: [{ ref: 'feature#1', name: 'orders' }] }]);
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
    const c = svc.propose({ world: 'sample', request: 'billing should use OrderButton from orders too.', intent: 'share.item', routes: [{ label: 'Through the library', steps: [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }] }] }).case;
    assert.equal(c.labelledBy, 'claude');
    assert.equal(c.status, 'draft');
    assert.equal(c.request, '<feature:F1> should use <item:I1> from <feature:F2> too.');
    assert.equal(c.filled.routes[0].steps[0].sentence, 'Move OrderButton from orders into the library.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('eval: drafts every held-out case from the train split only and scores recall, precision and the preferred route per family and intent', () => {
  const root = tmp();
  try {
    const svc = createTrainService({ root, seedFrom: SEED });
    const before = svc.scoreboard();
    assert.equal(before.lastRun, null);
    const sb = svc.runEval();
    assertScoreboard(sb);
    assert.ok(sb.lastRun);
    assert.ok(sb.total.heldout >= 50);
    assert.ok(sb.total.recall > 0.5, `recall ${sb.total.recall}`);
    for (const fam of ['line.baseOn', 'line.promote', 'line.setPageProp', 'line.setFragment', 'line.fix', 'none']) assert.ok(sb.byFamily[fam]?.heldout > 0, fam);
    for (const i of INTENT_IDS) assert.ok(sb.byIntent[i], i);
    assert.equal(svc.store.log().at(-1).action, 'eval');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
