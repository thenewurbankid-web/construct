// Run: cd ui/client && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalPreviewUrl, normalizePreviewUrl } from './PreviewUrl.ts';

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
