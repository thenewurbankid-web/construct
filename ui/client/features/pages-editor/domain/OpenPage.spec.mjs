import test from 'node:test';
import assert from 'node:assert/strict';
import { openPageQuery, parseOpenPage, withOpenPage } from './OpenPage.ts';

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

test('withOpenPage sets and clears the open page and keeps other params', () => {
  assert.equal(withOpenPage('', { feature: 'a', file: 'x/Y.tsx' }), '?feature=a&file=x%2FY.tsx');
  assert.equal(withOpenPage('?z=1&feature=b&file=q.tsx', { feature: 'a', file: 'x.tsx' }), '?z=1&feature=a&file=x.tsx');
  assert.equal(withOpenPage('?z=1&feature=b&file=q.tsx', null), '?z=1');
  assert.equal(withOpenPage('?feature=b&file=q.tsx', null), '');
});

test('all-pages rows are feature + file, and a row id maps back to exactly that page', async () => {
  const { allPageItems, pageOfItem } = await import('./AllPages.ts');
  const pages = [{ feature: 'a', file: 'X.tsx' }, { feature: 'b', file: 'sub/X.tsx' }];
  const items = allPageItems(pages);
  assert.deepEqual(items.map((i) => [i.label, i.detail]), [['X.tsx', 'a'], ['sub/X.tsx', 'b']]);
  assert.deepEqual(pageOfItem(pages, items[1].id), pages[1]);
  assert.equal(pageOfItem(pages, 'b\u0000other'), null);
});
