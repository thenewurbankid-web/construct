// ca2: every LINE-* finding carries typed fixes (packages/engine/line/fixes.mjs). For every rule: a temp copy of
// examples/line-sample with one planted violation; the finding has a fix with a sentence; the top fix, applied through
// applyChange (Construct's writer), removes that finding and adds none. Rules with no safe mechanical fix get one
// advice fix (step null) and are listed as gaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { assertFinding, assertStagedChange, assertApplyResult, LineOpError } from '../packages/engine/line/contract.mjs';
import { lineFindings, readLineProject } from '../packages/engine/line/model.mjs';
import { planFix, applyFix, fixesFor, findingKey } from '../packages/engine/line/fixes.mjs';
import { applyChange } from '../packages/engine/line/ops.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'examples/line-sample');

/** A temp copy of the sample with `files` planted (content null deletes). */
function project(files = {}, { from = SAMPLE } = {}) {
  const dir = makeTempDir('construct-line-fixes-');
  if (from) fs.cpSync(from, dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (content === null) { fs.rmSync(abs, { force: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** validate --profile line, as identities that survive a line shift. */
const problems = (dir) => validateLine(dir).violations.map((v) => `${v.rule}|${v.file}|${v.message}`).sort();

/** The one finding of `rule` in `file`, with its fixes checked against the contract. */
function findingOf(dir, rule, file) {
  const all = lineFindings(dir);
  all.forEach((f, i) => assertFinding(f, `findings[${i}]`));
  const f = all.find((x) => x.rule === rule && x.file === file);
  assert.ok(f, `${rule} is reported on ${file}: ${JSON.stringify(all.map((x) => `${x.rule} ${x.file}`))}`);
  assert.ok(f.fixes.length >= 1, 'it carries at least one fix');
  assert.equal(f.key, findingKey(f));
  return f;
}

/** Apply the top fix through the writer; the finding is gone and nothing new appears. */
function applyTop(dir, finding) {
  const before = problems(dir);
  const top = finding.fixes[0];
  assert.equal(top.rank, 1);
  assert.ok(top.step, `the top fix is a step: ${top.sentence}`);
  const change = planFix(dir, finding, top.id);
  assertStagedChange(change);
  const r = applyChange(dir, change);
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  const after = problems(dir);
  const gone = before.filter((p) => !after.includes(p));
  assert.ok(gone.some((p) => p.startsWith(`${finding.rule}|${finding.file}|`)), `the ${finding.rule} finding is gone`);
  assert.deepEqual(after.filter((p) => !before.includes(p)), [], 'no new finding appears');
  return { change, after };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('LINE-BASE: a feature item with no base gets one fix (the library item it already imports), and it writes the header', () => {
  const dir = project();
  const f = findingOf(dir, 'LINE-BASE', 'features/billing/components/InvoiceCard.tsx');
  assert.deepEqual(f.fixes.map((x) => x.id), ['LINE-BASE/set-base:components/Card'], 'exactly one fits, so one fix');
  assert.deepEqual(f.fixes[0].step, { tool: 'line.setBase', args: { file: 'features/billing/components/InvoiceCard.tsx', libraryId: 'components/Card' } });
  applyTop(dir, f);
  assert.match(read(dir, 'features/billing/components/InvoiceCard.tsx'), /^\/\/ @line-base components\/Card\nimport \{ Card \}/);
});

test('LINE-BASE: two base links -> keep one valid link; a JSON fixture with no base -> "$lineBase" set; broken JSON -> advice only', () => {
  const two = project({ 'features/orders/components/OrderCard.tsx': `// @line-base components/Card\n// @line-base components/Badge\n${read(SAMPLE, 'features/orders/components/OrderCard.tsx').split('\n').slice(1).join('\n')}` });
  const f2 = findingOf(two, 'LINE-BASE', 'features/orders/components/OrderCard.tsx');
  assert.deepEqual(f2.fixes.map((x) => x.id), ['LINE-BASE/set-base:components/Card', 'LINE-BASE/set-base:components/Badge']);
  applyTop(two, f2);
  assert.equal((read(two, 'features/orders/components/OrderCard.tsx').match(/@line-base/g) || []).length, 1);

  const json = project({ 'features/orders/fixtures/buyer.json': '{\n  "id": "u2"\n}\n' });
  const fj = findingOf(json, 'LINE-BASE', 'features/orders/fixtures/buyer.json');
  assert.equal(fj.fixes[0].id, 'LINE-BASE/set-base:fixtures/user');
  applyTop(json, fj);
  assert.deepEqual(JSON.parse(read(json, 'features/orders/fixtures/buyer.json')), { $lineBase: 'fixtures/user', id: 'u2' });

  const broken = project({ 'features/orders/fixtures/buyer.json': '{ "id": ' });
  const fb = findingOf(broken, 'LINE-BASE', 'features/orders/fixtures/buyer.json');
  assert.deepEqual(fb.fixes.map((x) => [x.id, x.step]), [['LINE-BASE/fix-json', null]], 'gap: broken JSON has no safe fix');
});

test('LINE-DIR: a cross-feature import gets one fix, promote the imported item, and applying it re-points the import', () => {
  const dir = project();
  const f = findingOf(dir, 'LINE-DIR', 'features/billing/pages/InvoicesPage.tsx');
  assert.deepEqual(f.fixes.map((x) => [x.id, x.step?.tool]), [['LINE-DIR/promote', 'line.promote']]);
  assert.deepEqual(f.fixes[0].step.args, { featureItemId: 'orders/components/OrderButton' });
  applyTop(dir, f);
  assert.ok(fs.existsSync(path.join(dir, 'library/components/OrderButton.tsx')));
});

test('LINE-OWNER: a page outside every feature moves into library/pages with its imports re-pointed', () => {
  const page = "import { ListPage } from '../../library/pages/ListPage';\n\nexport function HomePage() {\n  return <ListPage title=\"Home\" />;\n}\n";
  const dir = project({ 'screens/pages/HomePage.tsx': page });
  const f = findingOf(dir, 'LINE-OWNER', 'screens/pages/HomePage.tsx');
  assert.equal(f.fixes[0].id, 'LINE-OWNER/move-to-library', 'two features: no single owner to guess, so the library page is the likely fix');
  assert.ok(f.fixes.some((x) => x.id === 'LINE-OWNER/move-to-feature:orders:pages/ListPage'), 'moving into a feature is offered too');
  applyTop(dir, f);
  assert.match(read(dir, 'library/pages/HomePage.tsx'), /from '\.\/ListPage'/);
});

test('LINE-OWNER: a page in a feature outside pages/ moves into its pages/ with a page base; route and framework pages are advice only', () => {
  const page = "import { ListPage } from '../../../library/pages/ListPage';\n\nexport function Summary() {\n  return <ListPage title=\"Summary\" />;\n}\n";
  const dir = project({ 'features/orders/workflows/Summary.page.tsx': page });
  const f = findingOf(dir, 'LINE-OWNER', 'features/orders/workflows/Summary.page.tsx');
  assert.equal(f.fixes[0].id, 'LINE-OWNER/move-to-feature:orders:pages/ListPage');
  // The planted file is also a workflow without a base (LINE-BASE); the move fixes both, and adds nothing.
  const before = problems(dir);
  const r = applyChange(dir, planFix(dir, f, f.fixes[0].id));
  assert.equal(r.ok, true, r.sentence);
  const after = problems(dir);
  assert.deepEqual(after.filter((p) => !before.includes(p)), []);
  assert.ok(!after.some((p) => p.includes('Summary')), 'no finding is left on the moved page');
  assert.match(read(dir, 'features/orders/pages/Summary.tsx'), /^\/\/ @line-base pages\/ListPage\n/);

  const routes = project({ 'features/billing/pages/InvoicesPage.tsx': read(SAMPLE, 'features/billing/pages/InvoicesPage.tsx').replace('@line-route /billing', '@line-route /orders') });
  const fr = findingOf(routes, 'LINE-OWNER', 'features/billing/pages/InvoicesPage.tsx');
  assert.deepEqual(fr.fixes.map((x) => [x.id, x.step]), [['LINE-OWNER/own-route', null]], 'gap: Line cannot choose a route owner');

  const app = project({ 'app/login/page.tsx': 'export default function Page() {\n  return null;\n}\n' });
  const fa = findingOf(app, 'LINE-OWNER', 'app/login/page.tsx');
  assert.deepEqual(fa.fixes.map((x) => [x.id, x.step]), [['LINE-OWNER/thin-route', null]], 'gap: moving a framework route changes URLs');
});

test('LINE-LAYOUT: no library/ or features/ -> create the library folder; a loose library file -> moved into its kind', () => {
  const empty = project({ 'architecture.yml': 'version: 1\npreset: line\n', 'src/main.ts': 'export const x = 1;\n' }, { from: null });
  const f = findingOf(empty, 'LINE-LAYOUT', '.');
  assert.deepEqual(f.fixes.map((x) => x.step?.tool), ['line.createLayout']);
  applyTop(empty, f);
  assert.ok(fs.existsSync(path.join(empty, 'library/README.md')));

  const loose = project({ 'library/format.ts': 'export function money(n: number): string {\n  return `$${n}`;\n}\n' });
  const fl = findingOf(loose, 'LINE-LAYOUT', 'library/format.ts');
  assert.deepEqual(fl.fixes[0].step, { tool: 'line.moveFile', args: { from: 'library/format.ts', to: 'library/workflows/format.ts' } });
  applyTop(loose, fl);

  const folder = project({ 'library/utils/a.ts': 'export const a = 1;\n' });
  const ff = findingOf(folder, 'LINE-LAYOUT', 'library/utils');
  assert.equal(ff.fixes[0].step, null, 'gap: a stray folder needs a person to sort its files');
});

test('LINE-WRITER and LINE-SHARED: no safe mechanical fix, so one advice fix (step null) says what to do instead', () => {
  const dir = project({
    'library/workflows/save.ts': "import fs from 'node:fs';\n\nexport function save(p: string): void {\n  fs.writeFileSync(p, 'x');\n}\n",
    'library/workflows/ask.ts': "export async function ask(): Promise<Response> {\n  return fetch('http://localhost:11434/api/generate');\n}\n",
  });
  const w = findingOf(dir, 'LINE-WRITER', 'library/workflows/save.ts');
  assert.deepEqual(w.fixes.map((x) => [x.id, x.step]), [['LINE-WRITER/use-writer', null]]);
  assert.match(w.fixes[0].sentence, /writeFileSync\(\) call .*Construct's writer/);
  const s = findingOf(dir, 'LINE-SHARED', 'library/workflows/ask.ts');
  assert.deepEqual(s.fixes.map((x) => [x.id, x.step]), [['LINE-SHARED/use-shared', null]]);
  assert.match(s.fixes[0].sentence, /@mx\/reason/);
  assert.throws(() => planFix(dir, w, 'LINE-WRITER/use-writer'), (e) => e instanceof LineOpError && e.code === 'NO_STEP');
});

test('applyFix by key: lands the fix through the writer; an unknown key or a stale fix id is one refusal sentence', () => {
  const dir = project();
  const [f] = lineFindings(dir).filter((x) => x.rule === 'LINE-DIR');
  assert.throws(() => applyFix(dir, { findingKey: 'LINE-DIR|nope|1', fixId: 'LINE-DIR/promote' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_FINDING');
  assert.throws(() => applyFix(dir, { findingKey: f.key, fixId: 'LINE-DIR/nope' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_FIX');
  const r = applyFix(dir, { findingKey: f.key, fixId: 'LINE-DIR/promote' });
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.ok(!lineFindings(dir).some((x) => x.rule === 'LINE-DIR'));
});

test('the project view carries the fixes on project findings and on the feature item they point at', () => {
  const p = readLineProject(project());
  const item = p.features.find((x) => x.name === 'billing').items.find((i) => i.name === 'InvoiceCard');
  assert.equal(item.findings[0].fixes[0].id, 'LINE-BASE/set-base:components/Card');
  assert.ok(p.findings.every((x) => x.fixes.length >= 1));
  assert.deepEqual(fixesFor(SAMPLE, { sentence: 'Other.', rule: 'PAGE-001', severity: 'error', file: 'x', line: 1 }), []);
});
