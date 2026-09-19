import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describePageChange, adoptOwnWrite } from './pageChanges.mjs';
import { createChangeTracker } from '../../../src/file-change-tracker.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

test('external write is reported with a diff; own write is not', () => {
  const dir = makeTempDir('page-changes-');
  const abs = path.join(dir, 'P.tsx');
  const tracker = createChangeTracker();
  fs.writeFileSync(abs, 'a\nb\n');
  assert.equal(describePageChange(abs, 'P.tsx', tracker).change, null);
  fs.writeFileSync(abs, 'a\nB\n');
  const { change } = describePageChange(abs, 'P.tsx', tracker);
  assert.deepEqual(change.stats, { added: 1, removed: 1 });
  assert.ok(change.rows.some((r) => r.kind === 'added' && r.text === 'B'));
  // still reported on the next poll until dismissed
  assert.ok(describePageChange(abs, 'P.tsx', tracker).change);
  // the editor's own save clears it and is not re-reported
  fs.writeFileSync(abs, 'a\nC\n');
  adoptOwnWrite('P.tsx', 'a\nC\n', tracker);
  assert.equal(describePageChange(abs, 'P.tsx', tracker).change, null);
  fs.rmSync(dir, { recursive: true, force: true });
});
