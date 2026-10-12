// #912 refusal loop breaker. Bench run pilot-qwen-7b-r3 (qwen2.5-coder:7b): 189 of 200 turns were the identical refused
// call line.addRoute {"route":"/cart","page":"features/cart/pages/CartPage.tsx"} -> UNKNOWN_ITEM (feature cart and its page
// never existed). (a) the first refusal already leads with the step that makes the page (line.createFeature when the
// feature is missing, else line.baseOn under the same feature, the fitting base first); (b) the 3rd identical refused call
// escalates: it says it was refused 3 times and will not succeed, leads with that step as f1, is logged in calls.jsonl,
// and never offers the refused call back (as a fix or the example); (c) the bench driver stops after 10 identical
// refused calls in a row.
import test from 'node:test';
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { missingPageFixes } from '../packages/engine/line/build.mjs';
import { createRepeatGuard, guardFixes, escalate, callKey, REPEAT_ESCALATE_AT } from '../packages/engine/line/repeatGuard.mjs';
import { createPlanCli } from '../bench/ecommerce/driver/plan-cli.mjs';
import { refusalStreak, flags } from '../bench/ecommerce/driver/qwen-agent.mjs';

const R3 = { route: '/cart', page: 'features/cart/pages/CartPage.tsx' };
const R3_CALL = `line.addRoute ${JSON.stringify(R3)}`;
const DETAIL = 'export function DetailPage() {\n  return <main><h1>Detail</h1></main>;\n}\n';

const project = () => {
  const parent = fs.realpathSync(makeTempDir('line-repeat-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'catalog' });
  assert.equal(r.ok, true, r.sentence);
  const root = /** @type {string} */ (r.dir);
  fs.writeFileSync(path.join(root, 'library/pages/DetailPage.tsx'), DETAIL);
  return { root, parent, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
};
const readLog = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'call');
const offersRefused = (fixes) => (fixes ?? []).some((f) => callKey(f.step) === callKey({ tool: 'line.addRoute', args: R3 }));

test('(a) missingPageFixes: createFeature when the feature is missing; baseOn under the same feature, the fitting base first', () => {
  const { root, done } = project();
  try {
    const none = missingPageFixes(root, '/cart', R3.page);
    assert.equal(none.length, 1);
    assert.equal(none[0].step.tool, 'line.createFeature');
    assert.equal(none[0].step.args.name, 'cart');
    assert.ok(none[0].step.args.story && none[0].step.args.points.length);
    const list = missingPageFixes(root, '/catalog', 'features/catalog/pages/ShelfPage.tsx');
    assert.deepEqual(list.map((f) => f.step.args), [
      { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ShelfPage' },
      { libraryId: 'pages/DetailPage', feature: 'catalog', name: 'ShelfPage' },
    ]);
    const detail = missingPageFixes(root, '/products/:id', 'features/catalog/pages/ProductPage.tsx');
    assert.equal(detail[0].step.args.libraryId, 'pages/DetailPage');
    assert.deepEqual(missingPageFixes(root, '/x', 'library/pages/ListPage.tsx'), []);
  } finally { done(); }
});

test('(a, b) r3 replay through plan-cli: f1 creates the page from the first refusal; the 3rd identical call escalates and is logged', async () => {
  const { root, parent, done } = project();
  try {
    const log = path.join(parent, 'logs', 'calls.jsonl');
    const cli = createPlanCli({ project: root, log, builder: 'test', shadowJev: false });
    const base = await cli.run('add', ['line.baseOn', JSON.stringify({ libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' })], { why: 'The catalog list page.' });
    assert.equal(base.ok, true, base.sentence);
    const outs = [];
    for (let i = 0; i < 4; i += 1) outs.push(await cli.run('add', ['line.addRoute', JSON.stringify(R3)], { why: 'Serve the cart page at the /cart route.' }));
    for (const o of outs) {
      assert.equal(o.code, 'UNKNOWN_ITEM');
      assert.equal(o.fixes[0].step.tool, 'line.createFeature', 'the step that makes the missing feature leads');
      assert.equal(o.fixes[0].step.args.name, 'cart');
      assert.equal(offersRefused(o.fixes), false, 'the refused call is never a fix');
      assert.ok(!o.sentence.includes(`A correct call: ${R3_CALL}`), 'the refused call is never the example');
    }
    assert.doesNotMatch(outs[0].sentence, /^Stop:/);
    assert.doesNotMatch(outs[1].sentence, /^Stop:/);
    assert.match(outs[2].sentence, /^Stop: this exact call was already refused 3 times with UNKNOWN_ITEM and will not succeed if sent again: line\.addRoute \{"route":"\/cart","page":"features\/cart\/pages\/CartPage\.tsx"\}\. Do this instead: f1: line\.createFeature /);
    assert.match(outs[3].sentence, /^Stop: this exact call was already refused 4 times/);
    const calls = readLog(log).filter((c) => c.cmd === 'add' && c.args.tool === 'line.addRoute');
    assert.equal(calls.length, 4);
    assert.equal(calls[1].result.repeat, undefined);
    assert.deepEqual({ ...calls[2].result.repeat, lead: calls[2].result.repeat.lead.step.tool }, { times: 3, at: 3, escalated: true, call: R3_CALL, code: 'UNKNOWN_ITEM', lead: 'line.createFeature' });
    assert.ok(fs.existsSync(path.join(parent, 'logs', 'repeat-state.json')), 'the counts are kept next to calls.jsonl');

    // f1 lands the feature; the same addRoute now leads with baseOn CartPage under cart (the list base).
    const fixed = await cli.run('add', [], { fix: 'f1' });
    assert.equal(fixed.ok, true, fixed.sentence);
    for (let i = 0; i < 2; i += 1) { const ran = await cli.run('run-next'); assert.equal(ran.ok, true, ran.sentence); }
    assert.ok(fs.existsSync(path.join(root, 'features/cart/spec.md')));
    const next = await cli.run('add', ['line.addRoute', JSON.stringify(R3)], { why: 'Serve the cart page at the /cart route.' });
    assert.equal(next.code, 'UNKNOWN_ITEM');
    assert.deepEqual(next.fixes[0].step, { tool: 'line.baseOn', args: { libraryId: 'pages/ListPage', feature: 'cart', name: 'CartPage' } });
    assert.equal(offersRefused(next.fixes), false);
  } finally { done(); }
});

test('(b) the plan service: N is configurable; the Nth identical refusal leads with baseOn when the feature exists', async () => {
  const { root, done } = project();
  try {
    fs.mkdirSync(path.join(root, 'features/cart/pages'), { recursive: true });
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null, repeatAt: 2 });
    const req = { tool: 'line.addRoute', args: R3, why: 'Serve the cart.' };
    const one = /** @type {any} */ (await svc.addStep(req, 'agent'));
    assert.equal(one.repeat, undefined);
    assert.deepEqual(one.fixes[0].step.args, { libraryId: 'pages/ListPage', feature: 'cart', name: 'CartPage' });
    // Same call, its args in another order: still identical.
    const two = /** @type {any} */ (await svc.addStep({ tool: 'line.addRoute', args: { page: R3.page, route: '/cart' }, why: 'Again.' }, 'agent'));
    assert.equal(two.repeat.times, 2);
    assert.match(two.text, /^Stop: this exact call was already refused 2 times with UNKNOWN_ITEM .* Do this instead: f1: line\.baseOn \{"libraryId":"pages\/ListPage","feature":"cart","name":"CartPage"\}/);
    assert.equal(offersRefused(two.fixes), false);
    const picked = /** @type {any} */ (await svc.addStep({ fix: 'f1' }, 'agent'));
    assert.equal(picked.ok, true, picked.text ?? picked.sentence);
  } finally { done(); }
});

test('(b) guard helpers: counts per plan and code; a list with only the refused call gets the create step; an equal example is dropped', () => {
  const g = createRepeatGuard();
  assert.equal(g.at, REPEAT_ESCALATE_AT);
  const req = { tool: 'line.addRoute', args: R3 };
  assert.deepEqual([g.note('p1', req, 'UNKNOWN_ITEM'), g.note('p1', req, 'UNKNOWN_ITEM'), g.note('p2', req, 'UNKNOWN_ITEM'), g.note('p1', req, 'TYPE_ERROR')], [1, 2, 1, 1]);
  const kept = {}; const s = createRepeatGuard({ store: { get: () => kept.v, set: (v) => { kept.v = v; } }, at: 5 });
  s.note('p', req, 'X'); assert.equal(createRepeatGuard({ store: { get: () => kept.v, set: () => {} } }).note('p', req, 'X'), 2, 'counts survive a new process');
  const { root, done } = project();
  try {
    const same = [{ ref: 'f1', step: { tool: 'line.addRoute', args: { ...R3 } } }];
    assert.deepEqual(guardFixes(root, req, 'UNKNOWN_ITEM', 1, same), [], 'below N: the refused call is still dropped');
    const out = guardFixes(root, req, 'UNKNOWN_ITEM', 3, same);
    assert.equal(out.length, 1);
    assert.equal(out[0].step.tool, 'line.createFeature');
    assert.equal(out[0].ref, 'f1');
    const r = escalate({ ok: false, code: 'UNKNOWN_ITEM', sentence: 'No page.', text: `Refused (UNKNOWN_ITEM): No page.\nA correct call: ${R3_CALL}`, hint: { example: R3_CALL } }, req, 1);
    assert.doesNotMatch(r.text, /A correct call/);
    assert.equal(r.repeat, undefined);
    const none = escalate({ ok: false, code: 'UNKNOWN_ITEM', sentence: 'No page.', text: 'Refused (UNKNOWN_ITEM): No page.', hint: {} }, req, 3);
    assert.match(none.text, /^Stop: .* Do not send it again/);
    assert.equal(none.repeat.lead, null);
  } finally { done(); }
});

test('(c) bench driver: stops after --max-repeat-refusals identical refused calls in a row (default 10)', () => {
  assert.equal(flags([]).maxRepeatRefusals, 10);
  assert.equal(flags(['--max-repeat-refusals', '4']).maxRepeatRefusals, 4);
  const refused = { ok: false, code: 'UNKNOWN_ITEM' };
  const s = refusalStreak(10);
  for (let i = 1; i <= 9; i += 1) { assert.equal(s.see('plan_add', { tool: 'line.addRoute', args: R3 }, refused), i); assert.equal(s.hit, false); }
  s.see('plan_add', { args: R3, tool: 'line.addRoute' }, refused);
  assert.equal(s.hit, true, 'the 10th identical refused call stops the run (key order does not matter)');
  const t = refusalStreak(3);
  t.see('plan_add', { a: 1 }, refused); t.see('plan_add', { a: 1 }, refused);
  t.see('plan_status', {}, { ok: true });
  t.see('plan_add', { a: 1 }, refused); t.see('plan_add', { a: 2 }, refused);
  assert.equal(t.count, 1, 'an accepted call or a different call starts the count again');
  t.see('plan_add', { a: 2 }, { ok: false, code: 'TYPE_ERROR' });
  assert.equal(t.count, 1, 'another refusal code is another call');
  assert.equal(refusalStreak(0).see('x', {}, refused) && refusalStreak(0).hit, false);
});
