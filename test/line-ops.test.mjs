// Line Cockpit operations (T2, packages/engine/line/ops.mjs) on real temp copies of the passing Line fixture:
// the same behaviours test/line-contract.test.mjs proves over the mock, now against the real planners and the
// real writer, judged by the real `construct validate --profile line`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planBaseOn, planPromote, applyChange } from '../packages/engine/line/ops.mjs';
import { assertStagedChange, assertApplyResult, LineOpError } from '../packages/engine/line/contract.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PASSING = path.join(here, '..', 'packages', 'core', 'profiles', 'line', 'fixtures', 'passing');
const bin = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

/** A scratch copy of the passing fixture, with files added or replaced. */
function project(overlay = {}) {
  const dir = makeTempDir('construct-line-ops-');
  fs.cpSync(PASSING, dir, { recursive: true });
  for (const [rel, text] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** Every file under `dir` with its bytes, for byte-identical comparisons. */
function snapshot(dir) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(abs, e.name), r); else out[r] = fs.readFileSync(path.join(abs, e.name)).toString('base64');
    }
  };
  visit(dir, '');
  return out;
}

const errorsOf = (dir) => validateLine(dir).violations.filter((v) => v.severity === 'error');
const cliValidate = (dir) => spawnSync(process.execPath, [bin, 'validate', '--profile', 'line'], { cwd: dir, encoding: 'utf8' });

/** A billing page that imports the orders feature's OrderButton: the cross-feature import promote fixes. */
const CROSS = {
  'features/billing/pages/InvoicesPage.tsx': "// @line-base pages/ListPage\n// @line-route /billing\nimport { ListPage } from '../../../library/pages/ListPage';\nimport { OrderButton } from '../../orders/components/OrderButton';\n\nexport function InvoicesPage() {\n  return <ListPage title=\"Invoices\" />;\n}\n\nexport const Extra = OrderButton;\n",
};

test('ops: base-on plans one wrapped feature file and writes nothing; applying it lands it and validate --profile line stays clean', () => {
  const dir = project();
  const before = snapshot(dir);
  const change = planBaseOn(dir, { libraryId: 'components/Button', feature: 'billing', name: 'PayButton' });
  assertStagedChange(change);
  assert.equal(change.summary, 'Creates PayButton in feature billing, based on the library Button.');
  assert.deepEqual(change.files.map((f) => f.path), ['features/billing/components/PayButton.tsx']);
  const src = change.files[0].content;
  assert.match(src, /^\/\/ @line-base components\/Button\n/);
  assert.match(src, /import \{ Button \} from '\.\.\/\.\.\/\.\.\/library\/components\/Button';/);
  assert.match(src, /export function PayButton\(props: ComponentProps<typeof Button>\) \{\n {2}return <Button \{\.\.\.props\} \/>;/);
  assert.deepEqual(snapshot(dir), before, 'planning writes nothing');

  const r = applyChange(dir, change);
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.equal(r.sentence, 'Saved. Creates PayButton in feature billing, based on the library Button.');
  assert.deepEqual(r.files, ['features/billing/components/PayButton.tsx']);
  assert.equal(fs.readFileSync(path.join(dir, r.files[0]), 'utf8'), src);
  const cli = cliValidate(dir);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
});

test('ops: base-on works for every kind (page, workflow, fixture) and each lands clean', () => {
  const dir = project();
  const reqs = [
    { libraryId: 'pages/ListPage', feature: 'billing', name: 'PaymentsPage', path: 'features/billing/pages/PaymentsPage.tsx', has: /return <ListPage \{\.\.\.props\} \/>/ },
    { libraryId: 'workflows/checkout', feature: 'billing', name: 'billingCheckout', path: 'features/billing/workflows/billingCheckout.ts', has: /^\/\/ @line-base workflows\/checkout\nexport \* from '\.\.\/\.\.\/\.\.\/library\/workflows\/checkout';\n$/ },
    { libraryId: 'fixtures/user', feature: 'billing', name: 'payer', path: 'features/billing/fixtures/payer.json', has: /^\{\n {2}"\$lineBase": "fixtures\/user",/ },
  ];
  for (const { path: want, has, ...req } of reqs) {
    const change = planBaseOn(dir, req);
    assertStagedChange(change);
    assert.equal(change.files[0].path, want);
    assert.match(change.files[0].content, has);
    const r = applyChange(dir, change);
    assertApplyResult(r);
    assert.equal(r.ok, true, r.sentence);
  }
  assert.deepEqual(errorsOf(dir), []);
});

test('ops: base-on refusals are one-sentence LineOpErrors with their codes, and the tree stays byte-identical', () => {
  const dir = project();
  const before = snapshot(dir);
  const refused = (req, code) => assert.throws(() => planBaseOn(dir, req), (e) => e instanceof LineOpError && e.code === code && /^\S[^\n]*[.?!]$/.test(e.sentence));
  refused({ libraryId: 'components/Nope', feature: 'orders', name: 'X' }, 'UNKNOWN_ITEM');
  refused({ libraryId: 'components/../../features/orders/components/OrderButton', feature: 'orders', name: 'X' }, 'UNKNOWN_ITEM');
  refused({ libraryId: 'components/Button', feature: 'nowhere', name: 'X' }, 'UNKNOWN_FEATURE');
  refused({ libraryId: 'components/Button', feature: '..', name: 'X' }, 'UNKNOWN_FEATURE');
  refused({ libraryId: 'components/Button', feature: 'orders', name: 'orderButton' }, 'BAD_NAME');
  refused({ libraryId: 'components/Button', feature: 'orders', name: '../Evil' }, 'BAD_NAME');
  refused({ libraryId: 'components/Button', feature: 'orders', name: 'OrderButton' }, 'NAME_TAKEN');
  refused({ libraryId: 'workflows/checkout', feature: 'orders', name: 'orderCheckout' }, 'NAME_TAKEN');
  assert.throws(() => planPromote(dir, { featureItemId: 'orders/components/Nope' }), (e) => e instanceof LineOpError && e.code === 'UNKNOWN_ITEM');
  assert.deepEqual(snapshot(dir), before);
});

test('ops: applyChange refuses a cross-feature import with LINE-DIR, explains it in one sentence, and nothing lands', () => {
  const dir = project();
  const before = snapshot(dir);
  const bad = {
    summary: 'Adds a cross-feature import.',
    files: [
      { path: 'features/billing/components/Cross.tsx', content: "// @line-base components/Button\nimport { OrderButton } from '../../orders/components/OrderButton';\n\nexport function Cross() {\n  return <OrderButton />;\n}\n" },
      { path: 'features/billing/spec.md', content: '# Billing, edited\n' },
    ],
  };
  const r = applyChange(dir, bad);
  assertApplyResult(r);
  assert.equal(r.ok, false);
  assert.deepEqual(r.files, []);
  const dirFinding = r.findings.find((f) => f.rule === 'LINE-DIR');
  assert.ok(dirFinding, JSON.stringify(r.findings));
  assert.equal(dirFinding.file, 'features/billing/components/Cross.tsx');
  assert.equal(r.findings[0].severity, 'error');
  assert.equal(r.sentence, `Nothing was saved: ${r.findings[0].sentence.charAt(0).toLowerCase()}${r.findings[0].sentence.slice(1)}`);
  assert.deepEqual(snapshot(dir), before, 'neither file landed, not even the harmless one');
});

test('ops: promote moves the item into the library, fixes its users, and the cross-feature finding goes away', () => {
  const dir = project(CROSS);
  assert.ok(errorsOf(dir).some((v) => v.rule === 'LINE-DIR' && v.file === 'features/billing/pages/InvoicesPage.tsx'), 'the starting tree has the cross-feature import');
  const before = snapshot(dir);
  const change = planPromote(dir, { featureItemId: 'orders/components/OrderButton' });
  assertStagedChange(change);
  assert.deepEqual(snapshot(dir), before, 'planning writes nothing');
  assert.deepEqual(change.files.map((f) => `${f.path}:${f.content === null ? 'delete' : 'write'}`).sort(), [
    'features/billing/pages/InvoicesPage.tsx:write',
    'features/orders/components/OrderButton.tsx:delete',
    'features/orders/components/index.ts:write',
    'library/components/OrderButton.tsx:write',
  ]);
  const byPath = Object.fromEntries(change.files.map((f) => [f.path, f.content]));
  const moved = byPath['library/components/OrderButton.tsx'];
  assert.doesNotMatch(moved, /@line-base/);
  assert.match(moved, /^import \{ Button \} from '\.\/Button';/);
  assert.match(byPath['features/billing/pages/InvoicesPage.tsx'], /import \{ OrderButton \} from '\.\.\/\.\.\/\.\.\/library\/components\/OrderButton';/);
  assert.match(byPath['features/orders/components/index.ts'], /from '\.\.\/\.\.\/\.\.\/library\/components\/OrderButton'/);

  const r = applyChange(dir, change);
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.equal(fs.existsSync(path.join(dir, 'features/orders/components/OrderButton.tsx')), false);
  assert.deepEqual(errorsOf(dir), []);
  const cli = cliValidate(dir);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
});

test('ops: promote rewrites an at-sign alias importer to the library path', () => {
  const dir = project({
    'features/billing/components/PayButton.tsx': "// @line-base components/Button\nimport { OrderButton } from '@/features/orders/components/OrderButton';\n\nexport function PayButton() {\n  return <OrderButton />;\n}\n",
  });
  const change = planPromote(dir, { featureItemId: 'orders/components/OrderButton' });
  const pay = change.files.find((f) => f.path === 'features/billing/components/PayButton.tsx');
  assert.match(pay.content, /from '@\/library\/components\/OrderButton'/);
  assert.equal(applyChange(dir, change).ok, true);
  assert.deepEqual(errorsOf(dir), []);
});

test('ops: promote uses the TypeScript engine when the project has a tsconfig.json, with the same result', () => {
  const dir = project({ ...CROSS, 'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@/*': ['./*'] } } }) });
  const change = planPromote(dir, { featureItemId: 'orders/components/OrderButton' });
  const byPath = Object.fromEntries(change.files.map((f) => [f.path, f.content]));
  assert.match(byPath['library/components/OrderButton.tsx'], /from '\.\/Button'/);
  assert.match(byPath['features/billing/pages/InvoicesPage.tsx'], /from '\.\.\/\.\.\/\.\.\/library\/components\/OrderButton'/);
  assert.equal(applyChange(dir, change).ok, true);
  assert.deepEqual(errorsOf(dir), []);
});

test('ops: promote refuses when the library already has that name, and a promote that would make the library import a feature is refused by applyChange', () => {
  const dir = project({ 'library/components/OrderButton.tsx': 'export function OrderButton() {\n  return <button type="button">Order</button>;\n}\n' });
  assert.throws(() => planPromote(dir, { featureItemId: 'orders/components/OrderButton' }), (e) => e instanceof LineOpError && e.code === 'NAME_TAKEN');

  const dir2 = project({
    'features/orders/components/OrderBadge.tsx': "// @line-base components/Button\nimport { OrderButton } from './OrderButton';\n\nexport function OrderBadge() {\n  return <OrderButton />;\n}\n",
  });
  const before = snapshot(dir2);
  const r = applyChange(dir2, planPromote(dir2, { featureItemId: 'orders/components/OrderBadge' }));
  assertApplyResult(r);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.rule === 'LINE-DIR' && f.file === 'library/components/OrderBadge.tsx'), JSON.stringify(r.findings));
  assert.deepEqual(snapshot(dir2), before, 'the refused move left the feature file in place and wrote nothing');
});

test('ops: a write outside the project is impossible: escaping paths and links are refused before anything is staged', () => {
  const outside = makeTempDir('construct-line-ops-outside-');
  const dir = project();
  fs.symlinkSync(outside, path.join(dir, 'features', 'billing', 'components'));
  const before = snapshot(outside);
  const tries = ['../escape.tsx', '/etc/escape.tsx', 'features/../../escape.tsx', 'features/billing/components/Leak.tsx', 'features\\..\\..\\escape.tsx', '.git/config'];
  for (const p of tries) {
    const r = applyChange(dir, { summary: 'Escapes.', files: [{ path: p, content: 'export const x = 1;\n' }] });
    assertApplyResult(r);
    assert.equal(r.ok, false, p);
    assert.match(r.sentence, /^Nothing was saved: /);
  }
  assert.deepEqual(snapshot(outside), before);
  assert.equal(fs.existsSync(path.join(path.dirname(dir), 'escape.tsx')), false);
});
