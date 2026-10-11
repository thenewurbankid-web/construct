// Line workspace (cu6, packages/engine/line/workspace.mjs + applyChange in ops.mjs) on real temp copies of
// examples/line-sample: Line changes only the workspace folder; everything else stays read-only and byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBaseOn, applyChange } from '../packages/engine/line/ops.mjs';
import { readWorkspace, setWorkspace, workspaceFile, isInsideWorkspace } from '../packages/engine/line/workspace.mjs';
import { assertApplyResult, assertLineWorkspace, LineOpError } from '../packages/engine/line/contract.mjs';
import { applyFix } from '../packages/engine/line/fixes.mjs';
import { listFragments, planSetFragment } from '../packages/engine/line/fragments.mjs';
import { lineFindings } from '../packages/engine/line/model.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(here, '..', 'examples', 'line-sample');

function project() {
  const dir = makeTempDir('construct-line-ws-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

function snapshot(dir) {
  const out = {};
  const visit = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(abs, e.name), r); else out[r] = fs.readFileSync(path.join(abs, e.name), 'utf8');
    }
  };
  visit(dir, '');
  return out;
}

const isBadFolder = (e) => e instanceof LineOpError && e.code === 'BAD_FOLDER';

test('workspace: with no workspace file the whole project is the workspace, so existing behaviour is unchanged', () => {
  const dir = project();
  const w = readWorkspace(dir);
  assertLineWorkspace(w);
  assert.equal(w.folder, '');
  const r = applyChange(dir, planBaseOn(dir, { libraryId: 'components/Badge', feature: 'billing', name: 'PaidBadge' }));
  assert.equal(r.ok, true, r.sentence);
  assert.equal(fs.existsSync(path.join(dir, 'line/workspace.json')), false, 'reading never creates the file');
});

test('workspace: setting a folder writes line/workspace.json and reading it back gives the same folder', () => {
  const dir = project();
  const w = setWorkspace(dir, { folder: 'features/orders/' });
  assertLineWorkspace(w);
  assert.equal(w.folder, 'features/orders');
  assert.equal(workspaceFile(dir), 'line/workspace.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'line/workspace.json'), 'utf8')), { folder: 'features/orders' });
  assert.equal(readWorkspace(dir).folder, 'features/orders');
  assert.equal(setWorkspace(dir, { folder: '' }).folder, '');
  assert.equal(readWorkspace(dir).folder, '');
});

test('workspace: a change inside the folder lands', () => {
  const dir = project();
  setWorkspace(dir, { folder: 'features/orders' });
  const r = applyChange(dir, planBaseOn(dir, { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' }));
  assertApplyResult(r);
  assert.equal(r.ok, true, r.sentence);
  assert.ok(fs.existsSync(path.join(dir, 'features/orders/components/StatusBadge.tsx')));
});

test('workspace: a change outside the folder is refused in one sentence and nothing is written', () => {
  const dir = project();
  setWorkspace(dir, { folder: 'features/orders' });
  const before = snapshot(dir);
  const r = applyChange(dir, planBaseOn(dir, { libraryId: 'components/Badge', feature: 'billing', name: 'PaidBadge' }));
  assertApplyResult(r);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'OUTSIDE_WORKSPACE');
  assert.equal(r.sentence, 'Nothing was saved: features/billing/components/PaidBadge.tsx is outside your workspace folder features/orders; it stays read-only.');
  assert.equal(r.findings[0].rule, 'OUTSIDE_WORKSPACE');
  assert.deepEqual(snapshot(dir), before);
});

test('workspace: one file outside the folder refuses the whole change, even when the rest is inside', () => {
  const dir = project();
  setWorkspace(dir, { folder: 'features/orders' });
  const before = snapshot(dir);
  const r = applyChange(dir, { summary: 'Edits two features.', files: [
    { path: 'features/orders/components/X.tsx', content: '// @line-base components/Badge\nexport const X = 1;\n' },
    { path: 'library/components/Badge.tsx', content: 'export const Badge = 2;\n' },
  ] });
  assert.equal(r.code, 'OUTSIDE_WORKSPACE');
  assert.deepEqual(snapshot(dir), before);
});

test('workspace: a folder named like a prefix (features/orders-old) is outside features/orders', () => {
  assert.equal(isInsideWorkspace('features/orders', 'features/orders/a.tsx'), true);
  assert.equal(isInsideWorkspace('features/orders', 'features/orders-old/a.tsx'), false);
  assert.equal(isInsideWorkspace('', 'anything/at/all.ts'), true);
});

test('workspace: path traversal, absolute paths, missing folders and links out of the project are refused', () => {
  const dir = project();
  for (const folder of ['../', '../outside', 'features/../..', '/etc', 'features/./orders', '.git', 'C:/x', 'a\\b']) {
    assert.throws(() => setWorkspace(dir, { folder }), isBadFolder, folder);
  }
  assert.throws(() => setWorkspace(dir, { folder: 'features/nope' }), isBadFolder);
  assert.throws(() => setWorkspace(dir, { folder: 'features/orders/spec.md' }), isBadFolder, 'a file is not a folder');
  assert.throws(() => setWorkspace(dir, /** @type {any} */ ({ folder: 42 })), isBadFolder);
  const outside = makeTempDir('construct-line-ws-out-');
  fs.symlinkSync(outside, path.join(dir, 'escape'));
  assert.throws(() => setWorkspace(dir, { folder: 'escape' }), isBadFolder);
  assert.equal(fs.existsSync(path.join(dir, 'line/workspace.json')), false, 'a refused folder writes nothing');
});

test('workspace: a hand-edited workspace file that points outside the project makes Line refuse every change', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'line'));
  fs.writeFileSync(path.join(dir, 'line/workspace.json'), '{"folder": "../.."}');
  assert.throws(() => readWorkspace(dir), (e) => e instanceof LineOpError && e.code === 'BAD_WORKSPACE');
  const before = snapshot(dir);
  const r = applyChange(dir, planBaseOn(dir, { libraryId: 'components/Badge', feature: 'orders', name: 'StatusBadge' }));
  assertApplyResult(r);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_WORKSPACE');
  assert.deepEqual(snapshot(dir), before);
});

test('workspace: typed fixes (ca2) outside the folder are refused like any other change, and nothing is written', () => {
  const dir = project();
  setWorkspace(dir, { folder: 'features/orders' });
  const before = snapshot(dir);
  for (const rule of ['LINE-BASE', 'LINE-DIR']) {
    const f = lineFindings(dir).find((x) => x.rule === rule);
    assert.ok(f?.fixes?.[0]?.step, `${rule} has a typed fix`);
    const r = applyFix(dir, { findingKey: f.key, fixId: f.fixes[0].id });
    assertApplyResult(r);
    assert.equal(r.code, 'OUTSIDE_WORKSPACE', `${rule}: ${r.sentence}`);
    assert.match(r.sentence, /^Nothing was saved: .* is outside your workspace folder features\/orders; it stays read-only\.$/);
  }
  assert.deepEqual(snapshot(dir), before);
});

test('workspace: a code fragment edit (cx1) lands inside the folder and is refused outside it', () => {
  const file = 'features/orders/pages/OrdersPage.tsx';
  const edit = (dir) => {
    const list = listFragments(dir, file);
    return applyChange(dir, planSetFragment(dir, { file, fragmentId: list.fragments[0].id, code: "() => console.log('All orders')", contentHash: list.contentHash }));
  };
  const inside = project();
  setWorkspace(inside, { folder: 'features/orders' });
  assert.equal(edit(inside).ok, true);
  const outside = project();
  setWorkspace(outside, { folder: 'features/billing' });
  const before = snapshot(outside);
  const r = edit(outside);
  assert.equal(r.code, 'OUTSIDE_WORKSPACE');
  assert.equal(r.sentence, `Nothing was saved: ${file} is outside your workspace folder features/billing; it stays read-only.`);
  assert.deepEqual(snapshot(outside), before);
});
