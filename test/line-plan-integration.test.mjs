// Integration of cp1 (plan), ca2 (fixes) and ci1 (import), owner decisions 11 Oct: every client write is a plan step.
// (a) Import's steps are plan tools in the one registry and run one by one after the person's approval; (c) when a fix
// for a refused step lands, the refused step is re-checked (planned again, dry-run through the writer) and, when it
// would land now, waits for approval again. Real engine operations on copies of the examples, built-in plan store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { planImport, applyImport } from '../packages/engine/line/import.mjs';
import { checkChange, planPromote } from '../packages/engine/line/ops.mjs';
import { listFragments } from '../packages/engine/line/fragments.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copyOf = (example) => { const dir = makeTempDir('line-plan-int-'); fs.cpSync(path.join(REPO, 'examples', example), dir, { recursive: true }); return dir; };
const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const service = (root) => createLinePlanService({ root, commands: null, load: (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK }) });

/** Every file under `dir` (but Line state: the plan store's line/plans, the session traces in line/traces and the plan records in line/records) -> sha256. */
function hashes(dir) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === 'line/plans' || r === 'line/traces' || r === 'line/records' || r === 'line/memory') continue;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(abs, e.name))).digest('hex');
    }
  };
  visit(dir, '');
  return out;
}

test('checkChange: says whether the writer would land a change, and writes nothing either way', () => {
  const dir = copyOf('line-sample');
  const before = hashes(dir);
  const refused = checkChange(dir, planPromote(dir, { featureItemId: 'billing/pages/InvoicesPage' }));
  assert.equal(refused.ok, false);
  assert.match(refused.sentence, /^Nothing would be saved: the library file "library\/pages\/InvoicesPage\.tsx" imports/);
  const fine = checkChange(dir, planPromote(dir, { featureItemId: 'orders/components/OrderButton' }));
  assert.equal(fine.ok, true, fine.sentence);
  assert.deepEqual(hashes(dir), before, 'a dry run never writes');
});

test('(c) a refused step whose fix landed plans clean again and waits for the person\'s approval; approving it lands it', async () => {
  const dir = copyOf('line-sample');
  const svc = service(dir);
  const added = await svc.addStep({ tool: 'line.promote', args: { featureItemId: 'billing/pages/InvoicesPage' } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  const refused = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);
  assert.equal(refused.state, 'needs-fix');
  const fix = refused.result.options.find((o) => o.id === 'fix' && o.recommended);
  const fixStep = await svc.addStep({ tool: fix.step.tool, args: { ...fix.step.args, fixOf: added.stepId } }, 'ui');
  await svc.approve(fixStep.stepId, 'ui');
  const after = await svc.runNext('ui', fixStep.stepId);
  assert.equal(after.recheck, 'The fix landed, and step 1 plans clean now: it waits for your approval again.');
  assert.deepEqual(after.steps.map((s) => [s.n, s.state]), [[1, 'done'], [2, 'done'], [3, 'waiting']]);
  assert.equal(after.steps[0].sentence, 'Tried again as step 3.');
  assert.match(after.steps[2].sentence, /^Waiting for your approval: Try step 1 again: moves InvoicesPage/);
  assert.equal(fs.existsSync(path.join(dir, 'library/pages/InvoicesPage.tsx')), false, 'the re-check wrote nothing');
  await svc.approve(after.steps[2].id, 'ui');
  const landed = (await svc.runNext('ui')).steps[2];
  assert.equal(landed.state, 'done', landed.sentence);
  assert.equal(fs.existsSync(path.join(dir, 'library/pages/InvoicesPage.tsx')), true);
});

test('(c) a fix that lands but does not clear the refusal leaves the step needing a fix, with one sentence why', async () => {
  const dir = copyOf('line-sample');
  const svc = service(dir);
  const file = 'features/orders/pages/OrdersPage.tsx';
  const list = listFragments(dir, file);
  const added = await svc.addStep({ tool: 'line.setFragment', args: { file, fragmentId: list.fragments[0].id, code: "() => import('../../billing/components/InvoiceCard')", contentHash: list.contentHash } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  const refused = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);
  const fix = refused.result.options.find((o) => o.id === 'fix' && o.recommended);
  const fixStep = await svc.addStep({ tool: fix.step.tool, args: { ...fix.step.args, fixOf: added.stepId } }, 'ui');
  await svc.approve(fixStep.stepId, 'ui');
  const after = await svc.runNext('ui', fixStep.stepId);
  assert.match(after.recheck, /^The fix landed, but step 1 still cannot land: feature "orders" imports/);
  assert.deepEqual(after.steps.map((s) => [s.n, s.state]), [[1, 'needs-fix'], [2, 'done']]);
});

test('(a) Import through the plan: its steps join the plan, run after approval, and land exactly what applyImport lands', async () => {
  const folder = 'src/alerts';
  const viaPlan = copyOf('import-sample');
  const direct = copyOf('import-sample');
  const plan = planImport(viaPlan, folder, {});
  const svc = service(viaPlan);
  const ids = [];
  for (const s of plan.steps) {
    const r = await svc.addStep({ tool: s.tool, args: s.args, why: s.sentence }, 'ui');
    assert.equal(r.ok, true, r.sentence);
    ids.push(r.stepId);
  }
  const waiting = await svc.view();
  assert.ok(waiting.steps.every((s) => s.state === 'waiting'), 'nothing runs before approval');
  assert.match(waiting.steps[1].gap[0].sentence, /^To do when it runs/);
  assert.equal(fs.existsSync(path.join(viaPlan, folder, 'architecture.yml')), false, 'adding the steps wrote nothing');
  for (const id of ids) await svc.approve(id, 'ui');
  for (const id of ids) {
    const step = (await svc.runNext('ui', id)).steps.find((s) => s.id === id);
    assert.equal(step.state, 'done', step.sentence);
    assert.ok(step.result.apply.files.every((f) => f.startsWith(`${folder}/`)), 'paths are project-relative, inside the folder');
  }
  assert.equal(applyImport(direct, folder, {}).ok, true);
  assert.deepEqual(hashes(viaPlan), hashes(direct));
});

test('(a) an import step for a folder outside the project, or an agent approving one, is refused and changes nothing', async () => {
  const dir = copyOf('import-sample');
  const svc = service(dir);
  const before = hashes(dir);
  const out = await svc.addStep({ tool: 'line.import.mark', args: { folder: '../elsewhere', features: ['x'] } }, 'agent');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'BAD_ARGS');
  const step = await svc.addStep({ tool: 'line.import.mark', args: { folder: 'src/alerts', features: ['alerts'] } }, 'agent');
  assert.equal(step.ok, true, step.sentence);
  assert.equal((await svc.approve(step.stepId, 'agent')).ok, false, 'only a person approves a write');
  assert.deepEqual(hashes(dir), before);
});
