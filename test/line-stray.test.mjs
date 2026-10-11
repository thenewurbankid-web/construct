// Experiment fix 2 -- Construct accepted moving OrderButton to a root-level components/ folder. LINE-LAYOUT now
// reports a source file outside library/, features/ and the app/config folders as an error in one sentence, with a
// typed fix (into the feature that alone uses it, else the library). Runs on copies of examples/line-sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { normalizeLineConfig, DEFAULT_APP_FOLDERS } from '../packages/core/profiles/line/contract.mjs';
import { runChange } from '../packages/engine/line/planTools.mjs';
import { fixesFor } from '../packages/engine/line/fixes.mjs';
import { toFinding } from '../packages/engine/line/model.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const copy = () => { const dir = makeTempDir('line-stray-'); fs.cpSync(SAMPLE, dir, { recursive: true }); return dir; };
const plant = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const layoutHits = (dir) => validateLine(dir).violations.filter((v) => v.rule === 'LINE-LAYOUT');

test('the sample still shows only its 2 planted findings', () => {
  const v = validateLine(SAMPLE).violations;
  assert.deepEqual(v.map((x) => `${x.rule} ${x.file}`).sort(), ['LINE-BASE features/billing/components/InvoiceCard.tsx', 'LINE-DIR features/billing/pages/InvoicesPage.tsx']);
});

test('moving OrderButton to a root components/ folder is refused in one sentence; the recommended fix moves it into the library in one step', () => {
  const dir = copy();
  const r = runChange(dir, 'line.moveFile', { from: 'features/orders/components/OrderButton.tsx', to: 'components/OrderButton.tsx' });
  assert.equal(r.apply.ok, false, 'Construct no longer accepts it');
  assert.equal(fs.existsSync(path.join(dir, 'components/OrderButton.tsx')), false);
  const f = r.apply.findings.find((x) => x.rule === 'LINE-LAYOUT');
  assert.equal(f.sentence, 'The source file "components/OrderButton.tsx" is outside library/ and features/, so Line cannot check or reuse it; move it into the library or into the feature that uses it.');
  assert.equal(f.severity, 'error');
  const rec = r.options.find((o) => o.id === 'fix' && o.recommended);
  // Only billing uses it (orders does not import its own button), so billing's components/ first, the library next; the
  // file only exists in the refused change, so each fix is one line.amend step.
  assert.equal(rec.step.tool, 'line.amend');
  assert.deepEqual(rec.step.args.fix, { tool: 'line.moveFile', args: { from: 'components/OrderButton.tsx', to: 'features/billing/components/OrderButton.tsx' } });
  assert.equal(rec.sentence, "Move OrderButton.tsx into feature billing's components/ folder, the only feature that uses it, together with the change Construct refused, in one step.");
  const second = r.options.find((o) => o.id === 'fix' && !o.recommended && o.step);
  assert.deepEqual(second.step.args.fix.args.to, 'library/components/OrderButton.tsx');
  const done = runChange(dir, rec.step.tool, rec.step.args);
  assert.equal(done.apply.ok, true, done.sentence);
  assert.equal(layoutHits(dir).length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'features/billing/components/OrderButton.tsx')));
  // The planted LINE-DIR (billing importing orders' button) is gone too; only the planted LINE-BASE is left.
  assert.deepEqual(validateLine(dir).violations.map((x) => `${x.rule} ${x.file}`), ['LINE-BASE features/billing/components/InvoiceCard.tsx']);
});

test('a stray file only one feature uses gets "move into that feature" first, with its base; one nobody uses goes to the library', () => {
  const dir = copy();
  plant(dir, 'widgets/Pill.tsx', "import { Badge } from '../library/components/Badge';\nexport function Pill() { return <Badge />; }\n");
  const page = path.join(dir, 'features/orders/pages/OrdersPage.tsx');
  fs.writeFileSync(page, `import { Pill } from '../../../widgets/Pill';\n${fs.readFileSync(page, 'utf8')}`);
  plant(dir, 'helpers/format.ts', 'export const format = (n: number) => String(n);\n');
  const hits = layoutHits(dir);
  assert.deepEqual(hits.map((h) => h.file).sort(), ['helpers/format.ts', 'widgets/Pill.tsx']);
  const pill = fixesFor(dir, toFinding(hits.find((h) => h.file === 'widgets/Pill.tsx')));
  assert.deepEqual(pill.map((x) => x.step?.args), [
    { from: 'widgets/Pill.tsx', to: 'features/orders/components/Pill.tsx', base: 'components/Badge' },
    { from: 'widgets/Pill.tsx', to: 'library/components/Pill.tsx' },
  ]);
  assert.equal(pill[0].sentence, "Move Pill.tsx into feature orders's components/ folder, the only feature that uses it.");
  const fmt = fixesFor(dir, toFinding(hits.find((h) => h.file === 'helpers/format.ts')));
  assert.deepEqual(fmt[0].step, { tool: 'line.moveFile', args: { from: 'helpers/format.ts', to: 'library/workflows/format.ts' } });
  // The recommended fix applies through the writer and the finding is gone.
  const r = runChange(dir, 'line.moveFile', pill[0].step.args);
  assert.equal(r.apply.ok, true, r.sentence);
  assert.deepEqual(layoutHits(dir).map((h) => h.file), ['helpers/format.ts']);
});

test('files that are fine stay quiet: root config, app routes, scripts, tests, types, Line state, package roots, src/ entry and line.appFolders', () => {
  const dir = copy();
  for (const rel of ['vite.config.ts', 'app/layout.tsx', 'app/orders/page.tsx', 'scripts/seed.mjs', 'test/orders.test.mjs', 'e2e/flow.spec.ts',
    'types/global.d.ts', 'config/env.ts', 'line/plans/x.js', 'packages/util/index.js', 'components/Thing.test.tsx', 'tools/fixtures/a.ts', 'server/index.ts']) {
    plant(dir, rel, 'export const x = 1;\n');
  }
  plant(dir, 'architecture.yml', 'version: 1\npreset: line\nline:\n  appFolders: [server]\n');
  assert.deepEqual(layoutHits(dir), []);
  assert.deepEqual(normalizeLineConfig({ appFolders: ['server/'] }).appFolders, [...DEFAULT_APP_FOLDERS, 'server']);
  assert.throws(() => normalizeLineConfig({ appFolders: 'server' }), /must be a list of path patterns/);
});

test('a project with code under src/ allows src/ entry files and src/app, and still reports src/components', () => {
  const dir = makeTempDir('line-stray-src-');
  plant(dir, 'src/library/components/Button.tsx', 'export function Button() { return null; }\n');
  plant(dir, 'src/features/orders/spec.md', '# Orders\n');
  plant(dir, 'src/main.tsx', 'export {};\n');
  plant(dir, 'src/app/layout.tsx', 'export {};\n');
  plant(dir, 'src/components/Card.tsx', 'export function Card() { return null; }\n');
  assert.deepEqual(layoutHits(dir).map((h) => h.file), ['src/components/Card.tsx']);
});

test('a project with no library/ or features/ yet is reported once, not file by file', () => {
  const dir = makeTempDir('line-stray-none-');
  plant(dir, 'components/Card.tsx', 'export function Card() { return null; }\n');
  assert.deepEqual(layoutHits(dir).map((h) => h.file), ['.']);
});
