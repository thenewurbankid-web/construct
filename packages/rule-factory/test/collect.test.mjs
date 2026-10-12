// cs2 -- the miss collector reads plan feedback, validate findings, decision traces, the reason ledger and the drafter's
// misses into typed miss records, and the share of decisions static code made per step is printed from them. No model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { assertMissRecord, assertStaticShare } from '../contract.mjs';
import { missesFromFindings, missesFromPlanDoc, readPlanMisses, staticShare, missesFromTraces, readTraceMisses, missesFromLedger, readLedgerMisses, missesFromDrafts, missesFromClassified } from '../collect.mjs';
import { createLinePlanService } from '@line/construct-engine/line/plan-service';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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

// cs2 -- decision traces, the reason ledger and the drafter's misses.
const trace = (o) => ({ version: 'decision-trace.v1', id: `dt-${o.n}`, at: '2026-10-12T00:00:00Z', chooser: { id: 'pages-editor.quick-fix', question: 'How should the PAGE-003 violation be fixed?' }, summary: {}, options: ['mechanical', 'ai'], by: 'person', ...o });

test('decision traces: a static suggestion that was chosen and went well is static; an override, an exit and a bad outcome are misses with their kind', () => {
  const rs = missesFromTraces([
    trace({ n: 1, chosen: 'mechanical', suggestion: { option: 'mechanical', reason: 'r' }, provider: { name: 'rules', version: '1' }, outcome: { accepted: true } }),
    trace({ n: 2, chosen: 'ai', suggestion: { option: 'mechanical', reason: 'r' } }),
    trace({ n: 3, chosen: 'exit', suggestion: { option: 'mechanical', reason: 'r' } }),
    trace({ n: 4, chosen: 'mechanical', suggestion: { option: 'mechanical', reason: 'r' }, outcome: { reverted: true } }),
    trace({ n: 5, chosen: 'ai', by: 'decision-model', provider: { name: 'reason', version: '1' }, suggestion: { option: 'ai', reason: 'r' } }),
    { version: 'decision-trace.v1', kind: 'outcome', of: 'dt-1', at: 'x', outcome: {} },
  ]);
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => [r.id, r.decidedBy, r.miss, r.kind, r.correct]), [
    ['trace:dt-1', 'static', false, null, 'mechanical'],
    ['trace:dt-2', 'person', true, 'picked', 'ai'],
    ['trace:dt-3', 'person', true, 'absent', 'none'],
    ['trace:dt-4', 'person', true, 'picked', null],
    ['trace:dt-5', 'model', true, null, null],
  ]);
  assert.deepEqual(rs[1].options, ['mechanical', 'ai']);
  assert.equal(rs[4].staticChoice, null, 'a model provider\'s suggestion is not static code\'s');
});

test('decision traces: read from the state directory, outcomes merged; an unreadable store is a sentence, not a throw', async () => {
  const state = makeTempDir('line-rf-state-');
  const project = makeTempDir('line-rf-proj-');
  const { recordDecisions, recordOutcome } = await import('@line/construct-core/decision-trace-store');
  const summary = { id: 'pages-editor.quick-fix', question: 'How?', options: [{ id: 'mechanical', enabled: true }, { id: 'ai', enabled: true }], chosen: null };
  const rec = recordDecisions(project, [{ chooser: { id: 'pages-editor.quick-fix', question: 'How?' }, summary, chosen: 'ai', by: 'person', suggestion: { option: 'mechanical', reason: 'Rules suggest it.' } }], { stateDir: state });
  assert.equal(rec.recorded, 1, JSON.stringify(rec));
  recordOutcome(project, rec.ids[0], { planValidated: true }, { stateDir: state });
  const r = await readTraceMisses(project, { stateDir: state });
  assert.equal(r.note, null);
  assert.deepEqual(r.records.map((x) => [x.step, x.miss, x.kind, x.correct]), [['pages-editor.quick-fix', true, 'picked', 'ai']]);
});

const entry = (o) => ({ decisionId: `d${o.n}`, requestId: 'req1', stepId: 'gatelm.gapFill', pairId: 'gatelm.gapFill.newName', questionId: 'q', planVersion: '1', project: 'p', key: '0:name', options: ['OrdersBadge', 'StatusBadge'], qwenFavourite: null, jevPick: null, picked: 'OrdersBadge', by: 'order', rounds: 0, agreedFirstTry: true, lowConfidence: false, reasoning: [], rejected: [], ms: { propose: 0, pick: 0, review: 0 }, contextSummary: '', outcome: { verify: 'pass', user: 'accepted' }, at: '2026-10-12T00:00:00Z', ...o });

test('reason ledger: the static rung right is static; a ladder miss, a person\'s change and a model\'s pick are misses with kind and the right option', () => {
  const rs = missesFromLedger([
    entry({ n: 1, ladder: { step: 'static', ms: { static: 1, options: 0, review: 0 } } }),
    entry({ n: 2, ladder: { step: 'static', ms: { static: 1, options: 0, review: 0 } }, outcome: { verify: 'pass', user: 'changed' }, answers: [{ call: { tool: 'gatelm.fill', args: { value: 'StatusBadge' } }, channel: 'chip', who: 'person', at: 'x' }] }),
    entry({ n: 3, ladder: { step: 'jev', ms: { static: 1, options: 1, review: 0 }, miss: { type: 'absent', expected: ['BillingBadge'] } }, by: 'jev' }),
    entry({ n: 4, ladder: { step: 'jev', ms: { static: 1, options: 1, review: 0 } }, by: 'jev' }),
  ], 'gatelm.gapFill.newName/req1.json');
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => [r.decidedBy, r.miss, r.kind, r.correct, r.finalChoice]), [
    ['static', false, null, 'OrdersBadge', 'OrdersBadge'],
    ['person', true, 'picked', 'StatusBadge', 'StatusBadge'],
    ['model', true, 'absent', 'none', 'OrdersBadge'],
    ['model', true, null, null, 'OrdersBadge'],
  ]);
  assert.equal(rs[0].step, 'gatelm.gapFill');
});

test('reason ledger: read <dir>/<pairId>/<requestId>.json; a broken file is skipped and counted; a missing folder is empty', () => {
  const dir = makeTempDir('line-rf-ledger-');
  fs.mkdirSync(path.join(dir, 'gatelm.gapFill.newName'));
  fs.writeFileSync(path.join(dir, 'gatelm.gapFill.newName', 'req1.json'), JSON.stringify({ requestId: 'req1', entries: [entry({ n: 1 })] }));
  fs.writeFileSync(path.join(dir, 'gatelm.gapFill.newName', 'bad.json'), '{');
  const r = readLedgerMisses(dir);
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(readLedgerMisses(path.join(dir, 'nope')), { records: [], skipped: 0 });
});

test('drafter: a train case drafted to its preferred route is static; a miss keeps the slot-form request and the words it could not read', () => {
  const rs = missesFromDrafts([
    { caseId: 'tc-1', request: 'Make <name:N1> in <feature:F1>.', intent: 'add.component', drafted: 'add.component', preferred: true, words: [] },
    { caseId: 'tc-2', request: '<item:I1> should list <number:V1> per page.', intent: 'update.prop', drafted: 'update.prop', preferred: false, words: ['size'] },
  ]);
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => [r.id, r.decidedBy, r.miss, r.kind]), [['drafter:tc-1', 'static', false, null], ['drafter:tc-2', 'none', true, 'picked']]);
  assert.equal(rs[1].sentence, 'The drafter did not read "size".');
  assert.deepEqual(rs[1].context.words, ['size']);
});

test('im1\'s classified misses are a source: chosen is Line\'s choice (staticChoice), correct the right answer; a plan miss cs2 already holds is not counted twice', () => {
  const picked = { id: 'train:tc-9:line.promote', source: 'train', step: 'line.promote', kind: 'picked', options: ['line.promote', 'line.baseOn'], chosen: 'line.baseOn', correct: 'line.promote', correctFrom: 'train-gold', pattern: 'share <component> with <feature> -> line.promote', sentence: 'Line recommended line.baseOn; the gold is line.promote.' };
  const absent = { id: 'plan:p1:s2', source: 'plan', step: 'line.baseOn', kind: 'absent', options: [], chosen: null, correct: 'line.baseOn', correctFrom: 'person', pattern: 'base <component> -> line.baseOn', sentence: 'The person added line.baseOn, which Line did not offer.' };
  const other = { ...absent, id: 'plan:p1:s3' };
  const rs = missesFromClassified([picked, absent, other], ['plan:p1:s2']);
  for (const r of rs) assertMissRecord(r);
  assert.deepEqual(rs.map((r) => r.id), ['miss-report:train:tc-9:line.promote', 'miss-report:plan:p1:s3'], 'plan:p1:s2 is cs2\'s already');
  assert.deepEqual([rs[0].source, rs[0].staticChoice, rs[0].finalChoice, rs[0].kind, rs[0].correct, rs[0].decidedBy], ['miss-report', 'line.baseOn', 'line.promote', 'picked', 'line.promote', 'static']);
  assert.deepEqual([rs[1].decidedBy, rs[1].staticChoice, rs[1].kind], ['person', null, 'absent']);
});
