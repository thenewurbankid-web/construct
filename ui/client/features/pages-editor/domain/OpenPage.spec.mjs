import test from 'node:test';
import assert from 'node:assert/strict';
import { openPageQuery, parseOpenPage } from './OpenPage.ts';

test('openPageQuery / parseOpenPage round-trip, including odd characters', () => {
  const target = { feature: 'dash board', file: 'sub/Page & More.tsx' };
  assert.deepEqual(parseOpenPage(openPageQuery(target)), target);
});

test('parseOpenPage needs both feature and file', () => {
  assert.equal(parseOpenPage(''), null);
  assert.equal(parseOpenPage('?feature=a'), null);
  assert.equal(parseOpenPage('?file=x.tsx'), null);
  assert.deepEqual(parseOpenPage('?feature=a&file=x.tsx'), { feature: 'a', file: 'x.tsx' });
});
