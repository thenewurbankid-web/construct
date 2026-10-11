// cs2 (scaffold) -- the miss collector reads plan feedback and validate findings into typed miss records, and the
// share of decisions static code made per step is printed from them. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertMissRecord, assertStaticShare } from '../packages/rule-factory/contract.mjs';
import { missesFromFindings, missesFromPlanDoc, readPlanMisses, staticShare } from '../packages/rule-factory/collect.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'examples/line-sample');
const SCRIPT = path.join(ROOT, 'packages/rule-factory/static-share.mjs');
const copy = () => { const dir = makeTempDir('line-rf-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };

const step = (o) => ({ kind: 'write', addedBy: 'user', args: {}, ...o });
const DOC = {
  session: { id: 'ses-cockpit' },
  plans: [{
    id: 'plan-1',
    steps: [
      step({ id: 's1', n: 1, tool: 'line.baseOn', status: 'done', result: { needsYou: false } }),
      step({ id: 's2', n: 2, tool: 'line.baseOn', status: 'done', result: { needsYou: true, options: [{ id: 'fix', fixId: 'promote', recommended: true, step: { tool: 'line.promote', args: { featureItemId: 'a' } } }, { id: 'fix', fixId: 'move', recommended: false, step: { tool: 'line.moveFile', args: { from: 'a', to: 'b' } } }] } }),
      step({ id: 's3', n: 3, tool: 'line.moveFile', status: 'done', args: { from: 'a', to: 'b', fixOf: 's2' }, result: { needsYou: false } }),
      step({ id: 's4', n: 4, tool: 'line.promote', status: 'failed' }),
      step({ id: 's5', n: 5, tool: 'line.promote', status: 'done', addedBy: 'jev', result: { needsYou: false } }),
      step({ id: 's6', n: 6, tool: 'line.promote', status: 'planned' }),
      step({ id: 's7', n: 7, tool: 'line.project', kind: 'read', status: 'done' }),
      step({ id: 's8', n: 8, tool: 'line.leaveAsIs', status: 'done', args: { stepId: 's2' } }),
    ],
  }],
};

test('plan feedback: each finished write step is one record; a passed step is static, a step that needed the person, failed or came from a model is a miss', () => {
  const rs = missesFromPlanDoc(DOC, 'line/plans/ses-cockpit.json');
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => [r.id, r.step, r.decidedBy, r.miss, r.finalChoice]), [
    ['plan:plan-1:s1', 'line.baseOn', 'static', false, 'pass'],
    ['plan:plan-1:s2', 'line.baseOn', 'person', true, 'leave'],
    ['plan:plan-1:s3:fix', 'line.baseOn fix choice', 'person', true, 'move'],
    ['plan:plan-1:s3', 'line.moveFile', 'static', false, 'pass'],
    ['plan:plan-1:s4', 'line.promote', 'none', true, null],
    ['plan:plan-1:s5', 'line.promote', 'model', true, 'pass'],
  ]);
  assert.equal(rs[2].staticChoice, 'promote', 'static ranked promote first; the person chose move');
  assert.equal(rs[1].sentence, 'Step 2 needed the person, who chose to leave it as it is.');
});

test('validate findings: a finding with a typed fix ranked first is static; one without is a miss', () => {
  const rs = missesFromFindings([
    { rule: 'LINE-DIR', file: 'features/billing/pages/InvoicesPage.tsx', line: 4, key: 'LINE-DIR|features/billing/pages/InvoicesPage.tsx|4', fixes: [{ id: 'promote', rank: 1, step: { tool: 'line.promote' } }] },
    { rule: 'LINE-BASE', file: 'features/billing/components/InvoiceCard.tsx', line: 1 },
  ]);
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => [r.step, r.decidedBy, r.miss, r.staticChoice]), [['validate LINE-DIR', 'static', false, 'promote'], ['validate LINE-BASE', 'none', true, null]]);
});

test('static share: per step and for all steps, as a count, a share and a sentence', () => {
  const shares = staticShare(missesFromPlanDoc(DOC, 'x.json'));
  for (const s of shares) assertStaticShare(s);
  assert.deepEqual(shares.map((s) => [s.step, s.byStatic, s.total]), [['line.baseOn', 1, 2], ['line.baseOn fix choice', 0, 1], ['line.moveFile', 1, 1], ['line.promote', 0, 2], ['all', 2, 6]]);
  assert.equal(shares[0].sentence, 'Static code decided 1 of 2 (50%).');
  assert.deepEqual(staticShare([]), [{ step: 'all', total: 0, byStatic: 0, share: 0, sentence: 'Static code decided 0 of 0 (0%).' }]);
});

test('end to end on the Line sample: a real approved Base on step and the two planted findings give the share per step', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir });
  const added = await svc.addStep({ tool: 'line.baseOn', args: { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' } }, 'ui');
  await svc.approve(added.stepId, 'ui');
  await svc.runNext('ui');
  const plan = readPlanMisses(dir);
  assert.deepEqual(plan.map((r) => [r.step, r.decidedBy, r.miss]), [['line.baseOn', 'static', false]]);
  fs.writeFileSync(path.join(dir, 'line/plans/broken.json'), '{ not json');
  assert.equal(readPlanMisses(dir).length, 1, 'a broken plan file is skipped, not fatal');
  const out = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Share decided by static code, per step, in .* \(3 decisions\):$/m);
  assert.match(out.stdout, /^ {2}line\.baseOn: Static code decided 1 of 1 \(100%\)\.$/m);
  assert.match(out.stdout, /^ {2}validate LINE-DIR: Static code decided 1 of 1 \(100%\)\.$/m);
  assert.match(out.stdout, /^ {2}All steps: Static code decided \d of 3 \(\d+%\)\.$/m);
  const json = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(json.records, 3);
  const f = path.join(dir, 'findings.json');
  fs.writeFileSync(f, JSON.stringify({ violations: [{ rule: 'LINE-BASE', file: 'a.tsx', line: 1 }] }));
  const viaFile = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--findings', f], { encoding: 'utf8' });
  assert.match(viaFile.stdout, /validate LINE-BASE: Static code decided 0 of 1 \(0%\)\./);
});
