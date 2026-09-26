import test from 'node:test';
import assert from 'node:assert/strict';
import { builderReducer, initialBuilder } from './BuilderFlow.ts';

test('export opens the panel with the TSX and clears the status; closing keeps the name', () => {
  let s = builderReducer(initialBuilder, { type: 'STATUS', status: 'Saved' });
  s = builderReducer(s, { type: 'RENAMED', name: 'Categories' });
  s = builderReducer(s, { type: 'EXPORTED', tsx: 'export default function Categories() {}' });
  assert.deepEqual(s, { name: 'Categories', exported: 'export default function Categories() {}', status: '' });
  s = builderReducer(s, { type: 'EXPORT_CLOSED' });
  assert.equal(s.exported, null);
  assert.equal(s.name, 'Categories');
  assert.equal(builderReducer(s, { type: 'UNKNOWN' }), s);
});
