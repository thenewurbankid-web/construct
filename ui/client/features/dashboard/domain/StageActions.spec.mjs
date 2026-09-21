import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_ACTIONS, nextOpenAction } from './StageActions.ts';

test('the Features stage offers the four forms of the retired Dashboard, in order', () => {
  assert.deepEqual(STAGE_ACTIONS.map((a) => a.id), ['create', 'refactor', 'research', 'import']);
  assert.ok(STAGE_ACTIONS.every((a) => a.label && a.hint));
});

test('choosing an action opens it, choosing it again closes it, choosing another switches', () => {
  assert.equal(nextOpenAction(null, 'create'), 'create');
  assert.equal(nextOpenAction('create', 'create'), null);
  assert.equal(nextOpenAction('create', 'import'), 'import');
});
