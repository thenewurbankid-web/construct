// Experiment fix 1 -- a typed fix for a refused change can name a file only that change creates (move OrderButton to
// library/OrderButton.tsx: the fix "move it into library/components/" names library/OrderButton.tsx, which is not on
// disk). The fix step then carries the refused change and the fix as ONE line.amend step, applied atomically through
// applyChange: one approval, the finding gone, the refused step done. Runs on copies of examples/line-sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLinePlanService, loadPlanApi } from '../packages/engine/line/planService.mjs';
import { runChange, previewStep } from '../packages/engine/line/planTools.mjs';
import { planAmended, amendFixes, planStep, withFixes, onScratch } from '../packages/engine/line/fixes.mjs';
import { planMoveFile } from '../packages/engine/line/ops.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { toFinding } from '../packages/engine/line/model.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const copy = () => { const dir = makeTempDir('line-amend-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const MISSING_LINK = { env: { ...process.env, LINE_SOURCE_DIR: path.join(makeTempDir('no-source-'), 'nope') } };
const staticLoad = (o) => loadPlanApi({ ...o, linkOptions: MISSING_LINK });
const FROM = 'features/orders/components/OrderButton.tsx';
const TOP = 'library/OrderButton.tsx';
const DEST = 'library/components/OrderButton.tsx';
const REFUSED = { tool: 'line.moveFile', args: { from: FROM, to: TOP } };

test('planAmended: the refused move and its fix plan as one change; the file the refused change created and the fix moved again is left out', () => {
  const dir = copy();
  const first = planMoveFile(dir, REFUSED.args);
  assert.throws(() => planStep(dir, { tool: 'line.moveFile', args: { from: TOP, to: DEST } }), /There is no file/, 'the fix cannot run on its own');
  const one = planAmended(dir, first, { tool: 'line.moveFile', args: { from: TOP, to: DEST } });
  const paths = one.files.map((f) => f.path);
  assert.ok(paths.includes(DEST) && one.files.find((f) => f.path === DEST).content);
  assert.equal(one.files.find((f) => f.path === FROM).content, null, 'the original file is removed');
  assert.ok(!paths.includes(TOP), 'library/OrderButton.tsx never touches the disk');
  assert.match(one.summary, /^Moves OrderButton\.tsx to library\/.*, and in the same step moves OrderButton\.tsx to library\/components\//);
  const users = one.files.filter((f) => f.content && f.path !== DEST);
  assert.ok(users.length > 0 && users.every((f) => f.content.includes('library/components/OrderButton')), 'every user points at the final place');
});

test('amendFixes: only a fix whose file the refused change creates becomes a line.amend step; a fix that runs alone is kept', () => {
  const dir = copy();
  const staged = planMoveFile(dir, REFUSED.args);
  const findings = onScratch(dir, staged, (s) => withFixes(s, validateLine(s).violations.map(toFinding)));
  const layout = findings.find((f) => f.rule === 'LINE-LAYOUT' && f.file === TOP);
  assert.ok(layout, 'the refused change has a LINE-LAYOUT finding on its own new file');
  const out = amendFixes(dir, REFUSED, staged, findings);
  const fixed = out.find((f) => f.rule === 'LINE-LAYOUT' && f.file === TOP).fixes[0];
  assert.deepEqual(fixed.step, { tool: 'line.amend', args: { change: REFUSED, fix: { tool: 'line.moveFile', args: { from: TOP, to: DEST } } } });
  assert.match(fixed.sentence, /together with the change Construct refused, in one step\.$/);
  // A fix that runs on the project as it is stays a plain step (the setFragment refusal in line-plan.test.mjs keeps its
  // line.promote fix); here: a refused change that creates nothing, with a fix on a file on disk.
  const plain = [{ rule: 'LINE-DIR', file: 'features/billing/pages/InvoicesPage.tsx', line: 4, severity: 'error', sentence: 'X.', fixes: [{ id: 'LINE-DIR/promote', rank: 1, sentence: 'Promote.', step: { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } } }] }];
  assert.deepEqual(amendFixes(dir, { tool: 'line.setBase', args: {} }, { summary: 'S.', files: [] }, plain), plain);
});

test('runChange: the refused move is "needs a fix" and its recommended fix is one line.amend step that previews as one change', () => {
  const dir = copy();
  const r = runChange(dir, 'line.moveFile', REFUSED.args);
  assert.equal(r.apply.ok, false);
  assert.equal(exists(dir, TOP), false, 'nothing written');
  const rec = r.options.find((o) => o.id === 'fix' && o.recommended);
  assert.equal(rec.step.tool, 'line.amend', JSON.stringify(r.options));
  const staged = previewStep(dir, rec.step.tool, rec.step.args);
  assert.ok(staged.files.some((f) => f.path === DEST));
});

test('plan service: the recommended fix applies in one approval, the finding is gone and the refused step counts as done', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const added = await svc.addStep(REFUSED, 'ui');
  assert.equal(added.ok, true, added.sentence);
  await svc.approve(added.stepId, 'ui');
  const step = (await svc.runNext('ui')).steps.find((s) => s.id === added.stepId);
  assert.equal(step.state, 'needs-fix', step.sentence);
  assert.equal(exists(dir, TOP), false);
  const rec = step.result.options.find((o) => o.id === 'fix' && o.recommended);
  assert.equal(rec.step.tool, 'line.amend');
  const fix = await svc.addStep({ tool: rec.step.tool, args: { ...rec.step.args, fixOf: added.stepId } }, 'agent');
  assert.equal(fix.ok, true, fix.sentence);
  assert.equal((await svc.approve(fix.stepId, 'agent')).ok, false, 'an agent cannot approve it');
  const approved = await svc.approve(fix.stepId, 'ui');
  assert.equal(approved.ok, true, approved.sentence);
  const after = await svc.runNext('ui');
  const ran = after.steps.find((s) => s.id === fix.stepId);
  assert.equal(ran.state, 'done', ran.sentence);
  assert.equal(after.steps.find((s) => s.id === added.stepId).state, 'done', 'the refused step is resolved by its amended fix');
  assert.match(after.steps.find((s) => s.id === added.stepId).sentence, /Saved together with its fix in step 2\./);
  assert.ok(exists(dir, DEST) && !exists(dir, TOP) && !exists(dir, FROM));
  const left = validateLine(dir).violations;
  assert.equal(left.some((v) => v.rule === 'LINE-LAYOUT'), false, 'the LINE-LAYOUT finding is gone');
  assert.equal(left.some((v) => v.file === DEST), false, 'the moved file is clean');
});

test('line.amend refuses a change that is not a Line change, in one sentence', async () => {
  const dir = copy();
  const svc = createLinePlanService({ root: dir, commands: null, load: staticLoad });
  const r = await svc.addStep({ tool: 'line.amend', args: { change: { tool: 'line.project', args: {} }, fix: { tool: 'line.moveFile', args: { from: TOP, to: DEST } } } }, 'agent');
  assert.equal(r.ok, false);
  assert.equal(r.sentence, '"line.project" is not a Line change, so it cannot be amended.');
});
