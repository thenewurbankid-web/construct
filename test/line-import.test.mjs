// Line Import, partial migration (ci1, packages/engine/line/import.mjs) on a temp copy of examples/import-sample: the static
// scan finds the right items and proposals, asks only where two rules disagree, the plan is plan-ready steps, apply lands
// through the writer, nothing outside the folder changes by a single byte, and validate --profile line on the folder shows
// no new errors. The mock (mockImport.mjs) is checked against the real engine so the mock-mode screen says the same thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { scanImport, planImport, applyImport, planImportStep, listImportFolders } from '../packages/engine/line/import.mjs';
import { createMockImport } from '../packages/engine/line/mockImport.mjs';
import { assertImportScan, assertImportPlan, assertImportApplyResult, LineOpError } from '../packages/engine/line/contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/import-sample');
const FOLDER = 'src/alerts';
const TABLE_Q = 'generic-name:src/alerts/components/Table.tsx';

function copy() {
  const dir = makeTempDir('construct-line-import-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

/** Every file under `dir` -> sha256, optionally only those outside `skip`. */
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

/** `construct validate --profile line` on a folder: the errors, as "RULE file". */
function lineErrors(dir) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'packages/cli/construct.mjs'), 'validate', '--profile', 'line', '--dir', dir], { encoding: 'utf8' });
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  const out = [];
  lines.forEach((l, i) => { const m = l.match(/^❌ (\S+)/); if (m) out.push(`${m[1]} ${(lines[i + 1] || '').trim().replace(/:\d+$/, '')}`); });
  return out.sort();
}

test('scan: finds the components, pages, fixture and routes, and proposes library or feature by static rules', () => {
  const dir = copy();
  const scan = scanImport(dir, FOLDER);
  assertImportScan(scan);
  const by = Object.fromEntries(scan.found.map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(by).sort(), ['AlertDetailPage', 'AlertRow', 'AlertsPage', 'SeverityBadge', 'Table', 'alerts']);
  assert.equal(by.SeverityBadge.kind, 'components');
  assert.equal(by.SeverityBadge.proposal.target, 'library', 'used by both pages');
  assert.equal(by.SeverityBadge.proposal.level, 'atom');
  assert.deepEqual(by.SeverityBadge.rules, ['used-by-pages']);
  assert.equal(by.AlertRow.proposal.target, 'feature', 'only the alerts list uses it');
  assert.equal(by.AlertRow.proposal.feature, 'alerts');
  assert.equal(by.AlertRow.proposal.base, 'components/AlertRow');
  assert.equal(by.AlertsPage.kind, 'pages');
  assert.equal(by.AlertsPage.proposal.route, '/alerts', 'read from the react-router table outside the folder');
  assert.equal(by.AlertDetailPage.proposal.route, '/alerts/:id');
  assert.equal(by.alerts.kind, 'fixtures');
  assert.equal(by.alerts.proposal.target, 'library');
  assert.deepEqual(scan.unchanged.map((u) => u.file), ['src/alerts/hooks/useAlerts.ts', 'src/alerts/types.ts']);
  assert.ok(scan.found.every((f) => /^\S.*\.$/.test(f.proposal.sentence) && !/\.tsx?\b/.test(f.proposal.sentence)), 'plain English, no file paths in the sentence');
});

test('questions: one only, where two rules disagree (Table: general UI name vs one page); the answer changes the plan', () => {
  const dir = copy();
  const scan = scanImport(dir, FOLDER);
  assert.deepEqual(scan.questions.map((q) => q.id), [TABLE_Q]);
  assert.equal(scan.questions[0].recommended, 'library');
  assert.deepEqual(scan.found.filter((f) => f.confidence === 'ask').map((f) => f.name), ['Table']);
  const rec = planImport(dir, FOLDER, {});
  const feat = planImport(dir, FOLDER, { [TABLE_Q]: 'feature:alerts' });
  assertImportPlan(rec);
  assertImportPlan(feat);
  assert.ok(!rec.steps.some((s) => s.id.endsWith('feature-Table')));
  assert.ok(feat.steps.some((s) => s.tool === 'line.import.toFeature' && s.args.name === 'Table'));
});

test('plan: plan-ready steps (tool, args, sentence), marking first and feature items last; planning writes nothing', () => {
  const dir = copy();
  const before = hashes(dir);
  const plan = planImport(dir, FOLDER, {});
  assertImportPlan(plan);
  assert.equal(plan.steps[0].tool, 'line.import.mark');
  assert.deepEqual(plan.steps.map((s) => s.tool).slice(-3), ['line.import.toFeature', 'line.import.toFeature', 'line.import.toFeature']);
  assert.ok(plan.steps.filter((s) => s.args.keepShim).every((s) => /outside the folder uses it/.test(s.sentence)), 'kept files say why');
  assert.deepEqual(plan.steps.filter((s) => s.args.keepShim).map((s) => s.args.name).sort(), ['AlertDetailPage', 'AlertsPage'], 'App.tsx imports the two pages');
  assert.deepEqual(hashes(dir), before);
});

test('apply: every step lands through the writer, files outside the folder are byte-for-byte unchanged, and validate shows no new errors', () => {
  const dir = copy();
  const folderAbs = path.join(dir, FOLDER);
  const outside = hashes(dir, FOLDER);
  const errorsBefore = lineErrors(folderAbs);
  const r = applyImport(dir, FOLDER, {});
  assertImportApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.ok(r.files.every((f) => f.startsWith(`${FOLDER}/`)));
  assert.deepEqual(hashes(dir, FOLDER), outside, 'nothing outside the folder changed');
  const read = (rel) => fs.readFileSync(path.join(folderAbs, rel), 'utf8');
  assert.match(read('architecture.yml'), /preset: line/);
  assert.match(read('features/alerts/pages/AlertsPage.tsx'), /^\/\/ @line-base pages\/AlertsPage\n\/\/ @line-route \/alerts\n/);
  assert.match(read('library/components/SeverityBadge.tsx'), /^\/\/ @line-level atom\n/);
  assert.match(read('pages/AlertsPage.tsx'), /export \{ default \} from '\.\.\/library\/pages\/AlertsPage'/, 'App.tsx still finds AlertsPage');
  assert.equal(fs.existsSync(path.join(folderAbs, 'components/AlertRow.tsx')), false, 'nothing outside uses AlertRow, so no old file stays');
  assert.match(read('hooks/useAlerts.ts'), /'\.\.\/library\/fixtures\/alerts\.json'/, 'a file that stays is re-pointed');
  const errorsAfter = lineErrors(folderAbs);
  const added = errorsAfter.filter((e) => !errorsBefore.includes(e));
  assert.deepEqual(added, [], `new errors: ${added.join('; ')}`);
  assert.ok(errorsBefore.some((e) => e.startsWith('LINE-LAYOUT')) && !errorsAfter.some((e) => e.startsWith('LINE-LAYOUT')), 'the folder is now laid out as Line');
});

test('apply with the other answer: Table becomes a feature item based on its library copy', () => {
  const dir = copy();
  const r = applyImport(dir, FOLDER, { [TABLE_Q]: 'feature:alerts' });
  assert.equal(r.ok, true, r.sentence);
  assert.match(fs.readFileSync(path.join(dir, FOLDER, 'features/alerts/components/Table.tsx'), 'utf8'), /^\/\/ @line-base components\/Table\n/);
});

test('refusals: a folder outside the project, a step reaching outside the folder, and a second apply are one sentence and change nothing', () => {
  const dir = copy();
  for (const folder of ['../x', '/etc', '', 'src/nope']) {
    assert.throws(() => scanImport(dir, folder), (e) => e instanceof LineOpError && e.code === 'BAD_FOLDER' && /\.$/.test(e.sentence));
  }
  const all = hashes(dir);
  const step = { id: 'x', tool: 'line.import.toLibrary', args: { folder: FOLDER, from: '../App.tsx', kind: 'components', name: 'App' }, sentence: 'Moves App.' };
  assert.throws(() => planImportStep(path.join(dir, FOLDER), step), (e) => e.name === 'LineOpError');
  assert.throws(() => planImportStep(path.join(dir, FOLDER), { ...step, tool: 'fs.writeFile' }), (e) => e.code === 'UNKNOWN_TOOL');
  assert.deepEqual(hashes(dir), all);
  const first = applyImport(dir, FOLDER, {});
  assert.equal(first.ok, true, first.sentence);
  const again = applyImport(dir, FOLDER, {});
  assert.equal(again.ok, false);
  assert.match(again.sentence, /^[A-Z].*\.$/);
});

test('folders: lists the project\'s folders that hold code', () => {
  const { folders } = listImportFolders(copy());
  assert.deepEqual(folders.map((f) => f.path), ['src', 'src/alerts', 'src/alerts/components', 'src/alerts/hooks', 'src/alerts/pages', 'src/ui']);
});

test('the mock says what the engine says (mock mode shows the real proposals, questions and steps)', () => {
  const dir = copy();
  const mock = createMockImport();
  const real = scanImport(dir, FOLDER);
  const fake = mock.scan({ folder: FOLDER });
  for (const k of ['found', 'questions', 'unchanged', 'routes']) assert.deepEqual(fake[k], real[k], k);
  for (const answers of [{}, { [TABLE_Q]: 'feature:alerts' }]) {
    const a = planImport(dir, FOLDER, answers);
    const b = mock.plan({ folder: FOLDER, answers });
    assert.deepEqual(b, a);
  }
});
