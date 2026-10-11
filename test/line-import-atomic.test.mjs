// iv2-bugs: two bugs Line Import showed on max-ai-ui's src/subframe-pages/Opportunity, reproduced on
// test/fixtures/line-import-clash.
//   1. applyImport was not all-or-nothing: a step refused late left the earlier steps' files on disk. Now every step is
//      chained in a scratch copy and the net result lands in ONE writer transaction; a refused run leaves the project
//      byte-identical (every file hashed). The Import agent's plan steps land one by one, so it saves the folder before
//      the first one and offers "Undo the import" when a later one is refused.
//   2. A name clash was missed at plan time (Detail.tsx and Detail-v2.tsx both export Detail, and the plan said "Moves
//      Detail into the library" twice). Now planImport catches it, proposes DetailV2 from the file name (recommended, so
//      it is taken unless the person picks another name), and the step sentences name both files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { scanImport, planImport, applyImport } from '../packages/engine/line/import.mjs';
import { assertImportApplyResult, assertImportPlan, assertImportPlanFile, IMPORT_PLAN_FILE, LineOpError } from '../packages/engine/line/contract.mjs';
import { createImportAgentOnDisk, IMPORT_UNDO_FILE } from '../packages/engine/line/importAgentDisk.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'test/fixtures/line-import-clash');
const FOLDER = 'src/opp';
const FROZEN = 'src/opp-frozen';
const CLASH_Q = `name-clash:${FOLDER}/pages/Detail-v2.tsx`;

function copy() {
  const dir = makeTempDir('construct-line-import-atomic-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** Every file under `dir` (relative path -> sha256), skipping `skip` (a relative folder). */
function hashes(dir, skip = null) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip && (r === skip || r.startsWith(`${skip}/`))) continue;
      if (e.isDirectory()) visit(path.join(abs, e.name), r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(abs, e.name))).digest('hex');
    }
  };
  visit(dir, '');
  return out;
}

/** Every folder under `dir` (relative), so a refused run cannot leave an empty library/ behind either. */
function folders(dir) {
  const out = [];
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(r);
      visit(path.join(abs, e.name), r);
    }
  };
  visit(dir, '');
  return out.sort();
}

test('clash: the plan catches Detail.tsx and Detail-v2.tsx both exporting Detail, proposes DetailV2, and names both files', () => {
  const dir = copy();
  const scan = scanImport(dir, FOLDER);
  const q = scan.questions.find((x) => x.id === CLASH_Q);
  assert.ok(q, 'the clash is a question at plan time');
  assert.equal(q.recommended, 'name:DetailV2');
  assert.match(q.sentence, /Detail-v2\.tsx and Detail\.tsx both bring Detail/);
  assert.deepEqual(scan.found.filter((f) => f.kind === 'pages').map((f) => f.name).sort(), ['Detail', 'DetailV2']);
  assert.equal(scan.found.find((f) => f.name === 'DetailV2').confidence, 'ask');

  const plan = planImport(dir, FOLDER, {});
  assertImportPlan(plan);
  const lib = plan.steps.filter((s) => s.tool === 'line.import.toLibrary' && s.args.kind === 'pages');
  assert.deepEqual(lib.map((s) => s.args.name).sort(), ['Detail', 'DetailV2'], 'two different library pages, not Detail twice');
  const v2 = lib.find((s) => s.args.name === 'DetailV2');
  assert.equal(v2.args.exportName, 'Detail', 'the step renames the export too');
  assert.equal(lib.find((s) => s.args.name === 'Detail').args.exportName, undefined);
  for (const s of lib) assert.ok(/Detail\.tsx/.test(s.sentence) && /Detail-v2\.tsx/.test(s.sentence), `names both files: ${s.sentence}`);
  assert.equal(new Set(plan.steps.map((s) => s.sentence)).size, plan.steps.length, 'no two steps say the same thing');
  assert.equal(new Set(plan.steps.map((s) => s.id)).size, plan.steps.length, 'step ids stay unique');
});

test('clash: the recommended name lands; the export, an in-folder user, the old path and the feature item all follow it', () => {
  const dir = copy();
  const outside = hashes(dir, FOLDER);
  const r = applyImport(dir, FOLDER, {});
  assertImportApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.ok(r.steps.every((s) => s.ok));
  const read = (rel) => fs.readFileSync(path.join(dir, FOLDER, rel), 'utf8');
  assert.match(read('library/pages/DetailV2.tsx'), /export function DetailV2\(\)/);
  assert.match(read('library/pages/DetailV2.tsx'), /^DetailV2\.displayName = 'Detail';$/m, 'references follow; the string stays');
  assert.match(read('library/pages/Detail.tsx'), /export function Detail\(\)/);
  assert.match(read('hooks/useNextDetail.ts'), /import \{ DetailV2 as Detail \} from '\.\.\/library\/pages\/DetailV2';/, 'the user keeps its local name');
  assert.match(read('pages/Detail-v2.tsx'), /export \{ DetailV2 as Detail \} from '\.\.\/library\/pages\/DetailV2';/, 'App.tsx still finds Detail at the old path');
  assert.match(read('features/opp/pages/DetailV2.tsx'), /^\/\/ @line-base pages\/DetailV2\n/);
  assert.deepEqual(hashes(dir, FOLDER), outside, 'nothing outside the folder changed');
});

test('clash: the person can pick another name; an invalid or taken name is one sentence and plans nothing', () => {
  const dir = copy();
  const plan = planImport(dir, FOLDER, { [CLASH_Q]: 'name:DetailNext' });
  const step = plan.steps.find((s) => s.tool === 'line.import.toLibrary' && s.args.exportName === 'Detail');
  assert.equal(step.args.name, 'DetailNext');
  assert.ok(plan.steps.some((s) => s.tool === 'line.import.toFeature' && s.args.base === 'pages/DetailNext'));
  for (const bad of ['name:detail', 'name:Detail', 'DetailV3']) {
    assert.throws(() => planImport(dir, FOLDER, { [CLASH_Q]: bad }), (e) => e instanceof LineOpError && e.code === 'BAD_NAME' && /^\S.*\.$/.test(e.sentence), bad);
  }
  const r = applyImport(dir, FOLDER, { [CLASH_Q]: 'name:DetailNext' });
  assert.equal(r.ok, true, r.sentence);
  assert.match(fs.readFileSync(path.join(dir, FOLDER, 'library/pages/DetailNext.tsx'), 'utf8'), /export function DetailNext\(\)/);
});

test('clash: a new item named like one the folder\'s library already holds is caught too', () => {
  const dir = copy();
  assert.equal(applyImport(dir, FOLDER, {}).ok, true);
  fs.mkdirSync(path.join(dir, FOLDER, 'next/pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, FOLDER, 'next/pages/Detail.tsx'), 'export function Detail() {\n  return <main />;\n}\n');
  const scan = scanImport(dir, FOLDER);
  assert.deepEqual(scan.found.map((f) => f.file), [`${FOLDER}/next/pages/Detail.tsx`], 'items already in the library and features are not brought in again');
  const q = scan.questions.find((x) => x.id === `name-clash:${FOLDER}/next/pages/Detail.tsx`);
  assert.ok(q);
  assert.equal(q.recommended, 'name:Detail2');
  assert.match(q.sentence, /the folder already has Detail/);
});

test('all-or-nothing: a step refused late (a frozen library page) leaves the whole project byte-identical', () => {
  const dir = copy();
  const before = hashes(dir);
  const dirsBefore = folders(dir);
  const r = applyImport(dir, FROZEN, {});
  assertImportApplyResult(r);
  assert.equal(r.ok, false);
  assert.match(r.sentence, /^Nothing was saved: Line stopped at ".*", because .*frozen.*\.$/);
  assert.deepEqual(r.files, []);
  assert.deepEqual(/** @type {any} */ (r).landed, []);
  const ok = r.steps.filter((s) => s.ok).length;
  assert.ok(ok >= 2, `the refusal is late: ${ok} steps passed first (mark, Badge)`);
  assert.equal(r.steps.at(-1).ok, false);
  assert.deepEqual(hashes(dir), before, 'every file is byte-identical');
  assert.deepEqual(folders(dir), dirsBefore, 'no folder was created');
});

test('all-or-nothing, plan steps: the Import agent saves the folder first; when a later step is refused, "undo" puts it back', async () => {
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const before = hashes(dir);
  const planService = createLinePlanService({ root: dir, commands: null });
  const agent = createImportAgentOnDisk({ root: dir, folder: FROZEN, planService });
  let v = await agent.start('ui');
  v = await agent.editStep('ui', { action: 'approve-all' });
  for (let i = 0; i < 40 && v.waiting?.for === 'approval'; i += 1) {
    assert.equal((await planService.approve(v.waiting.planStepId, 'ui')).ok, true);
    v = await agent.resume('ui');
  }
  assert.equal(v.waiting?.for, 'answer', v.sentence);
  assert.match(v.waiting.sentence, /frozen/, 'refused by the writer (the frozen page), not by the step\'s arguments');
  assert.ok(v.steps.filter((s) => s.run === 'done').length >= 2, 'earlier steps landed before the refusal');
  assert.ok(fs.existsSync(path.join(dir, FROZEN, 'library/components/Badge.tsx')), 'half-applied until the person decides');
  assert.ok(fs.existsSync(path.join(dir, FROZEN, IMPORT_UNDO_FILE)), 'the folder was saved before the first write');
  const q = v.waiting.question;
  assert.equal(q.recommended, 'undo', 'no typed fix, so undoing the whole import is recommended');
  assert.ok(q.options.some((o) => o.id === 'leave'));
  v = await agent.answer('ui', q.id, 'undo');
  assert.equal(v.state, 'done');
  assert.match(v.sentence, /^Undone: /);
  assert.ok(v.steps.filter((s) => s.run === 'undone').length >= 2);
  // Line's own state stays: the plan session (line/ at the project root) and the import's plan file (<folder>/line/).
  const lineState = (f) => f.startsWith('line/') || f.startsWith(`${FROZEN}/line/`);
  const after = Object.fromEntries(Object.entries(hashes(dir)).filter(([f]) => !lineState(f)));
  assert.deepEqual(after, before, 'every file is back, byte for byte');
  assert.deepEqual(folders(path.join(dir, FROZEN)).filter((d) => d !== 'line' && !d.startsWith('line/')), ['components', 'hooks', 'pages']);
  assert.equal(fs.existsSync(path.join(dir, FROZEN, IMPORT_UNDO_FILE)), false, 'the saved copy goes with the undo');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, FROZEN, IMPORT_PLAN_FILE), 'utf8'));
  assertImportPlanFile(saved);
  assert.equal(saved.undo, 'undone');
  assert.ok(saved.changes.some((c) => c.action === 'undo'));
});
