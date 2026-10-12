// "What Line knows", the Change tab's service (knows/service.mjs): after a change lands, the next read of the
// proposals must not come from the graph built before it (line-knows.spec.js "Change: plan" left a second
// "Move OrderButton" proposal behind when the reload landed inside the graph's reuse window).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowsService } from '../packages/engine/line/knows/service.mjs';
import { applyChange, planPromote } from '../packages/engine/line/ops.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples/line-sample');
const FOCUS = 'item:orders/components/OrderButton';

test('a promote that lands right after a read leaves no proposal to move it again', () => {
  const root = makeTempDir('line-knows-change-');
  fs.cpSync(SAMPLE, root, { recursive: true });
  const s = createKnowsService({ root });
  const before = s.changes(FOCUS).proposals;
  assert.equal(before.filter((p) => p.kind === 'promote' && /Move OrderButton/.test(p.sentence)).length, 1);
  assert.equal(applyChange(root, planPromote(root, { featureItemId: 'orders/components/OrderButton' })).ok, true);
  // Immediately, well inside the reuse window.
  const after = s.changes(FOCUS).proposals;
  assert.deepEqual(after.filter((p) => /OrderButton/.test(p.sentence)), []);
  assert.equal(JSON.stringify(s.graph()).includes(`"${FOCUS}"`), false);
});
