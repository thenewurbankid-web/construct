// Line cu6: the Components screen tags cards and feature rows outside the workspace folder "Read-only".
import test from 'node:test';
import assert from 'node:assert/strict';
import { markReadOnly, screenWithWorkspace } from './ReadOnly.ts';
import { buildLibraryView } from './LibraryView.ts';
import { mockLineProject } from '../services/LineApi.mock.ts';
import { isInWorkspace, workspaceLabel } from '../../../lib/lineWorkspacePaths.ts';

const view = () => buildLibraryView(mockLineProject());

test('read-only: with the workspace on features/orders, library cards and billing rows are read-only, orders rows are not', () => {
  const v = markReadOnly(view(), 'features/orders');
  assert.ok(v.groups.flatMap((g) => g.cards).every((c) => c.readOnly === true));
  const rows = Object.fromEntries(v.features.flatMap((f) => f.rows.map((r) => [r.file, r.readOnly])));
  assert.equal(rows['features/orders/components/OrderButton.tsx'], false);
  for (const [file, ro] of Object.entries(rows)) if (file.startsWith('features/billing/')) assert.equal(ro, true, file);
});

test('read-only: the whole project (\'\') or a workspace not read yet (null) marks nothing, and loading screens pass through', () => {
  for (const folder of ['', null]) {
    const v = markReadOnly(view(), folder);
    assert.ok(v.groups.flatMap((g) => g.cards).every((c) => !c.readOnly));
    assert.ok(v.features.flatMap((f) => f.rows).every((r) => !r.readOnly));
  }
  assert.deepEqual(screenWithWorkspace({ kind: 'loading' }, 'features/orders'), { kind: 'loading' });
});

test('read-only: a folder that only shares a prefix is outside, and the label says "Whole project" for \'\'', () => {
  assert.equal(isInWorkspace('features/orders', 'features/orders-old/X.tsx'), false);
  assert.equal(isInWorkspace('features/orders', 'features/orders/X.tsx'), true);
  assert.equal(workspaceLabel(''), 'Whole project');
  assert.equal(workspaceLabel('features/orders'), 'features/orders');
});
