// Run: cd ui/client && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCxSrc, isOpenPage } from './CxSrc.ts';
import { resolvePreviewSelection } from './PreviewSelection.ts';
import { isLocalPreviewUrl, normalizePreviewUrl } from './PreviewUrl.ts';

const roots = [{ id: 'n0', line: 3, column: 5, children: [{ id: 'n1', line: 4, column: 7, children: [] }] }];

test('parseCxSrc splits from the right', () => {
  assert.deepEqual(parseCxSrc('a/b.tsx:4:7'), { file: 'a/b.tsx', line: 4, column: 7 });
  assert.equal(parseCxSrc('x'), null);
});

test('isOpenPage matches root-relative and prefixed paths only for the open page', () => {
  assert.equal(isOpenPage('features/billing/pages/Home.tsx', 'billing', 'Home.tsx'), true);
  assert.equal(isOpenPage('src/features/billing/pages/Home.tsx', 'billing', 'Home.tsx'), true);
  assert.equal(isOpenPage('features/billing/components/Home.tsx', 'billing', 'Home.tsx'), false);
});

test('resolvePreviewSelection selects the node at line:column', () => {
  assert.deepEqual(resolvePreviewSelection('features/b/pages/H.tsx:4:7', roots, 'b', 'H.tsx'), { kind: 'selected', nodeId: 'n1' });
});

test('resolvePreviewSelection reports other-file, stale and invalid', () => {
  assert.equal(resolvePreviewSelection('features/b/components/C.tsx:1:1', roots, 'b', 'H.tsx').kind, 'other-file');
  assert.equal(resolvePreviewSelection('features/b/pages/H.tsx:99:1', roots, 'b', 'H.tsx').kind, 'stale');
  assert.equal(resolvePreviewSelection('junk', roots, 'b', 'H.tsx').kind, 'invalid');
});

test('normalizePreviewUrl allows only http(s)', () => {
  assert.equal(normalizePreviewUrl(' http://localhost:5173 '), 'http://localhost:5173/');
  assert.equal(normalizePreviewUrl('javascript:alert(1)'), null);
  assert.equal(normalizePreviewUrl('file:///etc/passwd'), null);
  assert.equal(normalizePreviewUrl('nope'), null);
});

test('isLocalPreviewUrl allows only addresses on this machine (#378)', () => {
  for (const ok of ['http://localhost:5173/', 'http://127.0.0.1:5000/', 'http://[::1]:8080/', 'http://app.localhost:3000/']) assert.equal(isLocalPreviewUrl(ok), true, ok);
  for (const no of ['https://example.com/', 'http://192.168.1.10:5173/', 'http://localhost.evil.com/', 'http://10.0.0.1/', 'nope']) assert.equal(isLocalPreviewUrl(no), false, no);
});
